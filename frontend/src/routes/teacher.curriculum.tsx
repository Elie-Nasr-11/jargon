import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertCircle,
  Archive,
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  GripVertical,
  Layers3,
  ListChecks,
  Loader2,
  MessageSquare,
  NotebookPen,
  PanelLeft,
  PanelLeftClose,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Collapsible } from "@/components/Collapsible";
import { RouteLoader } from "@/components/RouteLoader";
import { ArtifactFrame } from "@/components/ArtifactFrame";
import { DeckRenderer } from "@/components/DeckRenderer";
import { DEFAULT_VOICE } from "@/lib/jargon-store";
import { parseArtifactConfig } from "@/lib/artifact-schema";
import type { DeckSpec } from "@/lib/artifact-schema";
import { lintArtifactHtml } from "@/lib/artifact-lint";
import {
  archiveCurriculumNode,
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
  readImageMaterial,
  readUrlMaterial,
} from "@/lib/api";
import {
  extractDocxText,
  extractPptxText,
  htmlToText,
  isDocx,
  isPlainTextFile,
  isPptx,
  sliceMaterialForLesson,
} from "@/lib/materialText";
import type {
  CurriculumAdminResponse,
  CurriculumAuthoringData,
  CurriculumCourse,
  CurriculumCourseVersion,
  CurriculumLessonMetaInput,
  CurriculumMilestoneInput,
  CurriculumNodeType,
  CurriculumOutlineDraft,
  CurriculumQuizItem,
  CurriculumStepDraft,
  CurriculumStepInput,
  CurriculumStepKind,
  CurriculumSubject,
  CurriculumUnit,
  LearningMode,
  Lesson,
  LessonActivity,
  LessonResource,
  CurriculumLessonPackage,
} from "@/lib/types";
import { KnowledgeCard } from "@/features/teacher/KnowledgeCard";
import { LinkedCoursesPanel } from "@/features/teacher/LinkedCoursesPanel";
import { extractPdfTextChunksFromUrl } from "@/lib/pdf-extract";
import { notifyErr } from "@/lib/feedback";
import { useUndoable } from "@/hooks/useUndoable";

type ResponseMode = LessonActivity["response_mode"];
type LessonKind = CurriculumLessonMetaInput["lesson_type"];

type Selection = { type: CurriculumNodeType; id: string } | null;

// AI generation request shapes (initial generate + per-item refine).
type OutlineGenArgs = {
  prompt: string;
  referenceText: string;
  current?: CurriculumOutlineDraft;
  feedback?: string;
  target?: string;
};
type StepsGenArgs = {
  prompt: string;
  referenceText: string;
  current?: CurriculumStepDraft[];
  feedback?: string;
  target?: string;
};
// P7 artifact authoring.
type ArtifactGenArgs = {
  kind: "html_sim" | "deck";
  brief: string;
  feedback?: string;
  current?: Record<string, unknown>;
};
type ArtifactApprovePayload = {
  kind: "html_sim" | "deck";
  title: string;
  posterText?: string;
  html?: string;
  deck?: DeckSpec;
};

type CurriculumSearch = {
  subject?: string;
  course?: string;
  unit?: string;
  lesson?: string;
};

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
            search: { tab: "classwork", ...search },
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
// R47: a work item as the console hands it to the Classwork list — assignments, quizzes,
// and materials render as rows under their lesson's unit heading, next to the lessons.
export type ClassworkItem = {
  kind: "assignment" | "assessment" | "material";
  id: string;
  lessonId: string | null;
  // R48: the lesson step this item IS (created from the step editor); null = standalone.
  activityId: string | null;
  title: string;
  status: string;
  dueAt: string | null;
  needsReviewCount: number;
  submittedCount: number;
};

export function CurriculumStudio({
  classId,
  workItems = [],
  onOpenItem,
  onCreate,
  onCreateForStep,
}: {
  classId: string;
  workItems?: ClassworkItem[];
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreate?: (kind: "assignment" | "assessment" | "material") => void;
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

  const selection: Selection = search.lesson
    ? { type: "lesson", id: search.lesson }
    : search.unit
      ? { type: "unit", id: search.unit }
      : search.course
        ? { type: "course", id: search.course }
        : search.subject
          ? { type: "subject", id: search.subject }
          : null;

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
        search: { tab: "classwork", [type]: id },
      });
    },
    [navigate, classId],
  );

  const clearSelection = useCallback(() => {
    navigate({
      to: "/teacher/class/$classId",
      params: { classId },
      search: { tab: "classwork" },
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

  const addCourse = (subjectId: string) =>
    reloading(
      async (accessToken, targetClassId) => {
        const created = await createCurriculumCourse({
          accessToken,
          classId: targetClassId,
          subjectId,
          title: "New course",
        });
        // R43: a course born inside a class belongs to it — link it immediately so the
        // scoped outline (and this class's students, once published) can see it. Only
        // when the current link set is known: set_class_courses REPLACES the whole set,
        // so writing from an unknown baseline could wipe existing links.
        const createdId = (created as { id?: string } | null)?.id;
        const links = classLinksRef.current;
        if (createdId && links) {
          const mine = links
            .filter((row) => row.class_id === targetClassId)
            .map((row) => row.course_id);
          await setClassCourses({
            accessToken,
            classId: targetClassId,
            courseIds: Array.from(new Set([...mine, createdId])),
          });
          setClassLinks([...links, { class_id: targetClassId, course_id: createdId }]);
        }
        return created;
      },
      { select: selectFromId("course") },
    );

  // R45 consolidated: "New unit" needs a home course, but courses are invisible now.
  // The class's backing course = the first linked course OWNED by this org (a fork or a
  // previously auto-created one). If none exists, create subject + course named after
  // the class and link it (guarded on a known link baseline, like addCourse).
  const addUnitToClass = () =>
    reloading(
      async (accessToken, targetClassId) => {
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
        let versionId = backing ? (currentVersionForCourse(backing.id)?.id ?? null) : null;
        if (!backing) {
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
          versionId = (course as { course_version_id?: string } | null)?.course_version_id ?? null;
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
        }
        if (!versionId) throw new Error("The class course has no version to add a unit to.");
        return createCurriculumUnit({
          accessToken,
          classId: targetClassId,
          courseVersionId: versionId,
          title: "New unit",
        });
      },
      { select: selectFromId("unit") },
    );

  const addUnit = (courseId: string) =>
    reloading(
      (accessToken, classId) => {
        const version = currentVersionForCourse(courseId);
        if (!version) throw new Error("This course has no version to add a unit to.");
        return createCurriculumUnit({
          accessToken,
          classId,
          courseVersionId: version.id,
          title: "New unit",
        });
      },
      { select: selectFromId("unit") },
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

  const archiveNode = (nodeType: CurriculumNodeType, id: string) =>
    reloading(
      (accessToken, classId) => archiveCurriculumNode({ accessToken, classId, nodeType, id }),
      { successMessage: "Archived." },
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
  ) =>
    reloading(
      (accessToken, classId) =>
        saveCurriculumLessonMeta({ accessToken, classId, lessonId, meta, milestone }),
      { successMessage: "Lesson saved." },
    );

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
    if (!selection || !data) return null;
    const course = nodePath(selection, data).course;
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
  }, [selection?.type, selection?.id, data, peerClassNames]);

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
        select: selectFromId("course"),
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
              ← Classwork
            </button>
          ) : null}
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
        // R47: no aside, no tree. The list IS the surface (units as topic headings with
        // lessons + work items beneath); a selection swaps the whole width to the editor.
        selection === null ? (
          <ClassworkList
            units={outlineUnits}
            lessonsForUnit={lessonsForUnit}
            emptyHint="No units yet — create one to start this class's classwork, or open Books & shared content below to bring in existing material."
            workItems={workItems}
            busy={busy}
            onSelectLesson={(id) => selectNode("lesson", id)}
            onSelectUnit={(id) => selectNode("unit", id)}
            onOpenItem={onOpenItem}
            onCreate={onCreate}
            onAddUnit={addUnitToClass}
            onAddLesson={addLesson}
            onReorder={reorder}
          />
        ) : (
          <div className="min-w-0">
            {sharedNotice ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-border bg-depth-sub px-3.5 py-2.5 text-meta text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                <span className="min-w-0 flex-1">
                  {sharedNotice.isGlobal ? (
                    <>
                      This is a shared book — duplicate it to edit or add lessons
                      {sharedNotice.names ? (
                        <>
                          {" "}
                          (also used by{" "}
                          <span className="text-foreground">{sharedNotice.names}</span>)
                        </>
                      ) : null}
                      .
                    </>
                  ) : (
                    <>
                      This course is shared — changes here also reach{" "}
                      <span className="text-foreground">{sharedNotice.names}</span>.
                    </>
                  )}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => duplicateSharedCourse(sharedNotice.courseId)}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  Duplicate for this class
                </button>
              </div>
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
              onAddSubject={addUnitToClass}
              onRename={renameNode}
              onArchive={archiveNode}
              onDelete={deleteNode}
              onAddCourse={addCourse}
              onAddUnit={addUnit}
              onAddLesson={addLesson}
              onMoveLesson={moveLesson}
              onSaveLessonMeta={saveLessonMeta}
              onUpsertStep={upsertStep}
              onReorderSteps={reorderSteps}
              onDeleteStep={deleteStep}
              onBindResource={bindResource}
              onShareResource={shareArtifact}
              onGenerateArtifact={generateArtifact}
              onApproveArtifact={approveArtifact}
              onPublishLesson={(lessonId) => void setPublication("publish_lesson", lessonId)}
              onArchiveLesson={(lessonId) => void setPublication("archive_lesson", lessonId)}
              onGenerateOutline={generateOutline}
              onApplyOutline={applyOutline}
              onBuildCourse={(courseId, outline, material) =>
                startCourseBuild(courseId, outline, {
                  material,
                  includeQuiz: true,
                  includeAssignment: true,
                })
              }
              onGenerateSteps={generateSteps}
              onApplySteps={applyStepDrafts}
              onGeneratePackage={generatePackage}
              onApplyPackage={applyPackage}
              counts={{
                coursesForSubject: (id) => classCoursesForSubject(id).length,
                unitsForCourse: (id) => unitsForCourse(id).length,
                lessonsForUnit: (id) => lessonsForUnit(id).length,
              }}
            />
          </div>
        )
      ) : null}

      {/* R45 consolidated: the class curriculum reads as the teacher's own — the books
          machinery (linking shared content in/out) is demoted to an advanced drawer,
          collapsed by default. It stays the only surface that can trim what students see. */}
      {!booting && data && selectedClass ? (
        <div className="rounded-card border border-border bg-depth-card p-4 shadow-card">
          <Collapsible
            open={booksOpen}
            onToggle={() => setBooksOpen((value) => !value)}
            title={
              <span className="text-body font-medium text-foreground">
                Books &amp; shared content
              </span>
            }
            meta={
              <span className="shrink-0 text-meta text-muted-foreground">
                {linkedCourseIds ? `${linkedCourseIds.size} in this class` : "…"}
              </span>
            }
            headerClassName="rounded-control px-1.5 py-2 transition-colors hover:bg-muted/60"
            bodyClassName="pt-2"
          >
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
          </Collapsible>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classwork list — the full-width face of the Classwork tab (R47). Units are topic
// headings (always expanded, Classroom-style); beneath each: lesson rows, then the
// work items (assignments / quizzes / materials) attached to those lessons. ONE
// "+ Create" menu makes everything; per-unit "+ Lesson" adds in place.
// ---------------------------------------------------------------------------

// R45 consolidated (still true here): the class curriculum is ONE flat list of units —
// subject/course stay invisible plumbing (each unit knows its backing course, which
// powers the shared-content annotation). Unit drag-reorder stays off (adjacent units
// can live in different backing courses); lessons still drag within their unit.
function ClassworkList({
  units,
  lessonsForUnit,
  emptyHint,
  workItems,
  busy,
  onSelectLesson,
  onSelectUnit,
  onOpenItem,
  onCreate,
  onAddUnit,
  onAddLesson,
  onReorder,
}: {
  units: Array<{ unit: CurriculumUnit; annotation: string | null }>;
  lessonsForUnit: (unitId: string) => Lesson[];
  emptyHint?: string;
  workItems: ClassworkItem[];
  busy: boolean;
  onSelectLesson: (id: string) => void;
  onSelectUnit: (id: string) => void;
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreate?: (kind: "assignment" | "assessment" | "material") => void;
  onAddUnit: () => void;
  onAddLesson: (unitId: string) => void;
  onReorder: (type: CurriculumNodeType, orderedIds: string[]) => void;
}) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);

  // Work items grouped under the unit their lesson belongs to; anything whose lesson
  // isn't in this class's outline falls into a trailing "Other classwork" bucket so
  // nothing ever silently disappears.
  const lessonUnitById = new Map<string, string>();
  for (const { unit } of units) {
    for (const lesson of lessonsForUnit(unit.id)) lessonUnitById.set(lesson.id, unit.id);
  }
  const itemsByUnit = new Map<string, ClassworkItem[]>();
  const otherItems: ClassworkItem[] = [];
  for (const item of workItems) {
    const unitId = item.lessonId ? lessonUnitById.get(item.lessonId) : undefined;
    if (unitId) {
      const list = itemsByUnit.get(unitId) ?? [];
      list.push(item);
      itemsByUnit.set(unitId, list);
    } else {
      otherItems.push(item);
    }
  }

  const kindLabel = (kind: ClassworkItem["kind"]) =>
    kind === "assignment" ? "assignment" : kind === "assessment" ? "quiz" : "material";

  const itemRow = (item: ClassworkItem) => (
    <button
      key={`${item.kind}:${item.id}`}
      type="button"
      onClick={() => onOpenItem?.(item.kind, item.id)}
      className="flex min-w-0 items-center gap-2.5 rounded-control py-1.5 pl-7 pr-2 text-left transition-colors hover:bg-muted"
    >
      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-meta text-muted-foreground">
        {kindLabel(item.kind)}
      </span>
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{item.title}</span>
      {item.needsReviewCount > 0 ? (
        <span className="shrink-0 rounded-full border border-warning/40 bg-warning/12 px-2 py-0.5 text-meta text-warning">
          {item.needsReviewCount} to review
        </span>
      ) : null}
      <span className="shrink-0 text-meta text-muted-foreground">
        {item.status}
        {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ""}
      </span>
    </button>
  );

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Classwork
          </span>
          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCreateMenuOpen((value) => !value)}
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={createMenuOpen}
              className="btn btn-primary btn-sm gap-1"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              Create
            </button>
            {createMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 w-44 rounded-card border border-border bg-depth-card p-1 shadow-card"
              >
                {(
                  [
                    { kind: "assignment", label: "Assignment" },
                    { kind: "assessment", label: "Quiz" },
                    { kind: "material", label: "Material" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onCreate?.(option.kind);
                    }}
                    className="block w-full rounded-control px-3 py-1.5 text-left text-meta text-foreground transition-colors hover:bg-muted"
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    onAddUnit();
                  }}
                  className="block w-full rounded-control px-3 py-1.5 text-left text-meta text-foreground transition-colors hover:bg-muted"
                >
                  Unit
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {units.length === 0 ? (
          <div className="rounded-card border border-dashed border-border px-3 py-6 text-center text-meta text-muted-foreground">
            {emptyHint ?? "No units yet. Create one to start the class's classwork."}
          </div>
        ) : (
          <div className="grid min-w-0 gap-4">
            {units.map(({ unit, annotation }) => {
              const lessons = lessonsForUnit(unit.id);
              const unitItems = itemsByUnit.get(unit.id) ?? [];
              return (
                <div key={unit.id} className="min-w-0">
                  <OutlineRow
                    depth={0}
                    label={unit.title}
                    meta={[
                      `${lessons.length} lesson${lessons.length === 1 ? "" : "s"}`,
                      annotation ? "shared" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    metaTitle={annotation ?? undefined}
                    hasChildren={false}
                    selected={false}
                    onSelect={() => onSelectUnit(unit.id)}
                    onAdd={() => onAddLesson(unit.id)}
                    addLabel="Add lesson"
                    dragging={false}
                    showGrip={false}
                  />
                  <div className="mt-0.5 grid min-w-0 gap-0.5">
                    <ReorderList
                      items={lessons}
                      disabled={busy}
                      onReorder={(ids) => onReorder("lesson", ids)}
                    >
                      {(lesson, lessonState) => (
                        <div className={dropClass(lessonState)}>
                          <OutlineRow
                            depth={1}
                            label={lesson.title}
                            meta={lesson.publication_status || "published"}
                            hasChildren={false}
                            selected={false}
                            onSelect={() => onSelectLesson(lesson.id)}
                            dragging={lessonState.dragging}
                          />
                        </div>
                      )}
                    </ReorderList>
                    {lessons.length === 0 ? <EmptyHint depth={1} label="No lessons" /> : null}
                    {unitItems.map(itemRow)}
                  </div>
                </div>
              );
            })}
            {otherItems.length ? (
              <div className="min-w-0">
                <div className="flex items-center gap-2 px-1.5 py-1 text-body font-medium text-foreground">
                  Other classwork
                  <span className="text-meta font-normal text-muted-foreground">
                    not attached to a unit here
                  </span>
                </div>
                <div className="mt-0.5 grid min-w-0 gap-0.5">{otherItems.map(itemRow)}</div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function OutlineRow({
  depth,
  label,
  meta,
  hasChildren,
  open,
  selected,
  onToggle,
  onSelect,
  onAdd,
  addLabel,
  dragging,
  showGrip = true,
  metaTitle,
}: {
  depth: number;
  label: string;
  meta?: string;
  hasChildren: boolean;
  open?: boolean;
  selected: boolean;
  onToggle?: () => void;
  onSelect: () => void;
  onAdd?: () => void;
  addLabel?: string;
  dragging: boolean;
  // R45: unit rows in the flat outline are not draggable — no grip affordance.
  showGrip?: boolean;
  // Tooltip for the meta chip (e.g. the full "also in …" class list behind "shared").
  metaTitle?: string;
}) {
  return (
    <div
      className={`group flex min-w-0 items-center gap-1 overflow-hidden rounded-lg pr-1 transition-colors ${
        selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      } ${dragging ? "opacity-40" : ""}`}
      style={{ paddingLeft: `${depth * 14 + 2}px` }}
    >
      {showGrip ? (
        <span className="shrink-0 cursor-grab text-muted-foreground/60 group-hover:text-muted-foreground">
          <GripVertical className="h-3.5 w-3.5" strokeWidth={1.6} />
        </span>
      ) : (
        <span className="w-1 shrink-0" />
      )}
      {hasChildren ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          className={`shrink-0 ${selected ? "text-primary-foreground/80" : "text-muted-foreground"}`}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
            strokeWidth={1.7}
          />
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <span className={`min-w-0 flex-1 truncate text-meta ${depth === 0 ? "font-medium" : ""}`}>
          {label}
        </span>
        {meta ? (
          <span
            className={`max-w-[45%] shrink-0 truncate text-overline uppercase tracking-[0.08em] ${
              selected ? "text-primary-foreground/70" : "text-muted-foreground"
            }`}
            title={metaTitle}
          >
            {meta}
          </span>
        ) : null}
      </button>
      {onAdd ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAdd();
          }}
          title={addLabel}
          aria-label={addLabel}
          className={`shrink-0 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 ${
            selected
              ? "text-primary-foreground/80 hover:bg-background/20"
              : "text-muted-foreground hover:bg-depth-field"
          }`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  );
}

function EmptyHint({ depth, label }: { depth: number; label: string }) {
  return (
    <div
      className="py-1 text-meta italic text-muted-foreground/70"
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
    >
      {label}
    </div>
  );
}

function ReorderList<T extends { id: string }>({
  items,
  onReorder,
  disabled,
  children,
}: {
  items: T[];
  onReorder: (orderedIds: string[]) => void;
  disabled?: boolean;
  children: (item: T, state: { dragging: boolean; over: boolean }) => ReactNode;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ids = items.map((item) => item.id);

  return (
    <>
      {items.map((item) => (
        <div
          key={item.id}
          className="min-w-0"
          draggable={!disabled}
          onDragStart={(event) => {
            if (disabled) return;
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            setDragId(item.id);
          }}
          onDragOver={(event) => {
            if (!dragId || dragId === item.id) return;
            event.preventDefault();
            event.stopPropagation();
            setOverId(item.id);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragId && dragId !== item.id) onReorder(reorderArray(ids, dragId, item.id));
            setDragId(null);
            setOverId(null);
          }}
          onDragEnd={(event) => {
            event.stopPropagation();
            setDragId(null);
            setOverId(null);
          }}
        >
          {children(item, { dragging: dragId === item.id, over: overId === item.id })}
        </div>
      ))}
    </>
  );
}

function dropClass(state: { over: boolean }) {
  // min-w-0 lets nested rows shrink so their labels truncate instead of forcing width.
  return `min-w-0 ${state.over ? "rounded-lg ring-1 ring-foreground/40" : ""}`;
}

// ---------------------------------------------------------------------------
// Detail pane — edits whichever node is selected.
// ---------------------------------------------------------------------------

function DetailPane({
  selection,
  data,
  lessonsById,
  orgUnits,
  resources,
  busy,
  onAddSubject,
  onRename,
  onArchive,
  onDelete,
  onAddCourse,
  onAddUnit,
  onAddLesson,
  onMoveLesson,
  onSaveLessonMeta,
  onUpsertStep,
  onReorderSteps,
  onDeleteStep,
  onBindResource,
  onShareResource,
  onGenerateArtifact,
  onApproveArtifact,
  onPublishLesson,
  onArchiveLesson,
  onGenerateOutline,
  onApplyOutline,
  onBuildCourse,
  onGenerateSteps,
  onApplySteps,
  onGeneratePackage,
  onApplyPackage,
  workItems,
  onOpenItem,
  onCreateForStep,
  counts,
}: {
  selection: Selection;
  data: CurriculumAuthoringData;
  lessonsById: Map<string, Lesson>;
  orgUnits: Array<{ unit: CurriculumUnit; courseTitle: string }>;
  resources: LessonResource[];
  busy: boolean;
  // R48: the class's work items (from the console) + the step-link callbacks, threaded
  // down to StepCard's "Step work" strip.
  workItems: ClassworkItem[];
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreateForStep?: (
    kind: "assignment" | "assessment",
    ctx: { lessonId: string; activityId: string },
  ) => void;
  onAddSubject: () => void;
  onRename: (type: CurriculumNodeType, id: string, title: string, description?: string) => void;
  onArchive: (type: CurriculumNodeType, id: string) => void;
  onDelete: (type: CurriculumNodeType, id: string) => void;
  onAddCourse: (subjectId: string) => void;
  onAddUnit: (courseId: string) => void;
  onAddLesson: (unitId: string) => void;
  onMoveLesson: (lessonId: string, targetUnitId: string) => void;
  onSaveLessonMeta: (
    lessonId: string,
    meta: CurriculumLessonMetaInput,
    milestone: CurriculumMilestoneInput,
  ) => void;
  onUpsertStep: (lessonId: string, step: CurriculumStepInput) => void;
  onReorderSteps: (lessonId: string, orderedIds: string[]) => void;
  onDeleteStep: (lessonId: string, activityId: string) => void;
  onBindResource: (resourceId: string, activityId: string | null) => void;
  onShareResource: (resourceId: string) => void;
  onGenerateArtifact: (
    lessonId: string,
    args: ArtifactGenArgs,
  ) => Promise<CurriculumAdminResponse | null>;
  onApproveArtifact: (
    lessonId: string,
    activityId: string,
    payload: ArtifactApprovePayload,
  ) => void;
  onPublishLesson: (lessonId: string) => void;
  onArchiveLesson: (lessonId: string) => void;
  // R56: build a whole lesson from teacher material (unit-level).
  onGeneratePackage?: (args: {
    unitId: string;
    prompt: string;
    referenceText: string;
    includeQuiz: boolean;
    includeAssignment: boolean;
  }) => Promise<CurriculumLessonPackage | null>;
  onApplyPackage?: (unitId: string, pkg: CurriculumLessonPackage) => void;
  onGenerateOutline: (
    courseId: string,
    args: OutlineGenArgs,
  ) => Promise<CurriculumOutlineDraft | null>;
  onApplyOutline: (courseId: string, outline: CurriculumOutlineDraft) => void;
  onBuildCourse: (courseId: string, outline: CurriculumOutlineDraft, material: string) => void;
  onGenerateSteps: (lessonId: string, args: StepsGenArgs) => Promise<CurriculumStepDraft[] | null>;
  onApplySteps: (lessonId: string, drafts: CurriculumStepDraft[]) => void;
  counts: {
    coursesForSubject: (id: string) => number;
    unitsForCourse: (id: string) => number;
    lessonsForUnit: (id: string) => number;
  };
}) {
  if (!selection) {
    return (
      <section className="rounded-card border border-border bg-depth-card shadow-card">
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Layers3 className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
          <div className="text-body text-foreground">Select a unit or lesson to edit it.</div>
          <p className="max-w-md text-meta leading-relaxed text-muted-foreground">
            This is your class's curriculum — units of lessons, written for this class. Pick one
            from the outline, or create a unit to get started.
          </p>
          <button
            type="button"
            onClick={onAddSubject}
            disabled={busy}
            className="btn btn-secondary"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            New unit
          </button>
        </div>
      </section>
    );
  }

  if (selection.type === "subject") {
    const subject = data.subjects.find((item) => item.id === selection.id);
    if (!subject) return <MissingNode />;
    const childCount = counts.coursesForSubject(subject.id);
    return (
      <StructureDetail
        kind="Subject"
        node={subject}
        status={subject.status}
        busy={busy}
        addLabel="New course"
        showArchive
        canDelete={childCount === 0}
        deleteHint="Remove its courses first to delete this subject."
        onSave={(title, description) => onRename("subject", subject.id, title, description)}
        onAddChild={() => onAddCourse(subject.id)}
        onArchive={() => onArchive("subject", subject.id)}
        onDelete={() => onDelete("subject", subject.id)}
      />
    );
  }

  if (selection.type === "course") {
    const course = data.courses.find((item) => item.id === selection.id);
    if (!course) return <MissingNode />;
    const childCount = counts.unitsForCourse(course.id);
    return (
      <StructureDetail
        kind="Course"
        node={course}
        status={course.status}
        busy={busy}
        addLabel="New unit"
        showArchive
        canDelete={childCount === 0}
        deleteHint="Remove its units first to delete this course."
        onSave={(title, description) => onRename("course", course.id, title, description)}
        onAddChild={() => onAddUnit(course.id)}
        onArchive={() => onArchive("course", course.id)}
        onDelete={() => onDelete("course", course.id)}
        ai={{
          resources,
          onGenerate: (args) => onGenerateOutline(course.id, args),
          onApply: (outline) => onApplyOutline(course.id, outline),
          onBuild: (outline, material) => onBuildCourse(course.id, outline, material),
        }}
      />
    );
  }

  if (selection.type === "unit") {
    const unit = data.units.find((item) => item.id === selection.id);
    if (!unit) return <MissingNode />;
    const childCount = counts.lessonsForUnit(unit.id);
    return (
      <StructureDetail
        kind="Unit"
        node={unit}
        busy={busy}
        addLabel="New lesson"
        showArchive={false}
        canDelete={childCount === 0}
        deleteHint="Remove its lessons first to delete this unit."
        onSave={(title, description) => onRename("unit", unit.id, title, description)}
        onAddChild={() => onAddLesson(unit.id)}
        onDelete={() => onDelete("unit", unit.id)}
        buildFromMaterial={
          onGeneratePackage && onApplyPackage
            ? {
                resources: data.resources,
                onGenerate: (args) => onGeneratePackage({ ...args, unitId: unit.id }),
                onApply: (pkg) => onApplyPackage(unit.id, pkg),
              }
            : undefined
        }
      />
    );
  }

  // lesson
  const lesson = lessonsById.get(selection.id);
  if (!lesson) return <MissingNode />;
  return (
    <LessonDetail
      lesson={lesson}
      data={data}
      orgUnits={orgUnits}
      busy={busy}
      onSaveMeta={(meta, milestone) => onSaveLessonMeta(lesson.id, meta, milestone)}
      onUpsertStep={(step) => onUpsertStep(lesson.id, step)}
      onReorderSteps={(ids) => onReorderSteps(lesson.id, ids)}
      onDeleteStep={(activityId) => onDeleteStep(lesson.id, activityId)}
      onBindResource={onBindResource}
      onShareResource={onShareResource}
      onGenerateArtifact={(args) => onGenerateArtifact(lesson.id, args)}
      onApproveArtifact={(activityId, payload) => onApproveArtifact(lesson.id, activityId, payload)}
      onPublish={() => onPublishLesson(lesson.id)}
      onArchiveLesson={() => onArchiveLesson(lesson.id)}
      onMove={(targetUnitId) => onMoveLesson(lesson.id, targetUnitId)}
      onDelete={() => onDelete("lesson", lesson.id)}
      resources={resources}
      onGenerateSteps={(args) => onGenerateSteps(lesson.id, args)}
      onApplySteps={(drafts) => onApplySteps(lesson.id, drafts)}
      workItems={workItems}
      onOpenItem={onOpenItem}
      onCreateForStep={onCreateForStep}
    />
  );
}

// R57: the whole-course build's face. A run is minutes long and made of many model
// calls, so the teacher gets a live per-lesson ledger — not a spinner: what is being
// written now, what landed, what failed and why (with a retry that re-queues only
// that lesson), and a Stop that takes effect between lessons.
function CourseBuildProgress({
  build,
  onCancel,
  onResume,
  onRetry,
  onDismiss,
}: {
  build: CourseBuild;
  onCancel: () => void;
  onResume: () => void;
  onRetry: (index: number) => void;
  onDismiss: () => void;
}) {
  const done = build.items.filter((item) => item.status === "done").length;
  const failed = build.items.filter((item) => item.status === "failed").length;
  const total = build.items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const finished = !build.running;

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-title font-medium text-foreground">
              <Sparkles className="h-4 w-4" strokeWidth={1.7} />
              {build.running
                ? `Building your course — ${done} of ${total} lessons`
                : build.canceled
                  ? `Build stopped — ${done} of ${total} lessons written`
                  : `Build finished — ${done} of ${total} lessons written`}
            </div>
            <p className="mt-1 text-meta text-muted-foreground">
              {build.running
                ? "Each lesson is written from its own part of your material. You can keep working — this keeps going."
                : failed
                  ? `${failed} ${failed === 1 ? "lesson" : "lessons"} need another try. Everything written is a draft until you publish it.`
                  : "Every lesson is a draft until you publish it."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {build.running ? (
              <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
                Stop after this lesson
              </button>
            ) : (
              <>
                {done + failed < total || failed ? (
                  <button type="button" onClick={onResume} className="btn btn-secondary btn-sm">
                    Resume
                  </button>
                ) : null}
                <button type="button" onClick={onDismiss} className="btn btn-ghost btn-sm">
                  Dismiss
                </button>
              </>
            )}
          </div>
        </div>

        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-pill bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Course build progress"
        >
          <div
            className="h-full rounded-pill bg-primary transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-3 grid max-h-[280px] gap-1 overflow-y-auto">
          {build.items.map((item, index) => (
            <div
              key={`${item.unitId}-${index}`}
              className="flex items-center gap-2.5 rounded-control border border-border/70 bg-depth-sub px-3 py-2"
            >
              <span className="shrink-0" aria-hidden>
                {item.status === "done" ? (
                  <Check className="h-3.5 w-3.5 text-success" strokeWidth={2} />
                ) : item.status === "building" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" strokeWidth={2} />
                ) : item.status === "failed" ? (
                  <AlertCircle className="h-3.5 w-3.5 text-danger" strokeWidth={2} />
                ) : (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-meta text-foreground">
                  {item.builtTitle || item.lessonTitle}
                </span>
                <span className="block truncate text-overline uppercase tracking-[0.08em] text-muted-foreground">
                  {item.unitTitle}
                  {item.error ? ` · ${item.error}` : ""}
                </span>
              </span>
              {item.status === "failed" && finished ? (
                <button
                  type="button"
                  onClick={() => onRetry(index)}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MissingNode() {
  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-6 text-body text-muted-foreground">
        That item is no longer available. Pick another from the outline.
      </div>
    </section>
  );
}

function StructureDetail({
  kind,
  node,
  status,
  busy,
  addLabel,
  showArchive,
  canDelete,
  deleteHint,
  onSave,
  onAddChild,
  onArchive,
  onDelete,
  ai,
  buildFromMaterial,
}: {
  kind: string;
  node: { id: string; title: string; description?: string };
  status?: string;
  busy: boolean;
  addLabel: string;
  showArchive: boolean;
  canDelete: boolean;
  deleteHint: string;
  onSave: (title: string, description: string) => void;
  onAddChild: () => void;
  onArchive?: () => void;
  onDelete: () => void;
  ai?: {
    resources: LessonResource[];
    onGenerate: (args: OutlineGenArgs) => Promise<CurriculumOutlineDraft | null>;
    onApply: (outline: CurriculumOutlineDraft) => void;
    onBuild: (outline: CurriculumOutlineDraft, material: string) => void;
  };
  // R56: on a UNIT, the studio can build a whole lesson from the teacher's material.
  buildFromMaterial?: {
    resources: LessonResource[];
    onGenerate: (args: {
      prompt: string;
      referenceText: string;
      includeQuiz: boolean;
      includeAssignment: boolean;
    }) => Promise<CurriculumLessonPackage | null>;
    onApply: (pkg: CurriculumLessonPackage) => void;
  };
}) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = title.trim() !== node.title || (description ?? "") !== (node.description ?? "");

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {kind}
            </div>
            <h2 className="mt-1 font-serif text-display text-foreground">{node.title}</h2>
          </div>
          {status ? (
            <span className="rounded-full border border-border px-3 py-1 text-meta text-muted-foreground">
              {status}
            </span>
          ) : null}
        </div>

        <div className="grid gap-3">
          <TextInput label={`${kind} title`} value={title} onChange={setTitle} />
          <TextArea label="Description" value={description} onChange={setDescription} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSave(title.trim(), description.trim())}
              disabled={busy || !title.trim() || !dirty}
              className="btn btn-secondary"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} />
              {busy ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={onAddChild}
              disabled={busy}
              className="btn btn-secondary"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              {addLabel}
            </button>
          </div>
        </div>

        {ai ? (
          <div className="mt-5">
            <AiOutlinePanel
              busy={busy}
              resources={ai.resources}
              onGenerate={ai.onGenerate}
              onApply={ai.onApply}
              onBuild={ai.onBuild}
            />
          </div>
        ) : null}

        {buildFromMaterial ? (
          <div className="mt-5">
            <BuildFromMaterialPanel
              busy={busy}
              resources={buildFromMaterial.resources}
              onGenerate={buildFromMaterial.onGenerate}
              onApply={buildFromMaterial.onApply}
            />
          </div>
        ) : null}

        <div className="mt-6 border-t border-border pt-4">
          <div className="mb-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Lifecycle
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showArchive && onArchive ? (
              <button
                type="button"
                onClick={onArchive}
                disabled={busy}
                className="btn btn-secondary"
              >
                <Archive className="h-3.5 w-3.5" strokeWidth={1.7} />
                Archive
              </button>
            ) : null}
            {confirmDelete ? (
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full border border-destructive/40 px-4 py-2 text-meta text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                  Confirm delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-meta text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy || !canDelete}
                title={canDelete ? undefined : deleteHint}
                className="btn btn-secondary"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                Delete
              </button>
            )}
            {!canDelete ? (
              <span className="text-meta text-muted-foreground">{deleteHint}</span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lesson detail — lesson-level meta + an ordered, multi-step content editor.
// ---------------------------------------------------------------------------

const STEP_KINDS: Array<{
  kind: CurriculumStepKind;
  label: string;
  stage: CurriculumStepInput["stage"];
  activityType: CurriculumStepInput["activity_type"];
  responseMode: ResponseMode;
  icon: ReactNode;
  promptLabel: string;
}> = [
  {
    kind: "teach",
    label: "Teach",
    stage: "teach",
    activityType: "discussion",
    responseMode: "text",
    icon: <BookOpen className="h-3.5 w-3.5" strokeWidth={1.7} />,
    promptLabel: "What the mentor explains",
  },
  {
    kind: "practice",
    label: "Practice",
    stage: "practice",
    activityType: "discussion",
    responseMode: "text",
    icon: <NotebookPen className="h-3.5 w-3.5" strokeWidth={1.7} />,
    promptLabel: "Practice prompt",
  },
  {
    kind: "checkpoint",
    label: "Checkpoint",
    stage: "assessment",
    activityType: "multiple_choice",
    responseMode: "multiple_choice",
    icon: <ListChecks className="h-3.5 w-3.5" strokeWidth={1.7} />,
    promptLabel: "Question",
  },
  {
    kind: "reflect",
    label: "Reflect",
    stage: "review",
    activityType: "reflection",
    responseMode: "text",
    icon: <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />,
    promptLabel: "Reflection prompt",
  },
];

function stepKindConfig(kind: CurriculumStepKind) {
  return STEP_KINDS.find((item) => item.kind === kind) || STEP_KINDS[1];
}

// v4 learning modes (docs/PLATFORM.md): the authoring vocabulary. Each mode maps onto the
// legacy kind system for icons/grouping; stage is a display label, gates live in mode.
const MODE_META: Array<{
  mode: LearningMode;
  label: string;
  kind: CurriculumStepKind;
  stage: CurriculumStepInput["stage"];
  activityType: CurriculumStepInput["activity_type"];
  responseMode: ResponseMode;
  defaultType: string;
  promptLabel: string;
  defaultPrompt: string;
}> = [
  {
    mode: "explanation",
    label: "Explain",
    kind: "teach",
    stage: "teach",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "",
    promptLabel: "The material the mentor teaches (stated outright)",
    defaultPrompt: "Teach this idea plainly with one concrete example.",
  },
  {
    mode: "media",
    label: "Media",
    kind: "teach",
    stage: "teach",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "",
    promptLabel: "How to frame the attached resource(s)",
    defaultPrompt: "Study the attached material, then come back when you're ready.",
  },
  {
    mode: "reflection",
    label: "Reflect",
    kind: "reflect",
    stage: "practice",
    activityType: "reflection",
    responseMode: "text",
    defaultType: "",
    promptLabel: "Reflection prompt (student produces the conclusion)",
    defaultPrompt: "Explain the idea in your own words.",
  },
  {
    mode: "practice",
    label: "Practice",
    kind: "practice",
    stage: "practice",
    activityType: "code",
    responseMode: "code",
    defaultType: "code",
    promptLabel: "Practice prompt",
    defaultPrompt: "Try this, then explain your thinking.",
  },
  {
    mode: "assignment",
    label: "Assignment",
    kind: "teach",
    stage: "practice",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "",
    promptLabel: "How to frame the assigned task (lives in the work dock)",
    defaultPrompt: "Introduce the assigned task and point the student to it.",
  },
  {
    mode: "inquiry",
    label: "Inquiry",
    kind: "reflect",
    stage: "practice",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "",
    promptLabel: "Topic to invite questions about",
    defaultPrompt: "What questions do you have about this topic?",
  },
  {
    mode: "assessment",
    label: "Assess",
    kind: "checkpoint",
    stage: "assessment",
    activityType: "multiple_choice",
    responseMode: "multiple_choice",
    defaultType: "mcq",
    promptLabel: "Question",
    defaultPrompt: "Which option is correct?",
  },
  {
    mode: "revision",
    label: "Revise",
    kind: "reflect",
    stage: "review",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "recall",
    promptLabel: "What to recall (prior skills; full behavior arrives in a later update)",
    defaultPrompt: "Let's revisit what you learned earlier.",
  },
];

function modeMeta(mode: LearningMode) {
  return MODE_META.find((item) => item.mode === mode) || MODE_META[3];
}

// Per-mode accent hue for the 8-mode StepCard picker and step rows — the --mode-* custom
// props from styles.css (the same family the student TurnMode skin reads; see
// src/student/turnModes.ts for that mapping). Authoring modes map onto the nearest student
// hue: explanation→lesson, assessment→quiz, revision→checkpoints, inquiry→open; media gets
// its own authoring-only --mode-media token.
const MODE_ACCENT: Record<LearningMode, string> = {
  explanation: "--mode-lesson",
  media: "--mode-media",
  reflection: "--mode-discuss",
  practice: "--mode-practice",
  assignment: "--mode-assignment",
  inquiry: "--mode-open",
  assessment: "--mode-quiz",
  revision: "--mode-checkpoints",
};

function modeAccentStyle(mode: LearningMode | "legacy" | null | undefined) {
  if (!mode || mode === "legacy") return undefined;
  return { ["--mode-accent" as string]: `var(${MODE_ACCENT[mode]})` };
}

// mode_type pinning mirrors the backend: practice code|applied, assessment mcq|open_ended.
function pinnedShapeFor(mode: LearningMode, modeType: string) {
  const meta = modeMeta(mode);
  if (mode === "practice" && modeType === "applied") {
    return { ...meta, activityType: "discussion" as const, responseMode: "text" as const };
  }
  if (mode === "assessment" && modeType === "open_ended") {
    return {
      ...meta,
      activityType: "discussion" as const,
      responseMode: "text" as const,
      kind: "reflect" as const,
    };
  }
  return meta;
}

function kindOfActivity(activity: LessonActivity): CurriculumStepKind {
  if (activity.mode) return pinnedShapeFor(activity.mode, activity.mode_type || "").kind;
  if (activity.response_mode === "multiple_choice") return "checkpoint";
  if (activity.stage === "teach" || activity.stage === "intro") return "teach";
  if (activity.stage === "review" || activity.activity_type === "reflection") return "reflect";
  return "practice";
}

function defaultStepForMode(mode: LearningMode): CurriculumStepInput {
  const meta = modeMeta(mode);
  const base: CurriculumStepInput = {
    title: meta.label,
    stage: meta.stage,
    activity_type: meta.activityType,
    response_mode: meta.responseMode,
    prompt: meta.defaultPrompt,
    mode,
    mode_type: meta.defaultType || null,
  };
  if (mode === "assessment") {
    base.choices = [
      { id: "a", text: "Option A" },
      { id: "b", text: "Option B" },
    ];
    base.quiz = {
      prompt: "Which option is correct?",
      choices: [
        { id: "a", text: "Option A" },
        { id: "b", text: "Option B" },
      ],
      correct_choice_ids: ["a"],
    };
  }
  return base;
}

// Map an AI-drafted step (mode or legacy kind + free text) onto the upsert payload.
// R56/R57: the ONE write path for a generated lesson package. Every row goes
// through the same actions manual authoring uses — no privileged bulk path — so the
// authoring guards, gates, and audit trail all still apply, and the lesson lands as
// a DRAFT (publishing stays the teacher's explicit act). R57 calls this per lesson
// from the whole-course runner; the single-lesson panel calls it through reloading().
async function writeLessonPackage(input: {
  accessToken: string;
  classId: string;
  unitId: string;
  pkg: CurriculumLessonPackage;
}): Promise<string> {
  const { accessToken, classId, unitId, pkg } = input;
  const created = await createCurriculumLessonStub({
    accessToken,
    classId,
    unitId,
    title: pkg.lesson.title,
    level: pkg.lesson.level,
    tutorPrompt: pkg.lesson.tutor_prompt,
  });
  const lessonId = created.lesson_id || created.id;
  if (!lessonId) throw new Error("The lesson could not be created.");
  for (const draft of pkg.steps) {
    await upsertCurriculumStep({ accessToken, classId, lessonId, step: stepInputFromDraft(draft) });
  }
  // The wrap-up quiz and the assignment land as STEPS, not as classwork rows: steps
  // need no roster (the studio has none), students meet them inside the lesson, and
  // R48's step-work strip turns any assignment/assessment step into graded classwork
  // in one click when the teacher wants grading.
  for (const item of pkg.quiz.items.slice(0, 4)) {
    const isMcq = item.question_type === "multiple_choice" && item.choices.length >= 2;
    await upsertCurriculumStep({
      accessToken,
      classId,
      lessonId,
      step: stepInputFromDraft({
        kind: "checkpoint",
        mode: "assessment",
        mode_type: isMcq ? "mcq" : "open_ended",
        title: item.prompt.slice(0, 60),
        prompt: item.prompt,
        choices: isMcq ? item.choices : [],
        correct_choice_id: isMcq ? item.correct_choice_ids[0] || "" : "",
      }),
    });
  }
  if (pkg.assignment) {
    const criteria = pkg.assignment.success_criteria.length
      ? `\n\nWhat a strong response includes:\n${pkg.assignment.success_criteria
          .map((line) => `- ${line}`)
          .join("\n")}`
      : "";
    await upsertCurriculumStep({
      accessToken,
      classId,
      lessonId,
      step: stepInputFromDraft({
        kind: "reflect",
        mode: "assignment",
        mode_type: "",
        title: pkg.assignment.title,
        prompt: `${pkg.assignment.instructions}${criteria}`,
        choices: [],
        correct_choice_id: "",
      }),
    });
  }
  return lessonId;
}

// R57: one queued lesson in a whole-course build, and the run that owns them.
type CourseBuildItem = {
  unitId: string;
  unitTitle: string;
  lessonTitle: string;
  /** This lesson's slice of the upload (see sliceMaterialForLesson). */
  material: string;
  status: "queued" | "building" | "done" | "failed";
  error: string;
  /** The title the model actually gave the lesson — usually the outline's, not always. */
  builtTitle: string;
};
type CourseBuild = {
  classId: string;
  courseId: string;
  items: CourseBuildItem[];
  includeQuiz: boolean;
  includeAssignment: boolean;
  running: boolean;
  canceled: boolean;
};

function stepInputFromDraft(draft: CurriculumStepDraft): CurriculumStepInput {
  const draftMode: LearningMode =
    draft.mode ||
    (
      {
        teach: "explanation",
        practice: "practice",
        checkpoint: "assessment",
        reflect: "reflection",
      } as const
    )[draft.kind] ||
    "practice";
  const modeType = draft.mode_type || modeMeta(draftMode).defaultType;
  const shape = pinnedShapeFor(draftMode, modeType);
  const isMcq = draftMode === "assessment" && modeType !== "open_ended";
  const choices = (draft.choices || []).filter((choice) => choice.id && choice.text);
  return {
    title: draft.title || shape.label,
    stage: shape.stage,
    activity_type: shape.activityType,
    response_mode: shape.responseMode,
    prompt: draft.prompt || shape.label,
    mode: draftMode,
    mode_type: modeType || null,
    choices: isMcq ? choices : [],
    quiz: isMcq
      ? {
          prompt: draft.prompt || "Choose the best answer.",
          choices,
          correct_choice_ids: draft.correct_choice_id ? [draft.correct_choice_id] : [],
        }
      : undefined,
  };
}

function LessonDetail({
  lesson,
  data,
  orgUnits,
  resources,
  busy,
  onSaveMeta,
  onUpsertStep,
  onReorderSteps,
  onDeleteStep,
  onBindResource,
  onShareResource,
  onGenerateArtifact,
  onApproveArtifact,
  onPublish,
  onArchiveLesson,
  onMove,
  onDelete,
  onGenerateSteps,
  onApplySteps,
  workItems,
  onOpenItem,
  onCreateForStep,
}: {
  lesson: Lesson;
  data: CurriculumAuthoringData;
  orgUnits: Array<{ unit: CurriculumUnit; courseTitle: string }>;
  resources: LessonResource[];
  busy: boolean;
  workItems: ClassworkItem[];
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreateForStep?: (
    kind: "assignment" | "assessment",
    ctx: { lessonId: string; activityId: string },
  ) => void;
  onSaveMeta: (meta: CurriculumLessonMetaInput, milestone: CurriculumMilestoneInput) => void;
  onUpsertStep: (step: CurriculumStepInput) => void;
  onReorderSteps: (orderedIds: string[]) => void;
  onDeleteStep: (activityId: string) => void;
  onBindResource: (resourceId: string, activityId: string | null) => void;
  onShareResource: (resourceId: string) => void;
  onGenerateArtifact: (args: ArtifactGenArgs) => Promise<CurriculumAdminResponse | null>;
  onApproveArtifact: (activityId: string, payload: ArtifactApprovePayload) => void;
  onPublish: () => void;
  onArchiveLesson: () => void;
  onMove: (targetUnitId: string) => void;
  onDelete: () => void;
  onGenerateSteps: (args: StepsGenArgs) => Promise<CurriculumStepDraft[] | null>;
  onApplySteps: (drafts: CurriculumStepDraft[]) => void;
}) {
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const steps = useMemo(
    () =>
      data.activities
        .filter((activity) => activity.lesson_id === lesson.id)
        .sort((a, b) => a.position - b.position),
    [data.activities, lesson.id],
  );
  const milestone = useMemo(
    () => data.milestones.find((item) => item.lesson_id === lesson.id) || null,
    [data.milestones, lesson.id],
  );
  const quizFor = (activityId: string) =>
    data.quizzes.find((quiz) => quiz.activity_id === activityId && quiz.status !== "archived") ||
    null;
  // P5: this lesson's materials, for the per-step attach controls.
  const lessonResources = useMemo(
    () =>
      resources.filter(
        (resource) => resource.lesson_id === lesson.id && resource.status !== "archived",
      ),
    [resources, lesson.id],
  );

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
            </div>
            <h2 className="mt-1 truncate font-serif text-display text-foreground">
              {lesson.title}
            </h2>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
            <ViewToggle active={view === "edit"} onClick={() => setView("edit")} label="Edit" />
            <ViewToggle
              active={view === "preview"}
              onClick={() => setView("preview")}
              label="Preview"
            />
          </div>
        </div>

        {view === "preview" ? (
          <LessonPreview lesson={lesson} milestone={milestone} steps={steps} quizFor={quizFor} />
        ) : (
          <div className="grid gap-5">
            <LessonMetaForm lesson={lesson} milestone={milestone} busy={busy} onSave={onSaveMeta} />

            <KnowledgeCard lessonId={lesson.id} />

            <section className="rounded-card border border-border bg-depth-sub p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-title font-medium text-foreground">
                  <Layers3 className="h-4 w-4" strokeWidth={1.7} />
                  Steps
                </div>
                <span className="text-meta text-muted-foreground">
                  {steps.length} step{steps.length === 1 ? "" : "s"}
                </span>
              </div>

              {steps.length === 0 ? (
                <div className="rounded-card border border-dashed border-border px-3 py-6 text-center text-meta text-muted-foreground">
                  No steps yet. Add the first one below.
                </div>
              ) : (
                <div className="grid gap-2">
                  <ReorderList items={steps} disabled={busy} onReorder={onReorderSteps}>
                    {(activity, state) => (
                      <div className={dropClass(state)}>
                        <StepCard
                          activity={activity}
                          index={steps.indexOf(activity)}
                          quiz={quizFor(activity.id)}
                          busy={busy}
                          dragging={state.dragging}
                          canDelete={steps.length > 1}
                          resources={lessonResources}
                          workItem={
                            workItems.find(
                              (item) => item.activityId === activity.id && item.kind !== "material",
                            ) ?? null
                          }
                          onBind={onBindResource}
                          onShare={onShareResource}
                          onOpenItem={onOpenItem}
                          onCreateForStep={onCreateForStep}
                          onGenerateArtifact={onGenerateArtifact}
                          onApproveArtifact={onApproveArtifact}
                          onSave={onUpsertStep}
                          onDelete={() => onDeleteStep(activity.id)}
                        />
                      </div>
                    )}
                  </ReorderList>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {MODE_META.map((meta) => (
                  <button
                    key={meta.mode}
                    type="button"
                    onClick={() => onUpsertStep(defaultStepForMode(meta.mode))}
                    disabled={busy}
                    style={modeAccentStyle(meta.mode)}
                    className="mode-chip inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-meta text-foreground disabled:opacity-50"
                  >
                    {stepKindConfig(meta.kind).icon}
                    {meta.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <AiStepsPanel
                  busy={busy}
                  resources={resources}
                  onGenerate={onGenerateSteps}
                  onApply={onApplySteps}
                />
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onPublish}
                className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-meta text-success transition-colors hover:bg-success/10"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                Publish
              </button>
              <button type="button" onClick={onArchiveLesson} className="btn btn-secondary">
                <Archive className="h-3.5 w-3.5" strokeWidth={1.7} />
                Archive
              </button>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Organize
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Move to unit
                  <select
                    value={lesson.unit_id || ""}
                    onChange={(event) => {
                      if (event.target.value && event.target.value !== lesson.unit_id) {
                        onMove(event.target.value);
                      }
                    }}
                    disabled={busy}
                    className="jargon-input normal-case tracking-normal"
                  >
                    {orgUnits.map(({ unit, courseTitle }) => (
                      <option key={unit.id} value={unit.id}>
                        {courseTitle} / {unit.title}
                      </option>
                    ))}
                  </select>
                </label>
                {confirmDelete ? (
                  <div className="inline-flex items-center gap-2 self-end">
                    <button
                      type="button"
                      onClick={onDelete}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-full border border-destructive/40 px-4 py-2 text-meta text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-meta text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                    className="btn btn-secondary self-end"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Delete
                  </button>
                )}
              </div>
              <p className="mt-2 text-meta text-muted-foreground">
                Lessons with learner activity can be archived but not deleted.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function LessonMetaForm({
  lesson,
  milestone,
  busy,
  onSave,
}: {
  lesson: Lesson;
  milestone: CurriculumAuthoringData["milestones"][number] | null;
  busy: boolean;
  onSave: (meta: CurriculumLessonMetaInput, milestone: CurriculumMilestoneInput) => void;
}) {
  const initialType = parseLessonKind(lesson.curriculum_metadata?.lesson_type) || "discussion";
  const [title, setTitle] = useState(lesson.title);
  const [level, setLevel] = useState(lesson.level || "Any level");
  const [lessonType, setLessonType] = useState<LessonKind>(initialType);
  const [tutorPrompt, setTutorPrompt] = useState(lesson.tutor_prompt || "");
  const [objective, setObjective] = useState(milestone?.objective || "");
  const [skillKeys, setSkillKeys] = useState((milestone?.skill_keys || []).join(", "));
  const [allowedModes, setAllowedModes] = useState<ResponseMode[]>(
    milestone?.allowed_response_modes?.length ? milestone.allowed_response_modes : ["text"],
  );
  // Tutor-behavior policy (school-governance controls).
  const [helpCeiling, setHelpCeiling] = useState<string>(lesson.help_ceiling || "guided");
  const [requireAttemptFirst, setRequireAttemptFirst] = useState<boolean>(
    lesson.require_attempt_first !== false,
  );
  const [finalAnswerPolicy, setFinalAnswerPolicy] = useState<string>(
    lesson.final_answer_policy || "after_attempt",
  );
  const [tutorTone, setTutorTone] = useState<string>(lesson.tutor_tone || "");
  const [tutorPace, setTutorPace] = useState<string>(lesson.tutor_pace || "");
  const [gradeBand, setGradeBand] = useState<string>(lesson.grade_band || "");
  // P8: live mentor-built activities (default off; the runtime re-checks server-side).
  const [allowLiveArtifacts, setAllowLiveArtifacts] = useState<boolean>(
    lesson.allow_live_artifacts === true,
  );

  const toggleMode = (mode: ResponseMode) => {
    setAllowedModes((current) => {
      const next = current.includes(mode)
        ? current.filter((item) => item !== mode)
        : [...current, mode];
      return next.length ? next : ["text"];
    });
  };

  const save = () => {
    onSave(
      {
        title: title.trim() || "Untitled lesson",
        level: level.trim() || "Any level",
        lesson_type: lessonType,
        tutor_prompt: tutorPrompt.trim(),
        help_ceiling: helpCeiling as CurriculumLessonMetaInput["help_ceiling"],
        require_attempt_first: requireAttemptFirst,
        final_answer_policy: finalAnswerPolicy as CurriculumLessonMetaInput["final_answer_policy"],
        tutor_tone: tutorTone,
        tutor_pace: tutorPace,
        grade_band: gradeBand,
        allow_live_artifacts: allowLiveArtifacts,
      },
      {
        objective: objective.trim(),
        skill_keys: skillKeys
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        allowed_response_modes: allowedModes,
      },
    );
  };

  return (
    <section className="rounded-card border border-border bg-depth-sub p-4">
      <div className="mb-3 flex items-center gap-2 text-title font-medium text-foreground">
        <NotebookPen className="h-4 w-4" strokeWidth={1.7} />
        Lesson basics
      </div>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Lesson title" value={title} onChange={setTitle} />
          <TextInput label="Level" value={level} onChange={setLevel} />
          <SelectInput
            label="Lesson type"
            value={lessonType}
            options={["discussion", "code", "reflection", "multiple_choice", "file"]}
            onChange={(value) => setLessonType(value as LessonKind)}
          />
        </div>
        <TextArea label="Mentor prompt" value={tutorPrompt} onChange={setTutorPrompt} />
        <TextArea label="Lesson objective" value={objective} onChange={setObjective} />
        <TextInput label="Skill keys (comma separated)" value={skillKeys} onChange={setSkillKeys} />
        <div className="grid gap-2">
          <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Allowed answer modes
          </div>
          <div className="flex flex-wrap gap-2">
            {(["text", "code", "multiple_choice", "file"] as ResponseMode[]).map((mode) => (
              <button
                type="button"
                key={mode}
                onClick={() => toggleMode(mode)}
                className={`rounded-full border px-3 py-1.5 text-meta transition-colors ${
                  allowedModes.includes(mode)
                    ? "border-primary/25 bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        {/* R52: a flat hairline group, not a third tier of nested card chrome — the
            editor keeps ONE inset level (this Lesson basics card) and separates
            sub-groups with rules instead of boxes-in-boxes. */}
        <div className="grid gap-3 border-t border-border/60 pt-4">
          <div>
            <div className="text-body font-medium text-foreground">Tutor behavior</div>
            <p className="mt-0.5 text-meta text-muted-foreground">
              Govern how much help the mentor may give and whether it must see an attempt first. The
              student's chosen mode can ask for help only up to the ceiling.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectInput
              label="Help ceiling"
              value={helpCeiling}
              options={["clarify", "hints", "guided", "worked_example", "feedback", "study"]}
              onChange={setHelpCeiling}
            />
            <SelectInput
              label="Final answer"
              value={finalAnswerPolicy}
              options={["never", "after_attempt", "allowed"]}
              onChange={setFinalAnswerPolicy}
            />
            <SelectInput
              label="Grade band"
              value={gradeBand || "auto"}
              options={["auto", "lower", "middle", "upper"]}
              onChange={(value) => setGradeBand(value === "auto" ? "" : value)}
            />
            <SelectInput
              label="Default tone"
              value={tutorTone || "default"}
              options={["default", "encouraging", "neutral", "direct"]}
              onChange={(value) => setTutorTone(value === "default" ? "" : value)}
            />
            <SelectInput
              label="Default pace"
              value={tutorPace || "default"}
              options={["default", "brief", "balanced", "guided"]}
              onChange={(value) => setTutorPace(value === "default" ? "" : value)}
            />
          </div>
          <button
            type="button"
            onClick={() => setRequireAttemptFirst((current) => !current)}
            className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-meta transition-colors ${
              requireAttemptFirst
                ? "border-primary/25 bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {requireAttemptFirst ? <Check className="h-3.5 w-3.5" strokeWidth={1.8} /> : null}
            Require an attempt before the mentor helps
          </button>
          <div className="grid gap-1">
            <button
              type="button"
              onClick={() => setAllowLiveArtifacts((current) => !current)}
              className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-meta transition-colors ${
                allowLiveArtifacts
                  ? "border-primary/25 bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {allowLiveArtifacts ? <Check className="h-3.5 w-3.5" strokeWidth={1.8} /> : null}
              Live mentor-built activities
            </button>
            <p className="text-meta text-muted-foreground">
              Lets the mentor offer to build a one-off interactive activity for a struggling student
              — private to that student until you share it.
            </p>
          </div>
        </div>
        <div>
          <button type="button" onClick={save} disabled={busy} className="btn btn-secondary">
            <Save className="h-3.5 w-3.5" strokeWidth={1.7} />
            {busy ? "Saving..." : "Save lesson basics"}
          </button>
        </div>
      </div>
    </section>
  );
}

function StepCard({
  activity,
  index,
  quiz,
  busy,
  dragging,
  canDelete,
  resources,
  workItem,
  onBind,
  onShare,
  onOpenItem,
  onCreateForStep,
  onGenerateArtifact,
  onApproveArtifact,
  onSave,
  onDelete,
}: {
  activity: LessonActivity;
  index: number;
  quiz: CurriculumAuthoringData["quizzes"][number] | null;
  busy: boolean;
  dragging: boolean;
  canDelete: boolean;
  // P5: this lesson's materials — bind/unbind writes lesson_resources.activity_id, and
  // the chat runtime attaches a step's bound materials on its presentation turn.
  resources: LessonResource[];
  // R48: the real assignment/assessment row linked to this step (null = none yet).
  workItem: ClassworkItem | null;
  onBind: (resourceId: string, activityId: string | null) => void;
  // P8: promote a mentor-built (student-private) activity to the whole class.
  onShare: (resourceId: string) => void;
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreateForStep?: (
    kind: "assignment" | "assessment",
    ctx: { lessonId: string; activityId: string },
  ) => void;
  // P7: generate an interactive artifact for this step, preview it, and approve → publish.
  onGenerateArtifact: (args: ArtifactGenArgs) => Promise<CurriculumAdminResponse | null>;
  onApproveArtifact: (activityId: string, payload: ArtifactApprovePayload) => void;
  onSave: (step: CurriculumStepInput) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(activity.title);
  const [prompt, setPrompt] = useState(activity.prompt);
  // v4 mode: existing steps keep their stored mode; "legacy" preserves pre-mode behavior
  // for unmigrated steps (selecting Legacy on save explicitly clears the mode).
  const [stepMode, setStepMode] = useState<LearningMode | "legacy">(activity.mode ?? "legacy");
  const [stepModeType, setStepModeType] = useState(
    activity.mode_type || (activity.mode ? modeMeta(activity.mode).defaultType : ""),
  );
  const [practiceMode, setPracticeMode] = useState<ResponseMode>(
    activity.response_mode === "code" ? "code" : "text",
  );
  const [starterCode, setStarterCode] = useState(activity.starter_code || "");
  const [expectedOutput, setExpectedOutput] = useState(activity.expected_output || "");
  // The selected mode drives which fields show; legacy keeps the old kind derivation.
  const kind =
    stepMode === "legacy"
      ? kindOfActivity({ ...activity, mode: null })
      : pinnedShapeFor(stepMode, stepModeType).kind;
  const config =
    stepMode === "legacy"
      ? stepKindConfig(kind)
      : {
          ...stepKindConfig(kind),
          label: modeMeta(stepMode).label,
          promptLabel: modeMeta(stepMode).promptLabel,
        };
  const showCodeFields =
    (stepMode === "legacy" && kind === "practice" && practiceMode === "code") ||
    (stepMode === "practice" && stepModeType !== "applied");
  const showChoices =
    (stepMode === "legacy" && kind === "checkpoint") ||
    (stepMode === "assessment" && stepModeType !== "open_ended");
  const initialChoices = quiz?.choices?.length
    ? quiz.choices
    : (activity.choices || [])
        .map((choice) => ({ id: choice.id || "", text: choice.text || choice.label || "" }))
        .filter((choice) => choice.id);
  const [choices, setChoices] = useState<Array<{ id: string; text: string }>>(
    initialChoices.length
      ? initialChoices
      : [
          { id: "a", text: "" },
          { id: "b", text: "" },
        ],
  );
  const [correctId, setCorrectId] = useState(
    quiz?.correct_choice_ids?.[0] || choices[0]?.id || "a",
  );

  const updateChoice = (i: number, patch: Partial<{ id: string; text: string }>) =>
    setChoices((current) =>
      current.map((choice, idx) => (idx === i ? { ...choice, ...patch } : choice)),
    );

  // P5 attach controls: a just-created step carries a temp id until the server swap —
  // binding to it would violate the resource's FK, so the controls wait it out.
  const attached = resources.filter((resource) => resource.activity_id === activity.id);
  // P8: mentor-built rows are student-private and carry their step in
  // metadata.generated.activity_id (activity_id stays null so they never enter the
  // step-binding machinery). They get their own oversight list below; a still-private
  // one can't be attached for the class (RLS would silently hide it from everyone else).
  const generatedFor = (resource: LessonResource) =>
    (resource.metadata?.generated as { activity_id?: string } | undefined)?.activity_id ?? null;
  const mentorBuilt = resources.filter((resource) => generatedFor(resource) === activity.id);
  const attachable = resources.filter(
    (resource) =>
      resource.activity_id !== activity.id &&
      !(generatedFor(resource) && resource.visibility === "student_private"),
  );
  const bindable = !activity.id.startsWith("temp-");

  const save = () => {
    const isCode = showCodeFields;
    const isMcq = showChoices;
    const cleaned = choices
      .map((choice) => ({ id: choice.id.trim(), text: choice.text.trim() }))
      .filter((choice) => choice.id && choice.text);
    const shape = stepMode === "legacy" ? null : pinnedShapeFor(stepMode, stepModeType);
    const step: CurriculumStepInput = {
      id: activity.id,
      title: title.trim() || config.label,
      stage: shape ? shape.stage : config.stage,
      activity_type: shape
        ? shape.activityType
        : kind === "checkpoint"
          ? "multiple_choice"
          : isCode
            ? "code"
            : config.activityType,
      response_mode: shape
        ? shape.responseMode
        : kind === "checkpoint"
          ? "multiple_choice"
          : isCode
            ? "code"
            : "text",
      prompt: prompt.trim(),
      starter_code: isCode ? starterCode : "",
      expected_output: isCode ? expectedOutput : "",
      choices: isMcq ? cleaned : [],
      // Always sent: an explicit null clears a step back to legacy behavior.
      mode: stepMode === "legacy" ? null : stepMode,
      mode_type: stepMode === "legacy" ? null : stepModeType || null,
      quiz: isMcq
        ? {
            prompt: prompt.trim() || "Choose the best answer.",
            choices: cleaned,
            correct_choice_ids: correctId ? [correctId] : [],
          }
        : undefined,
    };
    onSave(step);
    setOpen(false);
  };

  return (
    <div
      // The step's LearningMode hue rides the card's left edge + kind chip (mode-edge /
      // mode-chip read --mode-accent); legacy steps stay neutral.
      style={modeAccentStyle(stepMode)}
      className={`mode-edge rounded-card border border-border bg-depth-field ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="cursor-grab text-muted-foreground/60">
          <GripVertical className="h-4 w-4" strokeWidth={1.6} />
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-meta text-muted-foreground">
          {index + 1}
        </span>
        <span className="text-muted-foreground">{config.icon}</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-body text-foreground">
            {activity.title}
          </span>
          <span className="mode-chip shrink-0 rounded-pill border px-2 py-0.5 text-overline uppercase tracking-[0.08em] text-muted-foreground">
            {config.label}
          </span>
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
            strokeWidth={1.7}
          />
        </button>
      </div>

      {open ? (
        <div className="grid gap-3 border-t border-border p-3">
          <TextInput label="Step title" value={title} onChange={setTitle} />

          <SelectInput
            label="Learning mode"
            value={stepMode}
            options={["legacy", ...MODE_META.map((meta) => meta.mode)]}
            optionLabels={{
              legacy: "Legacy (pre-mode step)",
              explanation: "Explanation — teach it outright",
              media: "Media — study attached material",
              reflection: "Reflection — student explains it",
              practice: "Practice — use the idea",
              assignment: "Assignment — frame docked task",
              inquiry: "Inquiry — invite questions",
              assessment: "Assessment — evaluate grasp",
              revision: "Revision — recall prior skills",
            }}
            onChange={(value) => {
              const next = value as LearningMode | "legacy";
              setStepMode(next);
              if (next !== "legacy") setStepModeType(modeMeta(next).defaultType);
            }}
          />

          {stepMode === "practice" ? (
            <SelectInput
              label="Practice type"
              value={stepModeType || "code"}
              options={["code", "applied"]}
              optionLabels={{ code: "Code — run it", applied: "Applied — use it in words" }}
              onChange={setStepModeType}
            />
          ) : null}

          {stepMode === "assessment" ? (
            <SelectInput
              label="Assessment type"
              value={stepModeType || "mcq"}
              options={["mcq", "open_ended"]}
              optionLabels={{ mcq: "Multiple choice", open_ended: "Open-ended (graded, no hints)" }}
              onChange={setStepModeType}
            />
          ) : null}

          <TextArea label={config.promptLabel} value={prompt} onChange={setPrompt} />

          {stepMode === "legacy" && kind === "practice" ? (
            <SelectInput
              label="Answer mode"
              value={practiceMode}
              options={["text", "code"]}
              onChange={(value) => setPracticeMode(value as ResponseMode)}
            />
          ) : null}

          {showCodeFields ? (
            <>
              <TextArea label="Starter code" value={starterCode} onChange={setStarterCode} />
              <TextArea
                label="Expected output"
                value={expectedOutput}
                onChange={setExpectedOutput}
              />
            </>
          ) : null}

          {showChoices ? (
            <div className="grid gap-2">
              <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Choices
              </div>
              {choices.map((choice, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)_90px]">
                  <input
                    value={choice.id}
                    onChange={(event) => updateChoice(i, { id: event.target.value })}
                    className="jargon-input"
                  />
                  <input
                    value={choice.text}
                    onChange={(event) => updateChoice(i, { text: event.target.value })}
                    className="jargon-input"
                  />
                  <button
                    type="button"
                    onClick={() => setCorrectId(choice.id)}
                    className={`rounded-full border px-3 py-1.5 text-meta ${
                      correctId === choice.id
                        ? "border-success/35 text-success"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    Correct
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setChoices((current) => [
                    ...current,
                    { id: String.fromCharCode(97 + current.length), text: "" },
                  ])
                }
                className="justify-self-start text-meta text-muted-foreground hover:text-foreground"
              >
                + Add choice
              </button>
            </div>
          ) : null}

          {/* P5: per-step materials. The chat runtime attaches these on the step's
              presentation turn (all bound, up to 3) — the fix that makes Media steps
              actually show their material. Binding saves immediately, outside Save step. */}
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Attached materials
              </div>
              <span className="text-meta text-muted-foreground/70">
                Saves immediately · the mentor presents up to 3
              </span>
            </div>
            {attached.map((resource) => (
              <div
                key={resource.id}
                className="flex items-center gap-2 rounded-card border border-border bg-depth-sub px-3 py-2"
              >
                <Paperclip
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={1.7}
                />
                <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                  {resource.title}
                </span>
                <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                  {resource.resource_type}
                </span>
                {resource.status !== "published" ? (
                  <span
                    title="Drafts never reach students — the mentor only presents published materials."
                    className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-overline uppercase tracking-[0.06em] text-warning"
                  >
                    draft
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onBind(resource.id, null)}
                  disabled={busy || !bindable}
                  title="Detach from this step"
                  className="shrink-0 rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              </div>
            ))}
            {attached.length === 0 && stepMode === "media" ? (
              <div className="rounded-card border border-dashed border-border px-3 py-2 text-meta text-muted-foreground">
                {resources.length === 0
                  ? "No lesson materials yet — add them in the class console's Resources tab, then attach them here."
                  : "Media steps present their attached materials when the step opens — attach one below."}
              </div>
            ) : null}
            {attachable.length > 0 ? (
              <select
                value=""
                disabled={busy || !bindable}
                onChange={(event) => {
                  if (event.target.value) onBind(event.target.value, activity.id);
                  event.target.value = "";
                }}
                title={bindable ? undefined : "Save the new step first, then attach materials."}
                className="jargon-input text-muted-foreground disabled:opacity-50"
              >
                <option value="">Attach a material…</option>
                {attachable.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.title}
                    {resource.status !== "published" ? " (draft)" : ""}
                    {resource.activity_id ? " — attached to another step" : ""}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {/* R48: assignment/assessment steps run on a REAL work item — an assignments/
              assessments row whose activity_id points at this step. The chat runtime holds
              the step until the student submits it, so an unlinked step is just a
              conversation. Gated on the SAVED mode (the loader reads stored mode too):
              flipping the mode select above doesn't link anything until Save step. */}
          {activity.mode === "assignment" || activity.mode === "assessment" ? (
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Step work
                </div>
                <span className="text-meta text-muted-foreground/70">
                  {activity.mode === "assignment"
                    ? "Students submit it before the lesson moves on"
                    : "Students take it before the lesson moves on"}
                </span>
              </div>
              {workItem ? (
                <div className="flex items-center gap-2 rounded-card border border-border bg-depth-sub px-3 py-2">
                  <ListChecks
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.7}
                  />
                  <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                    {workItem.title}
                  </span>
                  <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                    {workItem.status}
                  </span>
                  {workItem.needsReviewCount > 0 ? (
                    <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-overline uppercase tracking-[0.06em] text-warning">
                      {workItem.needsReviewCount} to review
                    </span>
                  ) : null}
                  {onOpenItem ? (
                    <button
                      type="button"
                      onClick={() => onOpenItem(workItem.kind, workItem.id)}
                      className="shrink-0 rounded-full border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Open in Classwork
                    </button>
                  ) : null}
                </div>
              ) : onCreateForStep ? (
                <button
                  type="button"
                  onClick={() =>
                    onCreateForStep(activity.mode === "assignment" ? "assignment" : "assessment", {
                      lessonId: activity.lesson_id,
                      activityId: activity.id,
                    })
                  }
                  disabled={busy || !bindable}
                  title={bindable ? undefined : "Save the new step first, then create its work."}
                  className="justify-self-start rounded-full border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {activity.mode === "assignment"
                    ? "Create the assignment for this step"
                    : "Create the quiz for this step"}
                </button>
              ) : (
                <div className="rounded-card border border-dashed border-border px-3 py-2 text-meta text-muted-foreground">
                  No work linked to this step yet.
                </div>
              )}
            </div>
          ) : null}

          {/* P8: mentor-built activities for this step (live-generated for one student).
              Oversight list: the teacher can share one with the class — after the promote
              it becomes an ordinary attachable material. */}
          {mentorBuilt.length ? (
            <div className="grid gap-1.5">
              <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Mentor-built activities
              </div>
              {mentorBuilt.map((resource) => (
                <div
                  key={resource.id}
                  className="flex items-center gap-2 rounded-card border border-border bg-depth-field px-3 py-2"
                >
                  <Sparkles
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.7}
                  />
                  <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                    {resource.title}
                  </span>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-overline uppercase tracking-[0.06em] text-muted-foreground">
                    {resource.visibility === "student_private" ? "student-private" : "shared"}
                  </span>
                  {resource.visibility === "student_private" ? (
                    <button
                      type="button"
                      onClick={() => onShare(resource.id)}
                      disabled={busy}
                      title="Make this activity visible to the whole class"
                      className="shrink-0 rounded-full border border-border px-2.5 py-1 text-meta text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      Share with class
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* P7: generate an interactive activity (sim / deck), preview it, approve → it
              becomes a published material bound to THIS step. Gated on a saved step id. */}
          <ArtifactGeneratePanel
            busy={busy}
            bindable={bindable}
            onGenerate={onGenerateArtifact}
            onApprove={(payload) => onApproveArtifact(activity.id, payload)}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={busy} className="btn btn-secondary">
              <Save className="h-3.5 w-3.5" strokeWidth={1.7} />
              {busy ? "Saving..." : "Save step"}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy || !canDelete}
              title={canDelete ? undefined : "A lesson needs at least one step."}
              className="btn btn-secondary"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
              Delete step
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LessonPreview({
  lesson,
  milestone,
  steps,
  quizFor,
}: {
  lesson: Lesson;
  milestone: CurriculumAuthoringData["milestones"][number] | null;
  steps: LessonActivity[];
  quizFor: (activityId: string) => CurriculumAuthoringData["quizzes"][number] | null;
}) {
  return (
    <div className="grid gap-4">
      <div className="mb-1 flex items-center gap-2 text-title font-medium text-foreground">
        <Eye className="h-4 w-4" strokeWidth={1.7} />
        Student walkthrough
      </div>
      <div>
        <h2 className="font-serif text-display leading-tight text-foreground">{lesson.title}</h2>
        <p className="mt-2 text-body leading-relaxed text-muted-foreground">
          {milestone?.objective || "Add a lesson objective to preview the target."}
        </p>
      </div>
      {steps.length === 0 ? (
        <div className="rounded-card border border-border bg-depth-sub p-4 text-meta text-muted-foreground">
          No steps yet.
        </div>
      ) : (
        steps.map((activity, index) => {
          const kind = kindOfActivity(activity);
          const config = stepKindConfig(kind);
          const quiz = quizFor(activity.id);
          return (
            <div
              key={activity.id}
              style={modeAccentStyle(activity.mode)}
              className="mode-edge rounded-card border border-border bg-depth-sub p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-overline">
                  {index + 1}
                </span>
                {config.label}
              </div>
              <div className="text-body-lg font-medium text-foreground">{activity.title}</div>
              <p className="mt-1 whitespace-pre-wrap text-meta leading-relaxed text-muted-foreground">
                {activity.prompt}
              </p>
              {kind === "checkpoint" && quiz?.choices?.length ? (
                <div className="mt-3 grid gap-1.5">
                  {quiz.choices.map((choice) => (
                    <div
                      key={choice.id}
                      className={`rounded-control border px-3 py-2 text-meta ${
                        quiz.correct_choice_ids?.includes(choice.id)
                          ? "border-success/35 text-success"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {choice.id}. {choice.text}
                    </div>
                  ))}
                </div>
              ) : null}
              {kind === "practice" && activity.response_mode === "code" && activity.starter_code ? (
                <pre className="mt-3 overflow-auto rounded-control border border-border bg-depth-field p-3 text-meta text-foreground">
                  {activity.starter_code}
                </pre>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-meta transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AI authoring panels — generate a draft (with subject context + attached docs),
// review it, refine specific parts (changes highlighted), then apply.
// ---------------------------------------------------------------------------

type ItemStatus = "added" | "changed" | "same";

// Compare item signatures by index; used to highlight what a refine changed.
function diffStatuses(prev: string[] | null, next: string[]): ItemStatus[] {
  return next.map((sig, i) => {
    if (!prev || prev[i] === undefined) return prev ? "added" : "same";
    return prev[i] === sig ? "same" : "changed";
  });
}

function statusRing(status: ItemStatus): string {
  if (status === "added") return "border-success/45 bg-success/5";
  if (status === "changed") return "border-amber-400/60 bg-amber-400/10";
  return "border-border bg-depth-sub";
}

function statusLabel(status: ItemStatus): string | null {
  if (status === "added") return "new";
  if (status === "changed") return "changed";
  return null;
}

function resourceReferenceText(resource: LessonResource): string {
  return [resource.description, resource.student_instructions, resource.transcript_text]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n")
    .trim();
}

function combineReference(
  paste: string,
  docs: Array<{ name: string; text: string }>,
  pickedResources: Array<{ title: string; text: string }>,
): string {
  const sections: string[] = [];
  if (paste.trim()) sections.push(`[Pasted notes]\n${paste.trim()}`);
  for (const doc of docs)
    if (doc.text.trim()) sections.push(`[Document: ${doc.name}]\n${doc.text.trim()}`);
  for (const res of pickedResources) {
    if (res.text.trim()) sections.push(`[Resource: ${res.title}]\n${res.text.trim()}`);
  }
  return sections.join("\n\n");
}

function AiReferenceInput({
  resources,
  busy,
  onChange,
}: {
  resources: LessonResource[];
  busy: boolean;
  onChange: (referenceText: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [docs, setDocs] = useState<Array<{ name: string; text: string }>>([]);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [fileError, setFileError] = useState("");

  const usableResources = useMemo(
    () => resources.filter((resource) => resourceReferenceText(resource).length > 0),
    [resources],
  );

  useEffect(() => {
    const picked = usableResources
      .filter((resource) => resourceIds.includes(resource.id))
      .map((resource) => ({ title: resource.title, text: resourceReferenceText(resource) }));
    onChange(combineReference(paste, docs, picked));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paste, docs, resourceIds, usableResources]);

  // R56: teachers bring what they have — PDFs, Word, PowerPoint, notes, and photos of
  // worksheets. Office formats and PDFs are read IN THE BROWSER; only images need the
  // server (vision), and only the resulting text is ever sent on.
  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setExtracting(true);
    const added: Array<{ name: string; text: string }> = [];
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        let text = "";
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          const url = URL.createObjectURL(file);
          try {
            const chunks = await extractPdfTextChunksFromUrl(url);
            text = chunks.map((chunk) => chunk.chunk_text).join(" ");
          } finally {
            URL.revokeObjectURL(url);
          }
        } else if (isDocx(file)) {
          text = await extractDocxText(file);
        } else if (isPptx(file)) {
          text = await extractPptxText(file);
        } else if (file.type.startsWith("image/")) {
          const session = await getSession();
          if (!session) throw new Error("Sign in again to read images.");
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Could not read that image."));
            reader.readAsDataURL(file);
          });
          text = await readImageMaterial(session.access_token, dataUrl);
        } else if (isPlainTextFile(file)) {
          const raw = await file.text();
          text = /\.html?$/i.test(file.name) ? htmlToText(raw) : raw;
        } else {
          throw new Error("Unsupported file type.");
        }
        // R59: a real chapter upload is ~140k characters (111 pages). The old 40k cap
        // silently truncated it to the first lesson and a half, so the outline pass
        // proposed a course for a chapter it had only read the start of.
        if (text.trim()) added.push({ name: file.name, text: text.trim().slice(0, 400000) });
        else failed.push(file.name);
      } catch {
        failed.push(file.name);
      }
    }
    setDocs((current) => [...current, ...added]);
    setFileError(
      failed.length
        ? `Couldn't read ${failed.join(", ")} — try a PDF, Word, PowerPoint, image, or plain-text file.`
        : "",
    );
    setExtracting(false);
  };

  const addLink = async () => {
    const url = link.trim();
    if (!url) return;
    setLinkBusy(true);
    setFileError("");
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in again to read links.");
      const result = await readUrlMaterial(session.access_token, url);
      if (!result.text.trim()) throw new Error("That page had no readable text.");
      setDocs((current) => [
        ...current,
        { name: result.title || url, text: result.text.slice(0, 400000) },
      ]);
      setLink("");
    } catch (error) {
      setFileError((error as Error).message || "Could not read that link.");
    } finally {
      setLinkBusy(false);
    }
  };

  const summary =
    [
      paste.trim() ? "notes" : "",
      docs.length ? `${docs.length} file${docs.length === 1 ? "" : "s"}` : "",
      resourceIds.length
        ? `${resourceIds.length} resource${resourceIds.length === 1 ? "" : "s"}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || "optional";

  return (
    <div className="rounded-card border border-border bg-depth-sub p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-meta font-medium text-foreground"
      >
        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
        Reference material
        <span className="text-meta font-normal text-muted-foreground">{summary}</span>
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={1.7}
        />
      </button>
      {open ? (
        <div className="mt-3 grid gap-3">
          <TextArea label="Paste source text" value={paste} onChange={setPaste} />
          <div className="grid gap-1">
            <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Upload files (PDF, Word, PowerPoint, images, notes)
            </span>
            <input
              type="file"
              multiple
              accept=".txt,.md,.markdown,.csv,.html,.htm,.pdf,.docx,.pptx,image/*,text/plain,application/pdf"
              disabled={busy || extracting}
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = "";
              }}
              className="jargon-input file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-meta file:text-foreground"
            />
            {extracting ? (
              <span className="text-meta text-muted-foreground">Reading files…</span>
            ) : null}
            {fileError ? <span className="text-meta text-danger">{fileError}</span> : null}
            {docs.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {docs.map((doc, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-meta text-muted-foreground"
                  >
                    <span className="max-w-[160px] truncate">{doc.name}</span>
                    <button
                      type="button"
                      onClick={() => setDocs((current) => current.filter((_, idx) => idx !== i))}
                      aria-label="Remove file"
                      className="hover:text-foreground"
                    >
                      <X className="h-3 w-3" strokeWidth={1.8} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-1">
            <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Add a link
            </span>
            <div className="flex gap-2">
              <input
                value={link}
                onChange={(event) => setLink(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addLink();
                  }
                }}
                placeholder="https://…"
                disabled={busy || linkBusy}
                className="jargon-input min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={() => void addLink()}
                disabled={busy || linkBusy || !link.trim()}
                className="btn btn-secondary btn-sm shrink-0"
              >
                {linkBusy ? "Reading…" : "Read page"}
              </button>
            </div>
          </div>
          {usableResources.length ? (
            <div className="grid gap-1">
              <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Use existing resources
              </span>
              <div className="grid max-h-40 gap-1 overflow-auto">
                {usableResources.map((resource) => (
                  <label
                    key={resource.id}
                    className="flex items-center gap-2 text-meta text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={resourceIds.includes(resource.id)}
                      onChange={() =>
                        setResourceIds((current) =>
                          current.includes(resource.id)
                            ? current.filter((id) => id !== resource.id)
                            : [...current, resource.id],
                        )
                      }
                      className="h-3.5 w-3.5 accent-foreground"
                    />
                    <span className="min-w-0 truncate">{resource.title}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RefineBox({
  loading,
  placeholder,
  onSubmit,
  onCancel,
}: {
  loading: boolean;
  placeholder: string;
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="mt-2 grid gap-1.5">
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        className="jargon-input"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSubmit(text.trim())}
          disabled={loading || !text.trim()}
          className="btn btn-secondary btn-sm"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          {loading ? "Refining…" : "Refine"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-meta text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// R56 "build from material" — the one-stop authoring moment. The teacher points at
// what they already have (upload, paste, link, or an existing lesson resource), and
// the platform drafts the whole lesson: steps, a wrap-up quiz, and an assignment.
// Everything shown here is a DRAFT — Apply writes it as an unpublished lesson.
function BuildFromMaterialPanel({
  busy,
  resources,
  onGenerate,
  onApply,
}: {
  busy: boolean;
  resources: LessonResource[];
  onGenerate: (args: {
    prompt: string;
    referenceText: string;
    includeQuiz: boolean;
    includeAssignment: boolean;
  }) => Promise<CurriculumLessonPackage | null>;
  onApply: (pkg: CurriculumLessonPackage) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [includeAssignment, setIncludeAssignment] = useState(true);
  const [loading, setLoading] = useState(false);
  const [pkg, setPkg] = useState<CurriculumLessonPackage | null>(null);

  const run = async () => {
    setLoading(true);
    const result = await onGenerate({
      prompt: prompt.trim(),
      referenceText,
      includeQuiz,
      includeAssignment,
    });
    setLoading(false);
    if (result) setPkg(result);
  };

  return (
    <div className="rounded-card border border-border bg-depth-sub p-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <div className="min-w-0">
          <h4 className="text-body font-medium text-foreground">Build a lesson from material</h4>
          <p className="mt-0.5 text-meta text-muted-foreground">
            Upload a chapter, paste your notes, or add a link. Jargon drafts the lesson steps, a
            wrap-up quiz, and an assignment for you to review.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        <AiReferenceInput
          resources={resources}
          busy={busy || loading}
          onChange={setReferenceText}
        />
        <TextArea
          label="Anything to steer it? (optional) — e.g. Grade 7, one period, focus on the diagram on page 3"
          value={prompt}
          onChange={setPrompt}
        />
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-meta text-foreground">
            <input
              type="checkbox"
              checked={includeQuiz}
              onChange={() => setIncludeQuiz((value) => !value)}
              className="h-3.5 w-3.5 accent-foreground"
            />
            Include a wrap-up quiz
          </label>
          <label className="flex items-center gap-2 text-meta text-foreground">
            <input
              type="checkbox"
              checked={includeAssignment}
              onChange={() => setIncludeAssignment((value) => !value)}
              className="h-3.5 w-3.5 accent-foreground"
            />
            Include an assignment
          </label>
        </div>
        <div>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || loading || (!referenceText.trim() && !prompt.trim())}
            className="btn btn-primary btn-sm"
          >
            {loading ? "Building the lesson…" : "Build lesson"}
          </button>
          {!referenceText.trim() && !prompt.trim() ? (
            <span className="ml-2 text-meta text-muted-foreground">
              Add material or a brief first.
            </span>
          ) : null}
        </div>
      </div>

      {pkg ? (
        <div className="mt-4 grid gap-3 border-t border-border pt-4">
          {!pkg.grounded ? (
            <p className="text-meta text-warning">
              Built from your brief alone — no material was attached, so check the facts before
              publishing.
            </p>
          ) : null}
          <div className="rounded-card border border-border bg-depth-card p-3">
            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
            </div>
            <div className="mt-1 text-body font-medium text-foreground">{pkg.lesson.title}</div>
            {pkg.lesson.objective ? (
              <div className="mt-0.5 text-meta text-muted-foreground">{pkg.lesson.objective}</div>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {pkg.steps.length} steps
            </div>
            {pkg.steps.map((step, index) => (
              <div key={index} className="rounded-card border border-border bg-depth-card p-2.5">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-border px-2 py-0.5 text-overline uppercase text-muted-foreground">
                    {step.mode || step.kind}
                  </span>
                  <span className="min-w-0 truncate text-meta font-medium text-foreground">
                    {step.title}
                  </span>
                </div>
                {step.prompt ? (
                  <p className="mt-1 line-clamp-2 text-meta text-muted-foreground">{step.prompt}</p>
                ) : null}
              </div>
            ))}
          </div>

          {pkg.quiz.items.length ? (
            <div className="grid gap-1.5">
              <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Wrap-up quiz · {pkg.quiz.items.length} questions
              </div>
              {pkg.quiz.items.map((item, index) => (
                <div key={index} className="rounded-card border border-border bg-depth-card p-2.5">
                  <div className="text-meta text-foreground">{item.prompt}</div>
                  {item.choices.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {item.choices.map((choice) => (
                        <span
                          key={choice.id}
                          className={`rounded-full border px-2 py-0.5 text-overline ${
                            item.correct_choice_ids.includes(choice.id)
                              ? "border-success/45 text-success"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {choice.text}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-overline uppercase text-muted-foreground">
                      Written answer
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {pkg.assignment ? (
            <div className="rounded-card border border-border bg-depth-card p-3">
              <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Assignment
              </div>
              <div className="mt-1 text-meta font-medium text-foreground">
                {pkg.assignment.title}
              </div>
              <p className="mt-1 text-meta text-muted-foreground">{pkg.assignment.instructions}</p>
              {pkg.assignment.success_criteria.length ? (
                <ul className="mt-2 grid gap-0.5">
                  {pkg.assignment.success_criteria.map((line, index) => (
                    <li key={index} className="text-meta text-muted-foreground">
                      · {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onApply(pkg);
                setPkg(null);
              }}
              disabled={busy}
              className="btn btn-primary btn-sm"
            >
              Add this lesson
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || loading}
              className="btn btn-secondary btn-sm"
            >
              Rebuild
            </button>
            <button
              type="button"
              onClick={() => setPkg(null)}
              disabled={busy}
              className="btn btn-ghost btn-sm"
            >
              Discard
            </button>
            <span className="text-meta text-muted-foreground">
              Lands as a draft — publish it when you're happy.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AiOutlinePanel({
  busy,
  resources,
  onGenerate,
  onApply,
  onBuild,
}: {
  busy: boolean;
  resources: LessonResource[];
  onGenerate: (args: OutlineGenArgs) => Promise<CurriculumOutlineDraft | null>;
  onApply: (outline: CurriculumOutlineDraft) => void;
  // R57: apply the outline AND write every lesson from the same material.
  onBuild: (outline: CurriculumOutlineDraft, material: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<CurriculumOutlineDraft | null>(null);
  const [statuses, setStatuses] = useState<ItemStatus[]>([]);
  const [refineFor, setRefineFor] = useState<number | null>(null);

  const sigOf = (unit: CurriculumOutlineDraft["units"][number]) => JSON.stringify(unit);
  const lessonCount = draft
    ? draft.units.reduce((total, unit) => total + unit.lessons.length, 0)
    : 0;

  const generate = async () => {
    // R57: material alone is a brief — a chapter upload IS the instruction. Either
    // one is enough; both together is best.
    if (!prompt.trim() && !referenceText.trim()) return;
    setLoading(true);
    const result = await onGenerate({ prompt: prompt.trim(), referenceText });
    if (result) {
      setDraft(result);
      setStatuses(result.units.map(() => "same"));
      setRefineFor(null);
    }
    setLoading(false);
  };

  const refine = async (index: number, feedback: string) => {
    if (!draft || !feedback) return;
    setLoading(true);
    const prevSigs = draft.units.map(sigOf);
    const result = await onGenerate({
      prompt,
      referenceText,
      current: draft,
      feedback,
      target: `Unit "${draft.units[index]?.title || index + 1}"`,
    });
    if (result) {
      setStatuses(diffStatuses(prevSigs, result.units.map(sigOf)));
      setDraft(result);
      setRefineFor(null);
    }
    setLoading(false);
  };

  return (
    <section className="rounded-card border border-border bg-depth-sub p-4">
      <div className="mb-2 flex items-center gap-2 text-title font-medium text-foreground">
        <Sparkles className="h-4 w-4" strokeWidth={1.7} />
        Draft an outline with AI
      </div>
      <p className="mb-3 text-meta text-muted-foreground">
        Attach a book, chapter, or syllabus — or describe the course. The AI sees the rest of this
        subject too. Refine individual units before anything is created, then choose whether to
        build every lesson in one run.
      </p>
      <TextArea label="Brief" value={prompt} onChange={setPrompt} />
      <div className="mt-3">
        <AiReferenceInput resources={resources} busy={busy} onChange={setReferenceText} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading || busy || (!prompt.trim() && !referenceText.trim())}
          className="btn btn-secondary"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          {loading ? "Working…" : draft ? "Regenerate" : "Generate outline"}
        </button>
      </div>

      {draft ? (
        <div className="mt-3 grid gap-2 rounded-card border border-border bg-depth-field p-3">
          {draft.units.length === 0 ? (
            <div className="text-meta text-muted-foreground">
              The model did not return any units. Try a more specific brief.
            </div>
          ) : (
            draft.units.map((unit, i) => {
              const status = statuses[i] || "same";
              return (
                <div key={i} className={`rounded-control border p-2.5 ${statusRing(status)}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-meta font-medium text-foreground">
                      {unit.title}
                    </span>
                    {statusLabel(status) ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                        {statusLabel(status)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setRefineFor(refineFor === i ? null : i)}
                      title="Refine this unit"
                      aria-label="Refine this unit"
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-depth-field hover:text-foreground"
                    >
                      <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                  <ul className="mt-1 ml-4 list-disc text-meta text-muted-foreground">
                    {unit.lessons.map((lesson, j) => (
                      <li key={j}>{lesson.title}</li>
                    ))}
                  </ul>
                  {refineFor === i ? (
                    <RefineBox
                      loading={loading}
                      placeholder="e.g. add a hands-on lesson, make it easier…"
                      onSubmit={(feedback) => void refine(i, feedback)}
                      onCancel={() => setRefineFor(null)}
                    />
                  ) : null}
                </div>
              );
            })
          )}
          {draft.units.length ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onBuild(draft, referenceText);
                  setDraft(null);
                  setStatuses([]);
                  setPrompt("");
                }}
                disabled={busy}
                title={`Create the units and write all ${lessonCount} lessons`}
                className="btn btn-primary"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
                Build {lessonCount} {lessonCount === 1 ? "lesson" : "lessons"}
              </button>
              <button
                type="button"
                onClick={() => {
                  onApply(draft);
                  setDraft(null);
                  setStatuses([]);
                  setPrompt("");
                }}
                disabled={busy}
                title="Create the units and empty lessons only — write them yourself later"
                className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                Outline only
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setStatuses([]);
                }}
                className="text-meta text-muted-foreground hover:text-foreground"
              >
                Discard
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AiStepsPanel({
  busy,
  resources,
  onGenerate,
  onApply,
}: {
  busy: boolean;
  resources: LessonResource[];
  onGenerate: (args: StepsGenArgs) => Promise<CurriculumStepDraft[] | null>;
  onApply: (drafts: CurriculumStepDraft[]) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<CurriculumStepDraft[] | null>(null);
  const [statuses, setStatuses] = useState<ItemStatus[]>([]);
  const [refineFor, setRefineFor] = useState<number | null>(null);

  const sigOf = (step: CurriculumStepDraft) => JSON.stringify(step);

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    const result = await onGenerate({ prompt: prompt.trim(), referenceText });
    if (result) {
      setDrafts(result);
      setStatuses(result.map(() => "same"));
      setRefineFor(null);
    }
    setLoading(false);
  };

  const refine = async (index: number, feedback: string) => {
    if (!drafts || !feedback) return;
    setLoading(true);
    const prevSigs = drafts.map(sigOf);
    const result = await onGenerate({
      prompt,
      referenceText,
      current: drafts,
      feedback,
      target: `Step ${index + 1}: "${drafts[index]?.title || ""}"`,
    });
    if (result) {
      setStatuses(diffStatuses(prevSigs, result.map(sigOf)));
      setDrafts(result);
      setRefineFor(null);
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-title font-medium text-foreground">
        <Sparkles className="h-4 w-4" strokeWidth={1.7} />
        Draft steps with AI
      </div>
      <p className="mb-3 text-meta text-muted-foreground">
        Describe the lesson. The AI sees the lesson context and any reference material you attach.
        Refine individual steps, then add them.
      </p>
      <TextArea label="Brief" value={prompt} onChange={setPrompt} />
      <div className="mt-3">
        <AiReferenceInput resources={resources} busy={busy} onChange={setReferenceText} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading || busy || !prompt.trim()}
          className="btn btn-secondary"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          {loading ? "Working…" : drafts ? "Regenerate" : "Generate"}
        </button>
      </div>

      {drafts ? (
        <div className="mt-3 grid gap-2 rounded-card border border-border bg-depth-field p-3">
          {drafts.length === 0 ? (
            <div className="text-meta text-muted-foreground">
              The model did not return any steps. Try a more specific brief.
            </div>
          ) : (
            drafts.map((step, i) => {
              const status = statuses[i] || "same";
              return (
                <div key={i} className={`rounded-control border p-2.5 ${statusRing(status)}`}>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                      {step.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-meta font-medium text-foreground">
                      {step.title}
                    </span>
                    {statusLabel(status) ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                        {statusLabel(status)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setRefineFor(refineFor === i ? null : i)}
                      title="Refine this step"
                      aria-label="Refine this step"
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-depth-field hover:text-foreground"
                    >
                      <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-meta text-muted-foreground">
                    {step.prompt}
                  </p>
                  {step.kind === "checkpoint" && step.choices.length ? (
                    <ul className="mt-1 ml-4 list-disc text-meta text-muted-foreground">
                      {step.choices.map((choice) => (
                        <li
                          key={choice.id}
                          className={choice.id === step.correct_choice_id ? "text-success" : ""}
                        >
                          {choice.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {refineFor === i ? (
                    <RefineBox
                      loading={loading}
                      placeholder="e.g. make this a code task, harder, clearer wording…"
                      onSubmit={(feedback) => void refine(i, feedback)}
                      onCancel={() => setRefineFor(null)}
                    />
                  ) : null}
                </div>
              );
            })
          )}
          {drafts.length ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onApply(drafts);
                  setDrafts(null);
                  setStatuses([]);
                  setPrompt("");
                }}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                Add these steps
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrafts(null);
                  setStatuses([]);
                }}
                className="text-meta text-muted-foreground hover:text-foreground"
              >
                Discard
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// P7: generate → preview → approve an interactive artifact for a step. Mirrors AiStepsPanel:
// a brief drives a read-only generate, the draft renders in the SAME ArtifactFrame/DeckRenderer
// the student sees, and Approve persists it as a published resource bound to this step.
function ArtifactGeneratePanel({
  busy,
  bindable,
  onGenerate,
  onApprove,
}: {
  busy: boolean;
  bindable: boolean;
  onGenerate: (args: ArtifactGenArgs) => Promise<CurriculumAdminResponse | null>;
  onApprove: (payload: ArtifactApprovePayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"html_sim" | "deck">("html_sim");
  const [brief, setBrief] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState("");
  const [deck, setDeck] = useState<DeckSpec | null>(null);
  const [lintViolations, setLintViolations] = useState<string[]>([]);
  const hasDraft = Boolean(html) || Boolean(deck);

  const artifactConfig = useMemo(
    () => (html ? parseArtifactConfig({ kind: "html_sim", version: 1 }) : null),
    [html],
  );

  const generate = async () => {
    if (!brief.trim()) return;
    setLoading(true);
    try {
      const result = await onGenerate({
        kind,
        brief,
        feedback: hasDraft ? feedback : undefined,
        current: hasDraft ? (kind === "deck" ? { deck: deck ?? undefined } : { html }) : undefined,
      });
      if (result) {
        if (result.artifact_kind === "deck" && result.deck) {
          setDeck(result.deck);
          setHtml("");
          setLintViolations([]);
        } else if (result.artifact_html) {
          setHtml(result.artifact_html);
          setDeck(null);
          setLintViolations(result.lint?.ok === false ? result.lint.violations : []);
        }
        setFeedback("");
      }
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setHtml("");
    setDeck(null);
    setLintViolations([]);
    setFeedback("");
  };

  const approve = () => {
    if (html) {
      // Courtesy re-lint before publishing (the sandbox is the real boundary).
      if (!lintArtifactHtml(html).ok) {
        setLintViolations(lintArtifactHtml(html).violations);
        return;
      }
      onApprove({
        kind: "html_sim",
        title: brief.trim().slice(0, 80) || "Activity",
        posterText: brief.trim(),
        html,
      });
    } else if (deck) {
      onApprove({
        kind: "deck",
        title: deck.title || brief.trim().slice(0, 80) || "Slides",
        deck,
      });
    }
    setOpen(false);
    reset();
  };

  return (
    <div className="rounded-card border border-border bg-depth-sub">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <Sparkles className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
        <span className="flex-1 text-body text-foreground">Generate an activity</span>
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={1.7}
        />
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-border p-3">
          {!bindable ? (
            <div className="rounded-control border border-dashed border-border px-3 py-2 text-meta text-muted-foreground">
              Save this step first, then generate an activity for it.
            </div>
          ) : null}
          <div className="flex items-center gap-1 rounded-full border border-border p-0.5 justify-self-start">
            <ViewToggle
              active={kind === "html_sim"}
              onClick={() => {
                setKind("html_sim");
                reset();
              }}
              label="Simulation"
            />
            <ViewToggle
              active={kind === "deck"}
              onClick={() => {
                setKind("deck");
                reset();
              }}
              label="Slide deck"
            />
          </div>
          <TextArea
            label={
              kind === "html_sim" ? "Describe the interactive activity" : "Describe the slide deck"
            }
            value={brief}
            onChange={setBrief}
          />
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy || loading || !bindable || !brief.trim()}
            className="btn btn-secondary self-start"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
            {loading ? "Generating…" : hasDraft ? "Regenerate" : "Generate"}
          </button>

          {lintViolations.length ? (
            <div className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-meta text-warning">
              This activity tripped a safety check ({lintViolations.join(", ")}). Regenerate before
              approving.
            </div>
          ) : null}

          {html && artifactConfig ? (
            <ArtifactFrame
              title={brief.trim().slice(0, 80) || "Preview"}
              artifact={artifactConfig}
              fetchHtml={async () => html}
              onTelemetry={() => {}}
            />
          ) : deck ? (
            <DeckRenderer
              deck={deck}
              title={deck.title || "Preview"}
              voice={DEFAULT_VOICE}
              accessToken=""
              lessonId=""
              sessionId={null}
              onVoiceEvent={() => {}}
              readAloud={false}
            />
          ) : null}

          {hasDraft ? (
            <>
              <TextArea
                label="Feedback to refine (optional)"
                value={feedback}
                onChange={setFeedback}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={approve}
                  disabled={busy || loading || lintViolations.length > 0}
                  className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                  Approve &amp; add to step
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="text-meta text-muted-foreground hover:text-foreground"
                >
                  Discard
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ordering, parsing + breadcrumb helpers.
// ---------------------------------------------------------------------------

function byPositionThenTitle(
  a: { position: number | null; title: string },
  b: { position: number | null; title: string },
) {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER;
  const pb = b.position ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return a.title.localeCompare(b.title);
}

function lessonOrder(lesson: Lesson) {
  return lesson.unit_position ?? lesson.position ?? Number.MAX_SAFE_INTEGER;
}

function nodeLabel(nodeType: CurriculumNodeType): string {
  return nodeType.charAt(0).toUpperCase() + nodeType.slice(1);
}

// The actual rows removed by a cascading delete, captured so Undo can re-insert them.
function collectRemovedRows(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  id: string,
): Partial<CurriculumAuthoringData> {
  const ids = collectRemovedIds(data, nodeType, id);
  const lessonIds = new Set(data.lessons.filter((l) => ids.has(l.id)).map((l) => l.id));
  return {
    subjects: data.subjects.filter((s) => ids.has(s.id)),
    courses: data.courses.filter((c) => ids.has(c.id)),
    // Versions aren't selectable so they're not in `ids`; capture by removed course.
    courseVersions: data.courseVersions.filter((v) => ids.has(v.course_id)),
    units: data.units.filter((u) => ids.has(u.id)),
    lessons: data.lessons.filter((l) => ids.has(l.id)),
    milestones: data.milestones.filter((m) => lessonIds.has(m.lesson_id)),
    activities: data.activities.filter((a) => lessonIds.has(a.lesson_id)),
    quizzes: data.quizzes.filter((q) => lessonIds.has(q.lesson_id)),
  };
}

// Re-insert previously-removed rows (skipping any ids that already exist) — the
// inverse of cascadeRemove, used by Undo.
function mergeRows(
  data: CurriculumAuthoringData,
  removed: Partial<CurriculumAuthoringData>,
): CurriculumAuthoringData {
  const merge = <T extends { id: string }>(current: T[], add?: T[]): T[] => {
    if (!add || !add.length) return current;
    const present = new Set(current.map((row) => row.id));
    return [...current, ...add.filter((row) => !present.has(row.id))];
  };
  return {
    ...data,
    subjects: merge(data.subjects, removed.subjects),
    courses: merge(data.courses, removed.courses),
    courseVersions: merge(data.courseVersions, removed.courseVersions),
    units: merge(data.units, removed.units),
    lessons: merge(data.lessons, removed.lessons),
    milestones: merge(data.milestones, removed.milestones),
    activities: merge(data.activities, removed.activities),
    quizzes: merge(data.quizzes, removed.quizzes),
  };
}

// --- Optimistic local mutations -------------------------------------------
// Pure transforms over the in-memory CurriculumAuthoringData so structure edits
// reflect instantly; the network call persists the same change in the background.

// Every node id removed when deleting a subject/course/unit/lesson (cascades down
// the hierarchy). Used to drop the right rows and to clear a stale selection.
function collectRemovedIds(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  id: string,
): Set<string> {
  const subjectIds = new Set<string>();
  const courseIds = new Set<string>();
  const versionIds = new Set<string>();
  const unitIds = new Set<string>();
  const lessonIds = new Set<string>();

  if (nodeType === "subject") subjectIds.add(id);
  if (nodeType === "course") courseIds.add(id);
  if (nodeType === "unit") unitIds.add(id);
  if (nodeType === "lesson") lessonIds.add(id);

  if (subjectIds.size)
    for (const c of data.courses) if (subjectIds.has(c.subject_id)) courseIds.add(c.id);
  if (courseIds.size)
    for (const v of data.courseVersions) if (courseIds.has(v.course_id)) versionIds.add(v.id);
  if (versionIds.size)
    for (const u of data.units) if (versionIds.has(u.course_version_id)) unitIds.add(u.id);
  if (unitIds.size)
    for (const l of data.lessons) if (l.unit_id && unitIds.has(l.unit_id)) lessonIds.add(l.id);

  return new Set<string>([...subjectIds, ...courseIds, ...unitIds, ...lessonIds]);
}

function cascadeRemove(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  id: string,
): CurriculumAuthoringData {
  const subjectIds = new Set<string>();
  const courseIds = new Set<string>();
  const versionIds = new Set<string>();
  const unitIds = new Set<string>();
  const lessonIds = new Set<string>();

  if (nodeType === "subject") subjectIds.add(id);
  if (nodeType === "course") courseIds.add(id);
  if (nodeType === "unit") unitIds.add(id);
  if (nodeType === "lesson") lessonIds.add(id);

  if (subjectIds.size)
    for (const c of data.courses) if (subjectIds.has(c.subject_id)) courseIds.add(c.id);
  if (courseIds.size)
    for (const v of data.courseVersions) if (courseIds.has(v.course_id)) versionIds.add(v.id);
  if (versionIds.size)
    for (const u of data.units) if (versionIds.has(u.course_version_id)) unitIds.add(u.id);
  if (unitIds.size)
    for (const l of data.lessons) if (l.unit_id && unitIds.has(l.unit_id)) lessonIds.add(l.id);

  return {
    ...data,
    subjects: data.subjects.filter((s) => !subjectIds.has(s.id)),
    courses: data.courses.filter((c) => !courseIds.has(c.id)),
    courseVersions: data.courseVersions.filter((v) => !versionIds.has(v.id)),
    units: data.units.filter((u) => !unitIds.has(u.id)),
    lessons: data.lessons.filter((l) => !lessonIds.has(l.id)),
    milestones: data.milestones.filter((m) => !lessonIds.has(m.lesson_id)),
    activities: data.activities.filter((a) => !lessonIds.has(a.lesson_id)),
    quizzes: data.quizzes.filter((q) => !lessonIds.has(q.lesson_id)),
  };
}

function reorderNodesLocal(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  orderedIds: string[],
): CurriculumAuthoringData {
  const pos = new Map(orderedIds.map((id, i) => [id, i + 1]));
  if (nodeType === "subject")
    return {
      ...data,
      subjects: data.subjects.map((s) => (pos.has(s.id) ? { ...s, position: pos.get(s.id)! } : s)),
    };
  if (nodeType === "course")
    return {
      ...data,
      courses: data.courses.map((c) => (pos.has(c.id) ? { ...c, position: pos.get(c.id)! } : c)),
    };
  if (nodeType === "unit")
    return {
      ...data,
      units: data.units.map((u) => (pos.has(u.id) ? { ...u, position: pos.get(u.id)! } : u)),
    };
  return {
    ...data,
    lessons: data.lessons.map((l) => (pos.has(l.id) ? { ...l, unit_position: pos.get(l.id)! } : l)),
  };
}

function renameNodeLocal(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  id: string,
  title: string,
  description?: string,
): CurriculumAuthoringData {
  const withDesc = description !== undefined;
  if (nodeType === "subject")
    return {
      ...data,
      subjects: data.subjects.map((s) =>
        s.id === id ? { ...s, title, ...(withDesc ? { description } : {}) } : s,
      ),
    };
  if (nodeType === "course")
    return {
      ...data,
      courses: data.courses.map((c) =>
        c.id === id ? { ...c, title, ...(withDesc ? { description } : {}) } : c,
      ),
    };
  if (nodeType === "unit")
    return {
      ...data,
      units: data.units.map((u) =>
        u.id === id ? { ...u, title, ...(withDesc ? { description } : {}) } : u,
      ),
    };
  return {
    ...data,
    lessons: data.lessons.map((l) => (l.id === id ? { ...l, title } : l)),
  };
}

// Map a step input onto a lesson_activities row, mirroring the edge function's
// defaults so the optimistic row matches what the server will persist.
function activityFromStepInput(
  lessonId: string,
  step: CurriculumStepInput,
  position: number,
  id: string,
): LessonActivity {
  return {
    id,
    lesson_id: lessonId,
    position,
    title: step.title || "Step",
    activity_type: step.activity_type,
    stage: step.stage,
    prompt: step.prompt || "Add a prompt for learners.",
    response_mode: step.response_mode,
    starter_code: step.starter_code || "",
    expected_output: step.expected_output || null,
    choices: step.choices || [],
    rubric: {},
    skill_keys: step.skill_keys || [],
    pass_score: step.pass_score && step.pass_score > 0 ? step.pass_score : 1,
    mode: step.mode ?? null,
    mode_type: step.mode_type ?? null,
  };
}

function quizFromStepInput(
  activityId: string,
  lessonId: string,
  step: CurriculumStepInput,
  position: number,
): CurriculumQuizItem | null {
  if (step.response_mode !== "multiple_choice" || !step.quiz) return null;
  const choices = step.quiz.choices || [];
  const correct = step.quiz.correct_choice_ids || [];
  if (choices.length < 2 || !correct.length) return null;
  const now = new Date().toISOString();
  return {
    id: `${activityId}-quiz`,
    lesson_id: lessonId,
    milestone_id: null,
    activity_id: activityId,
    position,
    prompt: step.quiz.prompt || step.prompt || "Choose the best answer.",
    question_type: "multiple_choice",
    choices,
    correct_choice_ids: correct,
    rubric: {},
    skill_keys: step.skill_keys || [],
    status: "draft",
    created_at: now,
    updated_at: now,
  };
}

function nextStepPosition(data: CurriculumAuthoringData, lessonId: string): number {
  const positions = data.activities.filter((a) => a.lesson_id === lessonId).map((a) => a.position);
  return positions.length ? Math.max(...positions) + 1 : 1;
}

function insertStepLocal(
  data: CurriculumAuthoringData,
  lessonId: string,
  step: CurriculumStepInput,
  tempId: string,
): CurriculumAuthoringData {
  const position = nextStepPosition(data, lessonId);
  const activity = activityFromStepInput(lessonId, step, position, tempId);
  const quiz = quizFromStepInput(tempId, lessonId, step, position);
  return {
    ...data,
    activities: [...data.activities, activity],
    quizzes: quiz ? [...data.quizzes, quiz] : data.quizzes,
  };
}

function patchStepLocal(
  data: CurriculumAuthoringData,
  lessonId: string,
  step: CurriculumStepInput,
): CurriculumAuthoringData {
  const id = step.id!;
  const position = data.activities.find((a) => a.id === id)?.position ?? 1;
  const activity = activityFromStepInput(lessonId, step, position, id);
  const quiz = quizFromStepInput(id, lessonId, step, position);
  return {
    ...data,
    activities: data.activities.map((a) => (a.id === id ? activity : a)),
    // Replace this step's quiz to match the edit (removing it when no longer a checkpoint).
    quizzes: [...data.quizzes.filter((q) => q.activity_id !== id), ...(quiz ? [quiz] : [])],
  };
}

// P5: bind/unbind a resource to a step in local state (mirror of the DB write).
function patchResourceLocal(
  data: CurriculumAuthoringData,
  resourceId: string,
  activityId: string | null,
): CurriculumAuthoringData {
  return {
    ...data,
    resources: data.resources.map((resource) =>
      resource.id === resourceId ? { ...resource, activity_id: activityId } : resource,
    ),
  };
}

function swapStepId(
  data: CurriculumAuthoringData,
  tempId: string,
  realId: string,
): CurriculumAuthoringData {
  return {
    ...data,
    activities: data.activities.map((a) => (a.id === tempId ? { ...a, id: realId } : a)),
    quizzes: data.quizzes.map((q) =>
      q.activity_id === tempId ? { ...q, id: `${realId}-quiz`, activity_id: realId } : q,
    ),
  };
}

function reorderStepsLocal(
  data: CurriculumAuthoringData,
  orderedIds: string[],
): CurriculumAuthoringData {
  const pos = new Map(orderedIds.map((id, i) => [id, i + 1]));
  return {
    ...data,
    activities: data.activities.map((a) =>
      pos.has(a.id) ? { ...a, position: pos.get(a.id)! } : a,
    ),
    quizzes: data.quizzes.map((q) =>
      q.activity_id && pos.has(q.activity_id) ? { ...q, position: pos.get(q.activity_id)! } : q,
    ),
  };
}

function reorderArray(ids: string[], srcId: string, targetId: string): string[] {
  const next = ids.filter((id) => id !== srcId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return ids;
  next.splice(targetIndex, 0, srcId);
  return next;
}

function parseLessonKind(value: unknown): LessonKind | null {
  return ["discussion", "code", "reflection", "multiple_choice", "file"].includes(String(value))
    ? (value as LessonKind)
    : null;
}

function buildBreadcrumb({
  selection,
  data,
  goRoot,
  goNode,
}: {
  selection: Selection;
  data: CurriculumAuthoringData | null;
  goRoot: () => void;
  goNode: (type: CurriculumNodeType, id: string) => void;
}) {
  // Rooted at the class's Curriculum section — the studio has no page of its own anymore,
  // so the crumb encodes only the content path (subject → … → lesson) within this class.
  const segments: Array<{ label: string; onClick?: () => void }> = [
    { label: "Classwork", onClick: goRoot },
  ];
  if (!selection || !data) return segments;

  const path = nodePath(selection, data);
  const go = goNode;

  // R45 consolidated: subject/course are invisible plumbing — the crumb shows only the
  // levels the teacher actually navigates (unit → lesson).
  if (path.unit)
    segments.push({ label: path.unit.title, onClick: () => go("unit", path.unit!.id) });
  if (path.lesson) segments.push({ label: path.lesson.title });
  return segments;
}

function nodePath(selection: NonNullable<Selection>, data: CurriculumAuthoringData) {
  let subject: CurriculumSubject | undefined;
  let course: CurriculumCourse | undefined;
  let unit: CurriculumUnit | undefined;
  let lesson: Lesson | undefined;

  if (selection.type === "subject") {
    subject = data.subjects.find((item) => item.id === selection.id);
  } else if (selection.type === "course") {
    course = data.courses.find((item) => item.id === selection.id);
    subject = course ? data.subjects.find((item) => item.id === course!.subject_id) : undefined;
  } else if (selection.type === "unit") {
    unit = data.units.find((item) => item.id === selection.id);
    const version = unit
      ? data.courseVersions.find((item) => item.id === unit!.course_version_id)
      : undefined;
    course = version ? data.courses.find((item) => item.id === version.course_id) : undefined;
    subject = course ? data.subjects.find((item) => item.id === course!.subject_id) : undefined;
  } else {
    lesson = data.lessons.find((item) => item.id === selection.id);
    unit = lesson?.unit_id ? data.units.find((item) => item.id === lesson!.unit_id) : undefined;
    const version = unit
      ? data.courseVersions.find((item) => item.id === unit!.course_version_id)
      : undefined;
    course = version ? data.courses.find((item) => item.id === version.course_id) : undefined;
    subject = course ? data.subjects.find((item) => item.id === course!.subject_id) : undefined;
  }
  return { subject, course, unit, lesson };
}

// ---------------------------------------------------------------------------
// Small inputs.
// ---------------------------------------------------------------------------

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="jargon-input normal-case tracking-normal"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="jargon-input min-h-[82px] normal-case leading-relaxed tracking-normal"
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange,
  optionLabels,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  optionLabels?: Record<string, string>;
}) {
  return (
    <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="jargon-input normal-case tracking-normal"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}
