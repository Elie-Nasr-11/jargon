/**
 * The lesson, described for the assistant, from what is on the teacher's screen.
 *
 * The server can build this itself (`lessonStepsContext` in curriculum-admin) — but it
 * reaches it through `courseScopeForLesson`, which refuses any lesson whose course has
 * no owning organization. Every course linked to a class in this product is exactly
 * that: a shared book. So a lesson-scoped draft is refused for the whole library, and
 * the assistant answered "Course organization scope was not found."
 *
 * Scoping the request to the CLASS instead is both the fix and the more correct rule —
 * it is what `duplicate_course` already does, and it is the honest question anyway:
 * not "does this teacher own the book?" but "does this teacher teach this class?".
 * That leaves the grounding to be supplied from here, which is no loss: this reads the
 * teacher's LIVE screen, so a title drafted against an objective they just typed sees
 * the objective they just typed, which the server's saved-rows version never could.
 */
import type { CurriculumAuthoringData, CurriculumUnit, Lesson, LessonActivity } from "@/lib/types";

const clamp = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max));

export function lessonBrief(input: {
  data: CurriculumAuthoringData | null;
  lesson: Lesson | null;
  unit: CurriculumUnit | null;
  steps: LessonActivity[];
  /** What is in the fields right now, saved or not. */
  live: { title: string; objective: string; tutorPrompt?: string };
}): string {
  const { data, lesson, unit, steps, live } = input;
  if (!lesson) return "";

  const version = data?.courseVersions.find((row) => row.id === unit?.course_version_id) ?? null;
  const course = data?.courses.find((row) => row.id === version?.course_id) ?? null;
  const subject = data?.subjects.find((row) => row.id === course?.subject_id) ?? null;
  const siblings = (data?.lessons ?? [])
    .filter((row) => row.unit_id === lesson.unit_id && row.id !== lesson.id)
    .map((row) => row.title?.trim())
    .filter(Boolean);
  const stepLines = steps
    .map((step) => `- [${step.stage}/${step.response_mode}] ${step.title?.trim() || "Untitled"}`)
    .join("\n");

  const lines = [
    subject ? `Subject: ${subject.title}` : "",
    course ? `Course: ${course.title}` : "",
    unit ? `Unit: ${unit.title}` : "",
    live.title.trim() ? `Lesson: ${live.title.trim()}` : "",
    live.objective.trim() ? `Objective: ${live.objective.trim()}` : "",
    live.tutorPrompt?.trim() ? `Mentor prompt: ${clamp(live.tutorPrompt.trim(), 600)}` : "",
    siblings.length ? `Other lessons in this unit: ${siblings.join(", ")}` : "",
    stepLines ? `This lesson's current steps:\n${stepLines}` : "This lesson has no steps yet.",
  ].filter(Boolean);

  return clamp(lines.join("\n"), 3000);
}
