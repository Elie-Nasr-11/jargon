/**
 * The lesson as a student meets it.
 *
 * A read, not an editor: the title, the book pages it follows, the objective,
 * and every step in order with its prompt and answers. It exists so a teacher
 * can check what they built without pretending to be a student.
 */
import { BookOpen, Eye } from "lucide-react";
import { bookSourceFor, bookSourceLabel } from "@/features/teacher/bookSource";
import {
  kindOfActivity,
  modeAccentStyle,
  stepKindConfig,
} from "@/features/teacher/authoring/stepModel";
import type { CurriculumAuthoringData, Lesson, LessonActivity } from "@/lib/types";

export function LessonPreview({
  lesson,
  milestone,
  steps,
  quizFor,
  bookPages,
}: {
  lesson: Lesson;
  milestone: CurriculumAuthoringData["milestones"][number] | null;
  steps: LessonActivity[];
  quizFor: (activityId: string) => CurriculumAuthoringData["quizzes"][number] | null;
  bookPages: Map<string, { first: number; last: number }>;
}) {
  return (
    <div className="grid gap-4">
      <div className="mb-1 flex items-center gap-2 text-title font-medium text-foreground">
        <Eye className="h-4 w-4" strokeWidth={1.7} />
        Student walkthrough
      </div>
      <div>
        <h2 className="font-serif text-display leading-tight text-foreground">{lesson.title}</h2>
        {/* R73: name the book and pages this lesson was built from. The whole product
            claim is that this is THEIR book taught one-on-one — a teacher has to be
            able to see it, and check it against their own copy. */}
        {bookSourceLabel(bookSourceFor(lesson, bookPages, lesson.id)) ? (
          <p className="mt-1 flex items-center gap-1.5 text-meta text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            {bookSourceLabel(bookSourceFor(lesson, bookPages, lesson.id))}
          </p>
        ) : null}
        <p className="mt-2 text-body leading-relaxed text-muted-foreground">
          {milestone?.objective || "Add a lesson objective to preview the target."}
        </p>
      </div>
      {steps.length === 0 ? (
        <div className="rounded-card border border-border bg-depth-sub p-4 text-meta text-muted-foreground">
          No steps yet.
        </div>
      ) : (
        steps.map((activity, index) => {
          const kind = kindOfActivity(activity);
          const config = stepKindConfig(kind);
          const quiz = quizFor(activity.id);
          return (
            <div
              key={activity.id}
              style={modeAccentStyle(activity.mode)}
              className="mode-edge rounded-card border border-border bg-depth-sub p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-overline">
                  {index + 1}
                </span>
                {config.label}
              </div>
              <div className="text-body-lg font-medium text-foreground">{activity.title}</div>
              <p className="mt-1 whitespace-pre-wrap text-meta leading-relaxed text-muted-foreground">
                {activity.prompt}
              </p>
              {kind === "checkpoint" && quiz?.choices?.length ? (
                <div className="mt-3 grid gap-1.5">
                  {quiz.choices.map((choice) => (
                    <div
                      key={choice.id}
                      className={`rounded-control border px-3 py-2 text-meta ${
                        quiz.correct_choice_ids?.includes(choice.id)
                          ? "border-success/35 text-success"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {choice.id}. {choice.text}
                    </div>
                  ))}
                </div>
              ) : null}
              {kind === "practice" && activity.response_mode === "code" && activity.starter_code ? (
                <pre className="mt-3 overflow-auto rounded-control border border-border bg-depth-field p-3 text-meta text-foreground">
                  {activity.starter_code}
                </pre>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
