import { ArrowUpRight } from "lucide-react";
import type { Lesson, LessonActivity } from "@/lib/types";
import { turnModeSpec, type TurnMode } from "@/student/turnModes";

// Suggested first moves for a never-opened lesson — the ChatGPT/Claude new-chat pattern.
// Derived client-side from the lesson + its authored steps (fetchLessonActivities already
// rides the open round-trip): no server call, no new contract. The tapped suggestion becomes
// the student's first turn and sets its TurnMode.

export type Suggestion = { prompt: string; mode: TurnMode; label: string };

export function buildSuggestions(lesson: Lesson, activities: LessonActivity[]): Suggestion[] {
  const firstStep = activities[0]?.title?.trim();
  const hasQuiz = activities.some(
    (a) => a.activity_type === "multiple_choice" || a.mode === "assessment",
  );
  return [
    {
      mode: "lesson",
      label: "Start the lesson",
      prompt: firstStep
        ? `Let's start the lesson — walk me through "${firstStep}".`
        : `Let's start the lesson from the beginning.`,
    },
    {
      mode: "discuss",
      label: "Big picture first",
      prompt: `Before we start, give me the big picture — what will I learn in "${lesson.title}"?`,
    },
    hasQuiz
      ? {
          mode: "quiz",
          label: "Warm-up question",
          prompt: `Give me a quick warm-up question on "${lesson.title}" to see what I already know.`,
        }
      : {
          mode: "practice",
          label: "Let me try first",
          prompt: `Let me try the first step of "${lesson.title}" myself — give me something to attempt.`,
        },
  ];
}

// Chat-flow Phase 1: re-entry moves for a conversation the student walked away from
// (last message > 30 min old). Same ghost-row furniture as the opener suggestions —
// an abandoned session deserves a way back in, not a blank composer.
export function buildReentrySuggestions(lesson: Lesson): Suggestion[] {
  return [
    {
      mode: "lesson",
      label: "Pick up",
      prompt: "Let's pick up where we left off.",
    },
    {
      mode: "discuss",
      label: "Recap",
      prompt: `Recap what we've covered so far in "${lesson.title}".`,
    },
    {
      mode: "quiz",
      label: "Check me",
      prompt: "Quiz me quickly on what we covered last time before we go on.",
    },
  ];
}

// The composer lead: ghost rows hugging the top of the chatbox. Deliberately quieter than the
// resource cards up in the welcome — no border, no fill, ink only — so materials outrank
// canned openers. Hover is one surface step; the tap IS the first turn.
export function SuggestionRows({
  lesson,
  activities,
  suggestions,
  disabled,
  onSuggest,
}: {
  lesson: Lesson;
  activities: LessonActivity[];
  // Optional override (re-entry rows); defaults to the never-opened-lesson openers.
  suggestions?: Suggestion[];
  disabled?: boolean;
  onSuggest: (prompt: string, mode: TurnMode) => void;
}) {
  return (
    <div className="mb-1.5 flex flex-col gap-0.5">
      {(suggestions ?? buildSuggestions(lesson, activities)).map((suggestion) => (
        <button
          key={suggestion.label}
          type="button"
          disabled={disabled}
          onClick={() => onSuggest(suggestion.prompt, suggestion.mode)}
          className="hvp flex items-center gap-2.5 rounded-control px-3 py-1.5 text-left transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-40"
        >
          {/* Each label wears its mode's hue (the same 60% foreground mix the off-tag mode
              text uses everywhere) — the tap sets that TurnMode, so the color is a preview. */}
          <span
            className="shrink-0 font-mono text-overline uppercase tracking-[0.14em]"
            style={{
              color: `color-mix(in oklab, var(${turnModeSpec(suggestion.mode).accentVar}) 60%, var(--foreground))`,
            }}
          >
            {suggestion.label}
          </span>
          <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">
            {suggestion.prompt}
          </span>
          <ArrowUpRight
            className="hvr h-3.5 w-3.5 shrink-0 text-muted-foreground"
            strokeWidth={1.7}
          />
        </button>
      ))}
    </div>
  );
}
