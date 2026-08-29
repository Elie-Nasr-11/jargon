/**
 * Writing a generated lesson package through curriculum-admin.
 *
 * One lesson's worth of output - steps, quiz, assignment, artifacts - lands in
 * a single call so a half-written lesson never appears in the outline. Both the
 * single-lesson build and the course loop go through here.
 */
import { stepInputFromDraft } from "@/features/teacher/authoring/stepModel";
import { createCurriculumLessonStub, upsertCurriculumStep } from "@/lib/api";
import type { CurriculumLessonPackage } from "@/lib/types";

// Map an AI-drafted step (mode or legacy kind + free text) onto the upsert payload.
// R56/R57: the ONE write path for a generated lesson package. Every row goes
// through the same actions manual authoring uses — no privileged bulk path — so the
// authoring guards, gates, and audit trail all still apply, and the lesson lands as
// a DRAFT (publishing stays the teacher's explicit act). R57 calls this per lesson
// from the whole-course runner; the single-lesson panel calls it through reloading().
export async function writeLessonPackage(input: {
  accessToken: string;
  classId: string;
  unitId: string;
  pkg: CurriculumLessonPackage;
}): Promise<string> {
  const { accessToken, classId, unitId, pkg } = input;
  const created = await createCurriculumLessonStub({
    accessToken,
    classId,
    unitId,
    title: pkg.lesson.title,
    level: pkg.lesson.level,
    tutorPrompt: pkg.lesson.tutor_prompt,
  });
  const lessonId = created.lesson_id || created.id;
  if (!lessonId) throw new Error("The lesson could not be created.");
  for (const draft of pkg.steps) {
    await upsertCurriculumStep({ accessToken, classId, lessonId, step: stepInputFromDraft(draft) });
  }
  // The wrap-up quiz and the assignment land as STEPS, not as classwork rows: steps
  // need no roster (the studio has none), students meet them inside the lesson, and
  // R48's step-work strip turns any assignment/assessment step into graded classwork
  // in one click when the teacher wants grading.
  for (const item of pkg.quiz.items.slice(0, 4)) {
    const isMcq = item.question_type === "multiple_choice" && item.choices.length >= 2;
    await upsertCurriculumStep({
      accessToken,
      classId,
      lessonId,
      step: stepInputFromDraft({
        kind: "checkpoint",
        mode: "assessment",
        mode_type: isMcq ? "mcq" : "open_ended",
        title: item.prompt.slice(0, 60),
        prompt: item.prompt,
        choices: isMcq ? item.choices : [],
        correct_choice_id: isMcq ? item.correct_choice_ids[0] || "" : "",
      }),
    });
  }
  if (pkg.assignment) {
    const criteria = pkg.assignment.success_criteria.length
      ? `\n\nWhat a strong response includes:\n${pkg.assignment.success_criteria
          .map((line) => `- ${line}`)
          .join("\n")}`
      : "";
    await upsertCurriculumStep({
      accessToken,
      classId,
      lessonId,
      step: stepInputFromDraft({
        kind: "reflect",
        mode: "assignment",
        mode_type: "",
        title: pkg.assignment.title,
        prompt: `${pkg.assignment.instructions}${criteria}`,
        choices: [],
        correct_choice_id: "",
      }),
    });
  }
  return lessonId;
}
