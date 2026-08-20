import type { StudentAssessmentBundle, StudentAssignmentBundle } from "@/lib/types";

// Pure derivations over the student assessment bundle, shared by the Checkpoints panel,
// Home's due strip, and the sidebar badge. Kept out of the component files so those stay
// fast-refresh-clean and this stays trivially testable.
//
// R48: rows carry a KIND — assignments join the same surfaces (dock, panel, strips) via
// assignmentRows(). Before this, a required assignment could hold a lesson's end
// checkpoint with NO student surface anywhere to open it from — the dock and panel were
// assessments-only, and submitAssignment had no caller. The merge closes that dead-end.

export type CheckpointRowModel = {
  kind: "assessment" | "assignment";
  id: string;
  title: string;
  dueAt: string | null;
  // What the row's right-hand slot says.
  state: "todo" | "in_progress" | "waiting_review" | "scored";
  score: number | null;
};

const byDue = (a: CheckpointRowModel, b: CheckpointRowModel) =>
  (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");

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
      return {
        kind: "assessment" as const,
        id: a.id,
        title: a.title,
        dueAt: a.due_at,
        state,
        score,
      };
    })
    .sort(byDue);
}

// R48: recipient status → one displayable row per assigned assignment. Same shape, same
// surfaces; a tap opens AssignmentSurface instead of AssessmentSurface (kind dispatch).
export function assignmentRows(bundle: StudentAssignmentBundle): CheckpointRowModel[] {
  const recipientByAssignment = new Map(bundle.recipients.map((r) => [r.assignment_id, r]));
  return bundle.assignments
    .filter((a) => a.status === "assigned")
    .map((a) => {
      const recipient = recipientByAssignment.get(a.id);
      let state: CheckpointRowModel["state"] = "todo";
      let score: number | null = null;
      if (recipient?.status === "returned" || recipient?.status === "complete") {
        state = "scored";
        score = recipient?.score ?? null;
      } else if (recipient?.status === "submitted") {
        state = "waiting_review";
      } else if (recipient?.status === "started") {
        state = "in_progress";
      }
      return {
        kind: "assignment" as const,
        id: a.id,
        title: a.title,
        dueAt: a.due_at,
        state,
        score,
      };
    })
    .sort(byDue);
}

export function checkpointWorkDue(
  bundle: StudentAssessmentBundle,
  assignments: StudentAssignmentBundle | null = null,
): number {
  return [...checkpointRows(bundle), ...(assignments ? assignmentRows(assignments) : [])].filter(
    (r) => r.state === "todo" || r.state === "in_progress",
  ).length;
}

// The unified rows resolved back to their class through each item's class_id. Feeds the
// sidebar class list's due tags, each class summary's work section, and the chat dock.
export function checkpointRowsByClass(
  bundle: StudentAssessmentBundle,
  assignments: StudentAssignmentBundle | null = null,
): Map<string, CheckpointRowModel[]> {
  const map = new Map<string, CheckpointRowModel[]>();
  const classByAssessment = new Map(bundle.assessments.map((a) => [a.id, a.class_id]));
  const classByAssignment = new Map(
    (assignments?.assignments ?? []).map((a) => [a.id, a.class_id]),
  );
  const rows = [...checkpointRows(bundle), ...(assignments ? assignmentRows(assignments) : [])];
  for (const row of rows) {
    const classId =
      row.kind === "assignment" ? classByAssignment.get(row.id) : classByAssessment.get(row.id);
    if (!classId) continue;
    map.set(classId, [...(map.get(classId) ?? []), row]);
  }
  for (const [classId, classRows] of map) map.set(classId, [...classRows].sort(byDue));
  return map;
}
