/**
 * What the console knows about a class, derived from the dashboard payload.
 *
 * The console renders no numbers of its own: every count, status and summary
 * here is computed from the rows the dashboard already returned. Keeping the
 * derivations pure means a room can be redrawn without re-deriving what it says.
 */
import { displayName, formatScore, lessonName } from "@/features/teacher/classShared";
import {
  requiredCheckpointStatus,
  unifiedLessonStatus,
  unifiedStatusClass,
} from "@/features/teacher/lessonStatus";
import type {
  ChatInputModality,
  LearningSession,
  Lesson,
  Profile,
  TeacherDashboardData,
} from "@/lib/types";

export type StudentSummary = {
  sessions: number;
  completedSessions: number;
  attempts: number;
  quizAttempts: number;
  evidence: number;
};

export type GradebookRow = {
  studentId: string;
  statusLabel: string;
  statusClass: string;
  lessonDetail: string;
  scoreLabel: string;
  attempts: number;
  quizAttempts: number;
  evidence: number;
  mastery: number;
  latestSession: LearningSession | null;
  needsAttention: boolean;
};

export type StudentAnalytics = {
  completionRate: number | null;
  averageQuizScore: number | null;
  resourceOpened: number;
};

export function studentAnalyticsFor(dashboard: TeacherDashboardData, studentId: string): StudentAnalytics {
  const sessions = dashboard.sessions.filter((session) => session.user_id === studentId);
  const completed = sessions.filter((session) => session.status === "complete");
  const quizAttempts = dashboard.quizAttempts.filter((attempt) => attempt.user_id === studentId);
  const scoredQuizAttempts = quizAttempts.filter((attempt) => typeof attempt.score === "number");
  const resourceOpened = dashboard.resourceInteractions.filter(
    (interaction) =>
      interaction.user_id === studentId &&
      ["opened", "played", "completed", "downloaded"].includes(interaction.event_type),
  ).length;

  return {
    completionRate: ratio(completed.length, sessions.length),
    averageQuizScore: scoredQuizAttempts.length
      ? scoredQuizAttempts.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0) /
        scoredQuizAttempts.length
      : null,
    resourceOpened,
  };
}

// R46 sketchboard signals: everything a class card (and the Students tab's review
// strip) needs — roster size, section names, who's live, and how much is waiting in
// Review (submitted assignment work + submitted quiz attempts).
export type ClassSignals = {
  students: number;
  sections: string[];
  liveNow: number;
  toReview: number;
};

export function classSignals(dashboard: TeacherDashboardData, classId: string): ClassSignals {
  const studentSet = new Set<string>();
  const sections = new Set<string>();
  for (const membership of dashboard.memberships) {
    if (
      membership.class_id === classId &&
      membership.role === "student" &&
      membership.status === "active"
    ) {
      studentSet.add(membership.user_id);
      if (membership.section) sections.add(membership.section);
    }
  }
  const liveNow = dashboard.sessions.filter(
    (session) => studentSet.has(session.user_id) && session.status !== "complete",
  ).length;
  const classAssignmentIds = new Set(
    dashboard.assignments.filter((a) => a.class_id === classId).map((a) => a.id),
  );
  const classAssessmentIds = new Set(
    dashboard.assessments.filter((a) => a.class_id === classId).map((a) => a.id),
  );
  const toReview =
    dashboard.assignmentSubmissions.filter(
      (s) => s.status === "submitted" && classAssignmentIds.has(s.assignment_id),
    ).length +
    dashboard.assessmentAttempts.filter(
      (a) => a.status === "submitted" && classAssessmentIds.has(a.assessment_id),
    ).length;
  return {
    students: studentSet.size,
    sections: Array.from(sections).sort((a, b) => a.localeCompare(b)),
    liveNow,
    toReview,
  };
}

// R47 Home: the global To-review queue — every piece of submitted, ungraded work across ALL
// classes, newest first. Each row deep-links to the item's student-work view in its class.
export type GlobalReviewRow = {
  kind: "assignment" | "assessment";
  classId: string;
  className: string;
  itemId: string;
  itemTitle: string;
  studentName: string;
  at: string;
};

export function globalReviewRows(
  dashboard: TeacherDashboardData,
  profilesById: Map<string, Profile>,
  lessonsById: Map<string, Lesson>,
): GlobalReviewRow[] {
  const classNames = new Map(dashboard.classes.map((item) => [item.id, item.name]));
  const rows: GlobalReviewRow[] = [];
  const assignmentsById = new Map(dashboard.assignments.map((item) => [item.id, item]));
  for (const submission of dashboard.assignmentSubmissions) {
    if (submission.status !== "submitted") continue;
    const assignment = assignmentsById.get(submission.assignment_id);
    if (!assignment?.class_id) continue;
    rows.push({
      kind: "assignment",
      classId: assignment.class_id,
      className: classNames.get(assignment.class_id) ?? "Class",
      itemId: assignment.id,
      itemTitle: assignment.title || lessonName(lessonsById, assignment.lesson_id),
      studentName: displayName(profilesById.get(submission.user_id) ?? null, submission.user_id),
      at: submission.updated_at || submission.created_at,
    });
  }
  const assessmentsById = new Map(dashboard.assessments.map((item) => [item.id, item]));
  for (const attempt of dashboard.assessmentAttempts) {
    if (attempt.status !== "submitted") continue;
    const assessment = assessmentsById.get(attempt.assessment_id);
    if (!assessment?.class_id) continue;
    rows.push({
      kind: "assessment",
      classId: assessment.class_id,
      className: classNames.get(assessment.class_id) ?? "Class",
      itemId: assessment.id,
      itemTitle: assessment.title || lessonName(lessonsById, assessment.lesson_id),
      studentName: displayName(profilesById.get(attempt.user_id) ?? null, attempt.user_id),
      at: attempt.updated_at || attempt.created_at,
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

// Relative time for roster rows ("2h ago"), shared shape with the old overview strips.
export function relTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export function gradebookRowForStudent(
  dashboard: TeacherDashboardData,
  studentId: string,
  selectedLessonId: string,
  lessons: Lesson[],
  lessonsById: Map<string, Lesson>,
): GradebookRow {
  const selectedLesson = selectedLessonId === "all" ? null : selectedLessonId;
  const sessions = dashboard.sessions
    .filter(
      (session) =>
        session.user_id === studentId && (!selectedLesson || session.lesson_id === selectedLesson),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const latestSession = sessions[0] || null;
  const completedSessions = sessions.filter((session) => session.status === "complete");
  const attempts = dashboard.attempts.filter(
    (item) => item.user_id === studentId && (!selectedLesson || item.lesson_id === selectedLesson),
  );
  const quizAttempts = dashboard.quizAttempts.filter(
    (item) => item.user_id === studentId && (!selectedLesson || item.lesson_id === selectedLesson),
  );
  const evidence = dashboard.evidence.filter(
    (item) => item.user_id === studentId && (!selectedLesson || item.lesson_id === selectedLesson),
  );
  const mastery = dashboard.mastery.filter((item) => item.user_id === studentId);
  const failedSignals =
    attempts.some((item) => item.passed === false) ||
    quizAttempts.some((item) => item.passed === false) ||
    sessions.some(
      (session) => session.status === "needs_retry" || session.status === "needs_rescue",
    );

  if (selectedLesson) {
    const unified = unifiedLessonStatus(dashboard, studentId, selectedLesson);
    const { total, outstanding } = unified.checkpoints;
    const checkpointDetail = total > 0 ? ` • ${total - outstanding}/${total} required done` : "";
    return {
      studentId,
      statusLabel: unified.status,
      statusClass: unifiedStatusClass(unified.status),
      lessonDetail: `${lessonName(lessonsById, selectedLesson)}${checkpointDetail}`,
      scoreLabel: latestSession ? formatScore(latestSession.score) : "n/a",
      attempts: attempts.length,
      quizAttempts: quizAttempts.length,
      evidence: evidence.length,
      mastery: mastery.length,
      latestSession,
      needsAttention:
        unified.status === "Retry" || unified.status === "Checkpoints due" || failedSignals,
    };
  }

  const completedLessonNames = completedLessonNamesFor(dashboard.sessions, studentId, lessonsById);
  const completedCount = completedLessonNames.length;
  const totalLessons = lessons.length;
  const activeCount = sessions.filter((session) => session.status !== "complete").length;
  const averageCompleteScore = completedSessions.length
    ? completedSessions.reduce((sum, session) => sum + Number(session.score || 0), 0) /
      completedSessions.length
    : null;
  const outstandingRequired = lessons.reduce(
    (sum, lesson) => sum + requiredCheckpointStatus(dashboard, studentId, lesson.id).outstanding,
    0,
  );
  const detailBase = activeCount
    ? `${activeCount} active lesson${activeCount === 1 ? "" : "s"}`
    : completedCount
      ? completedLessonNames.join(", ")
      : "No lessons started";
  const requiredNote =
    outstandingRequired > 0
      ? ` • ${outstandingRequired} required checkpoint${
          outstandingRequired === 1 ? "" : "s"
        } outstanding`
      : "";

  return {
    studentId,
    statusLabel: `${completedCount}/${totalLessons} complete`,
    statusClass:
      completedCount > 0
        ? "border-success/40 bg-success/12 text-success"
        : "border-border bg-depth-sub text-muted-foreground",
    lessonDetail: `${detailBase}${requiredNote}`,
    scoreLabel: averageCompleteScore === null ? "n/a" : `${formatScore(averageCompleteScore)} avg`,
    attempts: attempts.length,
    quizAttempts: quizAttempts.length,
    evidence: evidence.length,
    mastery: mastery.length,
    latestSession,
    needsAttention: failedSignals || outstandingRequired > 0,
  };
}

export function summarizeStudent(dashboard: TeacherDashboardData, studentId: string): StudentSummary {
  return {
    sessions: dashboard.sessions.filter((session) => session.user_id === studentId).length,
    completedSessions: dashboard.sessions.filter(
      (session) => session.user_id === studentId && session.status === "complete",
    ).length,
    attempts: dashboard.attempts.filter((item) => item.user_id === studentId).length,
    quizAttempts: dashboard.quizAttempts.filter((item) => item.user_id === studentId).length,
    evidence: dashboard.evidence.filter((item) => item.user_id === studentId).length,
  };
}

// R60 Students roster: the per-student grade rollup behind the row chip. Mirrors
// fetchStudentGrades exactly — released statuses only, final_score ?? score — so the
// teacher's chip and the student's own grades list can never disagree.
export type StudentGradeSummary = { avg: number | null; graded: number; waiting: number; overdue: number };

export function gradeSummariesForClass(
  dashboard: TeacherDashboardData,
  classId: string,
): Map<string, StudentGradeSummary> {
  const released = new Set(["complete", "returned", "graded"]);
  const checkpointsById = new Map(
    dashboard.checkpoints
      .filter((checkpoint) => checkpoint.class_id === classId && checkpoint.status !== "archived")
      .map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  const nowMs = Date.now();
  const totals = new Map<
    string,
    { sum: number; graded: number; waiting: number; overdue: number }
  >();
  for (const recipient of dashboard.checkpointRecipients) {
    const checkpoint = checkpointsById.get(recipient.checkpoint_id);
    if (!checkpoint) continue;
    const entry = totals.get(recipient.user_id) ?? { sum: 0, graded: 0, waiting: 0, overdue: 0 };
    const rawScore = recipient.final_score ?? recipient.score;
    if (released.has(recipient.status) && rawScore != null) {
      entry.sum += Number(rawScore);
      entry.graded += 1;
    } else if (recipient.submitted_at) {
      entry.waiting += 1;
    } else if (checkpoint.due_at && Date.parse(checkpoint.due_at) < nowMs) {
      entry.overdue += 1;
    }
    totals.set(recipient.user_id, entry);
  }
  const summaries = new Map<string, StudentGradeSummary>();
  for (const [studentId, entry] of totals) {
    summaries.set(studentId, {
      avg: entry.graded ? entry.sum / entry.graded : null,
      graded: entry.graded,
      waiting: entry.waiting,
      overdue: entry.overdue,
    });
  }
  return summaries;
}

export function gradeChipLabel(summary: StudentGradeSummary | undefined): string {
  if (!summary || (!summary.graded && !summary.overdue)) return "No grades yet";
  const parts: string[] = [];
  if (summary.graded) parts.push(`Avg ${formatScore(summary.avg)}`);
  if (summary.overdue) parts.push(`${summary.overdue} overdue`);
  return parts.join(" · ");
}

// The roster row's one-line story: profile grade, recency, lessons finished.
export function studentContextLine(
  profile: Profile | null,
  sessions: LearningSession[],
  studentId: string,
  lessonsById: Map<string, Lesson>,
  nowMs: number,
): string {
  const parts: string[] = [];
  if (profile?.grade) parts.push(`Grade ${profile.grade}`);
  const latest = latestSessionFor(sessions, studentId);
  if (latest) {
    parts.push(`last active ${relTime(latest.updated_at, nowMs)}`);
    const completedCount = completedLessonNamesFor(sessions, studentId, lessonsById).length;
    parts.push(`${completedCount} lesson${completedCount === 1 ? "" : "s"} done`);
  } else {
    parts.push("no sessions yet");
  }
  return parts.join(" · ");
}

export function latestSessionFor(sessions: LearningSession[], studentId: string) {
  return sessions
    .filter((session) => session.user_id === studentId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

export function completedLessonNamesFor(
  sessions: LearningSession[],
  studentId: string,
  lessonsById: Map<string, Lesson>,
) {
  return unique(
    sessions
      .filter((session) => session.user_id === studentId && session.status === "complete")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((session) => lessonName(lessonsById, session.lesson_id)),
  );
}

export function inputModalityFromPayload(
  payload: Record<string, unknown> | null | undefined,
): ChatInputModality | null {
  const modality = payload?.input_modality;
  return modality === "typed" || modality === "dictated" || modality === "audio_session"
    ? modality
    : null;
}

export function statusLabel(session: LearningSession) {
  return `${session.status} - ${session.stage} - score ${formatScore(session.score)}`;
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function ratio(numerator: number, denominator: number) {
  if (!denominator) return null;
  return numerator / denominator;
}

export function unique(values: string[]) {
  return Array.from(new Set(values));
}
