import { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarClock, CheckCircle2, ChevronRight, GraduationCap } from "lucide-react";
import { GradientCard } from "@/components/GradientCard";
import { StateNote } from "@/components/StateNote";
import { formatDate, formatScore } from "@/lib/format";
import {
  fetchClassScopedLessons,
  fetchStudentAssessments,
  fetchStudentClasses,
  fetchStudentGrades,
  fetchStudentLessonProgress,
} from "@/lib/api";
import type {
  Assessment,
  AssessmentAttempt,
  Lesson,
  StudentAssessmentBundle,
  StudentClass,
  StudentGradeRow,
} from "@/lib/types";

// The student LMS views — a class menu → per-class dashboard (unit cards) → per-unit lesson list.
// These are now PROP-DRIVEN content (no routing): the ClassesModal owns the drill-down state and
// hands off lesson opens to the chat surface. Class scoping reuses fetchClassScopedLessons (linked
// courses, or the full catalog when a class has no links); per-lesson progress from the student's
// own sessions.

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

export type UnitGroup = { unitId: string; unitTitle: string; lessons: Lesson[] };

// Group scoped lessons into units keyed by unit_id, preserving unit_position then position order.
function groupByUnit(lessons: Lesson[]): UnitGroup[] {
  const byUnit = new Map<string, { title: string; pos: number; lessons: Lesson[] }>();
  for (const lesson of lessons) {
    const unitId = lesson.unit_id || "__none__";
    let group = byUnit.get(unitId);
    if (!group) {
      group = {
        title: lesson.unit_title || lesson.course_title || "Lessons",
        pos: lesson.unit_position ?? Number.MAX_SAFE_INTEGER,
        lessons: [],
      };
      byUnit.set(unitId, group);
    }
    group.lessons.push(lesson);
  }
  return Array.from(byUnit, ([unitId, group]) => ({
    unitId,
    unitTitle: group.title,
    lessons: [...group.lessons].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  })).sort((a, b) => {
    const ap = a.lessons[0]?.unit_position ?? Number.MAX_SAFE_INTEGER;
    const bp = b.lessons[0]?.unit_position ?? Number.MAX_SAFE_INTEGER;
    return ap - bp;
  });
}

// The class dashboard's recent/upcoming work strip + grades summary, scoped to this class's
// checkpoints (assignments + assessments) from the student's own grade rows.
function ClassWorkSummary({ grades }: { grades: StudentGradeRow[] }) {
  const now = Date.now();
  const released = grades.filter((g) => g.score != null);
  const avg = released.length
    ? released.reduce((sum, g) => sum + (g.score ?? 0), 0) / released.length
    : null;
  const upcoming = grades
    .filter(
      (g) =>
        g.due_at &&
        Date.parse(g.due_at) >= now &&
        !g.submitted_at &&
        g.status !== "complete" &&
        g.status !== "returned",
    )
    .sort((a, b) => Date.parse(a.due_at as string) - Date.parse(b.due_at as string))
    .slice(0, 4);
  const recent = grades
    .filter((g) => g.submitted_at)
    .sort((a, b) => Date.parse(b.submitted_at as string) - Date.parse(a.submitted_at as string))
    .slice(0, 4);
  if (!upcoming.length && !recent.length && avg == null) return null;
  return (
    <GradientCard>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium text-foreground">Work</div>
          {avg != null ? (
            <div className="text-[12px] text-muted-foreground">
              {released.length} graded · avg {Math.round(avg * 100)}%
            </div>
          ) : null}
        </div>
        {upcoming.length ? (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Upcoming
            </div>
            <div className="mt-1.5 grid gap-1">
              {upcoming.map((g) => (
                <div key={g.id} className="flex items-center gap-2 text-[12.5px]">
                  <CalendarClock
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.7}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{g.title}</span>
                  <span className="shrink-0 text-muted-foreground">due {formatDate(g.due_at)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {recent.length ? (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Recent
            </div>
            <div className="mt-1.5 grid gap-1">
              {recent.map((g) => (
                <div key={g.id} className="flex items-center gap-2 text-[12.5px]">
                  <CheckCircle2
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.7}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{g.title}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {g.score != null ? `${Math.round(g.score * 100)}%` : g.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </GradientCard>
  );
}

// The unit view's assessment reviews: returned/graded assessments for the unit's lessons, with the
// teacher's final score + feedback (student self-reads its own attempts).
function AssessmentReviews({
  bundle,
  lessonIds,
}: {
  bundle: StudentAssessmentBundle;
  lessonIds: Set<string>;
}) {
  const reviews = useMemo(() => {
    const latestByAssessment = new Map<string, AssessmentAttempt>();
    for (const att of bundle.attempts) {
      const prev = latestByAssessment.get(att.assessment_id);
      if (!prev || Date.parse(att.updated_at) > Date.parse(prev.updated_at)) {
        latestByAssessment.set(att.assessment_id, att);
      }
    }
    return bundle.assessments
      .filter((a) => a.lesson_id && lessonIds.has(a.lesson_id))
      .map((assessment) => ({ assessment, attempt: latestByAssessment.get(assessment.id) ?? null }))
      .filter(
        (row): row is { assessment: Assessment; attempt: AssessmentAttempt } =>
          row.attempt !== null &&
          (row.attempt.status === "returned" || row.attempt.final_score != null),
      )
      .sort((a, b) => Date.parse(b.attempt.updated_at) - Date.parse(a.attempt.updated_at));
  }, [bundle, lessonIds]);

  if (!reviews.length) return null;
  return (
    <div className="mt-5">
      <div className="mb-2 text-[13px] font-medium text-foreground">Assessment reviews</div>
      <div className="grid gap-2">
        {reviews.map(({ assessment, attempt }) => (
          <GradientCard key={assessment.id}>
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-[14px] font-medium text-foreground">
                  {assessment.title}
                </div>
                {attempt.final_score != null ? (
                  <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[12px] tabular-nums text-foreground">
                    {Math.round(attempt.final_score * 100)}%
                  </span>
                ) : null}
              </div>
              {attempt.feedback ? (
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                  {attempt.feedback}
                </p>
              ) : null}
            </div>
          </GradientCard>
        ))}
      </div>
    </div>
  );
}

// --- class list --------------------------------------------------------------------------------
export function ClassMenu({ onSelectClass }: { onSelectClass: (cls: StudentClass) => void }) {
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchStudentClasses()
      .then((rows) => alive && setClasses(rows))
      .catch((e) => alive && setError((e as Error).message || "Could not load your classes."));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <StateNote>{error}</StateNote>;
  if (classes === null) return <StateNote>Loading your classes…</StateNote>;
  if (classes.length === 0) {
    return (
      <StateNote>
        You&apos;re not enrolled in a class yet. You can still browse every lesson from the chat.
      </StateNote>
    );
  }
  return (
    <div className="grid gap-3">
      {classes.map((cls) => (
        <button key={cls.id} type="button" onClick={() => onSelectClass(cls)} className="text-left">
          <GradientCard>
            <div className="flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-background/45">
                <GraduationCap className="h-5 w-5 text-foreground" strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-foreground">{cls.name}</div>
                {cls.organizationName ? (
                  <div className="truncate text-[12.5px] text-muted-foreground">
                    {cls.organizationName}
                  </div>
                ) : null}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
            </div>
          </GradientCard>
        </button>
      ))}
    </div>
  );
}

// --- class dashboard (unit cards) --------------------------------------------------------------
export function ClassDashboard({
  classId,
  onSelectUnit,
}: {
  classId: string;
  onSelectUnit: (unit: UnitGroup) => void;
}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [grades, setGrades] = useState<StudentGradeRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [scoped, prog, gradeRows] = await Promise.all([
          fetchClassScopedLessons(classId),
          fetchStudentLessonProgress().catch(() => ({}) as Record<string, number>),
          fetchStudentGrades().catch(() => [] as StudentGradeRow[]),
        ]);
        if (!alive) return;
        setLessons(scoped);
        setProgress(prog);
        setGrades(gradeRows);
      } catch (e) {
        if (alive) setError((e as Error).message || "Could not load this class.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [classId]);

  const units = useMemo(() => groupByUnit(lessons ?? []), [lessons]);
  const unitProgress = (group: UnitGroup): number => {
    if (!group.lessons.length) return 0;
    const sum = group.lessons.reduce((acc, l) => acc + (progress[l.id] ?? 0), 0);
    return sum / group.lessons.length;
  };

  if (error) return <StateNote>{error}</StateNote>;
  if (lessons === null) return <StateNote>Loading…</StateNote>;
  return (
    <div className="grid gap-3">
      <ClassWorkSummary grades={grades.filter((g) => g.class_id === classId)} />
      {units.length === 0 ? (
        <StateNote>No lessons are available in this class yet.</StateNote>
      ) : null}
      {units.map((group) => (
        <button
          key={group.unitId}
          type="button"
          onClick={() => onSelectUnit(group)}
          className="text-left"
        >
          <GradientCard>
            <div className="p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-background/45">
                  <BookOpen className="h-5 w-5 text-foreground" strokeWidth={1.6} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium text-foreground">
                    {group.unitTitle}
                  </div>
                  <div className="text-[12.5px] text-muted-foreground">
                    {group.lessons.length} lesson{group.lessons.length === 1 ? "" : "s"} ·{" "}
                    {formatScore(unitProgress(group))} complete
                  </div>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.7}
                />
              </div>
              <div className="mt-3">
                <ProgressBar value={unitProgress(group)} />
              </div>
            </div>
          </GradientCard>
        </button>
      ))}
    </div>
  );
}

// --- unit view (lesson list + assessment reviews) ----------------------------------------------
export function UnitView({
  classId,
  unitId,
  onOpenLesson,
}: {
  classId: string;
  unitId: string;
  onOpenLesson: (lessonId: string) => void;
}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [assessments, setAssessments] = useState<StudentAssessmentBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [scoped, prog, bundle] = await Promise.all([
          fetchClassScopedLessons(classId),
          fetchStudentLessonProgress().catch(() => ({}) as Record<string, number>),
          fetchStudentAssessments().catch(() => null),
        ]);
        if (!alive) return;
        setLessons(scoped);
        setProgress(prog);
        setAssessments(bundle);
      } catch (e) {
        if (alive) setError((e as Error).message || "Could not load this unit.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [classId]);

  const unit = useMemo(() => {
    const groups = groupByUnit(lessons ?? []);
    return groups.find((g) => g.unitId === unitId) || null;
  }, [lessons, unitId]);

  if (error) return <StateNote>{error}</StateNote>;
  if (lessons === null) return <StateNote>Loading…</StateNote>;
  if (!unit) return <StateNote>This unit is no longer available.</StateNote>;
  return (
    <>
      <div className="grid gap-2">
        {unit.lessons.map((lesson) => {
          const value = progress[lesson.id] ?? 0;
          return (
            <button
              key={lesson.id}
              type="button"
              onClick={() => onOpenLesson(lesson.id)}
              className="w-full text-left"
            >
              <GradientCard>
                <div className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-foreground">
                      {lesson.title}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="w-28 max-w-[45%]">
                        <ProgressBar value={value} />
                      </span>
                      <span className="text-[11.5px] tabular-nums text-muted-foreground">
                        {value >= 1 ? "Complete" : value > 0 ? "In progress" : "Not started"}
                      </span>
                    </div>
                  </div>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.7}
                  />
                </div>
              </GradientCard>
            </button>
          );
        })}
      </div>
      {assessments ? (
        <AssessmentReviews
          bundle={assessments}
          lessonIds={new Set(unit.lessons.map((l) => l.id))}
        />
      ) : null}
    </>
  );
}

export { StateNote };
