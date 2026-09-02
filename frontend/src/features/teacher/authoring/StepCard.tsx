/**
 * One step, open for editing.
 *
 * A step is the unit of a lesson the student actually meets: what the mentor
 * says, what the student does, and what counts as done. The card carries the
 * step's own fields, its attached material, and - when the step IS a piece of
 * classwork - the link to that assignment or quiz.
 */
import { useEffect, useRef, useState } from "react";
import { Collapsible } from "@/components/Collapsible";
import { SelectInput, TextArea, TextInput } from "@/features/teacher/authoring/fields";
import { ArtifactGeneratePanel } from "@/features/teacher/authoring/generatePanels";
import {
  MODE_META,
  kindOfActivity,
  modeAccentStyle,
  modeMeta,
  pinnedShapeFor,
  stepKindConfig,
} from "@/features/teacher/authoring/stepModel";
import type {
  ArtifactApprovePayload,
  ArtifactGenArgs,
  ClassworkItem,
  ResponseMode,
} from "@/features/teacher/authoring/types";
import type {
  CurriculumAdminResponse,
  CurriculumAuthoringData,
  CurriculumStepInput,
  LearningMode,
  Lesson,
  LessonActivity,
  LessonResource,
} from "@/lib/types";
import {
  ChevronRight,
  GripVertical,
  ListChecks,
  Paperclip,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

export function StepCard({
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
  onDirtyState,
  onUnregister,
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
  // R60b: the lesson's single save bar — each card registers under its activity id.
  onDirtyState: (id: string, dirty: boolean, flush: () => void) => void;
  onUnregister: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [touched, setTouched] = useState(false);
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

  const touch =
    <A,>(set: (value: A) => void) =>
    (value: A) => {
      set(value);
      setTouched(true);
    };

  const updateChoice = (i: number, patch: Partial<{ id: string; text: string }>) => {
    setTouched(true);
    setChoices((current) =>
      current.map((choice, idx) => (idx === i ? { ...choice, ...patch } : choice)),
    );
  };

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
  // R74: book-imported material is stamped with the book's key by the importer; anything
  // a teacher attached by hand has no key and outranks it.
  const resourceTier = (resource: LessonResource): "lesson" | "book" =>
    String((resource.metadata as { import_key?: unknown } | null)?.import_key || "")
      ? "book"
      : "lesson";
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
    setTouched(false);
  };
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = save;
  useEffect(() => {
    onDirtyState(activity.id, touched, () => flushRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched, activity.id]);
  // Covers unmount AND the temp-id → server-id swap (the old id must not linger dirty).
  useEffect(() => () => onUnregister(activity.id), [activity.id, onUnregister]);

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
          <TextInput label="Step title" value={title} onChange={touch(setTitle)} />
          <TextArea label={config.promptLabel} value={prompt} onChange={touch(setPrompt)} />

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
                    onClick={() => touch(setCorrectId)(choice.id)}
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
                onClick={() => {
                  setTouched(true);
                  setChoices((current) => [
                    ...current,
                    { id: String.fromCharCode(97 + current.length), text: "" },
                  ]);
                }}
                className="justify-self-start text-meta text-muted-foreground hover:text-foreground"
              >
                + Add choice
              </button>
            </div>
          ) : null}

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
                      Open in Activity
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

          {/* R60b: everything below is machinery most lessons never need — folded away so
              a step reads as title + prompt (+ choices). The R48 strip above stays out,
              because linked work is the step's contract, not a setting. */}
          <Collapsible
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((value) => !value)}
            title={<span className="text-body font-medium text-foreground">Advanced</span>}
            meta={
              <span className="shrink-0 text-meta text-muted-foreground">
                mode · materials · activities
              </span>
            }
            headerClassName="rounded-control px-1.5 py-2 transition-colors hover:bg-muted/60"
            bodyClassName="grid gap-3 pt-2"
          >
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
                setTouched(true);
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
                onChange={touch(setStepModeType)}
              />
            ) : null}

            {stepMode === "assessment" ? (
              <SelectInput
                label="Assessment type"
                value={stepModeType || "mcq"}
                options={["mcq", "open_ended"]}
                optionLabels={{
                  mcq: "Multiple choice",
                  open_ended: "Open-ended (graded, no hints)",
                }}
                onChange={touch(setStepModeType)}
              />
            ) : null}

            {stepMode === "legacy" && kind === "practice" ? (
              <SelectInput
                label="Answer mode"
                value={practiceMode}
                options={["text", "code"]}
                onChange={touch((value: string) => setPracticeMode(value as ResponseMode))}
              />
            ) : null}

            {showCodeFields ? (
              <>
                <TextArea
                  label="Starter code"
                  value={starterCode}
                  onChange={touch(setStarterCode)}
                />
                <TextArea
                  label="Expected output"
                  value={expectedOutput}
                  onChange={touch(setExpectedOutput)}
                />
              </>
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
                    ? "No lesson materials yet — add them under Materials on this lesson, then attach them here."
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
                  {/* R74: RANKED, not piled. The book import staples the whole chapter PDF
                      and every page image to each lesson, so in production this list ran to
                      ~19 entries per lesson with nothing saying which mattered. Nothing is
                      re-parented — what a teacher chose is simply listed before what the
                      book happened to contain. */}
                  {[
                    { key: "lesson", label: "Lesson materials" },
                    { key: "book", label: "From the book" },
                  ].map((group) => {
                    const rows = attachable.filter(
                      (resource) => resourceTier(resource) === group.key,
                    );
                    if (!rows.length) return null;
                    return (
                      <optgroup key={group.key} label={group.label}>
                        {rows.map((resource) => (
                          <option key={resource.id} value={resource.id}>
                            {resource.title}
                            {resource.status !== "published" ? " (draft)" : ""}
                            {resource.activity_id ? " — attached to another step" : ""}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              ) : null}
            </div>

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

            <div>
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
          </Collapsible>
        </div>
      ) : null}
    </div>
  );
}
