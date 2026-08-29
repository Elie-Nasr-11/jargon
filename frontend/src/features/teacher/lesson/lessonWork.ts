/**
 * What work exists on one lesson, and who it is for.
 *
 * "Set work" is job 3: attach an assignment or a quiz to a lesson, for specific
 * students, with a due date. A teacher looking at a lesson needs all three of
 * those facts per row — not a count of rows. This derives them from the
 * dashboard payload; it renders nothing and decides nothing.
 */
import type {
  Assessment,
  AssessmentAttempt,
  AssessmentRecipient,
  Assignment,
  AssignmentRecipient,
  AssignmentSubmission,
  LessonActivity,
  Profile,
} from "@/lib/types";
import { displayName } from "@/features/teacher/classShared";

export type LessonWorkRow = {
  kind: "assignment" | "assessment";
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  /** 1-based position of the step this work IS, when it was created from one. */
  stepNumber: number | null;
  recipients: string[];
  toMark: number;
  submitted: number;
};

function countBy<T>(rows: T[], id: (row: T) => string, mark: (row: T) => boolean) {
  const out = new Map<string, { submitted: number; toMark: number }>();
  for (const row of rows) {
    const entry = out.get(id(row)) ?? { submitted: 0, toMark: 0 };
    entry.submitted += 1;
    if (mark(row)) entry.toMark += 1;
    out.set(id(row), entry);
  }
  return out;
}

export function lessonWorkRows(input: {
  lessonId: string;
  steps: LessonActivity[];
  assignments: Assignment[];
  assignmentRecipients: AssignmentRecipient[];
  assignmentSubmissions: AssignmentSubmission[];
  assessments: Assessment[];
  assessmentRecipients: AssessmentRecipient[];
  assessmentAttempts: AssessmentAttempt[];
  profilesById: Map<string, Profile>;
}): LessonWorkRow[] {
  const stepNumber = new Map(input.steps.map((step, index) => [step.id, index + 1]));
  const namesFor = (userIds: string[]) =>
    userIds.map((userId) => displayName(input.profilesById.get(userId), userId)).sort();

  const submissionCounts = countBy(
    input.assignmentSubmissions,
    (row) => row.assignment_id,
    (row) => row.status === "submitted",
  );
  const attemptCounts = countBy(
    input.assessmentAttempts,
    (row) => row.assessment_id,
    (row) => row.status === "submitted",
  );

  const rows: LessonWorkRow[] = [];
  for (const assignment of input.assignments) {
    if (assignment.lesson_id !== input.lessonId || assignment.status === "archived") continue;
    const counts = submissionCounts.get(assignment.id);
    rows.push({
      kind: "assignment",
      id: assignment.id,
      title: assignment.title || "Assignment",
      status: assignment.status,
      dueAt: assignment.due_at,
      stepNumber: assignment.activity_id ? (stepNumber.get(assignment.activity_id) ?? null) : null,
      recipients: namesFor(
        input.assignmentRecipients
          .filter((row) => row.assignment_id === assignment.id)
          .map((row) => row.user_id),
      ),
      toMark: counts?.toMark ?? 0,
      submitted: counts?.submitted ?? 0,
    });
  }
  for (const assessment of input.assessments) {
    if (assessment.lesson_id !== input.lessonId || assessment.status === "archived") continue;
    const counts = attemptCounts.get(assessment.id);
    rows.push({
      kind: "assessment",
      id: assessment.id,
      title: assessment.title || "Quiz",
      status: assessment.status,
      dueAt: assessment.due_at,
      stepNumber: assessment.activity_id ? (stepNumber.get(assessment.activity_id) ?? null) : null,
      recipients: namesFor(
        input.assessmentRecipients
          .filter((row) => row.assessment_id === assessment.id)
          .map((row) => row.user_id),
      ),
      toMark: counts?.toMark ?? 0,
      submitted: counts?.submitted ?? 0,
    });
  }
  // Anything needing marking first, then by due date, then by title.
  return rows.sort(
    (a, b) =>
      b.toMark - a.toMark ||
      (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
      a.title.localeCompare(b.title),
  );
}

/** "for 5 students" / "for Amal, Carl and Dana" — the sentence a teacher reads. */
export function recipientLabel(recipients: string[]): string {
  if (recipients.length === 0) return "not assigned to anyone yet";
  if (recipients.length === 1) return `for ${recipients[0]}`;
  if (recipients.length <= 3)
    return `for ${recipients.slice(0, -1).join(", ")} and ${recipients[recipients.length - 1]}`;
  return `for ${recipients.length} students`;
}

/** Due dates read as dates, not timestamps — "due Fri 5 Sep". */
export function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "no due date";
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "no due date";
  return `due ${date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}`;
}
