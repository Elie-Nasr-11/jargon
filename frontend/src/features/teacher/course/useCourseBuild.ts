/**
 * Getting a book into a class, and checking what came out.
 *
 * Job 1 and job 2. The outline pass names the units and lessons; the runner then
 * fills each lesson by looping the package engine — sequentially, because one
 * generation is a ~40s model call and a book makes twenty of them. Progress is
 * per lesson, cancellable between lessons, and a failure is captured and
 * retryable rather than killing the run.
 *
 * Everything it writes lands as a DRAFT. Job 2 is the review gate: it reports
 * what is actually in each lesson, flags what is broken as data, and publishes
 * only the set the teacher ticked.
 */
import { useCallback, useRef, useState } from "react";
import {
  createCurriculumLessonStub,
  createCurriculumUnit,
  generateCurriculumDraft,
  getSession,
  publishLessons,
  reviewUnit,
} from "@/lib/api";
import { notifyErr, notifyOk } from "@/lib/feedback";
import { sliceMaterialForLesson } from "@/lib/materialText";
import { writeLessonPackage } from "@/features/teacher/authoring/lessonPackage";
import type { CourseBuild, CourseBuildItem } from "@/features/teacher/authoring/stepModel";
import type { OutlineGenArgs } from "@/features/teacher/authoring/types";
import type { CourseData } from "@/features/teacher/course/useCourseData";
import type { LessonReview } from "@/lib/api";
import type { CurriculumLessonPackage, CurriculumOutlineDraft } from "@/lib/types";

export function useCourseBuild(classId: string, course: CourseData) {
  const { classSummary, currentVersionForCourse, resync, setBusy } = course;
  const [build, setBuild] = useState<CourseBuild | null>(null);
  const buildCancel = useRef(false);

  const [review, setReview] = useState<{
    open: boolean;
    loading: boolean;
    rows: LessonReview[];
    picked: Set<string>;
    publishing: boolean;
  }>({ open: false, loading: false, rows: [], picked: new Set(), publishing: false });

  const generateOutline = useCallback(
    async (courseId: string, args: OutlineGenArgs): Promise<CurriculumOutlineDraft | null> => {
      if (!classSummary) return null;
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to use AI authoring.");
        const result = await generateCurriculumDraft({
          accessToken: session.access_token,
          classId,
          organizationId: classSummary.organization_id,
          courseId,
          mode: "course_outline",
          prompt: args.prompt,
          referenceText: args.referenceText,
          current: args.current,
          feedback: args.feedback,
          target: args.target,
        });
        return result.outline || { units: [] };
      } catch (error) {
        notifyErr(error, "Could not draft an outline.");
        return null;
      }
    },
    [classSummary, classId],
  );

  /** One lesson's worth of generation: steps, wrap-up quiz, assignment brief. */
  const generatePackage = useCallback(
    async (args: {
      unitId?: string;
      prompt: string;
      referenceText: string;
      includeQuiz: boolean;
      includeAssignment: boolean;
      quiet?: boolean;
    }): Promise<CurriculumLessonPackage | null> => {
      if (!classSummary) return null;
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to use AI authoring.");
        const result = await generateCurriculumDraft({
          accessToken: session.access_token,
          classId,
          mode: "lesson_package",
          unitId: args.unitId,
          prompt: args.prompt,
          referenceText: args.referenceText,
          includeQuiz: args.includeQuiz,
          includeAssignment: args.includeAssignment,
        });
        return result.package || null;
      } catch (error) {
        if (args.quiet) throw error;
        notifyErr(error, "Could not build the lesson.");
        return null;
      }
    },
    [classSummary, classId],
  );

  /** Apply writes through the SAME actions manual authoring uses — no bulk path. */
  const applyPackage = useCallback(
    (unitId: string, pkg: CurriculumLessonPackage) =>
      course.reloading(async (accessToken) => {
        await writeLessonPackage({ accessToken, classId, unitId, pkg });
        notifyOk("Lesson drafted from your material.");
      }, "Could not write the lesson."),
    [course, classId],
  );

  const runCourseBuild = useCallback(
    async (plan: CourseBuild) => {
      buildCancel.current = false;
      setBuild(plan);
      const session = await getSession();
      if (!session) {
        notifyErr(new Error("Sign in to build a course."), "Sign in to build a course.");
        setBuild({ ...plan, running: false });
        return;
      }
      const patchItem = (index: number, next: Partial<CourseBuildItem>) =>
        setBuild((current) =>
          current
            ? {
                ...current,
                items: current.items.map((item, i) => (i === index ? { ...item, ...next } : item)),
              }
            : current,
        );

      for (let i = 0; i < plan.items.length; i += 1) {
        if (buildCancel.current) {
          setBuild((current) =>
            current ? { ...current, running: false, canceled: true } : current,
          );
          await resync();
          return;
        }
        const item = plan.items[i];
        // Only queued work runs, so a retry never regenerates a finished lesson.
        if (item.status !== "queued") continue;
        patchItem(i, { status: "building", error: "" });
        try {
          const pkg = await generatePackage({
            unitId: item.unitId,
            // Each lesson reads only ITS slice of the upload: hand a whole book to every
            // lesson and they all drift to the same loud chapter.
            prompt: `Lesson "${item.lessonTitle}" in the unit "${item.unitTitle}". Teach exactly this and nothing from neighbouring lessons.`,
            referenceText: item.material,
            includeQuiz: plan.includeQuiz,
            includeAssignment: plan.includeAssignment,
            quiet: true,
          });
          if (!pkg) throw new Error("The model returned nothing for this lesson.");
          await writeLessonPackage({
            accessToken: session.access_token,
            classId: plan.classId,
            unitId: item.unitId,
            pkg,
          });
          patchItem(i, { status: "done", builtTitle: pkg.lesson.title });
          // Refresh as we go: lessons appear in the outline instead of behind a spinner.
          await resync();
        } catch (error) {
          patchItem(i, {
            status: "failed",
            error: (error as Error).message || "Generation failed.",
          });
        }
      }
      setBuild((current) => (current ? { ...current, running: false } : current));
      await resync();
    },
    [generatePackage, resync],
  );

  /** Units are created up front (the run needs their ids); lessons are not stubbed —
   *  each package write creates its own, so a cancelled run leaves no empty shells. */
  const startCourseBuild = useCallback(
    (
      courseId: string,
      outline: CurriculumOutlineDraft,
      options: { material: string; includeQuiz: boolean; includeAssignment: boolean },
    ) => {
      const version = currentVersionForCourse(courseId);
      if (!version) {
        notifyErr(new Error("no version"), "This course has no version to add units to.");
        return;
      }
      setBusy(true);
      void (async () => {
        try {
          const session = await getSession();
          if (!session) throw new Error("Sign in to build a course.");
          const items: CourseBuildItem[] = [];
          for (const unit of outline.units) {
            const created = await createCurriculumUnit({
              accessToken: session.access_token,
              classId,
              courseVersionId: version.id,
              title: unit.title,
            });
            if (!created.id) continue;
            for (const lesson of unit.lessons) {
              items.push({
                unitId: created.id,
                unitTitle: unit.title,
                lessonTitle: lesson.title,
                material: options.material ? sliceMaterialForLesson(options.material, lesson) : "",
                status: "queued",
                error: "",
                builtTitle: "",
              });
            }
          }
          await resync();
          if (!items.length) {
            notifyOk("Outline applied.");
            return;
          }
          void runCourseBuild({
            classId,
            courseId,
            items,
            includeQuiz: options.includeQuiz,
            includeAssignment: options.includeAssignment,
            running: true,
            canceled: false,
          });
        } catch (error) {
          notifyErr(error, "Could not start the build.");
        } finally {
          setBusy(false);
        }
      })();
    },
    [currentVersionForCourse, setBusy, classId, resync, runCourseBuild],
  );

  const applyOutline = useCallback(
    (courseId: string, outline: CurriculumOutlineDraft) =>
      course.reloading(async (accessToken) => {
        const version = currentVersionForCourse(courseId);
        if (!version) throw new Error("This course has no version to add units to.");
        for (const unit of outline.units) {
          const created = await createCurriculumUnit({
            accessToken,
            classId,
            courseVersionId: version.id,
            title: unit.title,
          });
          if (!created.id) continue;
          for (const lesson of unit.lessons) {
            await createCurriculumLessonStub({
              accessToken,
              classId,
              unitId: created.id,
              title: lesson.title,
            });
          }
        }
        notifyOk("Outline applied.");
      }, "Could not apply the outline."),
    [course, currentVersionForCourse, classId],
  );

  const cancelBuild = useCallback(() => {
    buildCancel.current = true;
  }, []);

  const retryBuildItem = useCallback(
    (index: number) => {
      if (!build || build.running) return;
      void runCourseBuild({
        ...build,
        running: true,
        canceled: false,
        items: build.items.map((item, i) =>
          i === index ? { ...item, status: "queued", error: "" } : item,
        ),
      });
    },
    [build, runCourseBuild],
  );

  const resumeBuild = useCallback(() => {
    if (!build || build.running) return;
    void runCourseBuild({
      ...build,
      running: true,
      canceled: false,
      items: build.items.map((item) =>
        item.status === "done" ? item : { ...item, status: "queued", error: "" },
      ),
    });
  }, [build, runCourseBuild]);

  const dismissBuild = useCallback(() => setBuild(null), []);

  // --- the review gate ------------------------------------------------------

  /** Read what the build actually wrote, across every unit that still has drafts. */
  const openReview = useCallback(
    (unitIds: string[]) => {
      if (!classSummary || !unitIds.length) return;
      setReview({ open: true, loading: true, rows: [], picked: new Set(), publishing: false });
      void (async () => {
        try {
          const session = await getSession();
          if (!session) throw new Error("Sign in to review lessons.");
          const rows: LessonReview[] = [];
          for (const unitId of unitIds) {
            const result = await reviewUnit({
              accessToken: session.access_token,
              unitId,
              organizationId: classSummary.organization_id,
              classId,
            });
            rows.push(...result.lessons);
          }
          setReview({
            open: true,
            loading: false,
            rows,
            // Pre-tick everything publishable: the common case is "this all looks right",
            // and a teacher who disagrees unticks. Blocked lessons are never pre-ticked.
            picked: new Set(
              rows
                .filter((row) => row.ready && row.publication_status !== "published")
                .map((row) => row.lesson_id),
            ),
            publishing: false,
          });
        } catch (error) {
          notifyErr(error, "Could not read the lessons for review.");
          setReview((current) => ({ ...current, open: false, loading: false }));
        }
      })();
    },
    [classSummary, classId],
  );

  const closeReview = useCallback(() => setReview((current) => ({ ...current, open: false })), []);

  const toggleReviewPick = useCallback((lessonId: string) => {
    setReview((current) => {
      const picked = new Set(current.picked);
      if (picked.has(lessonId)) picked.delete(lessonId);
      else picked.add(lessonId);
      return { ...current, picked };
    });
  }, []);

  const publishReviewed = useCallback(() => {
    if (!classSummary || !review.picked.size) return;
    const ids = [...review.picked];
    setReview((current) => ({ ...current, publishing: true }));
    void (async () => {
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to publish lessons.");
        const result = await publishLessons({
          accessToken: session.access_token,
          lessonIds: ids,
          organizationId: classSummary.organization_id,
          classId,
        });
        notifyOk(
          result.failed
            ? `${result.published} published, ${result.failed} could not be — open those and try again.`
            : `${result.published} ${result.published === 1 ? "lesson is" : "lessons are"} live for students.`,
        );
        // Keep the gate open on whatever did not land, so failures stay visible.
        const landed = new Set(
          result.results.filter((row) => row.status === "published").map((row) => row.lesson_id),
        );
        setReview((current) => ({
          ...current,
          publishing: false,
          rows: current.rows.map((row) =>
            landed.has(row.lesson_id) ? { ...row, publication_status: "published" } : row,
          ),
          picked: new Set([...current.picked].filter((id) => !landed.has(id))),
        }));
        await resync();
      } catch (error) {
        notifyErr(error, "Could not publish those lessons.");
        setReview((current) => ({ ...current, publishing: false }));
      }
    })();
  }, [classSummary, review.picked, classId, resync]);

  return {
    build,
    cancelBuild,
    retryBuildItem,
    resumeBuild,
    dismissBuild,
    generateOutline,
    applyOutline,
    startCourseBuild,
    generatePackage,
    applyPackage,
    review,
    openReview,
    closeReview,
    toggleReviewPick,
    publishReviewed,
  };
}
