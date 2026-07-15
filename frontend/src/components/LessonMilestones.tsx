import { Check, Undo2 } from "lucide-react";
import type { LessonActivity, LessonArc } from "@/lib/types";

// The step-by-step milestone list for the current lesson (done / current / upcoming), enriched per
// step from the lesson's activities with a stage/type chip and a one-line description so every
// milestone shows what it actually is. Rendered inside the roadmap popover opened from the chat
// progress strip. Flow v3: completed steps are clickable — tapping one posts a navigate control
// turn that revisits it (the server validates the target against its own completion history).

const STAGE_LABELS: Record<string, string> = {
  intro: "Warm-up",
  teach: "Teach",
  practice: "Practice",
  assessment: "Checkpoint",
  review: "Review",
  complete: "Wrap-up",
};
const TYPE_LABELS: Record<string, string> = {
  discussion: "Discuss",
  code: "Code",
  multiple_choice: "Quiz",
  reflection: "Reflect",
  file: "Upload",
};
function stepKind(activity?: LessonActivity): string | null {
  if (!activity) return null;
  return STAGE_LABELS[activity.stage] || TYPE_LABELS[activity.activity_type] || null;
}
function clampOneLine(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function LessonMilestones({
  arc,
  activities = [],
  onNavigate,
  navigateDisabled = false,
}: {
  arc: LessonArc;
  activities?: LessonActivity[];
  // Flow v3: revisit a completed step. Absent = the stepper is display-only.
  onNavigate?: (activityId: string) => void;
  navigateDisabled?: boolean;
}) {
  const sorted = [...activities].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  // Match an arc step to its activity: prefer a unique title match, else fall back to position index
  // (deriveLessonArc and the backend both number steps in position order).
  const titleCounts = new Map<string, number>();
  for (const a of sorted) titleCounts.set(a.title, (titleCounts.get(a.title) ?? 0) + 1);
  const activityForStep = (step: number, title: string): LessonActivity | undefined => {
    if (title && titleCounts.get(title) === 1) {
      const byTitle = sorted.find((a) => a.title === title);
      if (byTitle) return byTitle;
    }
    return sorted[step - 1];
  };

  const steps: {
    step: number;
    title: string;
    state: "done" | "current" | "upcoming";
    activity_id?: string;
  }[] = [
    ...arc.completed.map((s) => ({ ...s, state: "done" as const })),
    ...(arc.current
      ? [{ step: arc.step, title: arc.current.title, state: "current" as const }]
      : []),
    ...arc.upcoming.map((s) => ({ ...s, state: "upcoming" as const })),
  ];
  // The authoritative clickable set: the server's steps_done when present (during a
  // revisit, completed steps sit AFTER the cursor, so arc state alone under-reports),
  // else the cursor-derived "done" state.
  const doneIds = arc.steps_done ? new Set(arc.steps_done) : null;
  return (
    <div>
      <div className="mb-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Step {arc.step} of {arc.total}
      </div>
      <ol className="space-y-1">
        {steps.map((s) => {
          const activity = activityForStep(s.step, s.title);
          const kind = stepKind(activity);
          const activityId = s.activity_id || activity?.id;
          const completed = doneIds
            ? Boolean(activityId && doneIds.has(activityId))
            : s.state === "done";
          const clickable = Boolean(onNavigate && activityId && completed && s.state !== "current");
          // Show the current step's live prompt from the arc; otherwise the activity's prompt.
          const desc =
            s.state === "current" && arc.current?.prompt
              ? arc.current.prompt
              : activity?.prompt || "";
          const body = (
            <>
              <span
                className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-meta font-medium tabular-nums ${
                  completed
                    ? "bg-success/15 text-success"
                    : s.state === "current"
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground"
                }`}
              >
                {completed ? <Check className="h-3 w-3" strokeWidth={3} /> : s.step}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 ${
                      s.state === "current"
                        ? "font-medium text-foreground"
                        : completed
                          ? "text-muted-foreground"
                          : "text-foreground"
                    }`}
                  >
                    {s.title}
                  </span>
                  {clickable ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-overline uppercase tracking-[0.06em] text-muted-foreground opacity-0 transition-opacity duration-(--dur-fast) group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Undo2 className="h-3 w-3" strokeWidth={2} />
                      Revisit
                    </span>
                  ) : kind ? (
                    <span className="shrink-0 text-overline uppercase tracking-[0.06em] text-muted-foreground">
                      {kind}
                    </span>
                  ) : null}
                </span>
                {desc ? (
                  <span className="mt-0.5 block text-meta leading-snug text-muted-foreground">
                    {clampOneLine(desc)}
                  </span>
                ) : null}
              </span>
            </>
          );
          return (
            <li key={s.step} className="text-body">
              {clickable ? (
                <button
                  type="button"
                  disabled={navigateDisabled}
                  onClick={() => activityId && onNavigate?.(activityId)}
                  className="group flex w-full items-start gap-2.5 rounded-control px-1 py-1 text-left transition-colors duration-(--dur-fast) hover:bg-surface-hover disabled:opacity-50"
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2.5 rounded-control px-1 py-1">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
