import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronRight } from "lucide-react";
import { StateNote } from "@/components/StateNote";
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
  AssessmentAttempt,
  Lesson,
  Notification,
  StudentAssessmentBundle,
  StudentAssignmentBundle,
  StudentClass,
  StudentGradeRow,
} from "@/lib/types";

// The class canvas: EVERYTHING about one class on a single scrolling page — no drill-down. Header
// (name/org/avg/due) · units with their lessons inline (click → open in the chat) · assignments ·
// assessments with latest results · class posts. The v4 ClassMenu→Dashboard→UnitView stack died
// for this; assignment submission and quiz-taking move into the P5 focus lockdown (until then the
// quiz opens the existing modal and assignments submit from the chat's work bar).

function ProgressBar({ value }: { value: number }) {
  return (
    <span className="h-[4px] w-full overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full rounded-full bg-foreground"
        style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
      />
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

export function ClassCanvas({
  classId,
  assignments,
  assessments,
  notifications,
  onMarkRead,
  onOpenLesson,
  onOpenQuiz,
}: {
  classId: string;
  assignments: StudentAssignmentBundle;
  assessments: StudentAssessmentBundle;
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onOpenLesson: (lessonId: string) => void;
  // viewingResult=true when the latest attempt is already finished — the lockdown opens relaxed.
  onOpenQuiz: (assessmentId: string, viewingResult: boolean) => void;
}) {
  const [cls, setCls] = useState<StudentClass | null>(null);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [grades, setGrades] = useState<StudentGradeRow[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const classPosts = useMemo(
    () => notifications.filter((n) => n.class_id === classId && n.kind !== "direct_message"),
    [notifications, classId],
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

  if (error) return <StateNote>{error}</StateNote>;
  if (lessons === null) return <StateNote>Loading…</StateNote>;

  const now = Date.now();

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

      {/* units + lessons inline */}
      <SectionLabel>Lessons</SectionLabel>
      {units.length === 0 ? (
        <StateNote>No lessons are available in this class yet.</StateNote>
      ) : (
        <div className="grid gap-4">
          {units.map((unit) => (
            <div
              key={unit.unitId}
              className="rounded-card border border-border/60 bg-depth-card p-4 shadow-card"
            >
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <div className="min-w-0 truncate text-body font-medium text-foreground">
                  {unit.unitTitle}
                </div>
                <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                  {formatScore(
                    unit.lessons.length
                      ? unit.lessons.reduce((acc, l) => acc + (progress[l.id] ?? 0), 0) /
                          unit.lessons.length
                      : 0,
                  )}{" "}
                  complete
                </span>
              </div>
              <div className="grid gap-0.5">
                {unit.lessons.map((lesson) => {
                  const value = progress[lesson.id] ?? 0;
                  return (
                    <div
                      key={lesson.id}
                      className="group flex w-full flex-wrap items-center gap-3 rounded-control px-2 py-2"
                    >
                      {/* hover treatment + chevron reveal scoped to the NAV BUTTON so an expanded
                          comment thread below doesn't light the row up as if it navigated */}
                      <button
                        type="button"
                        onClick={() => onOpenLesson(lesson.id)}
                        className="group/nav -mx-1 flex min-w-0 flex-1 items-center gap-3 rounded-control px-1 py-1 text-left transition-colors duration-(--dur-fast) hover:bg-surface-hover"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body text-foreground">{lesson.title}</div>
                        </div>
                        <span className="w-24 shrink-0">
                          <ProgressBar value={value} />
                        </span>
                        <span className="w-20 shrink-0 text-right text-meta tabular-nums text-muted-foreground">
                          {value >= 1 ? "Complete" : value > 0 ? "In progress" : "Not started"}
                        </span>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--dur-fast) group-hover/nav:opacity-100"
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
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* assignments */}
      {classAssignments.length ? (
        <>
          <SectionLabel>Assignments</SectionLabel>
          <div className="grid gap-2">
            {classAssignments.map((a) => {
              const recipient = recipientByAssignment.get(a.id) ?? null;
              const overdue =
                a.due_at &&
                Date.parse(a.due_at) < now &&
                recipient &&
                (recipient.status === "assigned" || recipient.status === "started");
              return (
                <div
                  key={a.id}
                  className="group rounded-card border border-border/60 bg-depth-card p-4 shadow-card"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-body font-medium text-foreground">
                      {a.title}
                    </div>
                    <span
                      className={`shrink-0 rounded-pill border px-2.5 py-0.5 text-meta font-medium ${
                        recipient?.status === "returned" || recipient?.status === "complete"
                          ? "border-success/40 bg-success/10 text-success"
                          : recipient?.status === "submitted"
                            ? "border-border text-muted-foreground"
                            : overdue
                              ? "border-danger/40 bg-danger/10 text-danger"
                              : "border-warning/40 bg-warning/10 text-warning"
                      }`}
                    >
                      {recipient?.status === "returned" || recipient?.status === "complete"
                        ? recipient.score != null
                          ? formatScore(recipient.score)
                          : "Returned"
                        : recipient?.status === "submitted"
                          ? "Submitted"
                          : overdue
                            ? "Overdue"
                            : "To do"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-meta text-muted-foreground">
                    {a.due_at ? (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.7} /> due{" "}
                        {formatDate(a.due_at)}
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
            })}
          </div>
        </>
      ) : null}

      {/* assessments */}
      {classAssessments.length ? (
        <>
          <SectionLabel>Assessments</SectionLabel>
          <div className="grid gap-2">
            {classAssessments.map((a) => {
              const attempt = latestAttemptByAssessment.get(a.id) ?? null;
              const released =
                attempt && (attempt.status === "returned" || attempt.final_score != null);
              // Mirror QuizPanel's own logic: any finished attempt opens as a RESULT view —
              // QuizPanel never starts a retake over a finished attempt, so don't promise one.
              const finished = attempt && attempt.status !== "in_progress";
              return (
                <div
                  key={a.id}
                  className="group rounded-card border border-border/60 bg-depth-card p-4 shadow-card"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-body font-medium text-foreground">
                      {a.title}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {released && attempt?.final_score != null ? (
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
                          finished
                            ? "border border-border text-foreground"
                            : "bg-foreground text-background"
                        }`}
                      >
                        {finished ? "View result" : "Open quiz"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-meta text-muted-foreground">
                    {a.due_at ? (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.7} /> due{" "}
                        {formatDate(a.due_at)}
                      </span>
                    ) : null}
                    {attempt && !released ? <span>· {attempt.status}</span> : null}
                  </div>
                  {released && attempt?.feedback ? (
                    <p className="mt-2 text-meta leading-relaxed text-muted-foreground">
                      {attempt.feedback}
                    </p>
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
            })}
          </div>
        </>
      ) : null}

      {/* class posts */}
      {classPosts.length ? (
        <>
          <SectionLabel>Class posts</SectionLabel>
          <div className="grid gap-1">
            {classPosts.slice(0, 20).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onMarkRead(n.id)}
                className={`flex items-start gap-2.5 rounded-control border border-border/60 px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-hover ${
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
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
