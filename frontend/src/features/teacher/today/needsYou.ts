/**
 * What needs the teacher, right now, in one class.
 *
 * Jobs 4 and 5 — see who is learning, act on what needs me. Two lists and
 * nothing else: students who are in a lesson at this moment, and work that has
 * been submitted and not yet marked. Both are derived from the dashboard the
 * console already holds; neither decides anything.
 */
import { displayName, lessonName } from "@/features/teacher/classShared";
import { globalReviewRows } from "@/features/teacher/console/derive";
import type { GlobalReviewRow } from "@/features/teacher/console/derive";
import type { LearningSession, Lesson, Profile, TeacherDashboardData } from "@/lib/types";

export type LiveRow = {
  studentId: string;
  studentName: string;
  sessionId: string;
  lessonTitle: string;
  stage: string;
  at: string;
};

/**
 * This class's students with an unfinished session, most recently active first.
 *
 * A student can be in two of a teacher's classes, so membership alone is not
 * enough: "in a lesson now" on ICT's Today must not report a student who is in
 * a Biology lesson. `teachesLesson` answers whether the lesson belongs to THIS
 * class; when the class's courses could not be read it is absent, and the list
 * falls back to unscoped — over-reporting is recoverable, hiding a live student
 * from the teacher who can help them is not.
 */
export function liveNowRows(
  dashboard: TeacherDashboardData,
  classId: string,
  profilesById: Map<string, Profile>,
  lessonsById: Map<string, Lesson>,
  teachesLesson?: (lessonId: string) => boolean,
): LiveRow[] {
  const studentIds = new Set(
    dashboard.memberships
      .filter(
        (row) => row.class_id === classId && row.role === "student" && row.status === "active",
      )
      .map((row) => row.user_id),
  );
  const latest = new Map<string, LearningSession>();
  for (const session of dashboard.sessions) {
    if (session.status === "complete" || !studentIds.has(session.user_id)) continue;
    if (teachesLesson && !teachesLesson(session.lesson_id)) continue;
    const existing = latest.get(session.user_id);
    if (!existing || session.updated_at > existing.updated_at) latest.set(session.user_id, session);
  }
  return [...latest.entries()]
    .map(([studentId, session]) => ({
      studentId,
      studentName: displayName(profilesById.get(studentId) ?? null, studentId),
      sessionId: session.id,
      lessonTitle: lessonName(lessonsById, session.lesson_id),
      stage: session.stage || "",
      at: session.updated_at,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Submitted, unmarked work in this class — the same rows the home queue shows. */
export function toMarkRows(
  dashboard: TeacherDashboardData,
  classId: string,
  profilesById: Map<string, Profile>,
  lessonsById: Map<string, Lesson>,
): GlobalReviewRow[] {
  return globalReviewRows(dashboard, profilesById, lessonsById).filter(
    (row) => row.classId === classId,
  );
}
