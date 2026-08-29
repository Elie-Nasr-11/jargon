/**
 * One lesson, open for editing.
 *
 * The lesson pane holds three things: what the lesson IS (title, objective, how
 * the mentor should teach it), the steps it runs, and the classwork hanging off
 * it. LessonPreview is the same lesson read the way a student meets it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Collapsible } from "@/components/Collapsible";
import { OverflowMenu } from "@/components/OverflowMenu";
import { DraftFieldButton } from "@/features/teacher/DraftFieldButton";
import { KnowledgeCard } from "@/features/teacher/KnowledgeCard";
import { LessonInventoryBar } from "@/features/teacher/LessonInventoryBar";
import { StepCard } from "@/features/teacher/authoring/StepCard";
import { ReorderList, dropClass } from "@/features/teacher/authoring/dragList";
import { SelectInput, TextArea, TextInput, ViewToggle } from "@/features/teacher/authoring/fields";
import { AiStepsPanel } from "@/features/teacher/authoring/generatePanels";
import { parseLessonKind } from "@/features/teacher/authoring/localState";
import {
  MODE_META,
  defaultStepForMode,
  kindOfActivity,
  modeAccentStyle,
  stepKindConfig,
} from "@/features/teacher/authoring/stepModel";
import type {
  ArtifactApprovePayload,
  ArtifactGenArgs,
  ClassworkItem,
  LessonKind,
  ResponseMode,
  StepsGenArgs,
} from "@/features/teacher/authoring/types";
import { bookSourceFor, bookSourceLabel } from "@/features/teacher/bookSource";
import type {
  CurriculumAdminResponse,
  CurriculumAuthoringData,
  CurriculumLessonMetaInput,
  CurriculumMilestoneInput,
  CurriculumStepDraft,
  CurriculumStepInput,
  CurriculumUnit,
  Lesson,
  LessonActivity,
  LessonResource,
} from "@/lib/types";
import {
  Archive,
  BookOpen,
  Check,
  Eye,
  Layers3,
  NotebookPen,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

export function LessonDetail({
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
  onCreateForLesson,
  onCreateForStep,
}: {
  lesson: Lesson;
  data: CurriculumAuthoringData;
  orgUnits: Array<{ unit: CurriculumUnit; courseTitle: string }>;
  resources: LessonResource[];
  busy: boolean;
  workItems: ClassworkItem[];
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreateForLesson?: (kind: "assignment" | "assessment", lessonId: string) => void;
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
  // R73: the book page ranges ride the authoring payload as a plain object; this room
  // wants a Map so the lesson header can name its source pages.
  const lessonBookPages = useMemo(
    () => new Map(Object.entries(data.bookPages || {})),
    [data.bookPages],
  );

  const [view, setView] = useState<"edit" | "preview">("edit");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [movingOpen, setMovingOpen] = useState(false);
  const [addStepOpen, setAddStepOpen] = useState(false);

  // R60b: ONE save. Children register their dirty state and a flush; the sticky bar
  // saves everything at once, and Publish flushes first so a teacher never publishes
  // stale text. No child state moves — each keeps its own fields and its save body.
  const flushers = useRef(new Map<string, () => void>());
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());
  const registerDirty = useCallback((id: string, dirty: boolean, flush: () => void) => {
    flushers.current.set(id, flush);
    setDirtyIds((prev) => {
      if (prev.has(id) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const unregisterDirty = useCallback((id: string) => {
    flushers.current.delete(id);
    setDirtyIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const saveAll = useCallback(() => {
    // Steps first, meta last — the meta path may refetch and must not race a step write.
    for (const id of dirtyIds) if (id !== "meta") flushers.current.get(id)?.();
    if (dirtyIds.has("meta")) flushers.current.get("meta")?.();
  }, [dirtyIds]);

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
  // R75: the derived knowledge graph opens on demand, not on arrival.
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  // R74: the lesson's own inventory. Assignments come from the work items the console
  // already hands down, so this counts what genuinely exists rather than re-querying.
  const inventory = useMemo(
    () => ({
      steps: steps.length,
      quizSteps: steps.filter((step) => step.response_mode === "multiple_choice").length,
      assignments: workItems.filter(
        (item) => item.kind === "assignment" && item.lessonId === lesson.id,
      ).length,
      materials: resources.filter(
        (resource) => resource.lesson_id === lesson.id && resource.status !== "archived",
      ).length,
    }),
    [steps, workItems, resources, lesson.id],
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
            {/* R74: what is actually IN this lesson. Build-from-material creates steps,
                a quiz, an assignment and materials in one action, so the teacher never
                watched the pieces appear — this is where they learn the pieces exist,
                and each count is a place they can go. */}
            <div className="mt-2">
              <LessonInventoryBar inventory={inventory} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 text-overline uppercase tracking-[0.08em] ${
                lesson.publication_status === "published"
                  ? "border-success/35 text-success"
                  : "border-border text-muted-foreground"
              }`}
            >
              {lesson.publication_status || "published"}
            </span>
            <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
              <ViewToggle active={view === "edit"} onClick={() => setView("edit")} label="Edit" />
              <ViewToggle
                active={view === "preview"}
                onClick={() => setView("preview")}
                label="Preview"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                saveAll();
                onPublish();
              }}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
              Publish
            </button>
            <OverflowMenu
              label="Lesson actions"
              actions={[
                {
                  label: "Archive",
                  icon: Archive,
                  disabled: busy,
                  onClick: onArchiveLesson,
                },
                {
                  label: "Move to unit…",
                  disabled: busy,
                  onClick: () => setMovingOpen(true),
                },
                {
                  label: "Delete lesson",
                  icon: Trash2,
                  tone: "danger",
                  disabled: busy,
                  separatorBefore: true,
                  onClick: () => setConfirmDelete(true),
                },
              ]}
            />
          </div>
        </div>

        {movingOpen ? (
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-card border border-border bg-depth-sub px-4 py-3">
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Move to unit
              <select
                value={lesson.unit_id || ""}
                onChange={(event) => {
                  if (event.target.value && event.target.value !== lesson.unit_id) {
                    onMove(event.target.value);
                  }
                  setMovingOpen(false);
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
            <button
              type="button"
              onClick={() => setMovingOpen(false)}
              className="text-meta text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : null}
        {confirmDelete ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-destructive/30 bg-depth-sub px-4 py-3">
            <span className="min-w-0 flex-1 text-meta text-muted-foreground">
              Delete this lesson? Lessons with learner activity can be archived but not deleted.
            </span>
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
        ) : null}

        {view === "preview" ? (
          <LessonPreview
            lesson={lesson}
            milestone={milestone}
            steps={steps}
            quizFor={quizFor}
            bookPages={lessonBookPages}
          />
        ) : (
          <div className="grid gap-5">
            <LessonMetaForm
              lesson={lesson}
              milestone={milestone}
              busy={busy}
              onSave={onSaveMeta}
              onDirtyState={registerDirty}
              onUnregister={unregisterDirty}
            />

            {/* R75: the knowledge graph (ideas, vocab, links) is NOT an authoring step —
                it is drafted from the lesson automatically when the lesson is published,
                and it feeds the student's brain map, My Jargon and the mentor's sense of
                what is fading. It matters, but it is a BY-PRODUCT of building a lesson,
                so it no longer sits open competing with the steps: it opens when a
                teacher wants to check what the machine derived. */}
            <Collapsible
              open={knowledgeOpen}
              onToggle={() => setKnowledgeOpen((value) => !value)}
              title={
                <span className="text-body font-medium text-foreground">
                  Ideas &amp; vocabulary
                </span>
              }
              meta={
                <span className="shrink-0 text-meta text-muted-foreground">
                  drafted from this lesson
                </span>
              }
              headerClassName="rounded-control px-1.5 py-2 transition-colors hover:bg-muted/60"
              bodyClassName="pt-2"
            >
              {knowledgeOpen ? <KnowledgeCard lessonId={lesson.id} /> : null}
            </Collapsible>

            {/* R74: the lesson's own classwork. Assignments and quizzes bind to a lesson
                and carry per-student recipients — the capability was always there, but the
                only way in was a generic "+ Create" that made you pick the lesson again
                afterwards. Creating it HERE means the place is never a question, and the
                student picker in the dialog answers "for whom". */}
            <LessonClasswork
              lessonId={lesson.id}
              items={workItems.filter(
                (item) => item.lessonId === lesson.id && item.kind !== "material",
              )}
              onOpenItem={onOpenItem}
              onCreate={onCreateForLesson}
            />

            {/* R74: the lesson's own classwork. Assignments and quizzes bind to a lesson
                and carry per-student recipients — the capability was always there, but the
                only way in was a generic "+ Create" that made you pick the lesson again
                afterwards. Creating it HERE means the place is never a question, and the
                student picker in the dialog answers "for whom". */}
            <LessonClasswork
              lessonId={lesson.id}
              items={workItems.filter(
                (item) => item.lessonId === lesson.id && item.kind !== "material",
              )}
              onOpenItem={onOpenItem}
              onCreate={onCreateForLesson}
            />

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
                          onDirtyState={registerDirty}
                          onUnregister={unregisterDirty}
                        />
                      </div>
                    )}
                  </ReorderList>
                </div>
              )}

              {/* R60b: one door instead of eight chips — a grouped menu, still driven by
                  MODE_META so the mode vocabulary stays single-sourced. */}
              <div className="relative mt-3">
                <button
                  type="button"
                  onClick={() => setAddStepOpen((value) => !value)}
                  disabled={busy}
                  aria-haspopup="menu"
                  aria-expanded={addStepOpen}
                  className="btn btn-secondary btn-sm gap-1"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Add step
                </button>
                {addStepOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-20 mt-1 w-64 rounded-card border border-border bg-depth-card p-1 shadow-card"
                  >
                    {(
                      [
                        { group: "Teach", modes: ["explanation", "media"] },
                        {
                          group: "Practice",
                          modes: ["practice", "reflection", "inquiry", "revision"],
                        },
                        { group: "Assess", modes: ["assessment", "assignment"] },
                      ] as const
                    ).map(({ group, modes }) => (
                      <div key={group}>
                        <div className="px-3 pb-0.5 pt-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                          {group}
                        </div>
                        {MODE_META.filter((meta) =>
                          (modes as readonly string[]).includes(meta.mode),
                        ).map((meta) => (
                          <button
                            key={meta.mode}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setAddStepOpen(false);
                              onUpsertStep(defaultStepForMode(meta.mode));
                            }}
                            style={modeAccentStyle(meta.mode)}
                            className="mode-chip flex w-full items-center gap-1.5 rounded-control px-3 py-1.5 text-left text-meta text-foreground transition-colors hover:bg-muted"
                          >
                            {stepKindConfig(meta.kind).icon}
                            {meta.label}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
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

            <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-depth-card/95 px-4 py-2.5 backdrop-blur sm:-mx-5 sm:px-5">
              <span className="text-meta text-muted-foreground">
                {dirtyIds.size
                  ? `${dirtyIds.size} unsaved change${dirtyIds.size === 1 ? "" : "s"}`
                  : "All changes saved"}
              </span>
              <button
                type="button"
                onClick={saveAll}
                disabled={busy || !dirtyIds.size}
                className="btn btn-primary btn-sm"
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.7} />
                Save changes
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function LessonMetaForm({
  lesson,
  milestone,
  busy,
  onSave,
  onDirtyState,
  onUnregister,
}: {
  lesson: Lesson;
  milestone: CurriculumAuthoringData["milestones"][number] | null;
  busy: boolean;
  onSave: (meta: CurriculumLessonMetaInput, milestone: CurriculumMilestoneInput) => void;
  // R60b: the lesson's single save bar — this form registers as "meta".
  onDirtyState: (id: string, dirty: boolean, flush: () => void) => void;
  onUnregister: (id: string) => void;
}) {
  const initialType = parseLessonKind(lesson.curriculum_metadata?.lesson_type) || "discussion";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [touched, setTouched] = useState(false);
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
    setTouched(true);
    setAllowedModes((current) => {
      const next = current.includes(mode)
        ? current.filter((item) => item !== mode)
        : [...current, mode];
      return next.length ? next : ["text"];
    });
  };

  // Any field edit marks the form dirty; the wrapper keeps the field setters as-is.
  const touch =
    <A,>(set: (value: A) => void) =>
    (value: A) => {
      set(value);
      setTouched(true);
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
    setTouched(false);
  };
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = save;
  useEffect(() => {
    onDirtyState("meta", touched, () => flushRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched]);
  useEffect(() => () => onUnregister("meta"), [onUnregister]);

  return (
    <section className="rounded-card border border-border bg-depth-sub p-4">
      <div className="mb-3 flex items-center gap-2 text-title font-medium text-foreground">
        <NotebookPen className="h-4 w-4" strokeWidth={1.7} />
        Lesson basics
      </div>
      <div className="grid gap-3">
        {/* R60b: two fields carry a lesson — title and objective. Everything else is a
            default a lazy teacher never has to see, folded under Advanced settings. */}
        {/* R76: every field a teacher writes into can hand them a draft. The assist
            never saves — it fills the box, and the teacher's own Save is still the only
            thing that commits, so a draft can always be edited away or ignored. */}
        <div className="grid gap-1">
          <TextInput label="Lesson title" value={title} onChange={touch(setTitle)} />
          <div className="justify-self-start">
            <DraftFieldButton
              field="lesson_title"
              current={title}
              lessonId={lesson.id}
              disabled={busy}
              onDraft={(text) => touch(setTitle)(text)}
            />
          </div>
        </div>
        <div className="grid gap-1">
          <TextArea label="Lesson objective" value={objective} onChange={touch(setObjective)} />
          <div className="justify-self-start">
            <DraftFieldButton
              field="lesson_objective"
              current={objective}
              lessonId={lesson.id}
              disabled={busy}
              onDraft={(text) => touch(setObjective)(text)}
            />
          </div>
        </div>
        <Collapsible
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((value) => !value)}
          title={<span className="text-body font-medium text-foreground">Advanced settings</span>}
          meta={
            <span className="shrink-0 text-meta text-muted-foreground">
              level · type · mentor prompt · tutor behavior
            </span>
          }
          headerClassName="rounded-control px-1.5 py-2 transition-colors hover:bg-muted/60"
          bodyClassName="pt-2"
        >
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Level" value={level} onChange={touch(setLevel)} />
              <SelectInput
                label="Lesson type"
                value={lessonType}
                options={["discussion", "code", "reflection", "multiple_choice", "file"]}
                onChange={touch((value: string) => setLessonType(value as LessonKind))}
              />
            </div>
            <div className="grid gap-1">
              <TextArea
                label="Mentor prompt"
                value={tutorPrompt}
                onChange={touch(setTutorPrompt)}
              />
              <div className="justify-self-start">
                <DraftFieldButton
                  field="tutor_prompt"
                  current={tutorPrompt}
                  lessonId={lesson.id}
                  disabled={busy}
                  onDraft={(text) => touch(setTutorPrompt)(text)}
                />
              </div>
            </div>
            <TextInput
              label="Skill keys (comma separated)"
              value={skillKeys}
              onChange={touch(setSkillKeys)}
            />
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
                  Govern how much help the mentor may give and whether it must see an attempt first.
                  The student's chosen mode can ask for help only up to the ceiling.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectInput
                  label="Help ceiling"
                  value={helpCeiling}
                  options={["clarify", "hints", "guided", "worked_example", "feedback", "study"]}
                  onChange={touch(setHelpCeiling)}
                />
                <SelectInput
                  label="Final answer"
                  value={finalAnswerPolicy}
                  options={["never", "after_attempt", "allowed"]}
                  onChange={touch(setFinalAnswerPolicy)}
                />
                <SelectInput
                  label="Grade band"
                  value={gradeBand || "auto"}
                  options={["auto", "lower", "middle", "upper"]}
                  onChange={touch((value: string) => setGradeBand(value === "auto" ? "" : value))}
                />
                <SelectInput
                  label="Default tone"
                  value={tutorTone || "default"}
                  options={["default", "encouraging", "neutral", "direct"]}
                  onChange={touch((value: string) =>
                    setTutorTone(value === "default" ? "" : value),
                  )}
                />
                <SelectInput
                  label="Default pace"
                  value={tutorPace || "default"}
                  options={["default", "brief", "balanced", "guided"]}
                  onChange={touch((value: string) =>
                    setTutorPace(value === "default" ? "" : value),
                  )}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setTouched(true);
                  setRequireAttemptFirst((current) => !current);
                }}
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
                  onClick={() => {
                    setTouched(true);
                    setAllowLiveArtifacts((current) => !current);
                  }}
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
                  Lets the mentor offer to build a one-off interactive activity for a struggling
                  student — private to that student until you share it.
                </p>
              </div>
            </div>
          </div>
        </Collapsible>
      </div>
    </section>
  );
}

// R74: what work exists on THIS lesson, and the one place to make more of it.
// Rows link to the grading view; the buttons name their target so a teacher never has
// to re-answer "which lesson?" in the dialog that follows.
export function LessonClasswork({
  lessonId,
  items,
  onOpenItem,
  onCreate,
}: {
  lessonId: string;
  items: ClassworkItem[];
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreate?: (kind: "assignment" | "assessment", lessonId: string) => void;
}) {
  return (
    <section className="rounded-card border border-border bg-depth-sub p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Classwork on this lesson
        </div>
        {onCreate ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onCreate("assignment", lessonId)}
              className="btn btn-secondary btn-sm"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Assignment
            </button>
            <button
              type="button"
              onClick={() => onCreate("assessment", lessonId)}
              className="btn btn-secondary btn-sm"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Quiz
            </button>
          </div>
        ) : null}
      </div>
      {items.length ? (
        <div className="grid gap-1.5">
          {items.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => onOpenItem?.(item.kind, item.id)}
              className="flex items-center gap-2 rounded-control border border-border bg-depth-card px-3 py-2 text-left transition-colors hover:border-primary"
            >
              <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                {item.title}
              </span>
              {item.activityId ? (
                <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                  on a step
                </span>
              ) : null}
              {item.needsReviewCount ? (
                <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-overline uppercase tracking-[0.06em] text-warning">
                  {item.needsReviewCount} to mark
                </span>
              ) : null}
              <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                {item.status}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-meta text-muted-foreground">
          Nothing set on this lesson yet.
        </p>
      )}
    </section>
  );
}

export function LessonPreview({
  lesson,
  milestone,
  steps,
  quizFor,
  bookPages,
}: {
  lesson: Lesson;
  milestone: CurriculumAuthoringData["milestones"][number] | null;
  steps: LessonActivity[];
  quizFor: (activityId: string) => CurriculumAuthoringData["quizzes"][number] | null;
  bookPages: Map<string, { first: number; last: number }>;
}) {
  return (
    <div className="grid gap-4">
      <div className="mb-1 flex items-center gap-2 text-title font-medium text-foreground">
        <Eye className="h-4 w-4" strokeWidth={1.7} />
        Student walkthrough
      </div>
      <div>
        <h2 className="font-serif text-display leading-tight text-foreground">{lesson.title}</h2>
        {/* R73: name the book and pages this lesson was built from. The whole product
            claim is that this is THEIR book taught one-on-one — a teacher has to be
            able to see it, and check it against their own copy. */}
        {bookSourceLabel(bookSourceFor(lesson, bookPages, lesson.id)) ? (
          <p className="mt-1 flex items-center gap-1.5 text-meta text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            {bookSourceLabel(bookSourceFor(lesson, bookPages, lesson.id))}
          </p>
        ) : null}
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
