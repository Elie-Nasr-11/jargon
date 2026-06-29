import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Archive,
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  GripVertical,
  Layers3,
  ListChecks,
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
import { GradientCard } from "@/components/GradientCard";
import { ConsoleShell } from "@/components/ConsoleShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { RouteLoader } from "@/components/RouteLoader";
import {
  archiveCurriculumNode,
  createCurriculumCourse,
  createCurriculumLessonStub,
  createCurriculumSubject,
  createCurriculumUnit,
  deleteCurriculumNode,
  deleteCurriculumStep,
  fetchCurriculumAuthoringData,
  fetchPrimaryRole,
  generateCurriculumDraft,
  getSession,
  invokeCurriculumAdmin,
  moveCurriculumLesson,
  renameCurriculumNode,
  reorderCurriculumNodes,
  reorderCurriculumSteps,
  roleHome,
  saveCurriculumLessonMeta,
  upsertCurriculumStep,
} from "@/lib/api";
import type {
  CurriculumAuthoringData,
  CurriculumCourse,
  CurriculumCourseVersion,
  CurriculumLessonMetaInput,
  CurriculumMilestoneInput,
  CurriculumNodeType,
  CurriculumOutlineDraft,
  CurriculumStepDraft,
  CurriculumStepInput,
  CurriculumStepKind,
  CurriculumSubject,
  CurriculumUnit,
  Lesson,
  LessonActivity,
  LessonResource,
} from "@/lib/types";
import { extractPdfTextChunksFromUrl } from "@/lib/pdf-extract";

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

type CurriculumSearch = {
  subject?: string;
  course?: string;
  unit?: string;
  lesson?: string;
};

export const Route = createFileRoute("/teacher/curriculum")({
  // The selected node lives on the URL spine so the studio is deep-linkable and
  // back/forward works. Exactly one of subject/course/unit/lesson is set at a time
  // (the selected node); ancestors are resolved from data for the outline + breadcrumb.
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
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState("");
  const [data, setData] = useState<CurriculumAuthoringData | null>(null);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [message, setMessage] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Outline nodes are collapsed by default; this set holds the EXPANDED ids.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [roleOk, setRoleOk] = useState(false);

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
      const role = await fetchPrimaryRole(session.access_token, session.user.id);
      if (role !== "teacher") {
        navigate({ to: roleHome(role), replace: true });
        return;
      }
      setRoleOk(true);
      const curriculum = await fetchCurriculumAuthoringData(session.user.id);
      setEmail(session.user.email || "");
      setData(curriculum);
      setSelectedClassId((current) => current || curriculum.classes[0]?.id || "");
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
    () => data?.classes.find((item) => item.id === selectedClassId) || null,
    [data, selectedClassId],
  );

  const lessonsById = useMemo(() => {
    const map = new Map<string, Lesson>();
    data?.lessons.forEach((lesson) => map.set(lesson.id, lesson));
    return map;
  }, [data]);

  // Org-scoped structure tree, ordered by the Phase 1 position columns.
  const orgSubjects = useMemo(() => {
    if (!data || !selectedClass) return [];
    return data.subjects
      .filter((subject) => subject.organization_id === selectedClass.organization_id)
      .sort(byPositionThenTitle);
  }, [data, selectedClass]);

  const coursesForSubject = useCallback(
    (subjectId: string) =>
      (data?.courses || [])
        .filter((course) => course.subject_id === subjectId)
        .sort(byPositionThenTitle),
    [data],
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

  // All units in the org (with their course title) — powers "move lesson to unit".
  const orgUnits = useMemo(() => {
    const rows: Array<{ unit: CurriculumUnit; courseTitle: string }> = [];
    for (const subject of orgSubjects) {
      for (const course of coursesForSubject(subject.id)) {
        for (const unit of unitsForCourse(course.id)) {
          rows.push({ unit, courseTitle: course.title });
        }
      }
    }
    return rows;
  }, [orgSubjects, coursesForSubject, unitsForCourse]);

  const selectNode = useCallback(
    (type: CurriculumNodeType, id: string) => {
      navigate({ to: "/teacher/curriculum", search: { [type]: id } as CurriculumSearch });
    },
    [navigate],
  );

  const clearSelection = useCallback(() => {
    navigate({ to: "/teacher/curriculum", search: {} });
  }, [navigate]);

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Auto-expand the ancestors of the selected node so it's visible in the otherwise
  // collapsed tree (covers deep links and freshly-created child nodes).
  useEffect(() => {
    if (!selection || !data) return;
    const path = nodePath(selection, data);
    const ancestorIds = [path.subject?.id, path.course?.id, path.unit?.id].filter(
      (id): id is string => Boolean(id) && id !== selection.id,
    );
    if (!ancestorIds.length) return;
    setExpanded((current) => {
      let changed = false;
      const next = new Set(current);
      for (const id of ancestorIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.type, selection?.id, data]);

  // --- Mutations ------------------------------------------------------------
  // Each runs an admin action then refreshes; create flows select the new node so
  // the teacher lands in its detail pane to keep building top-down.

  const runStructureOp = useCallback(
    async (
      op: (
        accessToken: string,
        classId: string,
      ) => Promise<void | { select?: { type: CurriculumNodeType; id: string } }>,
      successMessage?: string,
    ) => {
      if (!selectedClass) return;
      setBusy(true);
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to edit curriculum.");
        const outcome = await op(session.access_token, selectedClass.id);
        await loadData();
        if (outcome?.select) selectNode(outcome.select.type, outcome.select.id);
        if (successMessage) setMessage(successMessage);
      } catch (error) {
        setMessage((error as Error).message || "Could not update curriculum.");
      } finally {
        setBusy(false);
      }
    },
    [selectedClass, loadData, selectNode],
  );

  const addSubject = () =>
    runStructureOp(async (accessToken, classId) => {
      if (!selectedClass) return;
      const result = await createCurriculumSubject({
        accessToken,
        classId,
        organizationId: selectedClass.organization_id,
        title: "New subject",
      });
      return result.id ? { select: { type: "subject", id: result.id } } : undefined;
    });

  const addCourse = (subjectId: string) =>
    runStructureOp(async (accessToken, classId) => {
      const result = await createCurriculumCourse({
        accessToken,
        classId,
        subjectId,
        title: "New course",
      });
      return result.id ? { select: { type: "course", id: result.id } } : undefined;
    });

  const addUnit = (courseId: string) =>
    runStructureOp(async (accessToken, classId) => {
      const version = currentVersionForCourse(courseId);
      if (!version) throw new Error("This course has no version to add a unit to.");
      const result = await createCurriculumUnit({
        accessToken,
        classId,
        courseVersionId: version.id,
        title: "New unit",
      });
      return result.id ? { select: { type: "unit", id: result.id } } : undefined;
    });

  const addLesson = (unitId: string) =>
    runStructureOp(async (accessToken, classId) => {
      const result = await createCurriculumLessonStub({
        accessToken,
        classId,
        unitId,
        title: "New lesson",
      });
      return result.id ? { select: { type: "lesson", id: result.id } } : undefined;
    });

  const reorder = (nodeType: CurriculumNodeType, orderedIds: string[]) =>
    runStructureOp(async (accessToken, classId) => {
      await reorderCurriculumNodes({ accessToken, classId, nodeType, orderedIds });
    });

  const renameNode = (
    nodeType: CurriculumNodeType,
    id: string,
    title: string,
    description?: string,
  ) =>
    runStructureOp(async (accessToken, classId) => {
      await renameCurriculumNode({ accessToken, classId, nodeType, id, title, description });
    }, "Saved.");

  const archiveNode = (nodeType: CurriculumNodeType, id: string) =>
    runStructureOp(async (accessToken, classId) => {
      await archiveCurriculumNode({ accessToken, classId, nodeType, id });
    }, "Archived.");

  const deleteNode = (nodeType: CurriculumNodeType, id: string) =>
    runStructureOp(async (accessToken, classId) => {
      await deleteCurriculumNode({ accessToken, classId, nodeType, id });
      clearSelection();
    });

  const moveLesson = (lessonId: string, targetUnitId: string) =>
    runStructureOp(async (accessToken, classId) => {
      await moveCurriculumLesson({ accessToken, classId, lessonId, targetUnitId });
    }, "Lesson moved.");

  const saveLessonMeta = (
    lessonId: string,
    meta: CurriculumLessonMetaInput,
    milestone: CurriculumMilestoneInput,
  ) =>
    runStructureOp(async (accessToken, classId) => {
      await saveCurriculumLessonMeta({ accessToken, classId, lessonId, meta, milestone });
    }, "Lesson saved.");

  const upsertStep = (lessonId: string, step: CurriculumStepInput) =>
    runStructureOp(async (accessToken, classId) => {
      await upsertCurriculumStep({ accessToken, classId, lessonId, step });
    });

  const reorderSteps = (lessonId: string, orderedIds: string[]) =>
    runStructureOp(async (accessToken, classId) => {
      await reorderCurriculumSteps({ accessToken, classId, lessonId, orderedIds });
    });

  const deleteStep = (lessonId: string, activityId: string) =>
    runStructureOp(async (accessToken, classId) => {
      await deleteCurriculumStep({ accessToken, classId, lessonId, activityId });
    });

  // AI authoring: generate returns a draft to review (no write); apply uses the
  // create/upsert actions, then refreshes via runStructureOp. The course/lesson id
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

  const applyOutline = (courseId: string, outline: CurriculumOutlineDraft) =>
    runStructureOp(async (accessToken, classId) => {
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
    }, "Outline applied.");

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
    runStructureOp(async (accessToken, classId) => {
      for (const draft of drafts) {
        await upsertCurriculumStep({
          accessToken,
          classId,
          lessonId,
          step: stepInputFromDraft(draft),
        });
      }
    }, "Steps added.");

  const setPublication = async (action: "publish_lesson" | "archive_lesson", lessonId: string) => {
    if (!selectedClass || !lessonId) return;
    setPublishing(true);
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to update publishing.");
      await invokeCurriculumAdmin({
        accessToken: session.access_token,
        action,
        organizationId: selectedClass.organization_id,
        classId: selectedClass.id,
        lessonId,
      });
      setMessage(action === "publish_lesson" ? "Lesson published." : "Lesson archived.");
      await loadData();
    } catch (error) {
      setMessage((error as Error).message || "Could not update publication status.");
    } finally {
      setPublishing(false);
    }
  };

  if (!roleOk) {
    return <RouteLoader label="Loading…" />;
  }

  const crumbs = buildBreadcrumb({ selection, data, navigate });

  return (
    <ConsoleShell email={email} widthClass="max-w-[1440px]">
      <Breadcrumb segments={crumbs} />

      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
            Curriculum studio
          </div>
          <h1 className="font-serif mt-2 text-[30px] leading-tight tracking-tight text-foreground sm:text-[38px]">
            Build the lesson path.
          </h1>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {data?.classes.length ? (
            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Class scope
              <select
                value={selectedClassId}
                onChange={(event) => setSelectedClassId(event.target.value)}
                className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
              >
                {data.classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {data?.classes.length ? (
            <button
              type="button"
              onClick={() => setOutlineOpen((value) => !value)}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
            >
              {outlineOpen ? (
                <PanelLeftClose className="h-4 w-4" strokeWidth={1.7} />
              ) : (
                <PanelLeft className="h-4 w-4" strokeWidth={1.7} />
              )}
              {outlineOpen ? "Hide outline" : "Show outline"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void loadData()}
            className="rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
          >
            Refresh
          </button>
        </div>
      </section>

      {message ? (
        <GradientCard>
          <div className="flex items-center justify-between gap-3 p-4 text-[13px] text-muted-foreground">
            <span>{message}</span>
            <button
              type="button"
              onClick={() => setMessage("")}
              className="text-[12px] text-muted-foreground/70 hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </GradientCard>
      ) : null}

      {booting ? (
        <GradientCard>
          <div className="p-6 text-[14px] text-muted-foreground">Loading curriculum...</div>
        </GradientCard>
      ) : !data?.classes.length ? (
        <GradientCard>
          <div className="p-6 text-[14px] text-muted-foreground">
            Teacher curriculum access requires an assigned class.
          </div>
        </GradientCard>
      ) : data && selectedClass ? (
        <div className={`grid gap-4 ${outlineOpen ? "lg:grid-cols-[330px_minmax(0,1fr)]" : ""}`}>
          {outlineOpen ? (
            <aside className="min-w-0 lg:sticky lg:top-[78px] lg:max-h-[calc(100vh-110px)] lg:overflow-x-hidden lg:overflow-y-auto">
              <Outline
                subjects={orgSubjects}
                coursesForSubject={coursesForSubject}
                unitsForCourse={unitsForCourse}
                lessonsForUnit={lessonsForUnit}
                selection={selection}
                expanded={expanded}
                busy={busy}
                onToggle={toggleExpanded}
                onSelect={selectNode}
                onReorder={reorder}
                onAddSubject={addSubject}
                onAddCourse={addCourse}
                onAddUnit={addUnit}
                onAddLesson={addLesson}
                onCollapse={() => setOutlineOpen(false)}
              />
            </aside>
          ) : null}

          <div className="min-w-0">
            <DetailPane
              key={selection ? `${selection.type}:${selection.id}` : "empty"}
              selection={selection}
              data={data}
              lessonsById={lessonsById}
              orgUnits={orgUnits}
              resources={data.resources}
              busy={busy}
              publishing={publishing}
              onAddSubject={addSubject}
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
              onPublishLesson={(lessonId) => void setPublication("publish_lesson", lessonId)}
              onArchiveLesson={(lessonId) => void setPublication("archive_lesson", lessonId)}
              onGenerateOutline={generateOutline}
              onApplyOutline={applyOutline}
              onGenerateSteps={generateSteps}
              onApplySteps={applyStepDrafts}
              currentVersionForCourse={currentVersionForCourse}
              counts={{
                coursesForSubject: (id) => coursesForSubject(id).length,
                unitsForCourse: (id) => unitsForCourse(id).length,
                lessonsForUnit: (id) => lessonsForUnit(id).length,
              }}
            />
          </div>
        </div>
      ) : null}
    </ConsoleShell>
  );
}

// ---------------------------------------------------------------------------
// Outline sidebar — persistent Subject ▸ Course ▸ Unit ▸ Lesson tree with inline
// create + native drag-reorder (scoped per sibling group via ReorderList).
// ---------------------------------------------------------------------------

function Outline({
  subjects,
  coursesForSubject,
  unitsForCourse,
  lessonsForUnit,
  selection,
  expanded,
  busy,
  onToggle,
  onSelect,
  onReorder,
  onAddSubject,
  onAddCourse,
  onAddUnit,
  onAddLesson,
  onCollapse,
}: {
  subjects: CurriculumSubject[];
  coursesForSubject: (subjectId: string) => CurriculumCourse[];
  unitsForCourse: (courseId: string) => CurriculumUnit[];
  lessonsForUnit: (unitId: string) => Lesson[];
  selection: Selection;
  expanded: Set<string>;
  busy: boolean;
  onToggle: (id: string) => void;
  onSelect: (type: CurriculumNodeType, id: string) => void;
  onReorder: (type: CurriculumNodeType, orderedIds: string[]) => void;
  onAddSubject: () => void;
  onAddCourse: (subjectId: string) => void;
  onAddUnit: (courseId: string) => void;
  onAddLesson: (unitId: string) => void;
  onCollapse: () => void;
}) {
  const isSelected = (type: CurriculumNodeType, id: string) =>
    selection?.type === type && selection.id === id;

  return (
    <GradientCard>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Outline
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAddSubject}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              Subject
            </button>
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Hide outline"
              title="Hide outline"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </div>
        </div>

        {subjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
            No subjects yet. Create one to start building.
          </div>
        ) : (
          <div className="grid min-w-0 gap-1">
            <ReorderList
              items={subjects}
              disabled={busy}
              onReorder={(ids) => onReorder("subject", ids)}
            >
              {(subject, state) => {
                const open = expanded.has(subject.id);
                const courses = coursesForSubject(subject.id);
                return (
                  <div className={dropClass(state)}>
                    <OutlineRow
                      depth={0}
                      label={subject.title}
                      meta={subject.status}
                      hasChildren
                      open={open}
                      selected={isSelected("subject", subject.id)}
                      onToggle={() => onToggle(subject.id)}
                      onSelect={() => onSelect("subject", subject.id)}
                      onAdd={() => onAddCourse(subject.id)}
                      addLabel="Add course"
                      dragging={state.dragging}
                    />
                    {open ? (
                      <div className="mt-0.5 grid min-w-0 gap-0.5">
                        <ReorderList
                          items={courses}
                          disabled={busy}
                          onReorder={(ids) => onReorder("course", ids)}
                        >
                          {(course, courseState) => {
                            const courseOpen = expanded.has(course.id);
                            const units = unitsForCourse(course.id);
                            return (
                              <div className={dropClass(courseState)}>
                                <OutlineRow
                                  depth={1}
                                  label={course.title}
                                  meta={course.status}
                                  hasChildren
                                  open={courseOpen}
                                  selected={isSelected("course", course.id)}
                                  onToggle={() => onToggle(course.id)}
                                  onSelect={() => onSelect("course", course.id)}
                                  onAdd={() => onAddUnit(course.id)}
                                  addLabel="Add unit"
                                  dragging={courseState.dragging}
                                />
                                {courseOpen ? (
                                  <div className="mt-0.5 grid min-w-0 gap-0.5">
                                    <ReorderList
                                      items={units}
                                      disabled={busy}
                                      onReorder={(ids) => onReorder("unit", ids)}
                                    >
                                      {(unit, unitState) => {
                                        const unitOpen = expanded.has(unit.id);
                                        const lessons = lessonsForUnit(unit.id);
                                        return (
                                          <div className={dropClass(unitState)}>
                                            <OutlineRow
                                              depth={2}
                                              label={unit.title}
                                              meta={`${lessons.length} lesson${lessons.length === 1 ? "" : "s"}`}
                                              hasChildren
                                              open={unitOpen}
                                              selected={isSelected("unit", unit.id)}
                                              onToggle={() => onToggle(unit.id)}
                                              onSelect={() => onSelect("unit", unit.id)}
                                              onAdd={() => onAddLesson(unit.id)}
                                              addLabel="Add lesson"
                                              dragging={unitState.dragging}
                                            />
                                            {unitOpen ? (
                                              <div className="mt-0.5 grid min-w-0 gap-0.5">
                                                <ReorderList
                                                  items={lessons}
                                                  disabled={busy}
                                                  onReorder={(ids) => onReorder("lesson", ids)}
                                                >
                                                  {(lesson, lessonState) => (
                                                    <div className={dropClass(lessonState)}>
                                                      <OutlineRow
                                                        depth={3}
                                                        label={lesson.title}
                                                        meta={
                                                          lesson.publication_status || "published"
                                                        }
                                                        hasChildren={false}
                                                        selected={isSelected("lesson", lesson.id)}
                                                        onSelect={() =>
                                                          onSelect("lesson", lesson.id)
                                                        }
                                                        dragging={lessonState.dragging}
                                                      />
                                                    </div>
                                                  )}
                                                </ReorderList>
                                                {lessons.length === 0 ? (
                                                  <EmptyHint depth={3} label="No lessons" />
                                                ) : null}
                                              </div>
                                            ) : null}
                                          </div>
                                        );
                                      }}
                                    </ReorderList>
                                    {units.length === 0 ? (
                                      <EmptyHint depth={2} label="No units" />
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          }}
                        </ReorderList>
                        {courses.length === 0 ? <EmptyHint depth={1} label="No courses" /> : null}
                      </div>
                    ) : null}
                  </div>
                );
              }}
            </ReorderList>
          </div>
        )}
      </div>
    </GradientCard>
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
}) {
  return (
    <div
      className={`group flex min-w-0 items-center gap-1 overflow-hidden rounded-lg pr-1 transition-colors ${
        selected ? "bg-foreground text-background" : "hover:bg-muted"
      } ${dragging ? "opacity-40" : ""}`}
      style={{ paddingLeft: `${depth * 14 + 2}px` }}
    >
      <span className="shrink-0 cursor-grab text-muted-foreground/60 group-hover:text-muted-foreground">
        <GripVertical className="h-3.5 w-3.5" strokeWidth={1.6} />
      </span>
      {hasChildren ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          className={`shrink-0 ${selected ? "text-background/80" : "text-muted-foreground"}`}
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
        <span
          className={`min-w-0 flex-1 truncate text-[12.5px] ${depth === 0 ? "font-medium" : ""}`}
        >
          {label}
        </span>
        {meta ? (
          <span
            className={`shrink-0 text-[10px] uppercase tracking-[0.08em] ${
              selected ? "text-background/70" : "text-muted-foreground"
            }`}
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
              ? "text-background/80 hover:bg-background/20"
              : "text-muted-foreground hover:bg-background/60"
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
      className="py-1 text-[11px] italic text-muted-foreground/70"
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
  publishing,
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
  onPublishLesson,
  onArchiveLesson,
  onGenerateOutline,
  onApplyOutline,
  onGenerateSteps,
  onApplySteps,
  currentVersionForCourse,
  counts,
}: {
  selection: Selection;
  data: CurriculumAuthoringData;
  lessonsById: Map<string, Lesson>;
  orgUnits: Array<{ unit: CurriculumUnit; courseTitle: string }>;
  resources: LessonResource[];
  busy: boolean;
  publishing: boolean;
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
  onPublishLesson: (lessonId: string) => void;
  onArchiveLesson: (lessonId: string) => void;
  onGenerateOutline: (
    courseId: string,
    args: OutlineGenArgs,
  ) => Promise<CurriculumOutlineDraft | null>;
  onApplyOutline: (courseId: string, outline: CurriculumOutlineDraft) => void;
  onGenerateSteps: (lessonId: string, args: StepsGenArgs) => Promise<CurriculumStepDraft[] | null>;
  onApplySteps: (lessonId: string, drafts: CurriculumStepDraft[]) => void;
  currentVersionForCourse: (courseId: string) => CurriculumCourseVersion | null;
  counts: {
    coursesForSubject: (id: string) => number;
    unitsForCourse: (id: string) => number;
    lessonsForUnit: (id: string) => number;
  };
}) {
  if (!selection) {
    return (
      <GradientCard>
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Layers3 className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
          <div className="text-[14px] text-foreground">Select a node to edit it.</div>
          <p className="max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
            Pick a subject, course, unit, or lesson from the outline — or create a subject to start
            a new path. Drag items in the outline to reorder them.
          </p>
          <button
            type="button"
            onClick={onAddSubject}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            New subject
          </button>
        </div>
      </GradientCard>
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
    const version = currentVersionForCourse(course.id);
    const childCount = counts.unitsForCourse(course.id);
    return (
      <StructureDetail
        kind="Course"
        node={course}
        status={course.status}
        info={
          version
            ? `Version ${version.version_label}${version.is_current ? " · current" : ""}`
            : undefined
        }
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
      publishing={publishing}
      onSaveMeta={(meta, milestone) => onSaveLessonMeta(lesson.id, meta, milestone)}
      onUpsertStep={(step) => onUpsertStep(lesson.id, step)}
      onReorderSteps={(ids) => onReorderSteps(lesson.id, ids)}
      onDeleteStep={(activityId) => onDeleteStep(lesson.id, activityId)}
      onPublish={() => onPublishLesson(lesson.id)}
      onArchiveLesson={() => onArchiveLesson(lesson.id)}
      onMove={(targetUnitId) => onMoveLesson(lesson.id, targetUnitId)}
      onDelete={() => onDelete("lesson", lesson.id)}
      resources={resources}
      onGenerateSteps={(args) => onGenerateSteps(lesson.id, args)}
      onApplySteps={(drafts) => onApplySteps(lesson.id, drafts)}
    />
  );
}

function MissingNode() {
  return (
    <GradientCard>
      <div className="p-6 text-[13px] text-muted-foreground">
        That item is no longer available. Pick another from the outline.
      </div>
    </GradientCard>
  );
}

function StructureDetail({
  kind,
  node,
  status,
  info,
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
}: {
  kind: string;
  node: { id: string; title: string; description?: string };
  status?: string;
  info?: string;
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
  };
}) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = title.trim() !== node.title || (description ?? "") !== (node.description ?? "");

  return (
    <GradientCard>
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {kind}
            </div>
            <h2 className="mt-1 text-[18px] font-medium text-foreground">{node.title}</h2>
            {info ? <div className="mt-0.5 text-[11.5px] text-muted-foreground">{info}</div> : null}
          </div>
          {status ? (
            <span className="rounded-full border border-border px-3 py-1 text-[11.5px] text-muted-foreground">
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
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} />
              {busy ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={onAddChild}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
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
            />
          </div>
        ) : null}

        <div className="mt-6 border-t border-border pt-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Lifecycle
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showArchive && onArchive ? (
              <button
                type="button"
                onClick={onArchive}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
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
                  className="inline-flex items-center gap-2 rounded-full border border-destructive/40 px-4 py-2 text-[12.5px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                  Confirm delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-[12px] text-muted-foreground hover:text-foreground"
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
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                Delete
              </button>
            )}
            {!canDelete ? (
              <span className="text-[11.5px] text-muted-foreground">{deleteHint}</span>
            ) : null}
          </div>
        </div>
      </div>
    </GradientCard>
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

function kindOfActivity(activity: LessonActivity): CurriculumStepKind {
  if (activity.response_mode === "multiple_choice") return "checkpoint";
  if (activity.stage === "teach" || activity.stage === "intro") return "teach";
  if (activity.stage === "review" || activity.activity_type === "reflection") return "reflect";
  return "practice";
}

function defaultStepForKind(kind: CurriculumStepKind): CurriculumStepInput {
  const config = stepKindConfig(kind);
  const base: CurriculumStepInput = {
    title: config.label,
    stage: config.stage,
    activity_type: config.activityType,
    response_mode: config.responseMode,
    prompt:
      kind === "teach"
        ? "Explain the idea simply, then ask the learner a quick question to check they followed."
        : kind === "checkpoint"
          ? "Which option is correct?"
          : kind === "reflect"
            ? "What is one thing you understood, and one thing that is still unclear?"
            : "Try this, then explain your thinking.",
  };
  if (kind === "checkpoint") {
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

// Map an AI-drafted step (kind + free text) onto the create/upsert step payload.
function stepInputFromDraft(draft: CurriculumStepDraft): CurriculumStepInput {
  const config = stepKindConfig(draft.kind);
  const isCheckpoint = draft.kind === "checkpoint";
  const choices = (draft.choices || []).filter((choice) => choice.id && choice.text);
  return {
    title: draft.title || config.label,
    stage: config.stage,
    activity_type: config.activityType,
    response_mode: config.responseMode,
    prompt: draft.prompt || config.label,
    choices: isCheckpoint ? choices : [],
    quiz: isCheckpoint
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
  publishing,
  onSaveMeta,
  onUpsertStep,
  onReorderSteps,
  onDeleteStep,
  onPublish,
  onArchiveLesson,
  onMove,
  onDelete,
  onGenerateSteps,
  onApplySteps,
}: {
  lesson: Lesson;
  data: CurriculumAuthoringData;
  orgUnits: Array<{ unit: CurriculumUnit; courseTitle: string }>;
  resources: LessonResource[];
  busy: boolean;
  publishing: boolean;
  onSaveMeta: (meta: CurriculumLessonMetaInput, milestone: CurriculumMilestoneInput) => void;
  onUpsertStep: (step: CurriculumStepInput) => void;
  onReorderSteps: (orderedIds: string[]) => void;
  onDeleteStep: (activityId: string) => void;
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

  return (
    <GradientCard>
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Lesson
            </div>
            <h2 className="mt-1 truncate text-[18px] font-medium text-foreground">
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

            <section className="rounded-3xl border border-border bg-background/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <Layers3 className="h-4 w-4" strokeWidth={1.7} />
                  Steps
                </div>
                <span className="text-[11.5px] text-muted-foreground">
                  {steps.length} step{steps.length === 1 ? "" : "s"}
                </span>
              </div>

              {steps.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
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
                          onSave={onUpsertStep}
                          onDelete={() => onDeleteStep(activity.id)}
                        />
                      </div>
                    )}
                  </ReorderList>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {STEP_KINDS.map((config) => (
                  <button
                    key={config.kind}
                    type="button"
                    onClick={() => onUpsertStep(defaultStepForKind(config.kind))}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    {config.icon}
                    Add {config.label.toLowerCase()}
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
                disabled={publishing}
                className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-[12.5px] text-success transition-colors hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                Publish
              </button>
              <button
                type="button"
                onClick={onArchiveLesson}
                disabled={publishing}
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Archive className="h-3.5 w-3.5" strokeWidth={1.7} />
                Archive
              </button>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Organize
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Move to unit
                  <select
                    value={lesson.unit_id || ""}
                    onChange={(event) => {
                      if (event.target.value && event.target.value !== lesson.unit_id) {
                        onMove(event.target.value);
                      }
                    }}
                    disabled={busy}
                    className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
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
                      className="inline-flex items-center gap-2 rounded-full border border-destructive/40 px-4 py-2 text-[12.5px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-[12px] text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                    className="inline-flex items-center gap-2 self-end rounded-full border border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Delete
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                Lessons with learner activity can be archived but not deleted.
              </p>
            </div>
          </div>
        )}
      </div>
    </GradientCard>
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
    <section className="rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-foreground">
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
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Allowed answer modes
          </div>
          <div className="flex flex-wrap gap-2">
            {(["text", "code", "multiple_choice", "file"] as ResponseMode[]).map((mode) => (
              <button
                type="button"
                key={mode}
                onClick={() => toggleMode(mode)}
                className={`rounded-full border px-3 py-1.5 text-[11.5px] transition-colors ${
                  allowedModes.includes(mode)
                    ? "border-foreground/25 bg-foreground text-background"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <div>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
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
  onSave,
  onDelete,
}: {
  activity: LessonActivity;
  index: number;
  quiz: CurriculumAuthoringData["quizzes"][number] | null;
  busy: boolean;
  dragging: boolean;
  canDelete: boolean;
  onSave: (step: CurriculumStepInput) => void;
  onDelete: () => void;
}) {
  const kind = kindOfActivity(activity);
  const config = stepKindConfig(kind);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(activity.title);
  const [prompt, setPrompt] = useState(activity.prompt);
  const [practiceMode, setPracticeMode] = useState<ResponseMode>(
    activity.response_mode === "code" ? "code" : "text",
  );
  const [starterCode, setStarterCode] = useState(activity.starter_code || "");
  const [expectedOutput, setExpectedOutput] = useState(activity.expected_output || "");
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

  const save = () => {
    const isCode = kind === "practice" && practiceMode === "code";
    const cleaned = choices
      .map((choice) => ({ id: choice.id.trim(), text: choice.text.trim() }))
      .filter((choice) => choice.id && choice.text);
    const step: CurriculumStepInput = {
      id: activity.id,
      title: title.trim() || config.label,
      stage: config.stage,
      activity_type:
        kind === "checkpoint" ? "multiple_choice" : isCode ? "code" : config.activityType,
      response_mode: kind === "checkpoint" ? "multiple_choice" : isCode ? "code" : "text",
      prompt: prompt.trim(),
      starter_code: isCode ? starterCode : "",
      expected_output: isCode ? expectedOutput : "",
      choices: kind === "checkpoint" ? cleaned : [],
      quiz:
        kind === "checkpoint"
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
      className={`rounded-2xl border border-border bg-background/40 ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="cursor-grab text-muted-foreground/60">
          <GripVertical className="h-4 w-4" strokeWidth={1.6} />
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] text-muted-foreground">
          {index + 1}
        </span>
        <span className="text-muted-foreground">{config.icon}</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
            {activity.title}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
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
          <TextArea label={config.promptLabel} value={prompt} onChange={setPrompt} />

          {kind === "practice" ? (
            <SelectInput
              label="Answer mode"
              value={practiceMode}
              options={["text", "code"]}
              onChange={(value) => setPracticeMode(value as ResponseMode)}
            />
          ) : null}

          {kind === "practice" && practiceMode === "code" ? (
            <>
              <TextArea label="Starter code" value={starterCode} onChange={setStarterCode} />
              <TextArea
                label="Expected output"
                value={expectedOutput}
                onChange={setExpectedOutput}
              />
            </>
          ) : null}

          {kind === "checkpoint" ? (
            <div className="grid gap-2">
              <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Choices
              </div>
              {choices.map((choice, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)_90px]">
                  <input
                    value={choice.id}
                    onChange={(event) => updateChoice(i, { id: event.target.value })}
                    className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none"
                  />
                  <input
                    value={choice.text}
                    onChange={(event) => updateChoice(i, { text: event.target.value })}
                    className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setCorrectId(choice.id)}
                    className={`rounded-full border px-3 py-1.5 text-[11.5px] ${
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
                className="justify-self-start text-[12px] text-muted-foreground hover:text-foreground"
              >
                + Add choice
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" strokeWidth={1.7} />
              {busy ? "Saving..." : "Save step"}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy || !canDelete}
              title={canDelete ? undefined : "A lesson needs at least one step."}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
      <div className="mb-1 flex items-center gap-2 text-[15px] font-medium text-foreground">
        <Eye className="h-4 w-4" strokeWidth={1.7} />
        Student walkthrough
      </div>
      <div>
        <h2 className="font-serif text-[26px] leading-tight text-foreground">{lesson.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {milestone?.objective || "Add a lesson objective to preview the target."}
        </p>
      </div>
      {steps.length === 0 ? (
        <div className="rounded-2xl border border-border bg-background/40 p-4 text-[12.5px] text-muted-foreground">
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
              className="rounded-2xl border border-border bg-background/40 p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px]">
                  {index + 1}
                </span>
                {config.label}
              </div>
              <div className="text-[13px] font-medium text-foreground">{activity.title}</div>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                {activity.prompt}
              </p>
              {kind === "checkpoint" && quiz?.choices?.length ? (
                <div className="mt-3 grid gap-1.5">
                  {quiz.choices.map((choice) => (
                    <div
                      key={choice.id}
                      className={`rounded-xl border px-3 py-2 text-[12.5px] ${
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
                <pre className="mt-3 overflow-auto rounded-xl border border-border bg-background/60 p-3 text-[12px] text-foreground">
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
      className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
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
  return "border-border";
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

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setExtracting(true);
    const added: Array<{ name: string; text: string }> = [];
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
        } else {
          text = await file.text();
        }
        if (text.trim()) added.push({ name: file.name, text: text.trim().slice(0, 20000) });
      } catch {
        // Skip files we can't read.
      }
    }
    setDocs((current) => [...current, ...added]);
    setExtracting(false);
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
    <div className="rounded-2xl border border-border bg-background/30 p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-[12px] font-medium text-foreground"
      >
        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
        Reference material
        <span className="text-[11px] font-normal text-muted-foreground">{summary}</span>
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={1.7}
        />
      </button>
      {open ? (
        <div className="mt-3 grid gap-3">
          <TextArea label="Paste source text" value={paste} onChange={setPaste} />
          <div className="grid gap-1">
            <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Upload files (.txt, .md, .pdf)
            </span>
            <input
              type="file"
              multiple
              accept=".txt,.md,.markdown,.pdf,text/plain,application/pdf"
              disabled={busy || extracting}
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = "";
              }}
              className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12px] text-foreground outline-none file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-[12px] file:text-foreground"
            />
            {extracting ? (
              <span className="text-[11px] text-muted-foreground">Reading files…</span>
            ) : null}
            {docs.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {docs.map((doc, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
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
          {usableResources.length ? (
            <div className="grid gap-1">
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Use existing resources
              </span>
              <div className="grid max-h-40 gap-1 overflow-auto">
                {usableResources.map((resource) => (
                  <label
                    key={resource.id}
                    className="flex items-center gap-2 text-[12px] text-foreground"
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
        className="rounded-xl border border-border bg-background/70 px-3 py-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSubmit(text.trim())}
          disabled={loading || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          {loading ? "Refining…" : "Refine"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AiOutlinePanel({
  busy,
  resources,
  onGenerate,
  onApply,
}: {
  busy: boolean;
  resources: LessonResource[];
  onGenerate: (args: OutlineGenArgs) => Promise<CurriculumOutlineDraft | null>;
  onApply: (outline: CurriculumOutlineDraft) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<CurriculumOutlineDraft | null>(null);
  const [statuses, setStatuses] = useState<ItemStatus[]>([]);
  const [refineFor, setRefineFor] = useState<number | null>(null);

  const sigOf = (unit: CurriculumOutlineDraft["units"][number]) => JSON.stringify(unit);

  const generate = async () => {
    if (!prompt.trim()) return;
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
    <section className="rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
        <Sparkles className="h-4 w-4" strokeWidth={1.7} />
        Draft an outline with AI
      </div>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Describe the course. The AI sees the rest of this subject and any reference material you
        attach. Refine individual units before anything is created.
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
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          {loading ? "Working…" : draft ? "Regenerate" : "Generate"}
        </button>
      </div>

      {draft ? (
        <div className="mt-3 grid gap-2 rounded-2xl border border-border bg-background/40 p-3">
          {draft.units.length === 0 ? (
            <div className="text-[12.5px] text-muted-foreground">
              The model did not return any units. Try a more specific brief.
            </div>
          ) : (
            draft.units.map((unit, i) => {
              const status = statuses[i] || "same";
              return (
                <div key={i} className={`rounded-xl border p-2.5 ${statusRing(status)}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                      {unit.title}
                    </span>
                    {statusLabel(status) ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {statusLabel(status)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setRefineFor(refineFor === i ? null : i)}
                      title="Refine this unit"
                      aria-label="Refine this unit"
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                    >
                      <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                  <ul className="mt-1 ml-4 list-disc text-[12px] text-muted-foreground">
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
                  onApply(draft);
                  setDraft(null);
                  setStatuses([]);
                  setPrompt("");
                }}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-[12.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                Apply outline
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setStatuses([]);
                }}
                className="text-[12px] text-muted-foreground hover:text-foreground"
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
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
        <Sparkles className="h-4 w-4" strokeWidth={1.7} />
        Draft steps with AI
      </div>
      <p className="mb-3 text-[12px] text-muted-foreground">
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
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          {loading ? "Working…" : drafts ? "Regenerate" : "Generate"}
        </button>
      </div>

      {drafts ? (
        <div className="mt-3 grid gap-2 rounded-2xl border border-border bg-background/40 p-3">
          {drafts.length === 0 ? (
            <div className="text-[12.5px] text-muted-foreground">
              The model did not return any steps. Try a more specific brief.
            </div>
          ) : (
            drafts.map((step, i) => {
              const status = statuses[i] || "same";
              return (
                <div key={i} className={`rounded-xl border p-2.5 ${statusRing(status)}`}>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {step.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                      {step.title}
                    </span>
                    {statusLabel(status) ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {statusLabel(status)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setRefineFor(refineFor === i ? null : i)}
                      title="Refine this step"
                      aria-label="Refine this step"
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                    >
                      <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted-foreground">
                    {step.prompt}
                  </p>
                  {step.kind === "checkpoint" && step.choices.length ? (
                    <ul className="mt-1 ml-4 list-disc text-[11.5px] text-muted-foreground">
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
                className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-[12.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-50"
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
                className="text-[12px] text-muted-foreground hover:text-foreground"
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
  navigate,
}: {
  selection: Selection;
  data: CurriculumAuthoringData | null;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const segments: Array<{ label: string; onClick?: () => void }> = [
    { label: "Teacher", onClick: () => navigate({ to: "/teacher" }) },
    { label: "Curriculum", onClick: () => navigate({ to: "/teacher/curriculum", search: {} }) },
  ];
  if (!selection || !data) return segments;

  const path = nodePath(selection, data);
  const go = (type: CurriculumNodeType, id: string) =>
    navigate({ to: "/teacher/curriculum", search: { [type]: id } as CurriculumSearch });

  if (path.subject)
    segments.push({ label: path.subject.title, onClick: () => go("subject", path.subject!.id) });
  if (path.course)
    segments.push({ label: path.course.title, onClick: () => go("course", path.course!.id) });
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
    <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
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
    <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[82px] rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case leading-relaxed tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
