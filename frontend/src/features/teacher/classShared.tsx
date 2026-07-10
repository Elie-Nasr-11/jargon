// Small display helpers + status chips shared by the teacher class surfaces
// (builders, grading panels, gradebook, roster). Pure moves out of TeacherConsole.tsx —
// no logic changes.
import type {
  AssessmentRecipient,
  AssessmentStatus,
  AssignmentRecipient,
  AssignmentStatus,
  Lesson,
  Profile,
} from "@/lib/types";

export function displayName(profile: Profile | null | undefined, userId: string) {
  return profile?.name || `Student ${userId.slice(0, 8)}`;
}

export function lessonName(lessonsById: Map<string, Lesson>, lessonId: string | null | undefined) {
  if (!lessonId) return "No lesson";
  return lessonsById.get(lessonId)?.title || lessonId;
}

export function lessonTitle(lessons: Lesson[], lessonId: string | null | undefined) {
  if (!lessonId) return "No lesson";
  return lessons.find((lesson) => lesson.id === lessonId)?.title || lessonId;
}

export function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined) return "n/a";
  if (score <= 1) return `${Math.round(score * 100)}%`;
  return `${Math.round(score)}%`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AssignmentStatusChip({ status }: { status: AssignmentStatus }) {
  const classes =
    status === "assigned"
      ? "border-success/40 bg-success/12 text-success"
      : status === "archived"
        ? "border-border bg-background/45 text-muted-foreground"
        : status === "recommended"
          ? "border-info/40 bg-info/12 text-info"
          : "border-warning/40 bg-warning/12 text-warning";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export function AssignmentRecipientChip({ status }: { status: AssignmentRecipient["status"] }) {
  const classes =
    status === "complete"
      ? "border-success/40 bg-success/12 text-success"
      : status === "submitted"
        ? "border-info/40 bg-info/12 text-info"
        : status === "returned"
          ? "border-warning/40 bg-warning/12 text-warning"
          : "border-border bg-background/45 text-muted-foreground";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status}
    </span>
  );
}

export function AssessmentStatusChip({ status }: { status: AssessmentStatus }) {
  const classes =
    status === "published"
      ? "border-success/40 bg-success/12 text-success"
      : status === "archived"
        ? "border-border bg-background/45 text-muted-foreground"
        : "border-warning/40 bg-warning/12 text-warning";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status}
    </span>
  );
}

export function AssessmentRecipientChip({ status }: { status: AssessmentRecipient["status"] }) {
  const classes =
    status === "complete"
      ? "border-success/40 bg-success/12 text-success"
      : status === "submitted"
        ? "border-info/40 bg-info/12 text-info"
        : status === "started"
          ? "border-info/40 bg-info/12 text-info"
          : status === "returned"
            ? "border-warning/40 bg-warning/12 text-warning"
            : "border-border bg-background/45 text-muted-foreground";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status.replace("_", " ")}
    </span>
  );
}
