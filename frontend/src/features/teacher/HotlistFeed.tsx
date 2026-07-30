import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  ClipboardCheck,
  FileCheck2,
  Radio,
  Sparkles,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import type { Lesson, Profile, TeacherClassSummary, TeacherDashboardData } from "@/lib/types";

// v4.0 Phase 2 — the teacher hotlist. A single attention feed derived on load from the
// existing dashboard blob (docs/PLATFORM.md §5). The six `kind` values are the exact
// vocabulary a future `notifications` table will use, so the upgrade is a data-source swap.
export type HotlistKind =
  | "session_risk"
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

// State-hue LEFT ACCENT per row (DESIGN_V6 §6): a 3px tinted left edge carries the row's
// urgency at a glance; the rest of the row stays neutral so the feed reads calmly.
const TONE_ACCENT: Record<"danger" | "warn" | "info", string> = {
  danger: "border-l-danger",
  warn: "border-l-warning",
  info: "border-l-info/60",
};

// Count badge whose NUMBER flips in on change (DESIGN_V6 §3: number flips animate; badges
// never blink). Keying the inner span on the value re-triggers the .num-flip animation;
// reduced motion neutralizes it globally. Exported for the console's other count badges.
export function NumberFlip({ value }: { value: number | string }) {
  return (
    <span className="inline-block overflow-hidden align-bottom">
      <span key={String(value)} className="num-flip inline-block tabular-nums">
        {value}
      </span>
    </span>
  );
}

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
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Hotlist
          </div>
          {items.length ? (
            <span className="rounded-pill border border-border bg-depth-sub px-2.5 py-0.5 text-meta text-muted-foreground">
              <NumberFlip value={items.length} />
            </span>
          ) : null}
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={CheckCircle2}>
            You're all caught up — no submissions to grade, students at risk, or work due soon.
          </EmptyState>
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
                  className={`flex items-center gap-3 rounded-control border border-border border-l-[3px] bg-depth-field px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-muted ${TONE_ACCENT[meta.tone]}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${TONE_CLASS[meta.tone]}`} strokeWidth={1.7} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-meta text-foreground">{item.title}</div>
                    <div className="truncate text-overline text-muted-foreground">
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
                  <span className="shrink-0 text-meta text-muted-foreground">
                    {relativeTime(item.ts, nowMs)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {items.length > shown.length ? (
          <p className="mt-2 text-meta text-muted-foreground">
            +{items.length - shown.length} more — open a class to see the rest.
          </p>
        ) : null}
      </div>
    </section>
  );
}
