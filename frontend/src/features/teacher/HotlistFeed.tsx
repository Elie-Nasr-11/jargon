import {
  AlertTriangle,
  CalendarClock,
  CircleUserRound,
  ClipboardCheck,
  FileCheck2,
  Radio,
  Sparkles,
} from "lucide-react";
import { GradientCard } from "@/components/GradientCard";
import type { Lesson, Profile, TeacherClassSummary, TeacherDashboardData } from "@/lib/types";

// v4.0 Phase 2 — the teacher hotlist. A single attention feed derived on load from the
// existing dashboard blob (docs/PLATFORM.md §5). The seven `kind` values are the exact
// vocabulary a future `notifications` table will use, so the upgrade is a data-source swap.
export type HotlistKind =
  | "session_risk"
  | "alert_open"
  | "mentor_recommendation"
  | "submission_to_grade"
  | "assessment_to_review"
  | "live_now"
  | "due_soon";

export type HotlistItem = {
  id: string;
  kind: HotlistKind;
  title: string;
  subtitle: string;
  ts: number;
  classId: string | null;
  studentId: string | null;
};

const KIND_META: Record<
  HotlistKind,
  { label: string; icon: typeof Radio; rank: number; tone: "danger" | "warn" | "info" }
> = {
  session_risk: { label: "Needs attention", icon: AlertTriangle, rank: 0, tone: "danger" },
  alert_open: { label: "Alert", icon: AlertTriangle, rank: 0, tone: "danger" },
  mentor_recommendation: { label: "Mentor flag", icon: Sparkles, rank: 1, tone: "warn" },
  submission_to_grade: { label: "To grade", icon: FileCheck2, rank: 2, tone: "info" },
  assessment_to_review: { label: "To review", icon: ClipboardCheck, rank: 2, tone: "info" },
  live_now: { label: "Live now", icon: Radio, rank: 3, tone: "info" },
  due_soon: { label: "Due soon", icon: CalendarClock, rank: 4, tone: "info" },
};

const DAY = 86_400_000;

function relativeTime(ts: number, nowMs: number): string {
  const diff = ts - nowMs;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "" : " ago";
  const prefix = diff >= 0 ? "in " : "";
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return `${prefix}${Math.round(abs / 60_000)}m${suffix}`;
  if (abs < DAY) return `${prefix}${Math.round(abs / 3_600_000)}h${suffix}`;
  return `${prefix}${Math.round(abs / DAY)}d${suffix}`;
}

// Pure derivation: turn the dashboard blob into a ranked attention feed. No fetch, no state.
export function deriveHotlist(
  dashboard: TeacherDashboardData,
  maps: {
    classesById: Map<string, TeacherClassSummary>;
    profilesById: Map<string, Profile>;
    lessonsById: Map<string, Lesson>;
  },
  nowMs: number,
): HotlistItem[] {
  const { classesById, profilesById, lessonsById } = maps;
  // First class each active student belongs to (for building a deep link).
  const studentClass = new Map<string, string>();
  for (const m of dashboard.memberships) {
    if (m.role === "student" && m.status === "active" && !studentClass.has(m.user_id)) {
      studentClass.set(m.user_id, m.class_id);
    }
  }
  const name = (userId: string) => profilesById.get(userId)?.name || "A student";
  const lessonTitle = (lessonId: string | null) =>
    (lessonId && lessonsById.get(lessonId)?.title) || "a lesson";
  const className = (classId: string | null) => (classId && classesById.get(classId)?.name) || "";
  const ms = (value: string | null | undefined) => {
    const t = value ? Date.parse(value) : NaN;
    return Number.isFinite(t) ? t : 0;
  };

  const assignmentsById = new Map(dashboard.assignments.map((a) => [a.id, a]));
  const assessmentsById = new Map(dashboard.assessments.map((a) => [a.id, a]));
  const items: HotlistItem[] = [];

  for (const s of dashboard.sessions) {
    if (s.status === "needs_rescue" || s.status === "needs_retry") {
      const classId = studentClass.get(s.user_id) ?? null;
      items.push({
        id: `risk:${s.id}`,
        kind: "session_risk",
        title: `${name(s.user_id)} ${s.status === "needs_rescue" ? "needs rescue" : "needs a retry"} on ${lessonTitle(s.lesson_id)}`,
        subtitle: className(classId),
        ts: ms(s.updated_at),
        classId,
        studentId: s.user_id,
      });
    } else if (s.status === "active" && nowMs - ms(s.updated_at) < 5 * 60_000) {
      const classId = studentClass.get(s.user_id) ?? null;
      items.push({
        id: `live:${s.id}`,
        kind: "live_now",
        title: `${name(s.user_id)} is working on ${lessonTitle(s.lesson_id)}`,
        subtitle: className(classId),
        ts: ms(s.updated_at),
        classId,
        studentId: s.user_id,
      });
    }
  }

  for (const alert of dashboard.interventionAlerts) {
    if (alert.status !== "open" && alert.status !== "acknowledged") continue;
    items.push({
      id: `alert:${alert.id}`,
      kind: "alert_open",
      title: `${name(alert.student_id)}: ${alert.title || alert.alert_type.replace(/_/g, " ")}`,
      subtitle: className(alert.class_id),
      ts: ms(alert.created_at),
      classId: alert.class_id,
      studentId: alert.student_id,
    });
  }

  for (const rec of dashboard.mentorRecommendations) {
    const classId = studentClass.get(rec.user_id) ?? null;
    items.push({
      id: `rec:${rec.id}`,
      kind: "mentor_recommendation",
      title: `Mentor flagged ${name(rec.user_id)}: ${rec.title}`,
      subtitle: className(classId),
      ts: ms(rec.created_at),
      classId,
      studentId: rec.user_id,
    });
  }

  for (const sub of dashboard.assignmentSubmissions) {
    if (sub.status !== "submitted") continue;
    const assignment = assignmentsById.get(sub.assignment_id);
    items.push({
      id: `sub:${sub.id}`,
      kind: "submission_to_grade",
      title: `${name(sub.user_id)} submitted ${assignment?.title || "an assignment"}`,
      subtitle: className(assignment?.class_id ?? null),
      ts: ms(sub.submitted_at || sub.updated_at),
      classId: assignment?.class_id ?? null,
      studentId: sub.user_id,
    });
  }

  for (const attempt of dashboard.assessmentAttempts) {
    if (attempt.status !== "submitted") continue;
    const assessment = assessmentsById.get(attempt.assessment_id);
    items.push({
      id: `att:${attempt.id}`,
      kind: "assessment_to_review",
      title: `${name(attempt.user_id)} finished ${assessment?.title || "an assessment"}`,
      subtitle: className(assessment?.class_id ?? null),
      ts: ms(attempt.submitted_at || attempt.updated_at),
      classId: assessment?.class_id ?? null,
      studentId: attempt.user_id,
    });
  }

  for (const cp of dashboard.checkpoints) {
    const due = ms(cp.due_at);
    if (!due || due < nowMs || due > nowMs + 7 * DAY) continue;
    // Skip work that's already complete/archived — only live checkpoints are "due".
    if (cp.status === "archived" || cp.status === "complete") continue;
    items.push({
      id: `due:${cp.id}`,
      kind: "due_soon",
      title: `${cp.title} ${cp.kind === "assessment" ? "assessment" : "assignment"} due ${relativeTime(due, nowMs)}`,
      subtitle: className(cp.class_id),
      ts: due,
      classId: cp.class_id,
      studentId: null,
    });
  }

  return items.sort((a, b) => {
    const rank = KIND_META[a.kind].rank - KIND_META[b.kind].rank;
    if (rank !== 0) return rank;
    // Within a rank: due_soon by soonest; everything else by most recent.
    return a.kind === "due_soon" ? a.ts - b.ts : b.ts - a.ts;
  });
}

const TONE_CLASS: Record<"danger" | "warn" | "info", string> = {
  danger: "text-danger",
  warn: "text-warning",
  info: "text-muted-foreground",
};

export function HotlistFeed({
  items,
  onOpen,
  nowMs,
  limit = 30,
}: {
  items: HotlistItem[];
  onOpen: (item: HotlistItem) => void;
  nowMs: number;
  limit?: number;
}) {
  const shown = items.slice(0, limit);
  return (
    <GradientCard>
      <div className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
            Hotlist
          </div>
          {items.length ? (
            <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
              {items.length}
            </span>
          ) : null}
        </div>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">
            You're all caught up — no submissions to grade, alerts, or work due soon.
          </p>
        ) : (
          <div className="grid gap-1.5">
            {shown.map((item) => {
              const meta = KIND_META[item.kind];
              const Icon = meta.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpen(item)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-depth-field px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <Icon className={`h-4 w-4 shrink-0 ${TONE_CLASS[meta.tone]}`} strokeWidth={1.7} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-foreground">{item.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {meta.label}
                      {item.subtitle ? ` · ${item.subtitle}` : ""}
                    </div>
                  </div>
                  {item.studentId ? (
                    <CircleUserRound
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                      strokeWidth={1.6}
                    />
                  ) : null}
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(item.ts, nowMs)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {items.length > shown.length ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            +{items.length - shown.length} more — open a class to see the rest.
          </p>
        ) : null}
      </div>
    </GradientCard>
  );
}
