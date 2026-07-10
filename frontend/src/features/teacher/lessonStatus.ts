// Canonical per-(student, lesson) status math shared by the teacher class surfaces
// (gradebook, roster progress grid, class structure view). Pure moves out of
// TeacherConsole.tsx — no logic changes.
import type { LearningSession, TeacherDashboardData } from "@/lib/types";

export type LessonProgressStatus = "Not started" | "Active" | "Retry" | "Complete";

export function sessionProgressStatus(session: LearningSession): LessonProgressStatus {
  if (session.status === "complete") return "Complete";
  if (session.status === "needs_retry") return "Retry";
  return "Active";
}

export function lessonProgressStatus(
  sessions: LearningSession[],
  studentId: string,
  lessonId: string,
): LessonProgressStatus {
  const lessonSessions = sessions.filter(
    (session) => session.user_id === studentId && session.lesson_id === lessonId,
  );
  if (lessonSessions.some((session) => session.status === "complete")) return "Complete";
  if (lessonSessions.some((session) => session.status === "needs_retry")) return "Retry";
  if (
    lessonSessions.some(
      (session) => session.status === "active" || session.status === "needs_rescue",
    )
  ) {
    return "Active";
  }
  return "Not started";
}

// Per-dashboard index so the gradebook doesn't rescan dashboard.checkpoints +
// dashboard.checkpointRecipients on every (student, lesson) cell. Built once per dashboard
// object (WeakMap keyed on the fetch result) and reused across all cells and re-renders;
// evicted automatically when a new fetch replaces the dashboard. Collapses requiredCheckpointStatus
// from O(checkpoints + recipients) per call to O(required checkpoints for the lesson).
export type CheckpointIndex = {
  requiredByLesson: Map<string, string[]>; // lesson_id -> required+live checkpoint ids
  recipientStatus: Map<string, string>; // `${user_id}::${checkpoint_id}` -> status
};
const checkpointIndexCache = new WeakMap<TeacherDashboardData, CheckpointIndex>();

export function checkpointIndexFor(dashboard: TeacherDashboardData): CheckpointIndex {
  const cached = checkpointIndexCache.get(dashboard);
  if (cached) return cached;
  const requiredByLesson = new Map<string, string[]>();
  for (const c of dashboard.checkpoints) {
    const live =
      (c.kind === "assignment" && c.status === "assigned") ||
      (c.kind === "assessment" && c.status === "published");
    if (c.required && c.lesson_id && live) {
      const arr = requiredByLesson.get(c.lesson_id);
      if (arr) arr.push(c.id);
      else requiredByLesson.set(c.lesson_id, [c.id]);
    }
  }
  const recipientStatus = new Map<string, string>();
  for (const r of dashboard.checkpointRecipients) {
    recipientStatus.set(`${r.user_id}::${r.checkpoint_id}`, r.status);
  }
  const index = { requiredByLesson, recipientStatus };
  checkpointIndexCache.set(dashboard, index);
  return index;
}

// Reads the SAME unified `checkpoints` source as the chat runtime's completion gate
// (loadPendingCheckpoints in supabase/functions/chat/index.ts) — so the gradebook and the
// gate can't drift. A required checkpoint gates the lesson until the student COMPLETES it: any
// recipient status other than `complete` (assigned/started/submitted/returned) is still
// outstanding (parent must be live — assignment `assigned` / assessment `published`).
// Caveat: the runtime fails CLOSED (an unreadable checkpoint read holds the lesson open via
// pendingCheckpointsOk); the gradebook has no such signal, so if the checkpoint tables were
// unreadable at chat time the live lesson stays gated while this view reflects the teacher's
// current (successful) data load rather than that transient runtime state.
export function requiredCheckpointStatus(
  dashboard: TeacherDashboardData,
  studentId: string,
  lessonId: string,
): { total: number; outstanding: number } {
  const index = checkpointIndexFor(dashboard);
  const ids = index.requiredByLesson.get(lessonId);
  if (!ids || !ids.length) return { total: 0, outstanding: 0 };
  let total = 0;
  let outstanding = 0;
  for (const checkpointId of ids) {
    const status = index.recipientStatus.get(`${studentId}::${checkpointId}`);
    if (status === undefined) continue; // not assigned to this student
    total += 1;
    if (status !== "complete") outstanding += 1;
  }
  return { total, outstanding };
}

export type UnifiedLessonStatus = LessonProgressStatus | "Checkpoints due";

// The honest lesson status the student is actually subject to: activities AND required
// checkpoints. Key subtlety: when activities are done but a required checkpoint remains,
// the runtime holds the session at status "active" with a sticky `activities_complete`
// flag (NOT status "complete") — so we key "activities finished" off that flag, and only
// off status "complete" for genuinely-finished lessons. That lets us surface the held-open
// state as "Checkpoints due" rather than a misleading "Active" or "Complete".
export function unifiedLessonStatus(
  dashboard: TeacherDashboardData,
  studentId: string,
  lessonId: string,
): {
  status: UnifiedLessonStatus;
  activities: LessonProgressStatus;
  checkpoints: { total: number; outstanding: number };
} {
  const activities = lessonProgressStatus(dashboard.sessions, studentId, lessonId);
  const checkpoints = requiredCheckpointStatus(dashboard, studentId, lessonId);
  // Sticky across sessions (mirrors lessonProgressStatus's own `.some` completion): once a
  // session marked the activities done, treat activities as done even if a newer session is
  // active. `status === "complete"` implies activities were done too.
  const activitiesDone =
    activities === "Complete" ||
    dashboard.sessions.some(
      (session) =>
        session.user_id === studentId &&
        session.lesson_id === lessonId &&
        session.activities_complete === true,
    );

  let status: UnifiedLessonStatus;
  if (activitiesDone && checkpoints.outstanding > 0) {
    // Steps finished but required checkpoints still block completion — the actionable state.
    // Checked FIRST (before "Complete") so a required checkpoint added/reset AFTER an earlier
    // session already reached status "complete" still surfaces here — matching the runtime,
    // which re-holds the lesson open on the student's next turn.
    status = "Checkpoints due";
  } else if (activities === "Complete" || (activitiesDone && checkpoints.outstanding === 0)) {
    // Fully complete, or all activities + required checkpoints done (runtime flips the
    // session to "complete" on the student's next visit).
    status = "Complete";
  } else {
    status = activities; // Active / Retry / Not started
  }
  return { status, activities, checkpoints };
}

export function unifiedStatusClass(status: UnifiedLessonStatus) {
  if (status === "Checkpoints due") {
    return "border-warning/40 bg-warning/12 text-warning";
  }
  return lessonStatusClass(status);
}

export function lessonStatusClass(status: LessonProgressStatus) {
  if (status === "Complete") {
    return "border-success/40 bg-success/12 text-success";
  }
  if (status === "Active") {
    return "border-info/40 bg-info/12 text-info";
  }
  if (status === "Retry") {
    return "border-warning/40 bg-warning/12 text-warning";
  }
  return "border-border bg-background/45 text-muted-foreground";
}
