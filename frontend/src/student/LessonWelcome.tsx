import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { fetchLessonResources } from "@/lib/api";
import { ResourceCard } from "@/student/ResourceCard";
import type { Lesson, LessonActivity, LessonChatResource } from "@/lib/types";
import type { TurnMode } from "@/student/turnModes";

// The blank lesson-open surface (no mentor pretext): a fresh lesson shows nothing but the
// lesson's identity, its published materials, and three suggested prompts — the
// ChatGPT/Claude new-chat pattern. The student's first act (a suggestion tap or a typed
// message) is what starts the conversation; the mentor never speaks first.
//
// Suggestions derive client-side from the lesson + its authored steps (fetchLessonActivities
// already rides the open round-trip) — no server call, no new contract.

export type LessonWelcomeProps = {
  lesson: Lesson;
  activities: LessonActivity[];
  disabled?: boolean;
  onSuggest: (prompt: string, mode: TurnMode) => void;
};

type Suggestion = { prompt: string; mode: TurnMode; label: string };

function buildSuggestions(lesson: Lesson, activities: LessonActivity[]): Suggestion[] {
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

export function LessonWelcome({ lesson, activities, disabled, onSuggest }: LessonWelcomeProps) {
  const [resources, setResources] = useState<LessonChatResource[]>([]);

  useEffect(() => {
    let cancelled = false;
    setResources([]);
    void fetchLessonResources(lesson.id)
      .then((rows) => !cancelled && setResources(rows))
      .catch(() => {
        // Materials are a bonus on this surface — a failed read never blocks the welcome.
      });
    return () => {
      cancelled = true;
    };
  }, [lesson.id]);

  const suggestions = buildSuggestions(lesson, activities);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col justify-center gap-6 px-4 py-10">
      <header className="text-center">
        {lesson.unit_title ? (
          <div className="mb-2 font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
            {lesson.unit_title}
          </div>
        ) : null}
        <h1
          className="text-[22px] font-bold leading-snug tracking-[-0.015em]"
          style={{ color: "var(--ink-62)" }}
        >
          {lesson.title}
        </h1>
      </header>

      {resources.length ? (
        <div className="flex flex-col gap-2">
          {resources.slice(0, 3).map((resource) => (
            <ResourceCard key={resource.id} resource={resource} lessonId={lesson.id} />
          ))}
        </div>
      ) : null}

      {/* Three ways in. Ghost rows; hover = one surface step; the tap IS the first turn. */}
      <div className="flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            disabled={disabled}
            onClick={() => onSuggest(suggestion.prompt, suggestion.mode)}
            className="hvp flex items-center gap-3 rounded-control border border-border bg-depth-card px-4 py-3 text-left transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-40"
            style={{ boxShadow: "var(--inset-highlight)" }}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-meta font-semibold text-muted-foreground">
                {suggestion.label}
              </span>
              <span className="block truncate text-body text-foreground">{suggestion.prompt}</span>
            </span>
            <ArrowUpRight
              className="hvr h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.7}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
