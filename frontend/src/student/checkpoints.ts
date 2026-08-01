import type { StudentAssessmentBundle } from "@/lib/types";

// Pure derivations over the student assessment bundle, shared by the Checkpoints panel,
// Home's due strip, and the sidebar badge. Kept out of the component files so those stay
// fast-refresh-clean and this stays trivially testable.

export type CheckpointRowModel = {
  id: string;
  title: string;
  dueAt: string | null;
  // What the row's right-hand slot says.
  state: "todo" | "in_progress" | "waiting_review" | "scored";
  score: number | null;
};

// Recipient + latest attempt → one displayable row per published assessment.
export function checkpointRows(bundle: StudentAssessmentBundle): CheckpointRowModel[] {
  const latestAttemptByAssessment = new Map<string, StudentAssessmentBundle["attempts"][number]>();
  for (const attempt of bundle.attempts) {
    const existing = latestAttemptByAssessment.get(attempt.assessment_id);
    if (!existing || attempt.attempt_number > existing.attempt_number) {
      latestAttemptByAssessment.set(attempt.assessment_id, attempt);
    }
  }
  const recipientByAssessment = new Map(bundle.recipients.map((r) => [r.assessment_id, r]));

  return bundle.assessments
    .filter((a) => a.status === "published")
    .map((a) => {
      const recipient = recipientByAssessment.get(a.id);
      const attempt = latestAttemptByAssessment.get(a.id);
      let state: CheckpointRowModel["state"] = "todo";
      let score: number | null = null;
      if (attempt?.status === "in_progress") {
        state = "in_progress";
      } else if (
        (attempt && (attempt.status === "returned" || attempt.status === "graded")) ||
        recipient?.status === "complete" ||
        recipient?.status === "returned"
      ) {
        state = "scored";
        score = recipient?.final_score ?? attempt?.final_score ?? null;
      } else if (attempt?.status === "submitted" || recipient?.status === "submitted") {
        state = "waiting_review";
      }
      return { id: a.id, title: a.title, dueAt: a.due_at, state, score };
    })
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}

export function checkpointWorkDue(bundle: StudentAssessmentBundle): number {
  return checkpointRows(bundle).filter((r) => r.state === "todo" || r.state === "in_progress")
    .length;
}

// The unified rows resolved back to their class through the assessment's class_id. Feeds the
// sidebar class list's due tags and each class summary's work section.
export function checkpointRowsByClass(
  bundle: StudentAssessmentBundle,
): Map<string, CheckpointRowModel[]> {
  const map = new Map<string, CheckpointRowModel[]>();
  const classByAssessment = new Map(bundle.assessments.map((a) => [a.id, a.class_id]));
  for (const row of checkpointRows(bundle)) {
    const classId = classByAssessment.get(row.id);
    if (!classId) continue;
    map.set(classId, [...(map.get(classId) ?? []), row]);
  }
  return map;
}
