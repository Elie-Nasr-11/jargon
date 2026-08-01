import { useEffect, useState } from "react";
import { fetchLessonResources } from "@/lib/api";
import { ResourceCard } from "@/student/ResourceCard";
import type { Lesson, LessonChatResource } from "@/lib/types";

// The blank lesson-open surface (no mentor pretext): a fresh lesson shows nothing but the
// lesson's identity and its published materials. The suggested first moves live with the
// composer (SuggestionRows in suggestions.tsx) — this surface stays a quiet title card.
// The student's first act (a suggestion tap or a typed message) starts the conversation;
// the mentor never speaks first.

export type LessonWelcomeProps = {
  lesson: Lesson;
};

export function LessonWelcome({ lesson }: LessonWelcomeProps) {
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
    </div>
  );
}
