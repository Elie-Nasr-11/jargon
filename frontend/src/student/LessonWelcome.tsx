import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { fetchLessonObjectives, fetchLessonResources } from "@/lib/api";
import type { LessonObjectives } from "@/lib/api";
import { ResourceCard } from "@/student/ResourceCard";
import type { Lesson, LessonChatResource } from "@/lib/types";

// The blank lesson-open surface (no mentor pretext): a fresh lesson shows its identity, what
// the teacher says the student will learn, and the published materials. The suggested first
// moves live with the composer (SuggestionRows in suggestions.tsx). The student's first act
// starts the conversation; the mentor never speaks first.
//
// R30 (tester feedback #3): the "what you'll learn" framing used to be whatever the mentor
// improvised on turn one. It now comes from the TEACHER-APPROVED milestone objective and its
// expected_evidence.student_can list — the same rows the studio authors and the grader marks
// against, so what a student is promised, what is taught, and what is assessed cannot drift.

export type LessonWelcomeProps = {
  lesson: Lesson;
};

export function LessonWelcome({ lesson }: LessonWelcomeProps) {
  const [resources, setResources] = useState<LessonChatResource[]>([]);
  const [objectives, setObjectives] = useState<LessonObjectives | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResources([]);
    setObjectives(null);
    void fetchLessonResources(lesson.id)
      .then((rows) => !cancelled && setResources(rows))
      .catch(() => {
        // Materials are a bonus on this surface — a failed read never blocks the welcome.
      });
    void fetchLessonObjectives(lesson.id)
      .then((row) => !cancelled && setObjectives(row))
      .catch(() => {
        // Same: a lesson with no authored milestone simply shows no objectives block.
      });
    return () => {
      cancelled = true;
    };
  }, [lesson.id]);

  // Prefer the itemised student_can list (concrete and checkable); fall back to the
  // objective sentence when a teacher wrote only that.
  const learnItems = objectives?.student_can.length
    ? objectives.student_can
    : objectives?.objective
      ? [objectives.objective]
      : [];

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

      {learnItems.length ? (
        <section
          aria-label="What you'll learn"
          className="rounded-card border border-border bg-depth-sub px-4 py-3"
        >
          <div className="mb-2 flex items-center gap-2 font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
            <Target className="h-3.5 w-3.5" strokeWidth={1.8} />
            What you&rsquo;ll learn
          </div>
          <ul className="ml-1 list-none space-y-1.5 border-l-2 border-border pl-4">
            {learnItems.map((item, i) => (
              <li key={i} className="text-body text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
