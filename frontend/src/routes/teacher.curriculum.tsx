import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Archive,
  Check,
  ChevronRight,
  Eye,
  FilePlus2,
  GripVertical,
  Layers3,
  NotebookPen,
  Pencil,
  Plus,
  Send,
  Trash2,
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
  createLessonResource,
  deleteCurriculumNode,
  fetchCurriculumAuthoringData,
  fetchPrimaryRole,
  getSession,
  invokeCurriculumAdmin,
  moveCurriculumLesson,
  renameCurriculumNode,
  reorderCurriculumNodes,
  roleHome,
} from "@/lib/api";
import type {
  CurriculumAuthoringData,
  CurriculumBlueprint,
  CurriculumCourse,
  CurriculumCourseVersion,
  CurriculumNodeType,
  CurriculumSubject,
  CurriculumUnit,
  Lesson,
  LessonResource,
  LessonResourceType,
} from "@/lib/types";

type LessonKind = CurriculumBlueprint["lesson"]["type"];
type ResponseMode = CurriculumBlueprint["activity"]["response_mode"];
type ActivityStage = CurriculumBlueprint["activity"]["stage"];

type Selection = { type: CurriculumNodeType; id: string } | null;

type CurriculumSearch = {
  subject?: string;
  course?: string;
  unit?: string;
  lesson?: string;
};

type DraftState = {
  lessonId: string;
  subjectId: string;
  subjectTitle: string;
  subjectDescription: string;
  courseId: string;
  courseTitle: string;
  courseDescription: string;
  unitId: string;
  unitTitle: string;
  unitPosition: string;
  lessonTitle: string;
  lessonLevel: string;
  lessonType: LessonKind;
  tutorPrompt: string;
  sampleCode: string;
  milestoneTitle: string;
  milestoneObjective: string;
  skillKeys: string;
  allowedModes: ResponseMode[];
  activityTitle: string;
  activityStage: ActivityStage;
  activityPrompt: string;
  activityResponseMode: ResponseMode;
  starterCode: string;
  expectedOutput: string;
  rubricNotes: string;
  quizPrompt: string;
  quizChoices: Array<{ id: string; text: string }>;
  quizCorrectChoiceId: string;
  resourceIds: string[];
  newResourceTitle: string;
  newResourceDescription: string;
  newResourceInstructions: string;
  newResourceType: LessonResourceType;
  newResourceUrl: string;
  newResourceFile: File | null;
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
  const [teacherId, setTeacherId] = useState("");
  const [data, setData] = useState<CurriculumAuthoringData | null>(null);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [draft, setDraft] = useState<DraftState>(() => defaultDraft());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
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
      setTeacherId(session.user.id);
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

  const visibleResources = useMemo(() => {
    if (!data || !selectedClass) return [];
    return data.resources.filter(
      (resource) =>
        resource.status !== "archived" &&
        (!resource.class_id || resource.class_id === selectedClass.id) &&
        (!resource.organization_id || resource.organization_id === selectedClass.organization_id),
    );
  }, [data, selectedClass]);

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

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Load the lesson named by ?lesson= into the editor when it changes.
  useEffect(() => {
    if (!data || !search.lesson || draft.lessonId === search.lesson) return;
    const lesson = data.lessons.find((item) => item.id === search.lesson);
    if (lesson) setDraft(draftFromLesson(lesson, data));
  }, [data, search.lesson, draft.lessonId]);

  const setField = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  // --- Structure mutations --------------------------------------------------
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
        // Select after the refresh so the new node's detail pane renders with data present.
        if (outcome?.select) selectNode(outcome.select.type, outcome.select.id);
        if (successMessage) setMessage(successMessage);
      } catch (error) {
        setMessage((error as Error).message || "Could not update curriculum structure.");
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

  // --- Lesson blueprint (today's fields) ------------------------------------

  const saveBlueprint = async () => {
    if (!selectedClass || !teacherId) return;
    setSaving(true);
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to save curriculum.");
      const blueprint = draftToBlueprint(draft);
      const saved = await invokeCurriculumAdmin({
        accessToken: session.access_token,
        action: "save_lesson_blueprint",
        organizationId: selectedClass.organization_id,
        classId: selectedClass.id,
        lessonId: draft.lessonId || undefined,
        blueprint,
      });

      if (hasNewResourceDraft(draft) && saved.lesson_id) {
        await createLessonResource({
          teacherId,
          organizationId: selectedClass.organization_id,
          classId: selectedClass.id,
          lessonId: saved.lesson_id,
          title: draft.newResourceTitle.trim(),
          description: draft.newResourceDescription.trim(),
          studentInstructions: draft.newResourceInstructions.trim(),
          teacherNotes: "",
          resourceType: draft.newResourceType,
          sourceType: draft.newResourceFile ? "upload" : "external_url",
          status: "draft",
          visibility: "class_private",
          displayMode: "card",
          externalUrl: draft.newResourceUrl.trim(),
          file: draft.newResourceFile,
        });
      }

      setDraft((current) => ({
        ...current,
        lessonId: saved.lesson_id || current.lessonId,
        subjectId: saved.subject_id || current.subjectId,
        courseId: saved.course_id || current.courseId,
        unitId: saved.unit_id || current.unitId,
        newResourceTitle: "",
        newResourceDescription: "",
        newResourceInstructions: "",
        newResourceUrl: "",
        newResourceFile: null,
      }));
      setMessage("Lesson saved as curriculum draft.");
      await loadData();
    } catch (error) {
      setMessage((error as Error).message || "Could not save lesson.");
    } finally {
      setSaving(false);
    }
  };

  const setPublication = async (action: "publish_lesson" | "archive_lesson") => {
    if (!selectedClass || !draft.lessonId) {
      setMessage("Save the lesson before publishing or archiving it.");
      return;
    }
    setPublishing(true);
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to update publishing.");
      await invokeCurriculumAdmin({
        accessToken: session.access_token,
        action,
        organizationId: selectedClass.organization_id,
        classId: selectedClass.id,
        lessonId: draft.lessonId,
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
        <div className="grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-[78px] lg:max-h-[calc(100vh-110px)] lg:overflow-auto">
            <Outline
              subjects={orgSubjects}
              coursesForSubject={coursesForSubject}
              unitsForCourse={unitsForCourse}
              lessonsForUnit={lessonsForUnit}
              selection={selection}
              collapsed={collapsed}
              busy={busy}
              onToggle={toggleCollapsed}
              onSelect={selectNode}
              onReorder={reorder}
              onAddSubject={addSubject}
              onAddCourse={addCourse}
              onAddUnit={addUnit}
              onAddLesson={addLesson}
            />
          </aside>

          <div className="min-w-0">
            <DetailPane
              key={selection ? `${selection.type}:${selection.id}` : "empty"}
              selection={selection}
              data={data}
              draft={draft}
              resources={visibleResources}
              lessonsById={lessonsById}
              orgUnits={orgUnits}
              busy={busy}
              saving={saving}
              publishing={publishing}
              onField={setField}
              onAddSubject={addSubject}
              onRename={renameNode}
              onArchive={archiveNode}
              onDelete={deleteNode}
              onAddCourse={addCourse}
              onAddUnit={addUnit}
              onAddLesson={addLesson}
              onMoveLesson={moveLesson}
              onSaveLesson={() => void saveBlueprint()}
              onPublishLesson={() => void setPublication("publish_lesson")}
              onArchiveLesson={() => void setPublication("archive_lesson")}
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
  collapsed,
  busy,
  onToggle,
  onSelect,
  onReorder,
  onAddSubject,
  onAddCourse,
  onAddUnit,
  onAddLesson,
}: {
  subjects: CurriculumSubject[];
  coursesForSubject: (subjectId: string) => CurriculumCourse[];
  unitsForCourse: (courseId: string) => CurriculumUnit[];
  lessonsForUnit: (unitId: string) => Lesson[];
  selection: Selection;
  collapsed: Set<string>;
  busy: boolean;
  onToggle: (id: string) => void;
  onSelect: (type: CurriculumNodeType, id: string) => void;
  onReorder: (type: CurriculumNodeType, orderedIds: string[]) => void;
  onAddSubject: () => void;
  onAddCourse: (subjectId: string) => void;
  onAddUnit: (courseId: string) => void;
  onAddLesson: (unitId: string) => void;
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
          <button
            type="button"
            onClick={onAddSubject}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            Subject
          </button>
        </div>

        {subjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
            No subjects yet. Create one to start building.
          </div>
        ) : (
          <div className="grid gap-1">
            <ReorderList
              items={subjects}
              disabled={busy}
              onReorder={(ids) => onReorder("subject", ids)}
            >
              {(subject, state) => {
                const open = !collapsed.has(subject.id);
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
                      <div className="mt-0.5 grid gap-0.5">
                        <ReorderList
                          items={courses}
                          disabled={busy}
                          onReorder={(ids) => onReorder("course", ids)}
                        >
                          {(course, courseState) => {
                            const courseOpen = !collapsed.has(course.id);
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
                                  <div className="mt-0.5 grid gap-0.5">
                                    <ReorderList
                                      items={units}
                                      disabled={busy}
                                      onReorder={(ids) => onReorder("unit", ids)}
                                    >
                                      {(unit, unitState) => {
                                        const unitOpen = !collapsed.has(unit.id);
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
                                              <div className="mt-0.5 grid gap-0.5">
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
      className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
        selected ? "bg-foreground text-background" : "hover:bg-muted"
      } ${dragging ? "opacity-40" : ""}`}
      style={{ paddingLeft: `${depth * 14 + 2}px` }}
    >
      <span className="cursor-grab text-muted-foreground/60 group-hover:text-muted-foreground">
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
  return state.over ? "rounded-lg ring-1 ring-foreground/40" : "";
}

// ---------------------------------------------------------------------------
// Detail pane — edits whichever node is selected.
// ---------------------------------------------------------------------------

function DetailPane({
  selection,
  data,
  draft,
  resources,
  lessonsById,
  orgUnits,
  busy,
  saving,
  publishing,
  onField,
  onAddSubject,
  onRename,
  onArchive,
  onDelete,
  onAddCourse,
  onAddUnit,
  onAddLesson,
  onMoveLesson,
  onSaveLesson,
  onPublishLesson,
  onArchiveLesson,
  currentVersionForCourse,
  counts,
}: {
  selection: Selection;
  data: CurriculumAuthoringData;
  draft: DraftState;
  resources: LessonResource[];
  lessonsById: Map<string, Lesson>;
  orgUnits: Array<{ unit: CurriculumUnit; courseTitle: string }>;
  busy: boolean;
  saving: boolean;
  publishing: boolean;
  onField: <K extends keyof DraftState>(key: K, value: DraftState[K]) => void;
  onAddSubject: () => void;
  onRename: (type: CurriculumNodeType, id: string, title: string, description?: string) => void;
  onArchive: (type: CurriculumNodeType, id: string) => void;
  onDelete: (type: CurriculumNodeType, id: string) => void;
  onAddCourse: (subjectId: string) => void;
  onAddUnit: (courseId: string) => void;
  onAddLesson: (unitId: string) => void;
  onMoveLesson: (lessonId: string, targetUnitId: string) => void;
  onSaveLesson: () => void;
  onPublishLesson: () => void;
  onArchiveLesson: () => void;
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
      draft={draft}
      resources={resources}
      lessonsById={lessonsById}
      orgUnits={orgUnits}
      busy={busy}
      saving={saving}
      publishing={publishing}
      onField={onField}
      onSave={onSaveLesson}
      onPublish={onPublishLesson}
      onArchive={onArchiveLesson}
      onMove={(targetUnitId) => onMoveLesson(lesson.id, targetUnitId)}
      onDelete={() => onDelete("lesson", lesson.id)}
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

function LessonDetail({
  lesson,
  draft,
  resources,
  lessonsById,
  orgUnits,
  busy,
  saving,
  publishing,
  onField,
  onSave,
  onPublish,
  onArchive,
  onMove,
  onDelete,
}: {
  lesson: Lesson;
  draft: DraftState;
  resources: LessonResource[];
  lessonsById: Map<string, Lesson>;
  orgUnits: Array<{ unit: CurriculumUnit; courseTitle: string }>;
  busy: boolean;
  saving: boolean;
  publishing: boolean;
  onField: <K extends keyof DraftState>(key: K, value: DraftState[K]) => void;
  onSave: () => void;
  onPublish: () => void;
  onArchive: () => void;
  onMove: (targetUnitId: string) => void;
  onDelete: () => void;
}) {
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ready = Boolean(draft.lessonId);

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

        {view === "edit" ? (
          <>
            <BlueprintEditor
              draft={draft}
              resources={resources}
              lessonsById={lessonsById}
              onField={onField}
            />
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                {saving ? "Saving..." : "Save draft"}
              </button>
              <button
                type="button"
                onClick={onPublish}
                disabled={publishing || !ready}
                className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-[12.5px] text-success transition-colors hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                Publish
              </button>
              <button
                type="button"
                onClick={onArchive}
                disabled={publishing || !ready}
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Archive className="h-3.5 w-3.5" strokeWidth={1.7} />
                Archive
              </button>
            </div>

            <div className="mt-6 border-t border-border pt-4">
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
          </>
        ) : (
          <PreviewPanel draft={draft} resources={resources} />
        )}
      </div>
    </GradientCard>
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
// Ordering + breadcrumb helpers.
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
// Lesson blueprint editing (today's fields) — reused as-is by LessonDetail.
// ---------------------------------------------------------------------------

function defaultDraft(): DraftState {
  return {
    lessonId: "",
    subjectId: "",
    subjectTitle: "Logic Foundations",
    subjectDescription: "Structured lessons for clear thinking across subjects.",
    courseId: "",
    courseTitle: "Clear Thinking",
    courseDescription:
      "A teacher-authored path for claims, reasons, evidence, and careful explanation.",
    unitId: "",
    unitTitle: "Claims, Reasons, Evidence",
    unitPosition: "1",
    lessonTitle: "What Makes a Good Reason?",
    lessonLevel: "Any level",
    lessonType: "discussion",
    tutorPrompt:
      "Guide the student to understand that a good reason explains why a claim makes sense. Keep the conversation short, concrete, age-aware, and focused on one reasoning move at a time.",
    sampleCode: "",
    milestoneTitle: "Connect A Claim To A Reason",
    milestoneObjective:
      "The student can identify a claim and give a reason that explains why the claim makes sense.",
    skillKeys: "logic.claims,logic.reasons,logic.evidence",
    allowedModes: ["text"],
    activityTitle: "Reasoning discussion",
    activityStage: "practice",
    activityPrompt:
      "Tell me one thing you believe is true about school, games, or everyday life. What is one reason someone else should believe it too?",
    activityResponseMode: "text",
    starterCode: "",
    expectedOutput: "",
    rubricNotes: "Pass when the student states a claim and gives a reason that supports it.",
    quizPrompt:
      "Which option gives the best reason for the claim: Reading every day helps you learn?",
    quizChoices: [
      { id: "a", text: "Because reading every day is a thing people do." },
      {
        id: "b",
        text: "Because daily reading gives your brain more practice with words and ideas.",
      },
      { id: "c", text: "Because books exist in many places." },
    ],
    quizCorrectChoiceId: "b",
    resourceIds: [],
    newResourceTitle: "",
    newResourceDescription: "",
    newResourceInstructions: "",
    newResourceType: "link",
    newResourceUrl: "",
    newResourceFile: null,
  };
}

function draftFromLesson(lesson: Lesson, data: CurriculumAuthoringData): DraftState {
  const unit = data.units.find((item) => item.id === lesson.unit_id) || null;
  const version = unit
    ? data.courseVersions.find((item) => item.id === unit.course_version_id) || null
    : null;
  const course = version
    ? data.courses.find((item) => item.id === version.course_id) || null
    : null;
  const subject = course
    ? data.subjects.find((item) => item.id === course.subject_id) || null
    : null;
  const milestone = data.milestones.find((item) => item.lesson_id === lesson.id) || null;
  const activity = data.activities.find((item) => item.lesson_id === lesson.id) || null;
  const quiz =
    data.quizzes.find((item) => item.lesson_id === lesson.id && item.status !== "archived") || null;
  const metadata = lesson.curriculum_metadata || {};
  const lessonType =
    parseLessonKind(metadata.lesson_type) ||
    parseLessonKind(activity?.activity_type) ||
    "discussion";

  return {
    ...defaultDraft(),
    lessonId: lesson.id,
    subjectId: subject?.id || "",
    subjectTitle: subject?.title || "Untitled subject",
    subjectDescription: subject?.description || "",
    courseId: course?.id || "",
    courseTitle: course?.title || "Untitled course",
    courseDescription: course?.description || "",
    unitId: unit?.id || "",
    unitTitle: unit?.title || lesson.module || "Unit",
    unitPosition: String(unit?.position || 1),
    lessonTitle: lesson.title,
    lessonLevel: lesson.level || "Any level",
    lessonType,
    tutorPrompt: lesson.tutor_prompt || "",
    sampleCode: lesson.sample_code || "",
    milestoneTitle: milestone?.title || "",
    milestoneObjective: milestone?.objective || "",
    skillKeys: (milestone?.skill_keys || []).join(","),
    allowedModes: milestone?.allowed_response_modes?.length
      ? milestone.allowed_response_modes
      : [activity?.response_mode || "text"],
    activityTitle: activity?.title || "",
    activityStage: parseActivityStage(activity?.stage) || "practice",
    activityPrompt: activity?.prompt || "",
    activityResponseMode: activity?.response_mode || "text",
    starterCode: activity?.starter_code || lesson.sample_code || "",
    expectedOutput: activity?.expected_output || lesson.expected_output || "",
    rubricNotes:
      typeof activity?.rubric?.notes === "string"
        ? activity.rubric.notes
        : "Pass when the student shows the target idea in their own words.",
    quizPrompt: quiz?.prompt || "",
    quizChoices: quiz?.choices?.length ? quiz.choices : defaultDraft().quizChoices,
    quizCorrectChoiceId: quiz?.correct_choice_ids?.[0] || defaultDraft().quizCorrectChoiceId,
    resourceIds: data.resources
      .filter((resource) => resource.lesson_id === lesson.id && resource.status !== "archived")
      .map((resource) => resource.id),
  };
}

function parseLessonKind(value: unknown): LessonKind | null {
  return ["discussion", "code", "reflection", "multiple_choice", "file"].includes(String(value))
    ? (value as LessonKind)
    : null;
}

function parseActivityStage(value: unknown): ActivityStage | null {
  return ["intro", "teach", "practice", "assessment", "review"].includes(String(value))
    ? (value as ActivityStage)
    : null;
}

function draftToBlueprint(draft: DraftState): CurriculumBlueprint {
  const choices = draft.quizChoices
    .map((choice) => ({ id: choice.id.trim(), text: choice.text.trim() }))
    .filter((choice) => choice.id && choice.text);
  return {
    subject: {
      id: draft.subjectId || undefined,
      title: draft.subjectTitle.trim(),
      description: draft.subjectDescription.trim(),
    },
    course: {
      id: draft.courseId || undefined,
      title: draft.courseTitle.trim(),
      description: draft.courseDescription.trim(),
    },
    unit: {
      id: draft.unitId || undefined,
      title: draft.unitTitle.trim(),
      position: Math.max(1, Math.round(Number(draft.unitPosition) || 1)),
    },
    lesson: {
      id: draft.lessonId || undefined,
      title: draft.lessonTitle.trim(),
      level: draft.lessonLevel.trim() || "Any level",
      type: draft.lessonType,
      tutor_prompt: draft.tutorPrompt.trim(),
      sample_code: draft.sampleCode.trim(),
    },
    milestone: {
      title: draft.milestoneTitle.trim(),
      objective: draft.milestoneObjective.trim(),
      skill_keys: draft.skillKeys
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      allowed_response_modes: draft.allowedModes,
    },
    activity: {
      title: draft.activityTitle.trim(),
      stage: draft.activityStage,
      prompt: draft.activityPrompt.trim(),
      response_mode: draft.activityResponseMode,
      starter_code: draft.starterCode.trim(),
      expected_output: draft.expectedOutput.trim(),
      rubric: { notes: draft.rubricNotes.trim() },
    },
    quiz:
      draft.quizPrompt.trim() && choices.length >= 2 && draft.quizCorrectChoiceId
        ? {
            prompt: draft.quizPrompt.trim(),
            choices,
            correct_choice_ids: [draft.quizCorrectChoiceId],
          }
        : undefined,
    resource_ids: draft.resourceIds,
  };
}

function hasNewResourceDraft(draft: DraftState) {
  return Boolean(
    draft.newResourceTitle.trim() && (draft.newResourceFile || draft.newResourceUrl.trim()),
  );
}

function BlueprintEditor({
  draft,
  resources,
  lessonsById,
  onField,
}: {
  draft: DraftState;
  resources: LessonResource[];
  lessonsById: Map<string, Lesson>;
  onField: <K extends keyof DraftState>(key: K, value: DraftState[K]) => void;
}) {
  const toggleMode = (mode: ResponseMode) => {
    const exists = draft.allowedModes.includes(mode);
    const next = exists
      ? draft.allowedModes.filter((item) => item !== mode)
      : [...draft.allowedModes, mode];
    onField("allowedModes", next.length ? next : ["text"]);
  };

  const updateChoice = (index: number, patch: Partial<{ id: string; text: string }>) => {
    onField(
      "quizChoices",
      draft.quizChoices.map((choice, choiceIndex) =>
        choiceIndex === index ? { ...choice, ...patch } : choice,
      ),
    );
  };

  const toggleResource = (resourceId: string) => {
    onField(
      "resourceIds",
      draft.resourceIds.includes(resourceId)
        ? draft.resourceIds.filter((id) => id !== resourceId)
        : [...draft.resourceIds, resourceId],
    );
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">
          Save drafts freely. Publish only when students should see the lesson.
        </p>
        {draft.lessonId ? (
          <span className="rounded-full border border-border px-3 py-1 text-[11.5px] text-muted-foreground">
            {lessonsById.get(draft.lessonId)?.publication_status || "draft"}
          </span>
        ) : null}
      </div>

      <div className="grid gap-4">
        <EditorSection title="Lesson" icon={<NotebookPen className="h-4 w-4" strokeWidth={1.7} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Lesson title"
              value={draft.lessonTitle}
              onChange={(value) => onField("lessonTitle", value)}
            />
            <TextInput
              label="Level"
              value={draft.lessonLevel}
              onChange={(value) => onField("lessonLevel", value)}
            />
            <SelectInput
              label="Lesson type"
              value={draft.lessonType}
              options={["discussion", "code", "reflection", "multiple_choice", "file"]}
              onChange={(value) => onField("lessonType", value as LessonKind)}
            />
            <SelectInput
              label="Activity response"
              value={draft.activityResponseMode}
              options={["text", "code", "multiple_choice", "file"]}
              onChange={(value) => onField("activityResponseMode", value as ResponseMode)}
            />
          </div>
          <TextArea
            label="Mentor prompt"
            value={draft.tutorPrompt}
            onChange={(value) => onField("tutorPrompt", value)}
          />
          <TextArea
            label="Optional starter code"
            value={draft.sampleCode}
            onChange={(value) => onField("sampleCode", value)}
          />
        </EditorSection>

        <EditorSection
          title="Milestone and activity"
          icon={<Layers3 className="h-4 w-4" strokeWidth={1.7} />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Milestone title"
              value={draft.milestoneTitle}
              onChange={(value) => onField("milestoneTitle", value)}
            />
            <TextInput
              label="Skill keys"
              value={draft.skillKeys}
              onChange={(value) => onField("skillKeys", value)}
            />
          </div>
          <TextArea
            label="Milestone objective"
            value={draft.milestoneObjective}
            onChange={(value) => onField("milestoneObjective", value)}
          />
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
                    draft.allowedModes.includes(mode)
                      ? "border-foreground/25 bg-foreground text-background"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Activity title"
              value={draft.activityTitle}
              onChange={(value) => onField("activityTitle", value)}
            />
            <SelectInput
              label="Stage"
              value={draft.activityStage}
              options={["intro", "teach", "practice", "assessment", "review"]}
              onChange={(value) => onField("activityStage", value as ActivityStage)}
            />
          </div>
          <TextArea
            label="Student prompt"
            value={draft.activityPrompt}
            onChange={(value) => onField("activityPrompt", value)}
          />
          <TextArea
            label="Rubric / pass notes"
            value={draft.rubricNotes}
            onChange={(value) => onField("rubricNotes", value)}
          />
        </EditorSection>

        <EditorSection
          title="Quiz checkpoint"
          icon={<Send className="h-4 w-4" strokeWidth={1.7} />}
        >
          <TextArea
            label="MCQ prompt"
            value={draft.quizPrompt}
            onChange={(value) => onField("quizPrompt", value)}
          />
          <div className="grid gap-2">
            {draft.quizChoices.map((choice, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[64px_minmax(0,1fr)_90px]">
                <input
                  value={choice.id}
                  onChange={(event) => updateChoice(index, { id: event.target.value })}
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none"
                />
                <input
                  value={choice.text}
                  onChange={(event) => updateChoice(index, { text: event.target.value })}
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none"
                />
                <button
                  type="button"
                  onClick={() => onField("quizCorrectChoiceId", choice.id)}
                  className={`rounded-full border px-3 py-1.5 text-[11.5px] ${
                    draft.quizCorrectChoiceId === choice.id
                      ? "border-success/35 text-success"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  Correct
                </button>
              </div>
            ))}
          </div>
        </EditorSection>

        <EditorSection title="Resources" icon={<FilePlus2 className="h-4 w-4" strokeWidth={1.7} />}>
          <div className="grid gap-2">
            <div className="text-[12.5px] text-muted-foreground">
              Attach existing resources, or create one new draft resource while saving.
            </div>
            {resources.length ? (
              <div className="grid gap-2">
                {resources.map((resource) => (
                  <label
                    key={resource.id}
                    className="flex items-center gap-2 text-[12.5px] text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={draft.resourceIds.includes(resource.id)}
                      onChange={() => toggleResource(resource.id)}
                      className="h-4 w-4 accent-foreground"
                    />
                    <span className="min-w-0 truncate">
                      {resource.title} · {resource.resource_type} · {resource.status}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-background/35 p-3 text-[12.5px] text-muted-foreground">
                No reusable resources yet.
              </div>
            )}
          </div>

          <div className="mt-3 grid gap-3 rounded-2xl border border-border bg-background/35 p-3">
            <div className="text-[12px] font-medium text-foreground">New draft resource</div>
            <TextInput
              label="Title"
              value={draft.newResourceTitle}
              onChange={(value) => onField("newResourceTitle", value)}
            />
            <TextArea
              label="Student instructions"
              value={draft.newResourceInstructions}
              onChange={(value) => onField("newResourceInstructions", value)}
            />
            <SelectInput
              label="Type"
              value={draft.newResourceType}
              options={["link", "youtube", "pdf", "video", "audio", "image", "document"]}
              onChange={(value) => onField("newResourceType", value as LessonResourceType)}
            />
            <TextInput
              label="External URL"
              value={draft.newResourceUrl}
              onChange={(value) => onField("newResourceUrl", value)}
            />
            <input
              type="file"
              onChange={(event) => onField("newResourceFile", event.target.files?.[0] || null)}
              className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-[12px] file:text-foreground"
            />
          </div>
        </EditorSection>
      </div>
    </div>
  );
}

function PreviewPanel({ draft, resources }: { draft: DraftState; resources: LessonResource[] }) {
  const attached = resources.filter((resource) => draft.resourceIds.includes(resource.id));
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-[15px] font-medium text-foreground">
        <Eye className="h-4 w-4" strokeWidth={1.7} />
        Student preview
      </div>
      <div className="grid gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            {draft.subjectTitle} / {draft.unitTitle}
          </div>
          <h2 className="font-serif mt-2 text-[28px] leading-tight text-foreground">
            {draft.lessonTitle || "Untitled lesson"}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {draft.milestoneObjective || "Add an objective to preview the lesson target."}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-background/40 p-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Mentor asks
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
            {draft.activityPrompt || "The activity prompt will appear here."}
          </p>
        </div>
        {draft.quizPrompt ? (
          <div className="rounded-2xl border border-border bg-background/40 p-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Checkpoint
            </div>
            <p className="text-[13px] text-foreground">{draft.quizPrompt}</p>
            <div className="mt-3 grid gap-2">
              {draft.quizChoices.map((choice) => (
                <div
                  key={choice.id}
                  className="rounded-xl border border-border bg-background/45 px-3 py-2 text-[12.5px] text-muted-foreground"
                >
                  {choice.id}. {choice.text}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="rounded-2xl border border-border bg-background/40 p-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Resources
          </div>
          {attached.length ? (
            <div className="grid gap-2">
              {attached.map((resource) => (
                <div
                  key={resource.id}
                  className="rounded-xl border border-border bg-background/45 px-3 py-2"
                >
                  <div className="text-[12.5px] text-foreground">{resource.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {resource.resource_type} · {resource.status}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-muted-foreground">
              No existing resources attached yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-foreground">
        {icon}
        {title}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

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
