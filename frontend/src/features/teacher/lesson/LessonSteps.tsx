/**
 * Section 2 of 4: the steps. Eighty per cent of the screen, by design.
 *
 * A lesson IS its steps — everything else on this page describes them. They are
 * ordered, dragged, and edited in place, and adding one names what kind of beat
 * it is rather than asking afterwards.
 *
 * The empty state IS the drafting (rebuild brief, mechanism B). R79 got this half
 * right and left a press on it — "Draft the steps" — which is still a button asking
 * whether you want help. The brief's wording has no press in it: "Nothing here yet —
 * here are six steps drafted from pages 31–45. Keep them, or start your own." So an
 * empty steps list drafts on arrival and shows what it got. Nothing is written until
 * the teacher keeps them, and dismissing leaves an empty lesson, not a mess.
 */
import { useEffect, useRef, useState } from "react";
import { Layers3, Loader2, Plus, Sparkles } from "lucide-react";
import { StepCard } from "@/features/teacher/authoring/StepCard";
import { ReorderList, dropClass } from "@/features/teacher/authoring/dragList";
import {
  MODE_META,
  defaultStepForMode,
  modeAccentStyle,
  stepKindConfig,
} from "@/features/teacher/authoring/stepModel";
import { resourceReferenceText } from "@/features/teacher/authoring/referenceInput";
import { bookSourceFor, bookSourceLabel } from "@/features/teacher/bookSource";
import type { ClassworkItem } from "@/features/teacher/authoring/types";
import type {
  CurriculumStepDraft,
  CurriculumStepInput,
  Lesson,
  LessonActivity,
  LessonResource,
} from "@/lib/types";
import type { LessonAuthoring } from "@/features/teacher/lesson/useLessonAuthoring";

const ADD_GROUPS = [
  { group: "Teach", modes: ["explanation", "media"] },
  { group: "Practice", modes: ["practice", "reflection", "inquiry", "revision"] },
  { group: "Assess", modes: ["assessment", "assignment"] },
] as const;

/** The brief we send when the teacher accepts the offer — they write nothing. */
export function draftBriefFor(lesson: Lesson, objective: string, sourceLabel: string): string {
  const parts = [`Draft the steps for the lesson "${lesson.title || "Untitled lesson"}".`];
  if (objective.trim()) parts.push(`The objective is: ${objective.trim()}`);
  if (sourceLabel) parts.push(`It follows ${sourceLabel}.`);
  parts.push("Teach it, check understanding, then give the student something to practise.");
  return parts.join(" ");
}

export function LessonSteps({
  lesson,
  objective,
  steps,
  materials,
  workItems,
  authoring,
  busy,
  onRegisterDirty,
  onUnregisterDirty,
  onOpenItem,
  onCreateForStep,
}: {
  lesson: Lesson;
  objective: string;
  steps: LessonActivity[];
  materials: LessonResource[];
  workItems: ClassworkItem[];
  authoring: LessonAuthoring;
  busy: boolean;
  onRegisterDirty: (id: string, dirty: boolean, flush: () => void) => void;
  onUnregisterDirty: (id: string) => void;
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreateForStep?: (
    kind: "assignment" | "assessment",
    ctx: { lessonId: string; activityId: string },
  ) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [proposal, setProposal] = useState<CurriculumStepDraft[] | null>(null);
  // Dismissing the proposal must not re-draft it on the next render — the teacher
  // said no once, and an assistant that keeps re-offering is a nag.
  const [declined, setDeclined] = useState(false);
  const sourceLabel = bookSourceLabel(bookSourceFor(lesson, authoring.bookPages, lesson.id));

  const draft = async () => {
    setDrafting(true);
    const referenceText = materials
      .map((material) => resourceReferenceText(material))
      .filter(Boolean)
      .join("\n\n");
    const result = await authoring.generateSteps({
      prompt: draftBriefFor(lesson, objective, sourceLabel),
      referenceText,
    });
    if (result?.length) setProposal(result);
    setDrafting(false);
  };

  // Mechanism A/B: the steps arrive. No button was pressed and nothing was saved.
  // Guarded so it runs once per empty lesson: only when there is genuinely nothing
  // here, nothing already offered, nothing in flight, and the teacher has not said no.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (steps.length || proposal || drafting || declined || busy) return;
    // A lesson with no title AND no objective has nothing to draft FROM; proposing
    // from thin air is how an assistant produces confident nonsense.
    if (!lesson.title?.trim() && !objective.trim() && !sourceLabel) return;
    if (askedFor.current === lesson.id) return;
    askedFor.current = lesson.id;
    void draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, steps.length, proposal, drafting, declined, busy, objective, sourceLabel]);

  const addStep = (step: CurriculumStepInput) => {
    setAddOpen(false);
    authoring.upsertStep(step);
  };

  return (
    <section className="rounded-card border border-border bg-depth-card p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-title font-medium text-foreground">
          <Layers3 className="h-4 w-4" strokeWidth={1.7} />
          Steps
        </h2>
        <span className="text-meta text-muted-foreground">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
      </div>

      {steps.length === 0 && !proposal ? (
        <div className="rounded-card border border-dashed border-border px-4 py-6 text-center">
          {drafting ? (
            <>
              <p className="flex items-center justify-center gap-2 text-body text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                Drafting the steps…
              </p>
              <p className="mx-auto mt-1 max-w-[46ch] text-meta text-muted-foreground">
                {sourceLabel ? `From ${sourceLabel}.` : "From this lesson's title and objective."}
              </p>
            </>
          ) : (
            <>
              <p className="text-body text-foreground">Nothing here yet.</p>
              <p className="mx-auto mt-1 max-w-[46ch] text-meta text-muted-foreground">
                {declined
                  ? "Add the first step whenever you're ready."
                  : "Give this lesson a title or an objective and Jargon will draft the steps from it."}
              </p>
            </>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setAddOpen((value) => !value)}
              disabled={busy}
              className="btn btn-secondary btn-sm"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              Add the first step
            </button>
          </div>
        </div>
      ) : null}

      {proposal ? (
        <StepProposal
          drafts={proposal}
          busy={busy}
          onKeep={() => {
            authoring.applySteps(proposal);
            setProposal(null);
          }}
          onDiscard={() => {
            // Said no once: leave the lesson empty and do not re-offer.
            setProposal(null);
            setDeclined(true);
          }}
        />
      ) : null}

      {steps.length ? (
        <div className="grid gap-2">
          <ReorderList items={steps} disabled={busy} onReorder={authoring.reorderSteps}>
            {(activity, state) => (
              <div className={dropClass(state)}>
                <StepCard
                  activity={activity}
                  index={steps.indexOf(activity)}
                  quiz={authoring.quizFor(activity.id)}
                  busy={busy}
                  dragging={state.dragging}
                  canDelete={steps.length > 1}
                  resources={materials}
                  workItem={
                    workItems.find(
                      (item) => item.activityId === activity.id && item.kind !== "material",
                    ) ?? null
                  }
                  onBind={authoring.bindMaterial}
                  onShare={authoring.shareMaterial}
                  onOpenItem={onOpenItem}
                  onCreateForStep={onCreateForStep}
                  onGenerateArtifact={authoring.generateArtifact}
                  onApproveArtifact={authoring.approveArtifact}
                  onSave={authoring.upsertStep}
                  onDelete={() => authoring.deleteStep(activity.id)}
                  onDirtyState={onRegisterDirty}
                  onUnregister={onUnregisterDirty}
                />
              </div>
            )}
          </ReorderList>
        </div>
      ) : null}

      {/* One door, grouped by what the beat DOES — the mode vocabulary stays
          single-sourced in stepModel so this menu can never drift from it. */}
      <div className="relative mt-3">
        <button
          type="button"
          onClick={() => setAddOpen((value) => !value)}
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          className="btn btn-secondary btn-sm gap-1"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          Add a step
        </button>
        {addOpen ? (
          <div
            role="menu"
            className="absolute left-0 top-full z-20 mt-1 w-64 rounded-card border border-border bg-depth-card p-1 shadow-card"
          >
            {ADD_GROUPS.map(({ group, modes }) => (
              <div key={group}>
                <div className="px-3 pb-0.5 pt-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  {group}
                </div>
                {MODE_META.filter((meta) => (modes as readonly string[]).includes(meta.mode)).map(
                  (meta) => (
                    <button
                      key={meta.mode}
                      type="button"
                      role="menuitem"
                      onClick={() => addStep(defaultStepForMode(meta.mode))}
                      style={modeAccentStyle(meta.mode)}
                      className="mode-chip flex w-full items-center gap-1.5 rounded-control px-3 py-1.5 text-left text-meta text-foreground transition-colors hover:bg-muted"
                    >
                      {stepKindConfig(meta.kind).icon}
                      {meta.label}
                    </button>
                  ),
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** What came back, before anything is written. Keep it, or throw it away. */
function StepProposal({
  drafts,
  busy,
  onKeep,
  onDiscard,
}: {
  drafts: CurriculumStepDraft[];
  busy: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="rounded-card border border-primary/30 bg-primary/[0.04] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-body font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
          {drafts.length} proposed step{drafts.length === 1 ? "" : "s"}
        </span>
        <span className="text-meta text-muted-foreground">Nothing is saved yet</span>
      </div>
      <ol className="grid gap-1.5">
        {drafts.map((step, index) => (
          <li
            key={`${step.title}-${index}`}
            className="rounded-control border border-border bg-depth-card px-3 py-2"
          >
            <div className="text-meta font-medium text-foreground">
              {index + 1}. {step.title}
            </div>
            {step.prompt ? (
              <p className="mt-0.5 line-clamp-2 text-meta text-muted-foreground">{step.prompt}</p>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onKeep} disabled={busy} className="btn btn-primary btn-sm">
          Keep these steps
        </button>
        <button type="button" onClick={onDiscard} className="btn btn-ghost btn-sm">
          Discard
        </button>
      </div>
    </div>
  );
}
