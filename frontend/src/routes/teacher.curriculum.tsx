/**
 * The authoring studio: the class's content, and every write that changes it.
 *
 * The route itself only forwards old bookmarks. CurriculumStudio is the piece
 * the console mounts: it holds the authoring data, applies each edit locally and
 * then writes it through curriculum-admin. Everything it renders - the outline,
 * the lesson and step editors, the generate panels - lives under
 * features/teacher/authoring/.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { Breadcrumb } from "@/components/Breadcrumb";
import { RouteLoader } from "@/components/RouteLoader";
import type { DeckSpec } from "@/lib/artifact-schema";
import {
  publishLessons,
  reviewUnit,
  createArtifactResource,
  createCurriculumCourse,
  createCurriculumLessonStub,
  createCurriculumSubject,
  createCurriculumUnit,
  deleteCurriculumNode,
  deleteCurriculumStep,
  duplicateCourseForClass,
  fetchClassCourseLinks,
  fetchCurriculumAuthoringData,
  fetchTeacherClasses,
  generateCurriculumDraft,
  getSession,
  invokeCurriculumAdmin,
  moveCurriculumLesson,
  renameCurriculumNode,
  reorderCurriculumNodes,
  reorderCurriculumSteps,
  saveCurriculumLessonMeta,
  setClassCourses,
  updateLessonResource,
  upsertCurriculumStep,
} from "@/lib/api";
import type { LessonReview } from "@/lib/api";
import { BooksPanel, summarizeBooks } from "@/features/teacher/BooksPanel";
import { sliceMaterialForLesson } from "@/lib/materialText";
import type {
  CurriculumAdminResponse,
  CurriculumAuthoringData,
  CurriculumCourse,
  CurriculumCourseVersion,
  CurriculumLessonMetaInput,
  CurriculumMilestoneInput,
  CurriculumNodeType,
  CurriculumOutlineDraft,
  CurriculumStepDraft,
  CurriculumStepInput,
  CurriculumUnit,
  Lesson,
  CurriculumLessonPackage,
} from "@/lib/types";
import { LinkedCoursesPanel } from "@/features/teacher/LinkedCoursesPanel";
import { notifyErr } from "@/lib/feedback";
import { useUndoable } from "@/hooks/useUndoable";
import type {
  ClassworkItem,
  CurriculumSearch,
  OutlineGenArgs,
  Selection,
  StepsGenArgs,
} from "@/features/teacher/authoring/types";
import {
  CourseBuildProgress,
  CourseReviewPanel,
  DetailPane,
} from "@/features/teacher/authoring/DetailPane";
import {
  AiOutlinePanel,
  BuildFromMaterialPanel,
} from "@/features/teacher/authoring/generatePanels";
import { writeLessonPackage } from "@/features/teacher/authoring/lessonPackage";
import { ClassworkList, SharedCourseNotice } from "@/features/teacher/authoring/Outline";
import { stepInputFromDraft } from "@/features/teacher/authoring/stepModel";
import type { CourseBuild, CourseBuildItem } from "@/features/teacher/authoring/stepModel";
import {
  buildBreadcrumb,
  byPositionThenTitle,
  cascadeRemove,
  collectRemovedIds,
  collectRemovedRows,
  insertStepLocal,
  lessonOrder,
  mergeRows,
  nodeLabel,
  nodePath,
  patchResourceLocal,
  patchStepLocal,
  renameNodeLocal,
  reorderNodesLocal,
  reorderStepsLocal,
  swapStepId,
} from "@/features/teacher/authoring/localState";

export const Route = createFileRoute("/teacher/curriculum")({
  // R42: the studio has no standalone page anymore — building happens inside a class
  // (/teacher/class/$classId?tab=curriculum). This route survives only to catch old
  // bookmarks and stale deep links, forwarding the selection params into the teacher's
  // first class. The selection params keep the same names on the class route.
  validateSearch: (search: Record<string, unknown>): CurriculumSearch => ({
    subject: typeof search.subject === "string" ? search.subject : undefined,
    course: typeof search.course === "string" ? search.course : undefined,
    unit: typeof search.unit === "string" ? search.unit : undefined,
    lesson: typeof search.lesson === "string" ? search.lesson : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Curriculum - Jargon" },
      {
        name: "description",
        content: "Teacher curriculum authoring studio for Jargon lessons.",
      },
    ],
  }),
  component: CurriculumPage,
});

function CurriculumPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as CurriculumSearch;
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const session = await getSession();
        if (!alive) return;
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const classes = await fetchTeacherClasses(session.user.id);
        if (!alive) return;
        const first = classes[0];
        if (first) {
          navigate({
            to: "/teacher/class/$classId",
            params: { classId: first.id },
            search: { tab: "content", ...(search.lesson ? { lesson: search.lesson } : {}) },
            replace: true,
          });
        } else {
          navigate({ to: "/teacher", replace: true });
        }
      } catch {
        if (alive) navigate({ to: "/teacher", replace: true });
      }
    })();
    return () => {
      alive = false;
    };
    // Runs once on mount — `search` is only forwarded, never re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);
  return <RouteLoader label="Loading…" />;
}

// The authoring studio, mounted inside a class workspace's Curriculum section. All content
// operations run with this class as the authorization scope (curriculum-admin re-checks
// teacher membership server-side); the host (TeacherConsole) has already verified the
// teacher role, so there is no role gate here.
export function CurriculumStudio({
  classId,
  workItems = [],
  onOpenItem,
  onCreate,
  onCreateForLesson,
  onCreateForStep,
}: {
  classId: string;
  workItems?: ClassworkItem[];
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreate?: (kind: "assignment" | "assessment" | "material") => void;
  // R74: work created FROM a lesson, bound to that lesson. The step-linked variant
  // below (R48) is for work that IS a step.
  onCreateForLesson?: (kind: "assignment" | "assessment", lessonId: string) => void;
  // R48: create a work item FOR a lesson step — the console opens the matching dialog
  // with the lesson locked and stamps the step link on the created row.
  onCreateForStep?: (
    kind: "assignment" | "assessment",
    ctx: { lessonId: string; activityId: string },
  ) => void;
}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as CurriculumSearch;
  const [booting, setBooting] = useState(true);
  const [data, setData] = useState<CurriculumAuthoringData | null>(null);
  // R43: class↔course links across ALL the teacher's classes — this class's rows scope the
  // outline; other classes' rows power the "also used by" peer badges. null = links unknown
  // (load failed) → degrade to the unscoped org tree rather than hiding everything.
  const [classLinks, setClassLinks] = useState<Array<{
    class_id: string;
    course_id: string;
  }> | null>(null);
  const classLinksRef = useRef<Array<{ class_id: string; course_id: string }> | null>(null);
  classLinksRef.current = classLinks;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // R45: the books/shared-content drawer is advanced machinery — collapsed by default.
  const [booksOpen, setBooksOpen] = useState(false);
  // R60: outline-face state — a just-created unit sits with its name in edit; a unit's
  // "Add lesson" opens the R56 lesson builder; "Add units & lessons" opens the
  // R57 outline panel (mutually exclusive with the unit panel).
  const [renamingUnitId, setRenamingUnitId] = useState<string | null>(null);
  const [buildForUnitId, setBuildForUnitId] = useState<string | null>(null);
  const [buildCourseId, setBuildCourseId] = useState<string | null>(null);
  // R70: the review gate over one unit's drafts — what the machine wrote, and which
  // lessons the teacher has ticked to publish.
  const [reviewUnitId, setReviewUnitId] = useState<string | null>(null);
  const [reviewRows, setReviewRows] = useState<LessonReview[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewPicked, setReviewPicked] = useState<Set<string>>(() => new Set());
  const [reviewPublishing, setReviewPublishing] = useState(false);
  const undoable = useUndoable();
  // Deferred-undo ops (delete/publish) hold their optimistic change here so a
  // background refetch (from a create/AI-apply) doesn't resurrect a row that's
  // mid-undo-window. Each transform is removed when the op commits or is undone.
  const pendingReapply = useRef<
    Map<string, (d: CurriculumAuthoringData) => CurriculumAuthoringData>
  >(new Map());
  const applyPending = useCallback((d: CurriculumAuthoringData) => {
    let next = d;
    for (const fn of pendingReapply.current.values()) next = fn(next);
    return next;
  }, []);

  // R60: only lessons open an editor — the subject/course/unit panes (the pre-R47
  // StructureDetail chrome) are gone. Stale pane URLs normalize below.
  const selection: Selection = search.lesson ? { type: "lesson", id: search.lesson } : null;

  useEffect(() => {
    if (!search.lesson && (search.subject || search.course || search.unit)) {
      navigate({
        to: "/teacher/class/$classId",
        params: { classId },
        search: { tab: "content" },
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.subject, search.course, search.unit, search.lesson, classId]);

  const loadData = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session) {
        navigate({ to: "/login", replace: true });
        return;
      }
      const curriculum = await fetchCurriculumAuthoringData(session.user.id);
      setData(curriculum);
      try {
        setClassLinks(await fetchClassCourseLinks(curriculum.classes.map((item) => item.id)));
      } catch {
        setClassLinks(null); // unknown links → unscoped fallback, never a hidden catalog
      }
    } catch (error) {
      setMessage((error as Error).message || "Could not load curriculum studio.");
    } finally {
      setBooting(false);
    }
  }, [navigate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedClass = useMemo(
    () => data?.classes.find((item) => item.id === classId) || null,
    [data, classId],
  );

  const lessonsById = useMemo(() => {
    const map = new Map<string, Lesson>();
    data?.lessons.forEach((lesson) => map.set(lesson.id, lesson));
    return map;
  }, [data]);

  // The org's structure tree, ordered by the Phase 1 position columns. Subjects with a
  // NULL organization_id are GLOBAL shared content (all of prod's published courses live
  // under them) — they must be visible here, or the courses panel would omit links that
  // students actually see and a Save could silently wipe them.
  const orgSubjects = useMemo(() => {
    if (!data || !selectedClass) return [];
    return data.subjects
      .filter(
        (subject) =>
          subject.organization_id === selectedClass.organization_id ||
          subject.organization_id === null,
      )
      .sort(byPositionThenTitle);
  }, [data, selectedClass]);

  // Courses of a subject that this ORG may see: its own plus global (null-org) shared
  // content. Org-owned courses of other orgs — e.g. another org's fork of a global
  // course — never surface here (set_class_courses would reject linking them anyway).
  const coursesForSubject = useCallback(
    (subjectId: string) =>
      (data?.courses || [])
        .filter(
          (course) =>
            course.subject_id === subjectId &&
            (!course.organization_id || course.organization_id === selectedClass?.organization_id),
        )
        .sort(byPositionThenTitle),
    [data, selectedClass],
  );

  const currentVersionForCourse = useCallback(
    (courseId: string): CurriculumCourseVersion | null => {
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
        .sort((a, b) => a.position - b.position);
    },
    [data, currentVersionForCourse],
  );

  // R73: page ranges arrive as a plain object on the authoring payload; the outline
  // and the editor both want a Map.
  // R74: step counts per lesson for the outline rows.
  const stepCountByLesson = useMemo(() => {
    const counts = new Map<string, number>();
    for (const activity of data?.activities || []) {
      const id = String(activity.lesson_id || "");
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [data?.activities]);
  const stepCountFor = useCallback(
    (lessonId: string) => stepCountByLesson.get(lessonId) ?? 0,
    [stepCountByLesson],
  );

  const bookPages = useMemo(
    () => new Map(Object.entries(data?.bookPages || {})),
    [data?.bookPages],
  );

  const lessonsForUnit = useCallback(
    (unitId: string) =>
      (data?.lessons || [])
        .filter((lesson) => lesson.unit_id === unitId)
        .sort((a, b) => lessonOrder(a) - lessonOrder(b)),
    [data],
  );

  // R43 class scoping: this class's linked course ids. null = links unknown (read failed)
  // → the outline degrades to the whole org tree instead of hiding content.
  const linkedCourseIds = useMemo(() => {
    if (!classLinks) return null;
    return new Set(
      classLinks.filter((row) => row.class_id === classId).map((row) => row.course_id),
    );
  }, [classLinks, classId]);

  // Names of the teacher's OTHER classes that link a course — the honesty badge: editing a
  // shared course reaches those classes too. (RLS limits visibility to the teacher's own
  // classes; org-wide usage beyond them is not shown.)
  const peerClassNames = useCallback(
    (courseId: string): string[] => {
      if (!classLinks || !data) return [];
      const names: string[] = [];
      for (const row of classLinks) {
        if (row.course_id !== courseId || row.class_id === classId) continue;
        const cls = data.classes.find((item) => item.id === row.class_id);
        if (cls && !names.includes(cls.name)) names.push(cls.name);
      }
      return names;
    },
    [classLinks, data, classId],
  );

  // The class outline shows only linked courses…
  const classCoursesForSubject = useCallback(
    (subjectId: string) =>
      coursesForSubject(subjectId).filter(
        (course) => !linkedCourseIds || linkedCourseIds.has(course.id),
      ),
    [coursesForSubject, linkedCourseIds],
  );

  // …and only the subjects contributing one — plus subjects with no courses anywhere, so a
  // freshly created subject stays visible to build under (its first course auto-links here).
  const classSubjects = useMemo(
    () =>
      orgSubjects.filter(
        (subject) =>
          classCoursesForSubject(subject.id).length > 0 ||
          coursesForSubject(subject.id).length === 0,
      ),
    [orgSubjects, classCoursesForSubject, coursesForSubject],
  );

  // Units of the class's courses (with their course title) — powers "move lesson to unit".
  // Scoped like the outline: moving a lesson somewhere this class can't see would vanish it.
  const orgUnits = useMemo(() => {
    const rows: Array<{ unit: CurriculumUnit; courseTitle: string }> = [];
    for (const subject of classSubjects) {
      for (const course of classCoursesForSubject(subject.id)) {
        for (const unit of unitsForCourse(course.id)) {
          rows.push({ unit, courseTitle: course.title });
        }
      }
    }
    return rows;
  }, [classSubjects, classCoursesForSubject, unitsForCourse]);

  // R45 consolidated: the class curriculum is ONE flat list of units (subject/course
  // levels are invisible plumbing). Order: subject, course, then unit position. Each
  // unit keeps its backing course so shared-content honesty can annotate it.
  const classUnits = useMemo(() => {
    const rows: Array<{ unit: CurriculumUnit; course: CurriculumCourse }> = [];
    for (const subject of classSubjects) {
      for (const course of classCoursesForSubject(subject.id)) {
        for (const unit of unitsForCourse(course.id)) rows.push({ unit, course });
      }
    }
    return rows;
  }, [classSubjects, classCoursesForSubject, unitsForCourse]);

  const outlineUnits = useMemo(
    () =>
      classUnits.map(({ unit, course }) => {
        const peers = peerClassNames(course.id);
        return { unit, annotation: peers.length ? `also in ${peers.join(", ")}` : null };
      }),
    [classUnits, peerClassNames],
  );

  // R73: the books this class actually teaches, derived from the outline itself.
  const books = useMemo(
    () => summarizeBooks(outlineUnits.map((entry) => entry.unit), lessonsForUnit),
    [outlineUnits, lessonsForUnit],
  );

  // Every org course (with its subject for context) — the options list for the
  // "Courses in this class" panel below the workspace.
  const orgCourseOptions = useMemo(
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

  // Selection rides the class route's URL (?tab=curriculum&lesson=… etc.) so lesson
  // editing stays deep-linkable inside the class and back/forward keeps working.
  const selectNode = useCallback(
    (type: CurriculumNodeType, id: string) => {
      navigate({
        to: "/teacher/class/$classId",
        params: { classId },
        search: { tab: "content", [type]: id },
      });
    },
    [navigate, classId],
  );

  const clearSelection = useCallback(() => {
    navigate({
      to: "/teacher/class/$classId",
      params: { classId },
      search: { tab: "content" },
    });
  }, [navigate, classId]);

  // --- Mutations ------------------------------------------------------------
  // Edits/deletes/reorders apply optimistically (instant; resync only on error).
  // Structural creates and bulk AI applies run + refetch via reloading(), which
  // also selects the new node so the teacher lands in its detail pane.

  // Lightweight refetch (no role/nav recheck) used to resync after a failed op.
  const refresh = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const fresh = await fetchCurriculumAuthoringData(session.user.id);
    setData(applyPending(fresh));
  }, [applyPending]);

  // Optimistic mutation: apply the change to local state immediately, persist in
  // the background, and only resync (rolling back) if it fails. No global "busy"
  // freeze and no full refetch on success — this is what makes edits feel instant.
  const optimistic = useCallback(
    (
      apply: (current: CurriculumAuthoringData) => CurriculumAuthoringData,
      run: (accessToken: string, classId: string) => Promise<unknown>,
      opts?: { successMessage?: string; onSuccess?: (result: unknown) => void },
    ) => {
      if (!selectedClass) return;
      const classId = selectedClass.id;
      setData((prev) => (prev ? apply(prev) : prev));
      void (async () => {
        try {
          const session = await getSession();
          if (!session) throw new Error("Sign in to edit curriculum.");
          const result = await run(session.access_token, classId);
          opts?.onSuccess?.(result);
          if (opts?.successMessage) setMessage(opts.successMessage);
        } catch (error) {
          setMessage((error as Error).message || "Could not update curriculum.");
          await refresh(); // resync to server truth
        }
      })();
    },
    [selectedClass, refresh],
  );

  // For ops we don't reconstruct locally (structural creates, bulk AI applies):
  // run + refetch, surfacing progress via `busy` but never freezing the whole tree
  // for the optimistic ops above (they leave `busy` false).
  const reloading = useCallback(
    (
      run: (accessToken: string, classId: string) => Promise<unknown>,
      opts?: {
        successMessage?: string;
        select?: (result: unknown) => { type: CurriculumNodeType; id: string } | null;
        onDone?: (result: unknown) => void;
      },
    ) => {
      if (!selectedClass) return;
      const classId = selectedClass.id;
      setBusy(true);
      void (async () => {
        try {
          const session = await getSession();
          if (!session) throw new Error("Sign in to edit curriculum.");
          const result = await run(session.access_token, classId);
          setData(applyPending(await fetchCurriculumAuthoringData(session.user.id)));
          const sel = opts?.select?.(result);
          if (sel) selectNode(sel.type, sel.id);
          opts?.onDone?.(result);
          if (opts?.successMessage) setMessage(opts.successMessage);
        } catch (error) {
          setMessage((error as Error).message || "Could not update curriculum.");
          await refresh();
        } finally {
          setBusy(false);
        }
      })();
    },
    [selectedClass, selectNode, refresh, applyPending],
  );

  const selectFromId =
    (type: CurriculumNodeType) =>
    (result: unknown): { type: CurriculumNodeType; id: string } | null => {
      const id = (result as { id?: string } | null)?.id;
      return id ? { type, id } : null;
    };

  // R45 consolidated: units need a home course, but courses are invisible now. The
  // class's backing course = the first linked course OWNED by this org (a fork or a
  // previously auto-created one). If none exists, create subject + course named after
  // the class and link it (guarded on a known link baseline). R60: extracted so the
  // course-from-material build shares the same resolution as "New unit".
  const ensureBackingCourse = async (
    accessToken: string,
    targetClassId: string,
  ): Promise<{ courseId: string; versionId: string }> => {
    let backing: CurriculumCourse | null = null;
    for (const subject of orgSubjects) {
      for (const course of coursesForSubject(subject.id)) {
        if (
          course.organization_id === selectedClass!.organization_id &&
          linkedCourseIds?.has(course.id)
        ) {
          backing = course;
          break;
        }
      }
      if (backing) break;
    }
    if (backing) {
      const versionId = currentVersionForCourse(backing.id)?.id ?? null;
      if (!versionId) throw new Error("The class course has no version to add a unit to.");
      return { courseId: backing.id, versionId };
    }
    const subject = await createCurriculumSubject({
      accessToken,
      classId: targetClassId,
      organizationId: selectedClass!.organization_id,
      title: selectedClass!.name,
    });
    const subjectId = (subject as { id?: string } | null)?.id;
    if (!subjectId) throw new Error("Could not create the class curriculum home.");
    const course = await createCurriculumCourse({
      accessToken,
      classId: targetClassId,
      subjectId,
      title: selectedClass!.name,
    });
    const courseId = (course as { id?: string } | null)?.id;
    const versionId = (course as { course_version_id?: string } | null)?.course_version_id ?? null;
    if (!courseId || !versionId) {
      throw new Error("Could not create the class curriculum home.");
    }
    const links = classLinksRef.current;
    if (links) {
      const mine = links
        .filter((row) => row.class_id === targetClassId)
        .map((row) => row.course_id);
      await setClassCourses({
        accessToken,
        classId: targetClassId,
        courseIds: Array.from(new Set([...mine, courseId])),
      });
      setClassLinks([...links, { class_id: targetClassId, course_id: courseId }]);
    }
    return { courseId, versionId };
  };

  const addUnitToClass = () =>
    reloading(
      async (accessToken, targetClassId) => {
        const { versionId } = await ensureBackingCourse(accessToken, targetClassId);
        return createCurriculumUnit({
          accessToken,
          classId: targetClassId,
          courseVersionId: versionId,
          title: "New unit",
        });
      },
      {
        // R60: no unit pane to land on — the new unit appears in the outline with its
        // name already in edit, so "New unit" -> type the name -> Enter is the flow.
        onDone: (result) => {
          const id = (result as { id?: string } | null)?.id;
          if (id) setRenamingUnitId(id);
        },
      },
    );

  // R60: the course-from-material build (R57) finally gets a door — resolve (or
  // create) the class's backing course, then open the outline panel at the root.
  const openCourseBuild = () =>
    reloading(
      async (accessToken, targetClassId) => ensureBackingCourse(accessToken, targetClassId),
      {
        onDone: (result) => {
          const courseId = (result as { courseId?: string } | null)?.courseId;
          if (courseId) {
            setBuildCourseId(courseId);
            setBuildForUnitId(null);
          }
        },
      },
    );

  const addLesson = (unitId: string) =>
    reloading(
      (accessToken, classId) =>
        createCurriculumLessonStub({ accessToken, classId, unitId, title: "New lesson" }),
      { select: selectFromId("lesson") },
    );

  const reorder = (nodeType: CurriculumNodeType, orderedIds: string[]) =>
    optimistic(
      (d) => reorderNodesLocal(d, nodeType, orderedIds),
      (accessToken, classId) =>
        reorderCurriculumNodes({ accessToken, classId, nodeType, orderedIds }),
    );

  const renameNode = (
    nodeType: CurriculumNodeType,
    id: string,
    title: string,
    description?: string,
  ) =>
    optimistic(
      (d) => renameNodeLocal(d, nodeType, id, title, description),
      (accessToken, classId) =>
        renameCurriculumNode({ accessToken, classId, nodeType, id, title, description }),
      { successMessage: "Saved." },
    );

  const deleteNode = (nodeType: CurriculumNodeType, id: string) => {
    if (!selectedClass || !data) return;
    const classId = selectedClass.id;
    const removed = collectRemovedRows(data, nodeType, id); // captured for Undo
    const restoreSelection =
      selection && collectRemovedIds(data, nodeType, id).has(selection.id) ? selection : null;
    const key = `delete-node:${id}`;
    const transform = (d: CurriculumAuthoringData) => cascadeRemove(d, nodeType, id);
    undoable({
      key,
      message: `${nodeLabel(nodeType)} deleted.`,
      optimistic: () => {
        pendingReapply.current.set(key, transform);
        setData((d) => (d ? transform(d) : d));
        if (restoreSelection) clearSelection();
      },
      revert: () => {
        pendingReapply.current.delete(key);
        setData((d) => (d ? mergeRows(d, removed) : d));
        if (restoreSelection) selectNode(restoreSelection.type, restoreSelection.id);
      },
      commit: () => {
        pendingReapply.current.delete(key);
        void (async () => {
          try {
            const session = await getSession();
            if (!session) throw new Error("Sign in to edit curriculum.");
            await deleteCurriculumNode({
              accessToken: session.access_token,
              classId,
              nodeType,
              id,
            });
          } catch (error) {
            notifyErr(error, "Could not delete.");
            await refresh();
          }
        })();
      },
    });
  };

  const moveLesson = (lessonId: string, targetUnitId: string) =>
    optimistic(
      (d) => ({
        ...d,
        lessons: d.lessons.map((l) => (l.id === lessonId ? { ...l, unit_id: targetUnitId } : l)),
      }),
      (accessToken, classId) =>
        moveCurriculumLesson({ accessToken, classId, lessonId, targetUnitId }),
      { successMessage: "Lesson moved." },
    );

  const saveLessonMeta = (
    lessonId: string,
    meta: CurriculumLessonMetaInput,
    milestone: CurriculumMilestoneInput,
  ) => {
    // R60b: when the milestone row already exists this is a pure patch, so it goes the
    // optimistic route — instant, and (crucially) no full refetch racing the optimistic
    // step writes the sticky save bar flushes in the same tick. Only a FIRST save (no
    // milestone yet — the server assigns its id) still takes the reloading path.
    const existing = data?.milestones.find((row) => row.lesson_id === lessonId) ?? null;
    if (!existing) {
      reloading(
        (accessToken, classId) =>
          saveCurriculumLessonMeta({ accessToken, classId, lessonId, meta, milestone }),
        { successMessage: "Lesson saved." },
      );
      return;
    }
    optimistic(
      (d) => ({
        ...d,
        lessons: d.lessons.map((l) =>
          l.id === lessonId
            ? {
                ...l,
                title: meta.title,
                level: meta.level,
                tutor_prompt: meta.tutor_prompt,
                help_ceiling: meta.help_ceiling ?? l.help_ceiling,
                require_attempt_first: meta.require_attempt_first,
                final_answer_policy: meta.final_answer_policy ?? l.final_answer_policy,
                tutor_tone: meta.tutor_tone,
                tutor_pace: meta.tutor_pace,
                grade_band: meta.grade_band,
                allow_live_artifacts: meta.allow_live_artifacts,
              }
            : l,
        ),
        milestones: d.milestones.map((row) =>
          row.id === existing.id
            ? {
                ...row,
                title: meta.title,
                objective: milestone.objective,
                level: meta.level,
                skill_keys: milestone.skill_keys,
                allowed_response_modes: milestone.allowed_response_modes,
              }
            : row,
        ),
      }),
      (accessToken, classId) =>
        saveCurriculumLessonMeta({ accessToken, classId, lessonId, meta, milestone }),
      { successMessage: "Lesson saved." },
    );
  };

  const upsertStep = (lessonId: string, step: CurriculumStepInput) => {
    if (step.id) {
      // Editing an existing step: patch the activity (and its quiz) in place.
      optimistic(
        (d) => patchStepLocal(d, lessonId, step),
        (accessToken, classId) => upsertCurriculumStep({ accessToken, classId, lessonId, step }),
      );
      return;
    }
    // Adding a new step: insert a placeholder immediately, then swap in the real
    // id the server assigns so further edits target the right row.
    const tempId = `temp-step-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    optimistic(
      (d) => insertStepLocal(d, lessonId, step, tempId),
      (accessToken, classId) => upsertCurriculumStep({ accessToken, classId, lessonId, step }),
      {
        onSuccess: (result) => {
          const realId = (result as { id?: string } | null)?.id;
          if (realId && realId !== tempId) {
            setData((prev) => (prev ? swapStepId(prev, tempId, realId) : prev));
          }
        },
      },
    );
  };

  const reorderSteps = (lessonId: string, orderedIds: string[]) =>
    optimistic(
      (d) => reorderStepsLocal(d, orderedIds),
      (accessToken, classId) =>
        reorderCurriculumSteps({ accessToken, classId, lessonId, orderedIds }),
    );

  // P5: bind/unbind a lesson resource to a step (null unbinds). Direct RLS-gated write —
  // the chat runtime attaches a step's bound materials on its presentation turn.
  const bindResource = (resourceId: string, activityId: string | null) =>
    optimistic(
      (d) => patchResourceLocal(d, resourceId, activityId),
      () => updateLessonResource(resourceId, { activity_id: activityId }),
      { successMessage: activityId ? "Material attached to step." : "Material detached." },
    );

  // P8: promote a mentor-built (student-private) activity to the whole class. After the
  // promote it behaves like any teacher material (attachable, class-visible).
  const shareArtifact = (resourceId: string) =>
    reloading(
      () =>
        updateLessonResource(resourceId, {
          visibility: "class_private",
          student_id: null,
        }),
      { successMessage: "Activity shared with the class." },
    );

  const deleteStep = (lessonId: string, activityId: string) => {
    if (!selectedClass || !data) return;
    const classId = selectedClass.id;
    const removedActivity = data.activities.find((a) => a.id === activityId);
    const removedQuizzes = data.quizzes.filter((q) => q.activity_id === activityId);
    const key = `delete-step:${activityId}`;
    const transform = (d: CurriculumAuthoringData) => ({
      ...d,
      activities: d.activities.filter((a) => a.id !== activityId),
      quizzes: d.quizzes.filter((q) => q.activity_id !== activityId),
    });
    undoable({
      key,
      message: "Step deleted.",
      optimistic: () => {
        pendingReapply.current.set(key, transform);
        setData((d) => (d ? transform(d) : d));
      },
      revert: () => {
        pendingReapply.current.delete(key);
        setData((d) =>
          d
            ? {
                ...d,
                activities: removedActivity ? [...d.activities, removedActivity] : d.activities,
                quizzes: [...d.quizzes, ...removedQuizzes],
              }
            : d,
        );
      },
      commit: () => {
        pendingReapply.current.delete(key);
        void (async () => {
          try {
            const session = await getSession();
            if (!session) throw new Error("Sign in to edit curriculum.");
            await deleteCurriculumStep({
              accessToken: session.access_token,
              classId,
              lessonId,
              activityId,
            });
          } catch (error) {
            notifyErr(error, "Could not delete step.");
            await refresh();
          }
        })();
      },
    });
  };

  // AI authoring: generate returns a draft to review (no write); apply uses the
  // create/upsert actions, then refreshes via reloading(). The course/lesson id
  // gives the model subject-wide context; args carry reference material + refine feedback.
  const generateOutline = async (
    courseId: string,
    args: OutlineGenArgs,
  ): Promise<CurriculumOutlineDraft | null> => {
    if (!selectedClass) return null;
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to use AI authoring.");
      const result = await generateCurriculumDraft({
        accessToken: session.access_token,
        classId: selectedClass.id,
        organizationId: selectedClass.organization_id,
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
      setMessage((error as Error).message || "Could not generate an outline.");
      return null;
    }
  };

  // R57 WHOLE-COURSE BUILD. The outline pass names the lessons; this runner fills
  // each one by looping the R56 package engine — sequentially, because a generation
  // is a ~40s model call and a book makes twenty of them: parallel would hammer the
  // rate limit and the studio would have nothing honest to show. Progress is per
  // lesson, cancellable between lessons, and every failure is captured and retryable
  // instead of killing the run.
  const [build, setBuild] = useState<CourseBuild | null>(null);
  const buildCancel = useRef(false);

  const runCourseBuild = async (plan: CourseBuild) => {
    buildCancel.current = false;
    setBuild(plan);
    const session = await getSession();
    if (!session) {
      setMessage("Sign in to build a course.");
      setBuild({ ...plan, running: false });
      return;
    }
    const classId = plan.classId;
    const patch = (index: number, next: Partial<CourseBuildItem>) =>
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
        setBuild((current) => (current ? { ...current, running: false, canceled: true } : current));
        await refresh();
        return;
      }
      const item = plan.items[i];
      // Only queued work runs: a re-entry (retry) re-queues just the item it targets,
      // so finished lessons are never generated twice.
      if (item.status !== "queued") continue;
      patch(i, { status: "building", error: "" });
      try {
        const pkg = await generatePackage({
          unitId: item.unitId,
          // Each lesson reads only ITS slice of the upload (materialText.sliceMaterialForLesson):
          // handing a whole book to every lesson makes them all drift to the same loud chapter.
          prompt: `Lesson "${item.lessonTitle}" in the unit "${item.unitTitle}". Teach exactly this and nothing from neighbouring lessons.`,
          referenceText: item.material,
          includeQuiz: plan.includeQuiz,
          includeAssignment: plan.includeAssignment,
          quiet: true,
        });
        if (!pkg) throw new Error("The model returned nothing for this lesson.");
        await writeLessonPackage({
          accessToken: session.access_token,
          classId,
          unitId: item.unitId,
          pkg,
        });
        patch(i, { status: "done", builtTitle: pkg.lesson.title });
        // Refresh as we go: the teacher watches lessons appear in the outline instead
        // of staring at a spinner for ten minutes.
        await refresh();
      } catch (error) {
        patch(i, { status: "failed", error: (error as Error).message || "Generation failed." });
      }
    }
    setBuild((current) => (current ? { ...current, running: false } : current));
    await refresh();
  };

  // Create the units, then queue one build item per outline lesson. Units are created
  // up front (cheap, and the run needs their ids); lessons are NOT stubbed here —
  // each package write creates its own lesson, so a cancelled run leaves real lessons
  // and no empty shells.
  const startCourseBuild = (
    courseId: string,
    outline: CurriculumOutlineDraft,
    options: { material: string; includeQuiz: boolean; includeAssignment: boolean },
  ) => {
    if (!selectedClass) return;
    const version = currentVersionForCourse(courseId);
    if (!version) {
      setMessage("This course has no version to add units to.");
      return;
    }
    const classId = selectedClass.id;
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
          const unitId = created.id;
          if (!unitId) continue;
          for (const lesson of unit.lessons) {
            items.push({
              unitId,
              unitTitle: unit.title,
              lessonTitle: lesson.title,
              material: options.material ? sliceMaterialForLesson(options.material, lesson) : "",
              status: "queued",
              error: "",
              builtTitle: "",
            });
          }
        }
        await refresh();
        if (!items.length) {
          setMessage("Outline applied.");
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
        setMessage((error as Error).message || "Could not start the build.");
      } finally {
        setBusy(false);
      }
    })();
  };

  const retryBuildItem = (index: number) => {
    const current = build;
    if (!current || current.running) return;
    void runCourseBuild({
      ...current,
      running: true,
      canceled: false,
      items: current.items.map((item, i) =>
        i === index ? { ...item, status: "queued", error: "" } : item,
      ),
    });
  };

  // Resume: re-queue everything still unfinished (a cancelled run, or one that hit
  // failures) and run again from there.
  const resumeCourseBuild = () => {
    const current = build;
    if (!current || current.running) return;
    void runCourseBuild({
      ...current,
      running: true,
      canceled: false,
      items: current.items.map((item) =>
        item.status === "done" ? item : { ...item, status: "queued", error: "" },
      ),
    });
  };

  const applyOutline = (courseId: string, outline: CurriculumOutlineDraft) =>
    reloading(
      async (accessToken, classId) => {
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
      },
      { successMessage: "Outline applied." },
    );

  const generateSteps = async (
    lessonId: string,
    args: StepsGenArgs,
  ): Promise<CurriculumStepDraft[] | null> => {
    if (!selectedClass) return null;
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to use AI authoring.");
      const result = await generateCurriculumDraft({
        accessToken: session.access_token,
        classId: selectedClass.id,
        mode: "lesson_steps",
        lessonId,
        prompt: args.prompt,
        referenceText: args.referenceText,
        current: args.current,
        feedback: args.feedback,
        target: args.target,
      });
      return result.steps || [];
    } catch (error) {
      setMessage((error as Error).message || "Could not generate steps.");
      return null;
    }
  };

  const applyStepDrafts = (lessonId: string, drafts: CurriculumStepDraft[]) =>
    reloading(
      async (accessToken, classId) => {
        for (const draft of drafts) {
          await upsertCurriculumStep({
            accessToken,
            classId,
            lessonId,
            step: stepInputFromDraft(draft),
          });
        }
      },
      { successMessage: "Steps added." },
    );

  // R56 "build from material": ONE generation drafts a whole lesson from the teacher's
  // uploads — meta, steps, wrap-up quiz, assignment brief. Still review-first: this
  // returns a draft and writes nothing.
  const generatePackage = async (args: {
    unitId?: string;
    lessonId?: string;
    prompt: string;
    referenceText: string;
    includeQuiz: boolean;
    includeAssignment: boolean;
    /** R57: inside a course run, failures are reported per lesson, not in the banner. */
    quiet?: boolean;
  }): Promise<CurriculumLessonPackage | null> => {
    if (!selectedClass) return null;
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to use AI authoring.");
      const result = await generateCurriculumDraft({
        accessToken: session.access_token,
        classId: selectedClass.id,
        mode: "lesson_package",
        unitId: args.unitId,
        lessonId: args.lessonId,
        prompt: args.prompt,
        referenceText: args.referenceText,
        includeQuiz: args.includeQuiz,
        includeAssignment: args.includeAssignment,
      });
      return result.package || null;
    } catch (error) {
      if (args.quiet) throw error;
      setMessage((error as Error).message || "Could not build the lesson.");
      return null;
    }
  };

  // Apply writes the package through the SAME actions a teacher's manual authoring uses —
  // no privileged bulk path — so every guard, gate, and audit trail still applies. The
  // lesson lands as a DRAFT: publishing stays the teacher's explicit act.
  const applyPackage = (unitId: string, pkg: CurriculumLessonPackage) =>
    reloading(
      async (accessToken, classId) => {
        await writeLessonPackage({ accessToken, classId, unitId, pkg });
      },
      { successMessage: "Lesson drafted from your material." },
    );

  // P7: generate an artifact (html_sim / deck) — read-only draft round-trip; the studio
  // previews it, and approveArtifact persists it as a published resource bound to the step.
  const generateArtifact = async (
    lessonId: string,
    args: {
      kind: "html_sim" | "deck";
      brief: string;
      feedback?: string;
      current?: Record<string, unknown>;
    },
  ): Promise<CurriculumAdminResponse | null> => {
    if (!selectedClass) return null;
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to use AI authoring.");
      return await generateCurriculumDraft({
        accessToken: session.access_token,
        classId: selectedClass.id,
        mode: "artifact",
        lessonId,
        artifactKind: args.kind,
        brief: args.brief,
        feedback: args.feedback,
        current: args.current,
      });
    } catch (error) {
      setMessage((error as Error).message || "Could not generate the activity.");
      return null;
    }
  };

  const approveArtifact = (
    lessonId: string,
    activityId: string,
    payload: {
      kind: "html_sim" | "deck";
      title: string;
      posterText?: string;
      html?: string;
      deck?: DeckSpec;
    },
  ) =>
    reloading(
      async () => {
        const session = await getSession();
        if (!session) throw new Error("Sign in to add an activity.");
        if (!selectedClass) throw new Error("Pick a class first.");
        await createArtifactResource({
          teacherId: session.user.id,
          organizationId: selectedClass.organization_id,
          classId: selectedClass.id,
          lessonId,
          activityId,
          title: payload.title,
          posterText: payload.posterText,
          kind: payload.kind,
          html: payload.html,
          deck: payload.deck,
        });
      },
      { successMessage: "Activity added to the step." },
    );

  // R70: open the gate on a unit. Read-only — it reports what the build actually
  // wrote; nothing is published until the teacher ticks lessons and presses publish.
  const openReview = useCallback(
    (unitId: string) => {
      if (!selectedClass || !unitId) return;
      setReviewUnitId(unitId);
      setReviewRows([]);
      setReviewPicked(new Set());
      setReviewLoading(true);
      void (async () => {
        try {
          const session = await getSession();
          if (!session) throw new Error("Sign in to review lessons.");
          const result = await reviewUnit({
            accessToken: session.access_token,
            unitId,
            organizationId: selectedClass.organization_id,
            classId: selectedClass.id,
          });
          setReviewRows(result.lessons);
          // Pre-tick everything publishable: the common case is "this all looks right",
          // and a teacher who disagrees unticks. Blocked lessons are never pre-ticked.
          setReviewPicked(
            new Set(
              result.lessons
                .filter((row) => row.ready && row.publication_status !== "published")
                .map((row) => row.lesson_id),
            ),
          );
        } catch (error) {
          setMessage((error as Error).message || "Could not read the lessons for review.");
          setReviewUnitId(null);
        } finally {
          setReviewLoading(false);
        }
      })();
    },
    [selectedClass],
  );

  const publishReviewed = useCallback(() => {
    if (!selectedClass || !reviewPicked.size) return;
    const ids = [...reviewPicked];
    setReviewPublishing(true);
    void (async () => {
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to publish lessons.");
        const result = await publishLessons({
          accessToken: session.access_token,
          lessonIds: ids,
          organizationId: selectedClass.organization_id,
          classId: selectedClass.id,
        });
        setMessage(
          result.failed
            ? `${result.published} published, ${result.failed} could not be — open those and try again.`
            : `${result.published} ${result.published === 1 ? "lesson is" : "lessons are"} live for students.`,
        );
        // Keep the gate open on whatever did not land, so the failures stay visible.
        const landed = new Set(
          result.results.filter((row) => row.status === "published").map((row) => row.lesson_id),
        );
        setReviewRows((rows) =>
          rows.map((row) =>
            landed.has(row.lesson_id) ? { ...row, publication_status: "published" } : row,
          ),
        );
        setReviewPicked((picked) => new Set([...picked].filter((id) => !landed.has(id))));
        await refresh();
      } catch (error) {
        setMessage((error as Error).message || "Could not publish those lessons.");
      } finally {
        setReviewPublishing(false);
      }
    })();
  }, [selectedClass, reviewPicked, refresh]);

  const setPublication = (action: "publish_lesson" | "archive_lesson", lessonId: string) => {
    if (!selectedClass || !lessonId || !data) return;
    const organizationId = selectedClass.organization_id;
    const classId = selectedClass.id;
    const prevStatus = data.lessons.find((l) => l.id === lessonId)?.publication_status ?? "draft";
    const nextStatus = action === "publish_lesson" ? "published" : "archived";
    const key = `publish:${lessonId}`;
    const statusTransform =
      (status: Lesson["publication_status"]) => (d: CurriculumAuthoringData) => ({
        ...d,
        lessons: d.lessons.map((l) =>
          l.id === lessonId ? { ...l, publication_status: status } : l,
        ),
      });
    undoable({
      key,
      message: action === "publish_lesson" ? "Lesson published." : "Lesson archived.",
      optimistic: () => {
        pendingReapply.current.set(key, statusTransform(nextStatus));
        setData((d) => (d ? statusTransform(nextStatus)(d) : d));
      },
      revert: () => {
        pendingReapply.current.delete(key);
        setData((d) => (d ? statusTransform(prevStatus)(d) : d));
      },
      commit: () => {
        pendingReapply.current.delete(key);
        void (async () => {
          try {
            const session = await getSession();
            if (!session) throw new Error("Sign in to update publishing.");
            await invokeCurriculumAdmin({
              accessToken: session.access_token,
              action,
              organizationId,
              classId,
              lessonId,
            });
          } catch (error) {
            notifyErr(error, "Could not update publication status.");
            await refresh();
          }
        })();
      },
    });
  };

  // The selected node's course, when other classes also link it → the honesty strip
  // above the editor ("changes here also reach …") with the fork-on-demand action.
  const sharedNotice = useMemo(() => {
    if (!data) return null;
    // R60: with the node panes gone the fork affordance must live on the outline too —
    // a class linked to a shared/global book still needs its "duplicate first" button.
    const course = selection
      ? nodePath(selection, data).course
      : (classUnits.find(
          ({ course: c }) => c && (!c.organization_id || peerClassNames(c.id).length),
        )?.course ?? null);
    if (!course) return null;
    const peers = peerClassNames(course.id);
    // R50: a GLOBAL book (no owning organization) can never be edited directly, so the
    // fork affordance must render even when no peer class links it — otherwise the
    // server's "duplicate first" refusal points at a button that doesn't exist.
    const isGlobal = !course.organization_id;
    return peers.length || isGlobal
      ? { courseId: course.id, names: peers.join(", "), isGlobal }
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.type, selection?.id, data, peerClassNames, classUnits]);

  // R44 fork-on-demand: copy the shared course for THIS class and swap the class's link
  // to the copy. The link refresh happens inside the run so the scoped outline flips to
  // the fork in the same pass; selection lands on the new course.
  const duplicateSharedCourse = (courseId: string) =>
    reloading(
      async (accessToken, targetClassId) => {
        const result = await duplicateCourseForClass({
          accessToken,
          classId: targetClassId,
          courseId,
        });
        try {
          setClassLinks(await fetchClassCourseLinks((data?.classes ?? []).map((item) => item.id)));
        } catch {
          setClassLinks(null); // unknown links degrade to the unscoped tree
        }
        return result;
      },
      {
        // R60: no course pane to land on — stay on the outline; the banner's message
        // tells the story.
        successMessage:
          "This class now edits its own copy — other classes keep the original. Past student work stays with the original lessons.",
      },
    );

  const crumbs = buildBreadcrumb({ selection, data, goRoot: clearSelection, goNode: selectNode });

  return (
    <div className="flex flex-col gap-4">
      {/* Slim toolbar — the class page above already carries the class name and section
          switcher, so the studio only needs its content breadcrumb (the subject→lesson
          selection) and its own controls. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb segments={crumbs} />
        <div className="flex flex-wrap items-center gap-2">
          {selection ? (
            <button type="button" onClick={clearSelection} className="btn btn-secondary btn-sm">
              ← Content
            </button>
          ) : (
            <button
              type="button"
              onClick={openCourseBuild}
              disabled={busy}
              className="btn btn-secondary btn-sm"
            >
              Add units &amp; lessons
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadData()}
            className="btn btn-secondary btn-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {message ? (
        <section className="rounded-card border border-border bg-depth-card shadow-card">
          <div className="flex items-center justify-between gap-3 p-4 text-body text-muted-foreground">
            <span>{message}</span>
            <button
              type="button"
              onClick={() => setMessage("")}
              className="text-meta text-muted-foreground/70 hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      {build ? (
        <CourseBuildProgress
          build={build}
          onCancel={() => {
            buildCancel.current = true;
          }}
          onResume={resumeCourseBuild}
          onRetry={retryBuildItem}
          onDismiss={() => setBuild(null)}
          onReview={
            build.items.find((item) => item.status === "done")?.unitId
              ? () => {
                  const unitId = build.items.find((item) => item.status === "done")?.unitId;
                  if (unitId) openReview(unitId);
                }
              : undefined
          }
        />
      ) : null}

      {reviewUnitId ? (
        <CourseReviewPanel
          review={reviewRows}
          loading={reviewLoading}
          selected={reviewPicked}
          publishing={reviewPublishing}
          onToggle={(lessonId) =>
            setReviewPicked((picked) => {
              const next = new Set(picked);
              if (next.has(lessonId)) next.delete(lessonId);
              else next.add(lessonId);
              return next;
            })
          }
          onSelectAll={(next) =>
            setReviewPicked(
              next
                ? new Set(
                    reviewRows
                      .filter((row) => row.ready && row.publication_status !== "published")
                      .map((row) => row.lesson_id),
                  )
                : new Set(),
            )
          }
          onPublish={publishReviewed}
          onOpenLesson={(lessonId) => selectNode("lesson", lessonId)}
          onClose={() => setReviewUnitId(null)}
        />
      ) : null}

      {booting ? (
        <section className="rounded-card border border-border bg-depth-card shadow-card">
          <div className="p-6 text-body text-muted-foreground">Loading curriculum...</div>
        </section>
      ) : !selectedClass ? (
        <section className="rounded-card border border-border bg-depth-card shadow-card">
          <div className="p-6 text-body text-muted-foreground">
            Teacher curriculum access requires an assigned class.
          </div>
        </section>
      ) : data ? (
        // R47: no aside, no tree — the list IS the surface. R60: the list is the ONLY
        // structural surface (units + lessons + materials); a selection means a lesson
        // and swaps the whole width to the lesson editor. Work items live in Activity.
        selection === null ? (
          <div className="min-w-0">
            {sharedNotice ? (
              <SharedCourseNotice
                notice={sharedNotice}
                busy={busy}
                onDuplicate={() => duplicateSharedCourse(sharedNotice.courseId)}
              />
            ) : null}
            {buildCourseId ? (
              <div className="mb-3 rounded-card border border-border bg-depth-card p-4 shadow-card">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-body font-medium text-foreground">
                    Add units &amp; lessons
                  </span>
                  <button
                    type="button"
                    onClick={() => setBuildCourseId(null)}
                    className="text-meta text-muted-foreground/70 hover:text-foreground"
                  >
                    Close
                  </button>
                </div>
                <AiOutlinePanel
                  busy={busy}
                  resources={data.resources}
                  onGenerate={(args) => generateOutline(buildCourseId, args)}
                  onApply={(outline) => {
                    applyOutline(buildCourseId, outline);
                    setBuildCourseId(null);
                  }}
                  onBuild={(outline, material) => {
                    startCourseBuild(buildCourseId, outline, {
                      material,
                      includeQuiz: true,
                      includeAssignment: true,
                    });
                    setBuildCourseId(null);
                  }}
                />
              </div>
            ) : null}
            {/* R73: the book leads the Content room. What was built from the school's
                own material, and what is still an unreviewed draft, before any generic
                curriculum tree. */}
            <BooksPanel books={books} onReview={openReview} />
            {/* R75: the rare-but-real cross-class linking, one click away instead of an
                always-open drawer under the curriculum. */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setBooksOpen((value) => !value)}
                className="btn btn-ghost btn-sm"
              >
                {booksOpen ? "Hide courses" : "Courses in this class"}
              </button>
            </div>
            <ClassworkList
              units={outlineUnits}
              lessonsForUnit={lessonsForUnit}
              bookPages={bookPages}
              stepCountFor={stepCountFor}
              emptyHint="No units yet — use “Add units &amp; lessons” above to plan the course, or add a unit by hand."
              workItems={workItems.filter((entry) => entry.kind === "material")}
              busy={busy}
              renamingUnitId={renamingUnitId}
              onRenameUnit={(id, title) => {
                setRenamingUnitId(null);
                const current = data.units.find((unit) => unit.id === id);
                if (title && current && title !== current.title) renameNode("unit", id, title);
              }}
              onRenameStart={(id) => setRenamingUnitId(id)}
              canDeleteUnit={(id) => lessonsForUnit(id).length === 0}
              onDeleteUnit={(id) => deleteNode("unit", id)}
              onBuildLesson={(unitId) => {
                setBuildCourseId(null);
                setBuildForUnitId(unitId);
              }}
              onSelectLesson={(id) => selectNode("lesson", id)}
              onOpenItem={onOpenItem}
              onCreate={onCreate}
              onAddUnit={addUnitToClass}
              onAddLesson={addLesson}
              onReorder={reorder}
            />
            {buildForUnitId ? (
              <div className="mt-3 rounded-card border border-border bg-depth-card p-4 shadow-card">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-body font-medium text-foreground">
                    Build a lesson in “
                    {data.units.find((unit) => unit.id === buildForUnitId)?.title ?? "this unit"}”
                  </span>
                  <button
                    type="button"
                    onClick={() => setBuildForUnitId(null)}
                    className="text-meta text-muted-foreground/70 hover:text-foreground"
                  >
                    Close
                  </button>
                </div>
                <BuildFromMaterialPanel
                  busy={busy}
                  resources={data.resources}
                  onGenerate={(args) => generatePackage({ ...args, unitId: buildForUnitId })}
                  onApply={(pkg) => {
                    applyPackage(buildForUnitId, pkg);
                    setBuildForUnitId(null);
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="min-w-0">
            {sharedNotice ? (
              <SharedCourseNotice
                notice={sharedNotice}
                busy={busy}
                onDuplicate={() => duplicateSharedCourse(sharedNotice.courseId)}
              />
            ) : null}
            <DetailPane
              key={selection ? `${selection.type}:${selection.id}` : "empty"}
              selection={selection}
              data={data}
              workItems={workItems}
              onOpenItem={onOpenItem}
              onCreateForStep={onCreateForStep}
              lessonsById={lessonsById}
              orgUnits={orgUnits}
              resources={data.resources}
              busy={busy}
              onMoveLesson={moveLesson}
              onSaveLessonMeta={saveLessonMeta}
              onUpsertStep={upsertStep}
              onReorderSteps={reorderSteps}
              onDeleteStep={deleteStep}
              onDelete={deleteNode}
              onBindResource={bindResource}
              onShareResource={shareArtifact}
              onGenerateArtifact={generateArtifact}
              onApproveArtifact={approveArtifact}
              onPublishLesson={(lessonId) => void setPublication("publish_lesson", lessonId)}
              onArchiveLesson={(lessonId) => void setPublication("archive_lesson", lessonId)}
              onGenerateSteps={generateSteps}
              onApplySteps={applyStepDrafts}
            />
          </div>
        )
      ) : null}

      {/* R75: the always-open drawer is gone. Choosing which COURSES a class teaches is
          real (it is the only surface that trims what students see) but rare, so it opens
          from the outline's "Courses in this class" button instead of sitting on the page
          competing with the curriculum. R77 named it after what it manages — it never had
          anything to do with resources, and calling it "content" implied it did. */}
      {!booting && data && selectedClass && booksOpen ? (
        <div className="rounded-card border border-border bg-depth-card p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-body font-medium text-foreground">Courses in this class</span>
            <button
              type="button"
              onClick={() => setBooksOpen(false)}
              className="btn btn-ghost btn-sm"
            >
              Close
            </button>
          </div>
            <LinkedCoursesPanel
              classId={classId}
              courses={orgCourseOptions}
              linked={linkedCourseIds}
              peerNames={peerClassNames}
              onSaved={(courseIds) =>
                setClassLinks((current) => [
                  ...(current ?? []).filter((row) => row.class_id !== classId),
                  ...courseIds.map((courseId) => ({ class_id: classId, course_id: courseId })),
                ])
              }
            />
        </div>
      ) : null}
    </div>
  );
}
