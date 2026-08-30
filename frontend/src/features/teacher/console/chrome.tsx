/**
 * The console's small repeated parts.
 *
 * A panel, an inline empty state, a metric, a status chip, the row of session
 * chips, and the class button in the sidebar. They carry no logic - they exist
 * so that the same thing looks the same in all three rooms.
 */
import type { ReactNode } from "react";
import { lessonName } from "@/features/teacher/classShared";
import type { ClassSignals } from "@/features/teacher/console/derive";
import type {
  LearningSession,
  Lesson,
  LessonResourceStatus,
  TeacherClassSummary,
} from "@/lib/types";

export function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-depth-sub px-3 py-2">
      <div className="text-body-lg font-medium text-foreground">{value}</div>
      <div className="mt-0.5 text-overline uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function ResourceStatusChip({ status }: { status: LessonResourceStatus }) {
  const classes =
    status === "published"
      ? "border-success/40 bg-success/12 text-success"
      : status === "archived"
        ? "border-border bg-depth-sub text-muted-foreground"
        : "border-warning/40 bg-warning/12 text-warning";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-meta capitalize ${classes}`}>
      {status}
    </span>
  );
}

export function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-depth-sub p-4">
      <div className="mb-3 flex items-center gap-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

export function EmptyInline({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-border bg-depth-sub p-4">
      <div className="text-body font-medium text-foreground">{title}</div>
      <div className="mt-1 text-meta leading-relaxed text-muted-foreground">{body}</div>
    </div>
  );
}

export function SessionChipGroup({
  label,
  sessions,
  lessonsById,
  selectedSessionId,
  onSelectSession,
}: {
  label: "Active" | "Completed";
  sessions: LearningSession[];
  lessonsById: Map<string, Lesson>;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      {sessions.length ? (
        <div className="flex flex-wrap gap-2">
          {sessions.map((session) => (
            <button
              type="button"
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`rounded-full border px-3 py-1.5 text-meta transition-colors ${
                selectedSessionId === session.id
                  ? "border-primary/45 bg-background text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {lessonName(lessonsById, session.lesson_id)} · {session.status}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-meta text-muted-foreground">
          {label === "Completed" ? "No completed lessons yet" : "No active lessons"}
        </div>
      )}
    </div>
  );
}

// R46 sketchboard card: the class name, who's in it, and the two signals that matter —
// live now and to review. No stats tiles, no feed; the card IS the summary.
export function ClassButton({
  item,
  active,
  signals,
  onClick,
}: {
  item: TeacherClassSummary;
  active: boolean;
  signals: ClassSignals;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`elev-hover flex h-full w-full flex-col gap-2 rounded-card border bg-depth-card p-4 text-left shadow-card ${
        active ? "border-primary/45" : "border-border"
      }`}
    >
      <div className="text-body font-medium text-foreground">{item.name}</div>
      <div className="text-meta text-muted-foreground">
        {signals.students} student{signals.students === 1 ? "" : "s"}
        {signals.sections.length ? ` · sections ${signals.sections.join(" · ")}` : ""}
      </div>
      <div className="mt-auto flex flex-wrap gap-3 pt-1 text-meta">
        {signals.liveNow > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <NumberFlip value={signals.liveNow} /> live now
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-border" /> quiet
          </span>
        )}
        {signals.toReview > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-warning">
            <span className="h-2 w-2 rounded-full bg-warning" />
            <NumberFlip value={signals.toReview} /> to review
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-border" /> nothing to review
          </span>
        )}
      </div>
    </button>
  );
}

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
