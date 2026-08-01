import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2, Play } from "lucide-react";
import { groupByUnit } from "@/features/student/lessonGroups";
import { fetchClassResources, fetchStudentGrades } from "@/lib/api";
import { formatDate, formatScore } from "@/lib/format";
import { ClassAvatar } from "@/student/ClassList";
import { ProgressGlyph } from "@/student/LessonTree";
import { ResourceCard } from "@/student/ResourceCard";
import { SectionLabel, StatPill, WorkRow } from "@/student/summaryBits";
import type { CheckpointRowModel } from "@/student/checkpoints";
import type { Lesson, LessonChatResource, StudentClass, StudentGradeRow } from "@/lib/types";

// A class's summary page (Home with a class selected in the sidebar): identity band with
// color-coded stats, then RECENT → QUIZZES & ASSIGNMENTS → UNITS & LESSONS → RESOURCES.
// The disclosure ladder holds: primary facts show, dates/kinds reveal on hover, deep
// content (a lesson, an assessment, a material) takes a click.
//
// Color language: lesson-blue = live/current, success-green = done, open-orange = due,
// everything else stays in the ink ramp. Counters are mono.

export type ClassSummaryProps = {
  klass: StudentClass;
  // The class's scoped lessons, owned by the shell (null while loading).
  lessons: Lesson[] | null;
  progress: Record<string, number>;
  currentLessonId: string | null;
  assignmentRows: CheckpointRowModel[];
  onOpenLesson: (lessonId: string) => void;
  onOpenAssessment: (assessmentId: string) => void;
};

// One thin segment per lesson — the unit's shape at a glance.
function UnitBar({
  lessons,
  progress,
  currentLessonId,
}: {
  lessons: Lesson[];
  progress: Record<string, number>;
  currentLessonId: string | null;
}) {
  return (
    <div className="flex h-1 gap-0.5" aria-hidden>
      {lessons.map((lesson) => {
        const value = progress[lesson.id] ?? 0;
        const color =
          lesson.id === currentLessonId
            ? "var(--accent-text)"
            : value >= 1
              ? "var(--success)"
              : value > 0
                ? "var(--ink-45)"
                : "var(--ink-16)";
        return (
          <span
            key={lesson.id}
            className="flex-1 rounded-pill"
            style={{ backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}

export function ClassSummary({
  klass,
  lessons,
  progress,
  currentLessonId,
  assignmentRows,
  onOpenLesson,
  onOpenAssessment,
}: ClassSummaryProps) {
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);
  const [resources, setResources] = useState<LessonChatResource[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGrades(null);
    setResources(null);
    void fetchStudentGrades()
      .then((rows) => !cancelled && setGrades(rows.filter((row) => row.class_id === klass.id)))
      .catch(() => !cancelled && setGrades([]));
    void fetchClassResources(klass.id)
      .then((rows) => !cancelled && setResources(rows))
      .catch(() => !cancelled && setResources([]));
    return () => {
      cancelled = true;
    };
  }, [klass.id]);

  const groups = useMemo(() => (lessons ? groupByUnit(lessons) : []), [lessons]);
  const done = (lessons ?? []).filter((l) => (progress[l.id] ?? 0) >= 1).length;
  const due = assignmentRows.filter((r) => r.state === "todo" || r.state === "in_progress");
  const released = useMemo(
    () =>
      (grades ?? [])
        .filter((row) => row.score !== null)
        .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? "")),
    [grades],
  );
  const average = released.length
    ? released.reduce((sum, row) => sum + (row.score ?? 0), 0) / released.length
    : null;

  // Recent = the lesson to pick back up: in-progress first, else the first unstarted one.
  const resumeLesson = useMemo(() => {
    if (!lessons) return null;
    return (
      lessons.find((l) => {
        const v = progress[l.id] ?? 0;
        return v > 0 && v < 1;
      }) ??
      lessons.find((l) => (progress[l.id] ?? 0) === 0) ??
      null
    );
  }, [lessons, progress]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="mx-auto w-full max-w-4xl">
        {/* ---- Identity band + color-coded stats -------------------------------------- */}
        <header className="mb-7 flex flex-wrap items-center gap-4">
          <ClassAvatar name={klass.name} size={10} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-bold tracking-[-0.015em] text-foreground">
              {klass.name}
            </h1>
            {klass.organizationName ? (
              <p className="truncate text-meta text-muted-foreground">{klass.organizationName}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatPill
              color={lessons && done === lessons.length && done > 0 ? "var(--success)" : undefined}
              ariaLabel={`${done} of ${lessons?.length ?? 0} lessons complete`}
            >
              {done}/{lessons?.length ?? "…"} LESSONS
            </StatPill>
            {due.length ? <StatPill filled>{due.length} due</StatPill> : null}
            {average !== null ? (
              <StatPill ariaLabel="Average released grade">AVG {formatScore(average)}</StatPill>
            ) : null}
          </div>
        </header>

        {/* ---- 1. Recent --------------------------------------------------------------- */}
        <SectionLabel>Recent</SectionLabel>
        <div className="mb-7 grid gap-3 md:grid-cols-2">
          <div className="rounded-card border border-border bg-depth-card p-4 shadow-card">
            <h3 className="mb-2 flex items-center gap-2 text-body font-semibold text-foreground">
              <Play className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
              Pick up where you left off
            </h3>
            {lessons === null ? (
              <p className="flex items-center gap-2 text-meta text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            ) : resumeLesson ? (
              <button
                type="button"
                onClick={() => onOpenLesson(resumeLesson.id)}
                className="hvp group flex w-full items-center gap-2.5 rounded-control border border-border px-3 py-2.5 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
              >
                <ProgressGlyph
                  value={progress[resumeLesson.id] ?? 0}
                  current={resumeLesson.id === currentLessonId}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-foreground">
                    {resumeLesson.title}
                  </span>
                  {resumeLesson.unit_title ? (
                    <span className="block truncate text-meta text-muted-foreground">
                      {resumeLesson.unit_title}
                    </span>
                  ) : null}
                </span>
                <ArrowRight
                  className="hvr h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.7}
                />
              </button>
            ) : (
              <p className="text-body text-muted-foreground">
                Everything here is finished — nice work.
              </p>
            )}
          </div>

          <div className="rounded-card border border-border bg-depth-card p-4 shadow-card">
            <h3 className="mb-2 text-body font-semibold text-foreground">Latest grades</h3>
            {grades === null ? (
              <p className="flex items-center gap-2 text-meta text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            ) : released.length ? (
              <ul className="flex flex-col">
                {released.slice(0, 3).map((row) => (
                  <li
                    key={row.id}
                    className="hvp flex items-baseline gap-3 border-b border-border py-1.5 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">
                      {row.title}
                    </span>
                    <span className="hvr shrink-0 text-meta text-muted-foreground">
                      {row.submitted_at ? formatDate(row.submitted_at) : ""}
                    </span>
                    <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-foreground">
                      {formatScore(row.score)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">No graded work yet.</p>
            )}
          </div>
        </div>

        {/* ---- 2. Quizzes & assignments ------------------------------------------------ */}
        <SectionLabel>Quizzes &amp; assignments</SectionLabel>
        <div className="mb-7 rounded-card border border-border bg-depth-card p-3 shadow-card">
          {assignmentRows.length ? (
            <ul className="flex flex-col">
              {[...assignmentRows]
                .sort((a, b) => {
                  const rank = (r: CheckpointRowModel) =>
                    r.state === "todo" || r.state === "in_progress" ? 0 : 1;
                  return rank(a) - rank(b);
                })
                .map((row) => (
                  <WorkRow key={row.id} row={row} onOpen={onOpenAssessment} />
                ))}
            </ul>
          ) : (
            <p className="px-2 py-1 text-body text-muted-foreground">
              Nothing assigned in this class yet.
            </p>
          )}
        </div>

        {/* ---- 3. Units & lessons ------------------------------------------------------ */}
        <SectionLabel>Units &amp; lessons</SectionLabel>
        <div className="mb-7 flex flex-col gap-3">
          {lessons === null ? (
            <p className="flex items-center gap-2 text-meta text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          ) : groups.length ? (
            groups.map((group) => {
              const unitDone = group.lessons.filter((l) => (progress[l.id] ?? 0) >= 1).length;
              return (
                <div
                  key={group.unitId}
                  className="rounded-card border border-border bg-depth-card p-4 shadow-card"
                >
                  <div className="mb-2 flex items-baseline gap-3">
                    <h3 className="min-w-0 flex-1 truncate text-body font-semibold text-foreground">
                      {group.unitTitle}
                    </h3>
                    <span
                      className="shrink-0 font-mono text-overline tracking-[0.14em]"
                      style={{
                        color:
                          unitDone === group.lessons.length && unitDone > 0
                            ? "var(--success)"
                            : "var(--ink-45)",
                      }}
                    >
                      {unitDone}/{group.lessons.length}
                    </span>
                  </div>
                  <UnitBar
                    lessons={group.lessons}
                    progress={progress}
                    currentLessonId={currentLessonId}
                  />
                  <div className="mt-2 flex flex-col">
                    {group.lessons.map((lesson) => {
                      const current = lesson.id === currentLessonId;
                      const value = progress[lesson.id] ?? 0;
                      return (
                        <button
                          key={lesson.id}
                          type="button"
                          onClick={() => onOpenLesson(lesson.id)}
                          aria-current={current ? "true" : undefined}
                          className={`hvp flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left text-body transition-colors duration-(--dur-fast) ${
                            current
                              ? "bg-muted font-semibold text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <ProgressGlyph value={value} current={current} />
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              value >= 1 && !current
                                ? "line-through decoration-[var(--ink-16)]"
                                : ""
                            }`}
                          >
                            {lesson.title}
                          </span>
                          <span className="hvr inline-flex shrink-0 items-center gap-1 rounded-pill border border-border px-2 py-0.5 text-overline font-semibold text-foreground">
                            {value >= 1 ? "Revisit" : value > 0 ? "Continue" : "Start"}
                            <ArrowRight className="h-2.5 w-2.5" strokeWidth={2.2} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-body text-muted-foreground">No published lessons yet.</p>
          )}
        </div>

        {/* ---- 4. Resources ------------------------------------------------------------ */}
        <SectionLabel>Resources</SectionLabel>
        <div className="flex flex-col gap-2 pb-6">
          {resources === null ? (
            <p className="flex items-center gap-2 text-meta text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          ) : resources.length ? (
            resources.map((resource) => <ResourceCard key={resource.id} resource={resource} />)
          ) : (
            <p className="text-body text-muted-foreground">
              No materials shared with this class yet.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
