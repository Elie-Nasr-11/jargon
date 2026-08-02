import type { LessonArc, LessonArcStep } from "@/lib/types";

// Chat-flow Phase 1: the lesson's visible, TAPPABLE spine — the progress bar the server's
// own copy has been promising ("the completed steps in the progress bar at the top are
// clickable"). One row above the transcript: a done-count label plus one chip per step.
// Done chips (in the server's steps_done ledger) tap to revisit via the existing navigate
// control turn; the current step wears the accent; upcoming steps are hollow and inert.
//
// Honesty per the v5.0 decision: the label counts DISCHARGED steps (the requirement
// ledger), not the cursor — a student who discussed for an hour sees the same count as
// when they started, because discussion discharges nothing.

function orderedSteps(arc: LessonArc): (LessonArcStep & { isCurrent?: boolean })[] {
  const steps: (LessonArcStep & { isCurrent?: boolean })[] = [
    ...arc.completed,
    ...(arc.current ? [{ step: arc.step, title: arc.current.title, isCurrent: true }] : []),
    ...arc.upcoming,
  ];
  return steps.sort((a, b) => a.step - b.step);
}

export function LessonSpine({
  arc,
  busy,
  onNavigate,
}: {
  arc: LessonArc;
  busy?: boolean;
  onNavigate: (activityId: string) => void;
}) {
  // Single-step lessons have no spine to show (same rule as the section eyebrow).
  if (!arc.total || arc.total <= 1) return null;
  const doneIds = new Set(
    arc.steps_done ?? arc.completed.map((s) => s.activity_id).filter(Boolean),
  );
  const steps = orderedSteps(arc);
  const doneCount = steps.filter((s) => s.activity_id && doneIds.has(s.activity_id)).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2">
      <span className="mr-1 font-mono text-overline uppercase tracking-[0.14em] text-muted-foreground">
        {doneCount}/{arc.total} done
      </span>
      {steps.map((step) => {
        const done = Boolean(step.activity_id && doneIds.has(step.activity_id));
        const revisitable = done && !step.isCurrent && Boolean(step.activity_id);
        const label = step.isCurrent
          ? `Step ${step.step}: ${step.title} — current`
          : done
            ? `Revisit step ${step.step}: ${step.title}`
            : `Step ${step.step}: ${step.title} — not reached yet`;
        return (
          <button
            key={step.step}
            type="button"
            title={label}
            aria-label={label}
            disabled={!revisitable || busy}
            onClick={() => revisitable && step.activity_id && onNavigate(step.activity_id)}
            className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] tabular-nums transition-colors duration-(--dur-fast) ${
              step.isCurrent
                ? "border-transparent bg-[color-mix(in_oklab,var(--mode-lesson)_24%,var(--background))] font-bold text-foreground"
                : done
                  ? "cursor-pointer border-border bg-muted text-foreground hover:border-foreground/40 disabled:cursor-default disabled:opacity-60"
                  : "border-border text-muted-foreground opacity-60"
            }`}
          >
            {step.step}
          </button>
        );
      })}
    </div>
  );
}
