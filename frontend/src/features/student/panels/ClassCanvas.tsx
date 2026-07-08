import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronRight, Lock, Megaphone } from "lucide-react";
import { StateNote } from "@/components/StateNote";
import { Collapsible } from "@/components/Collapsible";
import { ProgressRing } from "@/components/ProgressRing";
import { EntityComments } from "@/features/comms/EntityComments";
import { groupByUnit } from "@/features/student/lessonGroups";
import { formatDate, formatScore, relativeTime } from "@/lib/format";
import {
  fetchClassScopedLessons,
  fetchEntityCommentCounts,
  fetchStudentClasses,
  fetchStudentGrades,
  fetchStudentLessonProgress,
} from "@/lib/api";
import type {
  Assessment,
  AssessmentAttempt,
  Assignment,
  Lesson,
  Notification,
  StudentAssessmentBundle,
  StudentAssignmentBundle,
  StudentClass,
  StudentGradeRow,
} from "@/lib/types";

// The class canvas: EVERYTHING about one class on a single scrolling page — no drill-down. A
// Recent & upcoming strip up top (this class's deadlines + latest submissions, so due dates read
// without scanning); collapsible units whose lessons carry an at-a-glance state (a progress ring +
// title weight) and their WORK IN PLACE (each assignment/assessment nested under the lesson it
// belongs to; lesson-less
// work drops to "Other work"); and a Discussion section split into the student's private teacher
// threads and class-wide posts. Assignment submission and quiz-taking run in the P5 focus lockdown.

type UnitState = "complete" | "in_progress" | "not_started";

function unitStateOf(lessons: Lesson[], progress: Record<string, number>): UnitState {
  if (!lessons.length) return "not_started";
  let complete = 0;
  let started = 0;
  for (const l of lessons) {
    const v = progress[l.id] ?? 0;
    if (v >= 1) complete += 1;
    else if (v > 0) started += 1;
  }
  if (complete === lessons.length) return "complete";
  if (started > 0 || complete > 0) return "in_progress";
  return "not_started";
}

function StateChip({ state }: { state: UnitState }) {
  const cls =
    state === "complete"
      ? "border-success/40 bg-success/10 text-success"
      : state === "in_progress"
        ? "border-info/40 bg-info/10 text-info"
        : "border-border text-muted-foreground";
  const label =
    state === "complete" ? "Complete" : state === "in_progress" ? "In progress" : "Not started";
  return (
    <span
      className={`shrink-0 rounded-pill border px-2 py-0.5 text-overline font-medium uppercase tracking-[0.06em] ${cls}`}
    >
      {label}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-7 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground first:mt-0">
      {children}
    </div>
  );
}

function WorkLine({
  title,
  meta,
  tone,
}: {
  title: string;
  meta: string;
  tone: "danger" | "success" | "muted";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-body text-foreground">{title}</span>
      <span
        className={`shrink-0 text-meta tabular-nums ${
          tone === "danger"
            ? "text-danger"
            : tone === "success"
              ? "text-success"
              : "text-muted-foreground"
        }`}
      >
        {meta}
      </span>
    </div>
  );
}

export function ClassCanvas({
  classId,
  assignments,
  assessments,
  notifications,
  onMarkRead,
  onOpenLesson,
  switchBlocked = false,
  onOpenQuiz,
}: {
  classId: string;
  assignments: StudentAssignmentBundle;
  assessments: StudentAssessmentBundle;
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onOpenLesson: (lessonId: string) => void;
  // Lesson switching is refused while a turn is in flight — disable the rows (like the sidebar's)
  // so the refusal never reads as a dead click.
  switchBlocked?: boolean;
  // viewingResult=true when the latest attempt is already finished — the lockdown opens relaxed.
  onOpenQuiz: (assessmentId: string, viewingResult: boolean) => void;
}) {
  const [cls, setCls] = useState<StudentClass | null>(null);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [grades, setGrades] = useState<StudentGradeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openUnits, setOpenUnits] = useState<Record<string, boolean>>({});
  const seededRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Per-section resilience: the units list is the canvas's backbone (hard fail); the rest
      // degrades to empty.
      try {
        const [classRows, scoped, prog, gradeRows] = await Promise.all([
          fetchStudentClasses().catch(() => [] as StudentClass[]),
          fetchClassScopedLessons(classId),
          fetchStudentLessonProgress().catch(() => ({}) as Record<string, number>),
          fetchStudentGrades().catch(() => [] as StudentGradeRow[]),
        ]);
        if (!alive) return;
        setCls(classRows.find((c) => c.id === classId) ?? null);
        setLessons(scoped);
        setProgress(prog);
        setGrades(gradeRows.filter((g) => g.class_id === classId));
      } catch (e) {
        if (alive) setError((e as Error).message || "Could not load this class.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [classId]);

  const units = useMemo(() => groupByUnit(lessons ?? []), [lessons]);

  // Seed the open units ONCE when the catalog + progress first arrive: units whose folded state
  // is in-progress (some lesson started, or partially complete) open; if none qualify the first
  // unit opens so the page never lands fully collapsed. After that the student's own toggles win.
  useEffect(() => {
    if (seededRef.current || lessons === null || units.length === 0) return;
    seededRef.current = true;
    const seed: Record<string, boolean> = {};
    let anyOpen = false;
    for (const u of units) {
      const open = unitStateOf(u.lessons, progress) === "in_progress";
      seed[u.unitId] = open;
      if (open) anyOpen = true;
    }
    if (!anyOpen && units[0]) seed[units[0].unitId] = true;
    setOpenUnits(seed);
  }, [lessons, units, progress]);

  const released = grades.filter((g) => g.score != null);
  const avg = released.length
    ? released.reduce((sum, g) => sum + (g.score ?? 0), 0) / released.length
    : null;
  const dueCount = grades.filter(
    (g) => (g.status === "assigned" || g.status === "started") && g.due_at,
  ).length;

  const classAssignments = useMemo(
    () =>
      assignments.assignments
        .filter((a) => a.class_id === classId && a.status === "assigned")
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [assignments, classId],
  );
  const recipientByAssignment = useMemo(
    () => new Map(assignments.recipients.map((r) => [r.assignment_id, r])),
    [assignments],
  );

  const classAssessments = useMemo(
    () =>
      assessments.assessments
        .filter((a) => a.class_id === classId && a.status === "published")
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [assessments, classId],
  );
  const latestAttemptByAssessment = useMemo(() => {
    const map = new Map<string, AssessmentAttempt>();
    for (const att of assessments.attempts) {
      const prev = map.get(att.assessment_id);
      if (!prev || Date.parse(att.updated_at) > Date.parse(prev.updated_at)) {
        map.set(att.assessment_id, att);
      }
    }
    return map;
  }, [assessments]);

  // Key work to the lesson it belongs to (in this class's catalog); everything else is "Other work".
  const lessonIdSet = useMemo(() => new Set((lessons ?? []).map((l) => l.id)), [lessons]);
  const workByLesson = useMemo(() => {
    const map = new Map<string, { assignments: Assignment[]; assessments: Assessment[] }>();
    const ensure = (id: string) => {
      let entry = map.get(id);
      if (!entry) {
        entry = { assignments: [], assessments: [] };
        map.set(id, entry);
      }
      return entry;
    };
    for (const a of classAssignments) {
      if (a.lesson_id && lessonIdSet.has(a.lesson_id)) ensure(a.lesson_id).assignments.push(a);
    }
    for (const a of classAssessments) {
      if (a.lesson_id && lessonIdSet.has(a.lesson_id)) ensure(a.lesson_id).assessments.push(a);
    }
    return map;
  }, [classAssignments, classAssessments, lessonIdSet]);
  const orphanAssignments = useMemo(
    () => classAssignments.filter((a) => !a.lesson_id || !lessonIdSet.has(a.lesson_id)),
    [classAssignments, lessonIdSet],
  );
  const orphanAssessments = useMemo(
    () => classAssessments.filter((a) => !a.lesson_id || !lessonIdSet.has(a.lesson_id)),
    [classAssessments, lessonIdSet],
  );

  const classPosts = useMemo(
    () => notifications.filter((n) => n.class_id === classId && n.kind !== "direct_message"),
    [notifications, classId],
  );
  // Private teacher threads (kind private_comment, written by the entity_comments layer) vs the
  // class-wide feed. Private is the student's own, so it leads.
  const privatePosts = useMemo(
    () => classPosts.filter((n) => n.kind === "private_comment"),
    [classPosts],
  );
  const publicPosts = useMemo(
    () => classPosts.filter((n) => n.kind !== "private_comment"),
    [classPosts],
  );

  // Batched comment counts for the chips (per-viewer honest — RLS scopes what each caller sees).
  const [commentCounts, setCommentCounts] = useState<{
    lesson: Record<string, number>;
    assignment: Record<string, number>;
    assessment: Record<string, number>;
  }>({ lesson: {}, assignment: {}, assessment: {} });
  useEffect(() => {
    if (!lessons) return;
    let alive = true;
    void Promise.all([
      fetchEntityCommentCounts(
        "lesson",
        lessons.map((l) => l.id),
        classId,
      ).catch(() => ({})),
      fetchEntityCommentCounts(
        "assignment",
        classAssignments.map((a) => a.id),
        classId,
      ).catch(() => ({})),
      fetchEntityCommentCounts(
        "assessment",
        classAssessments.map((a) => a.id),
        classId,
      ).catch(() => ({})),
    ]).then(([lesson, assignment, assessment]) => {
      if (alive) setCommentCounts({ lesson, assignment, assessment });
    });
    return () => {
      alive = false;
    };
  }, [lessons, classAssignments, classAssessments, classId]);

  const now = Date.now();

  // Recent & upcoming, off the unified grades feed. Overdue is pinned ahead of future-due.
  const openWork = grades.filter(
    (g) => (g.status === "assigned" || g.status === "started") && g.due_at,
  );
  const byDueAsc = (a: StudentGradeRow, b: StudentGradeRow) =>
    Date.parse(a.due_at as string) - Date.parse(b.due_at as string);
  const overdue = openWork.filter((g) => Date.parse(g.due_at as string) < now).sort(byDueAsc);
  const upcoming = openWork.filter((g) => Date.parse(g.due_at as string) >= now).sort(byDueAsc);
  const upcomingList = [...overdue, ...upcoming].slice(0, 4);
  const recentList = grades
    .filter((g) => g.submitted_at)
    .sort((a, b) => Date.parse(b.submitted_at as string) - Date.parse(a.submitted_at as string))
    .slice(0, 4);

  // --- render helpers (defined after `now` so overdue math is in scope) ---------------------

  const renderAssignmentCard = (a: Assignment) => {
    const recipient = recipientByAssignment.get(a.id) ?? null;
    const done = recipient?.status === "returned" || recipient?.status === "complete";
    const overdueA =
      a.due_at &&
      Date.parse(a.due_at) < now &&
      recipient &&
      (recipient.status === "assigned" || recipient.status === "started");
    return (
      <div key={a.id} className="rounded-card border border-border bg-depth-sub p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-body font-medium text-foreground">{a.title}</div>
          <span
            className={`shrink-0 rounded-pill border px-2.5 py-0.5 text-meta font-medium ${
              done
                ? "border-success/40 bg-success/10 text-success"
                : recipient?.status === "submitted"
                  ? "border-border text-muted-foreground"
                  : overdueA
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-warning/40 bg-warning/10 text-warning"
            }`}
          >
            {done
              ? recipient?.score != null
                ? formatScore(recipient.score)
                : "Returned"
              : recipient?.status === "submitted"
                ? "Submitted"
                : overdueA
                  ? "Overdue"
                  : "To do"}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-meta text-muted-foreground">
          {a.due_at ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.7} /> due {formatDate(a.due_at)}
            </span>
          ) : null}
          {recipient?.feedback ? <span>· feedback in</span> : null}
        </div>
        {recipient?.feedback ? (
          <p className="mt-2 text-meta leading-relaxed text-muted-foreground">
            {recipient.feedback}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <EntityComments
            entityType="assignment"
            entityId={a.id}
            classId={classId}
            initialCount={commentCounts.assignment[a.id] ?? 0}
          />
        </div>
      </div>
    );
  };

  const renderAssessmentCard = (a: Assessment) => {
    const attempt = latestAttemptByAssessment.get(a.id) ?? null;
    const releasedResult =
      attempt && (attempt.status === "returned" || attempt.final_score != null);
    // Mirror QuizPanel's own logic: any finished attempt opens as a RESULT view — QuizPanel never
    // starts a retake over a finished attempt, so don't promise one.
    const finished = attempt && attempt.status !== "in_progress";
    return (
      <div key={a.id} className="rounded-card border border-border bg-depth-sub p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-body font-medium text-foreground">{a.title}</div>
          <div className="flex shrink-0 items-center gap-2">
            {releasedResult && attempt?.final_score != null ? (
              <span className="rounded-pill border border-border px-2.5 py-0.5 text-meta font-medium tabular-nums text-foreground">
                {formatScore(attempt.final_score)}
              </span>
            ) : finished ? (
              <span className="text-meta text-muted-foreground">Awaiting review</span>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenQuiz(a.id, Boolean(finished))}
              className={`rounded-pill px-3 py-1 text-meta font-medium transition-opacity duration-(--dur-fast) hover:opacity-90 ${
                finished ? "border border-border text-foreground" : "bg-foreground text-background"
              }`}
            >
              {finished ? "View result" : "Open quiz"}
            </button>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2 text-meta text-muted-foreground">
          {a.due_at ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.7} /> due {formatDate(a.due_at)}
            </span>
          ) : null}
          {attempt && !releasedResult ? <span>· {attempt.status}</span> : null}
        </div>
        {releasedResult && attempt?.feedback ? (
          <p className="mt-2 text-meta leading-relaxed text-muted-foreground">{attempt.feedback}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <EntityComments
            entityType="assessment"
            entityId={a.id}
            classId={classId}
            initialCount={commentCounts.assessment[a.id] ?? 0}
          />
        </div>
      </div>
    );
  };

  const renderLesson = (lesson: Lesson) => {
    const value = progress[lesson.id] ?? 0;
    const started = value > 0;
    const inProgress = value > 0 && value < 1;
    const work = workByLesson.get(lesson.id);
    return (
      <div key={lesson.id}>
        {/* hover treatment + chevron reveal scoped to the NAV BUTTON so an expanded comment thread
            below doesn't light the row up as if it navigated. State reads from a leading ring
            (in-progress only) + title weight, matching the sidebar. */}
        <div className="group flex w-full flex-wrap items-center gap-3 rounded-control px-2 py-2">
          <button
            type="button"
            onClick={() => onOpenLesson(lesson.id)}
            disabled={switchBlocked}
            className="group/nav -mx-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-control px-1 py-1 text-left transition-colors duration-(--dur-fast) hover:bg-accent focus-visible:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
              {inProgress ? <ProgressRing value={value} size={14} /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={`truncate text-body ${started ? "text-foreground" : "text-muted-foreground"}`}
              >
                {lesson.title}
              </div>
            </div>
            <span className="sr-only">
              {value >= 1 ? "Completed" : value > 0 ? "In progress" : "Not started"}
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--dur-fast) group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100"
              strokeWidth={1.7}
            />
          </button>
          <EntityComments
            entityType="lesson"
            entityId={lesson.id}
            classId={classId}
            initialCount={commentCounts.lesson[lesson.id] ?? 0}
          />
        </div>
        {work && (work.assignments.length || work.assessments.length) ? (
          <div className="mb-1 ml-3 mt-1 grid gap-1.5 border-l border-border/60 pl-3">
            {work.assignments.map(renderAssignmentCard)}
            {work.assessments.map(renderAssessmentCard)}
          </div>
        ) : null}
      </div>
    );
  };

  const renderPost = (n: Notification) => (
    <button
      key={n.id}
      type="button"
      onClick={() => onMarkRead(n.id)}
      className={`flex items-start gap-2.5 rounded-control border border-border/60 px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-accent ${
        n.read_at ? "bg-transparent" : "bg-depth-field"
      }`}
    >
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
          n.read_at ? "bg-transparent" : "bg-danger"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-body text-foreground">{n.title}</span>
        {n.body ? (
          <span className="block truncate text-meta text-muted-foreground">{n.body}</span>
        ) : null}
        <span className="block text-meta text-muted-foreground">
          {relativeTime(n.created_at, now)}
        </span>
      </span>
    </button>
  );

  if (error) return <StateNote>{error}</StateNote>;
  if (lessons === null) return <StateNote>Loading…</StateNote>;

  return (
    <div>
      {/* header */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          {/* This IS the page title — PageShell passes no title for the canvas. */}
          <h1 className="truncate font-serif text-display text-foreground">
            {cls?.name ?? "Class"}
          </h1>
          {cls?.organizationName ? (
            <div className="truncate text-meta text-muted-foreground">{cls.organizationName}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-meta text-muted-foreground">
          {avg != null ? (
            <span>
              {released.length} graded · avg{" "}
              <span className="tabular-nums text-foreground">{formatScore(avg)}</span>
            </span>
          ) : null}
          {dueCount > 0 ? (
            <span className="rounded-pill border border-warning/40 bg-warning/10 px-2.5 py-0.5 font-medium tabular-nums text-warning">
              {dueCount} due
            </span>
          ) : null}
        </div>
      </div>

      {/* recent & upcoming */}
      {upcomingList.length || recentList.length ? (
        <>
          <SectionLabel>Recent &amp; upcoming</SectionLabel>
          <div className="grid gap-x-6 gap-y-4 rounded-card border border-border bg-depth-card p-4 shadow-card sm:grid-cols-2">
            <div>
              <div className="mb-2 text-overline font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Upcoming
              </div>
              {upcomingList.length ? (
                <div className="grid gap-1.5">
                  {upcomingList.map((g) => {
                    const od = Date.parse(g.due_at as string) < now;
                    return (
                      <WorkLine
                        key={g.id}
                        title={g.title}
                        meta={od ? "Overdue" : formatDate(g.due_at as string)}
                        tone={od ? "danger" : "muted"}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="text-meta text-muted-foreground">Nothing due.</div>
              )}
            </div>
            <div>
              <div className="mb-2 text-overline font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Recent
              </div>
              {recentList.length ? (
                <div className="grid gap-1.5">
                  {recentList.map((g) => (
                    <WorkLine
                      key={g.id}
                      title={g.title}
                      meta={g.score != null ? formatScore(g.score) : "Submitted"}
                      tone={g.score != null ? "success" : "muted"}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-meta text-muted-foreground">No recent submissions.</div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* units + lessons + work in place */}
      <SectionLabel>Lessons</SectionLabel>
      {units.length === 0 ? (
        <StateNote>No lessons are available in this class yet.</StateNote>
      ) : (
        <div className="grid gap-3">
          {units.map((unit) => {
            const open = openUnits[unit.unitId] ?? false;
            const state = unitStateOf(unit.lessons, progress);
            const mean = unit.lessons.length
              ? unit.lessons.reduce((acc, l) => acc + (progress[l.id] ?? 0), 0) /
                unit.lessons.length
              : 0;
            return (
              <div
                key={unit.unitId}
                className="rounded-card border border-border bg-depth-card p-2 shadow-card"
              >
                <Collapsible
                  open={open}
                  onToggle={() =>
                    setOpenUnits((s) => ({ ...s, [unit.unitId]: !(s[unit.unitId] ?? false) }))
                  }
                  headerClassName="rounded-control px-2 py-1.5 transition-colors duration-(--dur-fast) hover:bg-accent"
                  title={
                    <span className="truncate text-body font-medium text-foreground">
                      {unit.unitTitle}
                    </span>
                  }
                  meta={
                    <span className="flex shrink-0 items-center gap-2">
                      <StateChip state={state} />
                      <span className="text-meta tabular-nums text-muted-foreground">
                        {formatScore(mean)}
                      </span>
                    </span>
                  }
                  bodyClassName="grid gap-0.5 px-1 pt-1"
                >
                  {unit.lessons.map(renderLesson)}
                </Collapsible>
              </div>
            );
          })}
        </div>
      )}

      {/* work with no resolvable lesson */}
      {orphanAssignments.length || orphanAssessments.length ? (
        <>
          <SectionLabel>Other work</SectionLabel>
          <div className="grid gap-1.5 rounded-card border border-border bg-depth-card p-2 shadow-card">
            {orphanAssignments.map(renderAssignmentCard)}
            {orphanAssessments.map(renderAssessmentCard)}
          </div>
        </>
      ) : null}

      {/* discussion — private teacher threads first, then class-wide */}
      {privatePosts.length || publicPosts.length ? (
        <>
          <SectionLabel>Discussion</SectionLabel>
          {privatePosts.length ? (
            <div className="mb-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-muted-foreground">
                <Lock className="h-3.5 w-3.5" strokeWidth={1.7} /> Private to you
              </div>
              <div className="grid gap-1">{privatePosts.slice(0, 12).map(renderPost)}</div>
            </div>
          ) : null}
          {publicPosts.length ? (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-muted-foreground">
                <Megaphone className="h-3.5 w-3.5" strokeWidth={1.7} /> Class-wide
              </div>
              <div className="grid gap-1">{publicPosts.slice(0, 20).map(renderPost)}</div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
