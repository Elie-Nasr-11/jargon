import { Check } from "lucide-react";
import type { LessonActivity, LessonArc } from "@/lib/types";

// The step-by-step milestone list for the current lesson (done / current / upcoming). Enriched per
// step from the lesson's activities: a stage/type chip and a one-line description, so every milestone
// shows what it actually is. Rendered as the content of
// the hovering LessonProgress pill's dropdown.

const ACCENT = "text-[color:var(--accent-text)]";

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
}: {
  arc: LessonArc;
  activities?: LessonActivity[];
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

  const steps: { step: number; title: string; state: "done" | "current" | "upcoming" }[] = [
    ...arc.completed.map((s) => ({ ...s, state: "done" as const })),
    ...(arc.current
      ? [{ step: arc.step, title: arc.current.title, state: "current" as const }]
      : []),
    ...arc.upcoming.map((s) => ({ ...s, state: "upcoming" as const })),
  ];
  return (
    <div className="mt-1">
      <div className="mb-2 flex items-center gap-1" aria-hidden>
        {Array.from({ length: arc.total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i < arc.step - 1
                ? "bg-foreground/35"
                : i === arc.step - 1
                  ? "bg-foreground"
                  : "bg-border"
            }`}
          />
        ))}
      </div>
      <div className="mb-3 text-[11.5px] text-foreground">
        Step {arc.step} of {arc.total}
      </div>
      <ol className="space-y-1.5">
        {steps.map((s) => {
          const activity = activityForStep(s.step, s.title);
          const kind = stepKind(activity);
          // Show the current step's live prompt from the arc; otherwise the activity's prompt.
          const desc =
            s.state === "current" && arc.current?.prompt
              ? arc.current.prompt
              : activity?.prompt || "";
          return (
            <li key={s.step} className="flex items-start gap-2.5 text-[13px]">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                  s.state === "done"
                    ? "bg-success/15 text-success"
                    : s.state === "current"
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground"
                }`}
              >
                {s.state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : s.step}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 text-foreground ${
                      s.state === "current" ? "font-medium" : ""
                    }`}
                  >
                    {s.title}
                  </span>
                  {kind ? <span className={`shrink-0 text-[10px] ${ACCENT}`}>{kind}</span> : null}
                </span>
                {desc ? (
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-foreground/70">
                    {clampOneLine(desc)}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
