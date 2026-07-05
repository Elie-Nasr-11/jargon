import { CalendarClock, ClipboardCheck, FileCheck2, Radio } from "lucide-react";
import type { Assessment, Assignment, Profile, TeacherDashboardData } from "@/lib/types";

// v4.0 Phase 2c — the class Overview's attention strips: which students are live right now
// (pop in to steer) and a work-at-a-glance count. Both derive from the dashboard blob already
// in ClassDetail scope; the teacher side is poll-based, so these reflect the last fetch.

const DAY = 86_400_000;

function relTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < DAY) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / DAY)}d ago`;
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/45 px-3 py-2">
      <div className="text-[15px] font-medium text-foreground">{value}</div>
      <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function ClassOverviewStrips({
  classId,
  dashboard,
  studentIds,
  assignments,
  assessments,
  profilesById,
  lessonTitle,
  onWatch,
}: {
  classId: string;
  dashboard: TeacherDashboardData;
  studentIds: string[];
  assignments: Assignment[]; // already scoped to this class
  assessments: Assessment[]; // already scoped to this class
  profilesById: Map<string, Profile>;
  lessonTitle: (lessonId: string | null) => string;
  onWatch: (studentId: string, sessionId: string) => void;
}) {
  const now = Date.now();
  const studentSet = new Set(studentIds);

  const live = dashboard.sessions
    .filter((s) => studentSet.has(s.user_id) && s.status !== "complete")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const assignmentIds = new Set(assignments.map((a) => a.id));
  const assessmentIds = new Set(assessments.map((a) => a.id));
  const submitted =
    dashboard.assignmentSubmissions.filter(
      (s) => s.status === "submitted" && assignmentIds.has(s.assignment_id),
    ).length +
    dashboard.assessmentAttempts.filter(
      (a) => a.status === "submitted" && assessmentIds.has(a.assessment_id),
    ).length;

  // Live checkpoints for this class, split by due window.
  const liveCheckpoints = dashboard.checkpoints.filter(
    (c) =>
      c.class_id === classId &&
      ((c.kind === "assignment" && c.status === "assigned") ||
        (c.kind === "assessment" && c.status === "published")),
  );
  const dueMs = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : NaN;
  };
  const dueSoon = liveCheckpoints.filter((c) => {
    const d = dueMs(c.due_at);
    return Number.isFinite(d) && d >= now && d <= now + 7 * DAY;
  }).length;
  const upcoming = liveCheckpoints.filter((c) => {
    const d = dueMs(c.due_at);
    return Number.isFinite(d) && d > now + 7 * DAY;
  }).length;

  return (
    <div className="mt-5 grid gap-3">
      {live.length ? (
        <div className="rounded-3xl border border-border bg-depth-sub p-4">
          <div className="mb-3 flex items-center gap-2 text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
            <Radio className="h-3.5 w-3.5 text-success" strokeWidth={1.8} />
            Live now
          </div>
          <div className="grid gap-1.5">
            {live.slice(0, 6).map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-xl border border-border bg-depth-field px-3 py-2"
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-foreground">
                    {displayName(profilesById.get(s.user_id), s.user_id)}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {lessonTitle(s.lesson_id)} · {relTime(s.updated_at, now)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onWatch(s.user_id, s.id)}
                  className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground hover:bg-muted"
                >
                  Watch
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-border bg-depth-sub p-4">
        <div className="mb-3 text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
          Work
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
            <Tile value={submitted} label="To grade / review" />
          </div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-warning" strokeWidth={1.7} />
            <Tile value={dueSoon} label="Due within 7 days" />
          </div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
            <Tile value={upcoming} label="Upcoming" />
          </div>
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
            <Tile value={live.length} label="Live now" />
          </div>
        </div>
      </div>
    </div>
  );
}

function displayName(profile: Profile | null | undefined, userId: string) {
  return profile?.name || `Student ${userId.slice(0, 8)}`;
}
