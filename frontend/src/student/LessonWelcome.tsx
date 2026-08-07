import { useEffect, useState } from "react";
import { fetchLessonResources } from "@/lib/api";
import { ResourceCard } from "@/student/ResourceCard";
import type { Lesson, LessonChatResource } from "@/lib/types";

// The blank lesson-open surface (no mentor pretext): a fresh lesson shows its identity and
// the published materials. The suggested first moves live with the composer (SuggestionRows
// in suggestions.tsx). The student's first act starts the conversation; the mentor never
// speaks first.
//
// R32 (owner): the "What you'll learn" panel is gone from this screen. R30 built it from the
// teacher-approved milestone objective so the promise could not drift from what is taught and
// assessed — that reasoning still holds, but handing a student the objectives up front
// front-loads the answers to work they have not done yet.
//
// The milestone objective itself keeps working: the server reads milestone.objective into
// the grader's context, so what a step is marked against is unchanged. The client-side
// fetchLessonObjectives helper went with the panel — it had no other caller, and a corpse
// left in api.ts reads like a live contract to whoever finds it next.
//
// WORTH KNOWING: expected_evidence.student_can was ONLY ever read here. Teachers still
// author it in the studio, but with this panel gone nothing at runtime consumes it. Either
// give it a job or retire the field — do not assume it is still doing one.

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
          <div className="font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
            Start with the material
          </div>
          {resources.slice(0, 3).map((resource) => (
            <ResourceCard key={resource.id} resource={resource} lessonId={lesson.id} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
