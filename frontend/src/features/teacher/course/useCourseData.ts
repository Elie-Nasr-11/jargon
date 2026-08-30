/**
 * The class's course, as an outline — and every write that changes its shape.
 *
 * A class teaches one course; its units and lessons are the outline. Courses and
 * subjects are plumbing a teacher never sees: when a class has no course yet,
 * the first "Add a unit" quietly creates one named after the class and links it.
 *
 * Everything here is structure. What is INSIDE a lesson belongs to the lesson's
 * own screen, which is why nothing in this file touches a step.
 */
import { useCallback, useMemo, useState } from "react";
import {
  createCurriculumCourse,
  createCurriculumLessonStub,
  createCurriculumSubject,
  createCurriculumUnit,
  deleteCurriculumNode,
  duplicateCourseForClass,
  fetchClassCourseLinks,
  getSession,
  moveCurriculumLesson,
  renameCurriculumNode,
  reorderCurriculumNodes,
  setClassCourses,
} from "@/lib/api";
import { notifyErr, notifyOk } from "@/lib/feedback";
import { useUndoable } from "@/hooks/useUndoable";
import { useAuthoringData } from "@/features/teacher/authoring/useAuthoringData";
import {
  byPositionThenTitle,
  cascadeRemove,
  collectRemovedRows,
  lessonOrder,
  mergeRows,
  nodeLabel,
  renameNodeLocal,
  reorderNodesLocal,
} from "@/features/teacher/authoring/localState";
import { useQuery } from "@tanstack/react-query";
import type {
  CurriculumAuthoringData,
  CurriculumCourse,
  CurriculumNodeType,
  CurriculumUnit,
  Lesson,
} from "@/lib/types";

export type CourseData = ReturnType<typeof useCourseData>;

export function useCourseData(classId: string) {
  const authoring = useAuthoringData(classId);
  const { data, patch, resync, optimistic, reloading, classSummary } = authoring;
  const undoable = useUndoable();
  const [renamingUnitId, setRenamingUnitId] = useState<string | null>(null);

  // Which courses this class is linked to. Unknown links mean an unscoped fallback,
  // never a hidden catalog — a class must not silently teach something it did not link.
  const linksQuery = useQuery({
    queryKey: ["classCourseLinks", data?.classes.map((row) => row.id).join(",") ?? ""],
    queryFn: () =>
      fetchClassCourseLinks((data as CurriculumAuthoringData).classes.map((row) => row.id)),
    enabled: Boolean(data?.classes.length),
    staleTime: 60 * 1000,
  });
  const classLinks = linksQuery.data ?? null;

  const linkedCourseIds = useMemo(() => {
    if (!classLinks) return null;
    return new Set(
      classLinks.filter((row) => row.class_id === classId).map((row) => row.course_id),
    );
  }, [classLinks, classId]);

  const orgSubjects = useMemo(() => {
    if (!data || !classSummary) return [];
    // Subjects with a NULL organization_id are GLOBAL shared content — every published
    // course in production lives under one, so they must stay visible here.
    return data.subjects
      .filter(
        (subject) =>
          subject.organization_id === classSummary.organization_id ||
          subject.organization_id === null,
      )
      .sort(byPositionThenTitle);
  }, [data, classSummary]);

  const coursesForSubject = useCallback(
    (subjectId: string) =>
      (data?.courses || [])
        .filter(
          (course) =>
            course.subject_id === subjectId &&
            (!course.organization_id || course.organization_id === classSummary?.organization_id),
        )
        .sort(byPositionThenTitle),
    [data, classSummary],
  );

  const currentVersionForCourse = useCallback(
    (courseId: string) => {
      const versions = (data?.courseVersions || []).filter(
        (version) => version.course_id === courseId,
      );
      return versions.find((version) => version.is_current) || versions[0] || null;
    },
    [data],
  );

  const unitsForCourse = useCallback(
    (courseId: string) => {
      const version = currentVersionForCourse(courseId);
      if (!version) return [] as CurriculumUnit[];
      return (data?.units || [])
        .filter((unit) => unit.course_version_id === version.id)
        .sort(byPositionThenTitle);
    },
    [data, currentVersionForCourse],
  );

  const lessonsForUnit = useCallback(
    (unitId: string) =>
      (data?.lessons || []).filter((lesson) => lesson.unit_id === unitId).sort(lessonOrder),
    [data],
  );

  /** The units this class actually teaches, in order, with the course they came from. */
  const outlineUnits = useMemo(() => {
    if (!data || !classSummary)
      return [] as Array<{ unit: CurriculumUnit; course: CurriculumCourse | null }>;
    const rows: Array<{ unit: CurriculumUnit; course: CurriculumCourse | null }> = [];
    for (const subject of orgSubjects) {
      for (const course of coursesForSubject(subject.id)) {
        if (linkedCourseIds && !linkedCourseIds.has(course.id)) continue;
        for (const unit of unitsForCourse(course.id)) rows.push({ unit, course });
      }
    }
    return rows;
  }, [data, classSummary, orgSubjects, coursesForSubject, linkedCourseIds, unitsForCourse]);

  const stepCountByLesson = useMemo(() => {
    const counts = new Map<string, number>();
    for (const activity of data?.activities || []) {
      counts.set(activity.lesson_id, (counts.get(activity.lesson_id) || 0) + 1);
    }
    return counts;
  }, [data]);
  const stepCountFor = useCallback(
    (lessonId: string) => stepCountByLesson.get(lessonId) || 0,
    [stepCountByLesson],
  );

  const bookPages = useMemo(
    () => new Map(Object.entries(data?.bookPages || {})),
    [data?.bookPages],
  );

  /** Lessons students cannot see yet — the review banner's subject. */
  const drafts = useMemo(() => {
    const rows: Array<{ lesson: Lesson; unitId: string }> = [];
    for (const { unit } of outlineUnits) {
      for (const lesson of lessonsForUnit(unit.id)) {
        if ((lesson.publication_status || "published") !== "published") {
          rows.push({ lesson, unitId: unit.id });
        }
      }
    }
    return rows;
  }, [outlineUnits, lessonsForUnit]);

  const peerClassNames = useCallback(
    (courseId: string) => {
      if (!classLinks || !data) return [] as string[];
      return classLinks
        .filter((row) => row.course_id === courseId && row.class_id !== classId)
        .map(
          (row) => data.classes.find((item) => item.id === row.class_id)?.name || "another class",
        );
    },
    [classLinks, data, classId],
  );

  /** A shared or global course cannot be edited in place — fork it for this class first. */
  const sharedNotice = useMemo(() => {
    const course =
      outlineUnits.find(({ course: c }) => c && (!c.organization_id || peerClassNames(c.id).length))
        ?.course ?? null;
    if (!course) return null;
    const peers = peerClassNames(course.id);
    const isGlobal = !course.organization_id;
    return peers.length || isGlobal
      ? { courseId: course.id, names: peers.join(", "), isGlobal }
      : null;
  }, [outlineUnits, peerClassNames]);

  // --- writes ---------------------------------------------------------------

  /** Units need a home course. Courses are invisible, so this resolves or creates one. */
  const ensureBackingCourse = useCallback(
    async (accessToken: string): Promise<{ courseId: string; versionId: string }> => {
      if (!classSummary) throw new Error("This class is not one of yours.");
      for (const subject of orgSubjects) {
        for (const course of coursesForSubject(subject.id)) {
          if (
            course.organization_id === classSummary.organization_id &&
            linkedCourseIds?.has(course.id)
          ) {
            const versionId = currentVersionForCourse(course.id)?.id ?? null;
            if (!versionId) throw new Error("The class course has no version to add a unit to.");
            return { courseId: course.id, versionId };
          }
        }
      }
      const subject = await createCurriculumSubject({
        accessToken,
        classId,
        organizationId: classSummary.organization_id,
        title: classSummary.name,
      });
      const subjectId = (subject as { id?: string } | null)?.id;
      if (!subjectId) throw new Error("Could not create the class curriculum home.");
      const course = await createCurriculumCourse({
        accessToken,
        classId,
        subjectId,
        title: classSummary.name,
      });
      const courseId = (course as { id?: string } | null)?.id;
      const versionId =
        (course as { course_version_id?: string } | null)?.course_version_id ?? null;
      if (!courseId || !versionId) throw new Error("Could not create the class curriculum home.");
      // Only link from a KNOWN baseline: saving the link set when the current one
      // could not be read would silently drop every course this class already teaches.
      if (classLinks) {
        const mine = classLinks
          .filter((row) => row.class_id === classId)
          .map((row) => row.course_id);
        await setClassCourses({
          accessToken,
          classId,
          courseIds: Array.from(new Set([...mine, courseId])),
        });
        await linksQuery.refetch();
      }
      return { courseId, versionId };
    },
    [
      classSummary,
      orgSubjects,
      coursesForSubject,
      linkedCourseIds,
      currentVersionForCourse,
      classId,
      classLinks,
      linksQuery,
    ],
  );

  const addUnit = useCallback(
    () =>
      reloading(
        async (accessToken) => {
          const { versionId } = await ensureBackingCourse(accessToken);
          return createCurriculumUnit({
            accessToken,
            classId,
            courseVersionId: versionId,
            title: "New unit",
          });
        },
        "Could not add the unit.",
        (result) => {
          // The new unit lands with its name in edit: type it, press Enter.
          const id = (result as { id?: string } | null)?.id;
          if (id) setRenamingUnitId(id);
        },
      ),
    [reloading, ensureBackingCourse, classId],
  );

  const addLesson = useCallback(
    (unitId: string, onCreated?: (lessonId: string) => void) =>
      reloading(
        (accessToken) =>
          createCurriculumLessonStub({ accessToken, classId, unitId, title: "New lesson" }),
        "Could not add the lesson.",
        (result) => {
          const id = (result as { id?: string } | null)?.id;
          if (id) onCreated?.(id);
        },
      ),
    [reloading, classId],
  );

  const renameUnit = useCallback(
    (unitId: string, title: string) =>
      optimistic(
        (current) => renameNodeLocal(current, "unit", unitId, title),
        (accessToken) =>
          renameCurriculumNode({ accessToken, classId, nodeType: "unit", id: unitId, title }),
        { failure: "Could not rename the unit." },
      ),
    [optimistic, classId],
  );

  const reorder = useCallback(
    (nodeType: CurriculumNodeType, orderedIds: string[]) =>
      optimistic(
        (current) => reorderNodesLocal(current, nodeType, orderedIds),
        (accessToken) => reorderCurriculumNodes({ accessToken, classId, nodeType, orderedIds }),
        { failure: "Could not reorder." },
      ),
    [optimistic, classId],
  );

  const moveLesson = useCallback(
    (lessonId: string, targetUnitId: string) =>
      optimistic(
        (current) => ({
          ...current,
          lessons: current.lessons.map((row) =>
            row.id === lessonId ? { ...row, unit_id: targetUnitId } : row,
          ),
        }),
        (accessToken) => moveCurriculumLesson({ accessToken, classId, lessonId, targetUnitId }),
        { failure: "Could not move the lesson." },
      ),
    [optimistic, classId],
  );

  const deleteNode = useCallback(
    (nodeType: CurriculumNodeType, id: string) => {
      if (!data) return;
      const removed = collectRemovedRows(data, nodeType, id); // captured for Undo
      const transform = (current: CurriculumAuthoringData) => cascadeRemove(current, nodeType, id);
      undoable({
        key: `delete-node:${id}`,
        message: `${nodeLabel(nodeType)} deleted.`,
        optimistic: () => patch(transform),
        revert: () => patch((current) => mergeRows(current, removed)),
        commit: () => {
          void (async () => {
            try {
              const session = await getSession();
              if (!session) throw new Error("Sign in to edit this class.");
              await deleteCurriculumNode({
                accessToken: session.access_token,
                classId,
                nodeType,
                id,
              });
            } catch (error) {
              notifyErr(error, "Could not delete.");
              await resync();
            }
          })();
        },
      });
    },
    [data, undoable, patch, resync, classId],
  );

  /** R44: copy a shared course for THIS class, then teach the copy. */
  const duplicateSharedCourse = useCallback(
    (courseId: string) =>
      reloading(async (accessToken) => {
        await duplicateCourseForClass({ accessToken, classId, courseId });
        await linksQuery.refetch();
        // The teacher has to know what a copy costs: this class forks forward, and the
        // work students already did stays with the lessons they did it on.
        notifyOk(
          "This class now edits its own copy — other classes keep the original. Past student work stays with the original lessons.",
        );
      }, "Could not copy the course."),
    [reloading, classId, linksQuery],
  );

  /** Every course this org may link, for the "courses in this class" picker. */
  const courseOptions = useMemo(
    () =>
      orgSubjects.flatMap((subject) =>
        coursesForSubject(subject.id).map((course) => ({
          id: course.id,
          title: course.title,
          subjectTitle: subject.title,
        })),
      ),
    [orgSubjects, coursesForSubject],
  );

  return {
    ...authoring,
    outlineUnits,
    courseOptions,
    linkedCourseIds,
    peerClassNames,
    lessonsForUnit,
    stepCountFor,
    bookPages,
    drafts,
    sharedNotice,
    renamingUnitId,
    setRenamingUnitId,
    currentVersionForCourse,
    ensureBackingCourse,
    addUnit,
    addLesson,
    renameUnit,
    reorder,
    moveLesson,
    deleteNode,
    duplicateSharedCourse,
  };
}
