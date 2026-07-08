import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  List,
  NotebookPen,
} from "lucide-react";
import { StateNote } from "@/components/StateNote";
import { DmThread } from "@/features/comms/DmThread";
import { EntityComments } from "@/features/comms/EntityComments";
import { GradesPanel } from "@/features/student/GradesPanel";
import { AgendaCalendar } from "@/features/student/panels/AgendaCalendar";
import { formatScore, relativeTime } from "@/lib/format";
import { modeLabel } from "@/lib/modes";
import {
  COMMS_MINI_CHAT_FLAG,
  fetchCommsEnabledClassIds,
  fetchDmChannels,
  fetchEntityCommentCounts,
  fetchStudentClasses,
  fetchStudentProfileStats,
  getSession,
  listMyTeachers,
  openDmChannel,
} from "@/lib/api";
import { notifyErr } from "@/lib/feedback";
import type {
  DmChannel,
  MyTeacher,
  Notification,
  StudentGradeRow,
  StudentProfileStats,
} from "@/lib/types";

// Pulse — time + signal, in one panel: (a) Up next, this student's work as either a day-grouped
// agenda (−7d…+21d, overdue pinned) or a month calendar, toggled; (b) Grades, a summary + recent
// five with the full gradebook behind a disclosure; (c) Activity, ONE merged feed of notifications
// and DM threads (threads expand inline; "message a teacher" bootstraps a channel); (d)
// Performance, the student's own numbers (progress / skills / strengths / teacher notes).

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 mt-7 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground first:mt-0">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// (a) Up next — the agenda timeline
// ---------------------------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(dayStart: number, todayStart: number): string {
  const diff = Math.round((dayStart - todayStart) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Date(dayStart).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type AgendaEvent = { key: string; kind: "due" | "submitted"; at: number; row: StudentGradeRow };

function AgendaRow({ event }: { event: AgendaEvent }) {
  const { row, kind } = event;
  return (
    <div className="flex items-center gap-2.5 rounded-control border border-border/60 bg-depth-field px-3 py-2.5">
      {kind === "due" ? (
        <CalendarClock className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" strokeWidth={1.7} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-foreground">{row.title}</div>
        <div className="text-meta text-muted-foreground">
          {kind === "due"
            ? `${row.kind === "assessment" ? "Assessment" : "Assignment"} due`
            : `Submitted${row.score != null ? ` · ${formatScore(row.score)}` : ""}`}
        </div>
      </div>
    </div>
  );
}

function AgendaTimeline({ grades }: { grades: StudentGradeRow[] }) {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const windowStart = todayStart - 7 * DAY_MS;
  const windowEnd = todayStart + 22 * DAY_MS;

  const { overdue, days } = useMemo(() => {
    const open = (g: StudentGradeRow) => g.status === "assigned" || g.status === "started";
    const events: AgendaEvent[] = [];
    const late: StudentGradeRow[] = [];
    for (const g of grades) {
      if (g.due_at) {
        const at = Date.parse(g.due_at);
        if (open(g) && at < now) {
          late.push(g);
        } else if (at >= windowStart && at < windowEnd && open(g)) {
          events.push({ key: `due-${g.id}`, kind: "due", at, row: g });
        }
      }
      if (g.submitted_at) {
        const at = Date.parse(g.submitted_at);
        if (at >= windowStart && at <= now) {
          events.push({ key: `sub-${g.id}`, kind: "submitted", at, row: g });
        }
      }
    }
    const byDay = new Map<number, AgendaEvent[]>();
    for (const ev of events.sort((a, b) => a.at - b.at)) {
      const day = startOfDay(ev.at);
      const list = byDay.get(day) ?? [];
      list.push(ev);
      byDay.set(day, list);
    }
    return {
      overdue: late.sort((a, b) => Date.parse(a.due_at as string) - Date.parse(b.due_at as string)),
      days: Array.from(byDay.entries()).sort((a, b) => a[0] - b[0]),
    };
  }, [grades, now, windowStart, windowEnd]);

  if (!overdue.length && !days.length) {
    return <StateNote>Nothing on your plate for the next three weeks.</StateNote>;
  }
  return (
    <div className="grid gap-3">
      {overdue.length ? (
        <div className="rounded-card border border-danger/40 bg-danger/8 p-3">
          <div className="mb-1.5 text-overline font-medium uppercase tracking-[0.1em] text-danger">
            Overdue
          </div>
          <div className="grid gap-1.5">
            {overdue.map((g) => (
              <div key={g.id} className="flex items-center gap-2.5">
                <CalendarClock className="h-4 w-4 shrink-0 text-danger" strokeWidth={1.7} />
                <span className="min-w-0 flex-1 truncate text-body text-foreground">{g.title}</span>
                <span className="shrink-0 text-meta text-danger">
                  {relativeTime(g.due_at as string)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {days.map(([day, events]) => (
        <div key={day}>
          <div
            className={`mb-1.5 text-meta font-medium ${
              day === todayStart ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {dayLabel(day, todayStart)}
          </div>
          <div className="grid gap-1.5">
            {events.map((ev) => (
              <AgendaRow key={ev.key} event={ev} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// (b) Grades — summary + recent, full gradebook behind a disclosure
// ---------------------------------------------------------------------------------------------
function GradesSection({ grades }: { grades: StudentGradeRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const released = useMemo(
    () =>
      grades
        .filter((g) => g.score != null)
        .sort(
          (a, b) =>
            Date.parse(b.submitted_at ?? b.due_at ?? "1970-01-01") -
            Date.parse(a.submitted_at ?? a.due_at ?? "1970-01-01"),
        ),
    [grades],
  );
  const avg = released.length
    ? released.reduce((sum, g) => sum + (g.score ?? 0), 0) / released.length
    : null;
  const recent = released.slice(0, 5);

  // Batched comment counts for the recent rows' chips — grade comments are per-class anchored, so
  // group the ids by class before counting. Chips only render on rows whose class the student is
  // STILL an active member of (RLS would reject posts anchored to a class they left).
  const [gradeCounts, setGradeCounts] = useState<Record<string, number>>({});
  const [activeClassIds, setActiveClassIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchStudentClasses()
      .then((rows) => alive && setActiveClassIds(new Set(rows.map((c) => c.id))))
      .catch(() => alive && setActiveClassIds(new Set()));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const byClass = new Map<string, string[]>();
    for (const g of recent) {
      if (!g.class_id) continue;
      const list = byClass.get(g.class_id) ?? [];
      list.push(g.id);
      byClass.set(g.class_id, list);
    }
    if (!byClass.size) return;
    let alive = true;
    void Promise.all(
      Array.from(byClass, ([classId, ids]) =>
        fetchEntityCommentCounts("grade", ids, classId).catch(() => ({}) as Record<string, number>),
      ),
    ).then((maps) => {
      if (alive) setGradeCounts(Object.assign({}, ...maps));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grades]);

  if (!grades.length) {
    return <StateNote>No graded work yet.</StateNote>;
  }
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-meta text-muted-foreground">
        <span>
          {released.length} graded
          {avg != null ? (
            <>
              {" "}
              · avg <span className="tabular-nums text-foreground">{formatScore(avg)}</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="grid gap-1">
        {recent.map((g) => (
          <div
            key={g.id}
            className="group flex flex-wrap items-center gap-3 rounded-control border border-border/60 px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-body text-foreground">{g.title}</span>
            <span className="shrink-0 text-meta text-muted-foreground">
              {g.kind === "assessment" ? "Assessment" : "Assignment"}
            </span>
            <span className="w-11 shrink-0 text-right text-meta font-medium tabular-nums text-foreground">
              {formatScore(g.score)}
            </span>
            {g.class_id && activeClassIds?.has(g.class_id) ? (
              <EntityComments
                entityType="grade"
                entityId={g.id}
                classId={g.class_id}
                initialCount={gradeCounts[g.id] ?? 0}
              />
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-2 inline-flex items-center gap-1.5 text-meta font-medium text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-(--dur-fast) ${expanded ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
        {expanded ? "Hide all grades" : "All grades"}
      </button>
      {expanded ? (
        <div className="mt-3">
          <GradesPanel grades={grades} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// (c) Activity — one merged feed: notifications + DM threads (inline) + message-a-teacher
// ---------------------------------------------------------------------------------------------
type FeedItem =
  | { kind: "notification"; at: number; notification: Notification }
  | { kind: "dm"; at: number; channel: DmChannel };

function ActivityFeed({
  notifications,
  onMarkRead,
  onMarkAll,
}: {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
}) {
  const [meId, setMeId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<MyTeacher[]>([]);
  const [channels, setChannels] = useState<DmChannel[]>([]);
  const [dmEnabled, setDmEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<DmChannel | null>(null);
  const [opening, setOpening] = useState(false);

  // The MessagesPanel bootstrap, relocated: DM rows only exist for classes where messaging is on.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSession();
        const uid = session?.user?.id;
        if (!uid || cancelled) return;
        setMeId(uid);
        const classes = await fetchStudentClasses();
        const enabled = await fetchCommsEnabledClassIds(
          classes.map((c) => c.id),
          COMMS_MINI_CHAT_FLAG,
        );
        if (cancelled || enabled.size === 0) return;
        setDmEnabled(true);
        const [t, ch] = await Promise.all([listMyTeachers(), fetchDmChannels()]);
        if (cancelled) return;
        setTeachers(t.filter((row) => enabled.has(row.class_id)));
        setChannels(ch);
      } catch {
        // the feed degrades to notifications-only
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const teacherNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teachers) map.set(t.teacher_id, t.teacher_name);
    return map;
  }, [teachers]);
  const classNameByTeacher = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teachers) map.set(`${t.teacher_id}:${t.class_id}`, t.class_name);
    return map;
  }, [teachers]);

  // Expanding a thread consumes its unread direct_message notifications — the thread IS the
  // notification's destination, so leaving them unread would keep the badge lit forever.
  const expandChannel = (channel: DmChannel) => {
    setExpanded(channel);
    for (const n of notifications) {
      if (n.kind === "direct_message" && !n.read_at && n.ref?.channel_id === channel.id) {
        onMarkRead(n.id);
      }
    }
  };

  // A direct_message notification row expands its thread in place (the v4 cross-surface
  // deep-link died with the Messages view — the feed IS the messages surface now).
  const openNotification = (n: Notification) => {
    onMarkRead(n.id);
    if (n.kind === "direct_message" && typeof n.ref?.channel_id === "string") {
      const channel = channels.find((c) => c.id === n.ref?.channel_id);
      if (channel) expandChannel(channel);
    }
  };

  const feed = useMemo(() => {
    const channelIds = new Set(channels.map((c) => c.id));
    const items: FeedItem[] = [
      // A DM notification whose thread is already a feed row would show the same event twice —
      // the thread row wins (expansion marks the notification read).
      ...notifications
        .filter(
          (n) =>
            !(
              n.kind === "direct_message" &&
              typeof n.ref?.channel_id === "string" &&
              channelIds.has(n.ref.channel_id)
            ),
        )
        .map((n) => ({
          kind: "notification" as const,
          at: Date.parse(n.created_at),
          notification: n,
        })),
      ...channels.map((c) => ({
        kind: "dm" as const,
        at: Date.parse(c.last_message_at ?? c.created_at),
        channel: c,
      })),
    ];
    return items.sort((a, b) => b.at - a.at).slice(0, 30);
  }, [notifications, channels]);

  const teachersWithoutChannel = useMemo(
    () =>
      teachers.filter(
        (t) => !channels.some((c) => c.teacher_id === t.teacher_id && c.class_id === t.class_id),
      ),
    [teachers, channels],
  );

  const startThread = async (t: MyTeacher) => {
    if (!meId || opening) return;
    setOpening(true);
    try {
      const channel = await openDmChannel(meId, t.teacher_id, t.class_id);
      if (!channel) return;
      setChannels((prev) => (prev.some((c) => c.id === channel.id) ? prev : [channel, ...prev]));
      setExpanded(channel);
    } catch (err) {
      notifyErr(err, "Couldn't open the conversation.");
    } finally {
      setOpening(false);
    }
  };

  const unread = notifications.filter((n) => !n.read_at).length;
  const now = Date.now();

  if (!loaded && !notifications.length) {
    return <StateNote>Loading your activity…</StateNote>;
  }

  if (expanded && meId) {
    return (
      <div className="flex h-[min(52dvh,480px)] min-h-0 flex-col">
        <button
          type="button"
          onClick={() => setExpanded(null)}
          className="mb-2 inline-flex items-center gap-1.5 text-body text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
          {teacherNameById.get(expanded.teacher_id) ?? "Teacher"}
        </button>
        <div className="min-h-0 flex-1">
          <DmThread
            channelId={expanded.id}
            meId={meId}
            disabled={expanded.status !== "open"}
            disabledNote={
              expanded.status === "blocked"
                ? "Your teacher has paused this conversation."
                : "This conversation is closed."
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {unread ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onMarkAll}
            className="text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
          >
            Mark all read
          </button>
        </div>
      ) : null}
      {feed.length === 0 ? (
        <StateNote>Nothing here yet.</StateNote>
      ) : (
        <div className="grid gap-1">
          {feed.map((item) =>
            item.kind === "dm" ? (
              <button
                key={`dm-${item.channel.id}`}
                type="button"
                onClick={() => expandChannel(item.channel)}
                className="flex items-start gap-2.5 rounded-control border border-border/60 px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-hover"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-foreground">
                    {teacherNameById.get(item.channel.teacher_id) ?? "Teacher"}
                  </span>
                  <span className="block truncate text-meta text-muted-foreground">
                    {classNameByTeacher.get(
                      `${item.channel.teacher_id}:${item.channel.class_id}`,
                    ) ?? "Conversation"}
                    {item.channel.last_message_at
                      ? ` · ${relativeTime(item.channel.last_message_at, now)}`
                      : ""}
                  </span>
                </span>
              </button>
            ) : (
              <button
                key={`n-${item.notification.id}`}
                type="button"
                onClick={() => openNotification(item.notification)}
                className={`flex items-start gap-2.5 rounded-control border border-border/60 px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-hover ${
                  item.notification.read_at ? "bg-transparent" : "bg-depth-field"
                }`}
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    item.notification.read_at ? "bg-transparent" : "bg-danger"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-foreground">{item.notification.title}</span>
                  {item.notification.body ? (
                    <span className="block truncate text-meta text-muted-foreground">
                      {item.notification.body}
                    </span>
                  ) : null}
                  <span className="block text-meta text-muted-foreground">
                    {relativeTime(item.notification.created_at, now)}
                  </span>
                </span>
              </button>
            ),
          )}
        </div>
      )}
      {teachersWithoutChannel.length ? (
        <div className="mt-3">
          <div className="mb-1.5 text-meta text-muted-foreground">Message a teacher</div>
          <div className="grid gap-1">
            {teachersWithoutChannel.map((t) => (
              <button
                key={`${t.teacher_id}:${t.class_id}`}
                type="button"
                onClick={() => void startThread(t)}
                disabled={opening}
                className="flex flex-col rounded-control border border-border/60 px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-hover disabled:opacity-50"
              >
                <span className="text-body text-foreground">{t.teacher_name}</span>
                <span className="text-meta text-muted-foreground">{t.class_name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// (d) Performance — the ProfilePanel's numbers without the identity, plus embedded guided review
// ---------------------------------------------------------------------------------------------
function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-card border border-border bg-depth-sub px-3 py-2.5">
      <div className="text-title font-medium leading-none text-foreground">{value}</div>
      <div className="mt-1 text-overline uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function PerformanceSection() {
  const [stats, setStats] = useState<StudentProfileStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchStudentProfileStats()
      .then((data) => alive && setStats(data))
      .catch((e) => alive && setError((e as Error).message || "Could not load your stats."));
    return () => {
      alive = false;
    };
  }, []);

  const skills = useMemo(
    () => [...(stats?.mastery ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [stats],
  );
  const byMode = useMemo(() => {
    const acc = new Map<string, { total: number; count: number }>();
    for (const ev of stats?.evidence ?? []) {
      if (!ev.mode || ev.score == null) continue;
      const cur = acc.get(ev.mode) ?? { total: 0, count: 0 };
      cur.total += ev.score;
      cur.count += 1;
      acc.set(ev.mode, cur);
    }
    return Array.from(acc, ([mode, { total, count }]) => ({
      mode,
      avg: total / count,
      count,
    })).sort((a, b) => b.avg - a.avg);
  }, [stats]);

  if (error) return <StateNote>{error}</StateNote>;
  if (!stats) return <StateNote>Loading your stats…</StateNote>;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <StatTile value={stats.progress.lessonsCompleted} label="Lessons completed" />
        <StatTile value={stats.progress.lessonsStarted} label="Lessons started" />
      </div>

      <div className="mb-2 mt-6 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Proficiency
      </div>
      {skills.length ? (
        <div className="grid gap-2 rounded-card border border-border bg-depth-sub p-3">
          {skills.map((skill) => (
            <div key={skill.skill_key} className="flex items-center gap-2.5">
              <span className="min-w-0 flex-1 truncate text-body text-foreground">
                {skill.skill_key}
              </span>
              <span className="shrink-0 text-meta text-muted-foreground">
                {titleCase(skill.level)}
              </span>
              <span className="h-[4px] w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-foreground"
                  style={{ width: formatScore(skill.score) }}
                />
              </span>
              <span className="w-9 shrink-0 text-right text-meta tabular-nums text-foreground/70">
                {formatScore(skill.score)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-meta text-muted-foreground">Complete lessons to build your skill map.</p>
      )}

      <div className="mb-2 mt-6 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Strengths by activity
      </div>
      {byMode.length ? (
        <div className="grid gap-2 rounded-card border border-border bg-depth-sub p-3">
          {byMode.map((row) => (
            <div key={row.mode} className="flex items-center gap-2.5">
              <span className="min-w-0 flex-1 truncate text-body text-foreground">
                {modeLabel(row.mode)}
              </span>
              <span className="shrink-0 text-meta text-muted-foreground">
                {row.count} {row.count === 1 ? "item" : "items"}
              </span>
              <span className="h-[4px] w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-foreground"
                  style={{ width: formatScore(row.avg) }}
                />
              </span>
              <span className="w-9 shrink-0 text-right text-meta tabular-nums text-foreground/70">
                {formatScore(row.avg)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-meta text-muted-foreground">
          Complete activities to see your strengths here.
        </p>
      )}

      <div className="mb-2 mt-6 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Notes from your teacher
      </div>
      {stats.notes.length ? (
        <div className="grid gap-2">
          {stats.notes.slice(0, 4).map((note) => (
            <div
              key={note.id}
              className="flex gap-2.5 rounded-card border border-border bg-depth-sub p-3"
            >
              <NotebookPen
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.7}
              />
              <div className="min-w-0 flex-1">
                <p className="text-body leading-relaxed text-foreground">{note.note}</p>
                <div className="mt-1 text-meta text-muted-foreground">
                  {relativeTime(note.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-meta text-muted-foreground">No notes from your teacher yet.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function PulsePanel({
  grades,
  notifications,
  onMarkRead,
  onMarkAll,
}: {
  grades: StudentGradeRow[];
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
}) {
  const [agendaView, setAgendaView] = useState<"agenda" | "calendar">("agenda");
  const views = [
    { key: "agenda" as const, label: "Agenda", Icon: List },
    { key: "calendar" as const, label: "Calendar", Icon: CalendarDays },
  ];
  return (
    <div>
      <div className="mb-2 mt-7 flex items-center justify-between gap-3 first:mt-0">
        <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Up next
        </span>
        <div className="flex items-center gap-0.5 rounded-pill border border-border p-0.5">
          {views.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setAgendaView(key)}
              aria-pressed={agendaView === key}
              className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-meta font-medium transition-colors duration-(--dur-fast) ${
                agendaView === key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.7} /> {label}
            </button>
          ))}
        </div>
      </div>
      {agendaView === "agenda" ? (
        <AgendaTimeline grades={grades} />
      ) : (
        <AgendaCalendar grades={grades} />
      )}

      <SectionLabel>Grades</SectionLabel>
      <GradesSection grades={grades} />

      <SectionLabel>Activity</SectionLabel>
      <ActivityFeed notifications={notifications} onMarkRead={onMarkRead} onMarkAll={onMarkAll} />

      <SectionLabel>Performance</SectionLabel>
      <PerformanceSection />
    </div>
  );
}
