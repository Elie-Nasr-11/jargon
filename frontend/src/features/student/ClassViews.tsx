import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, ChevronRight, GraduationCap } from "lucide-react";
import { GradientCard } from "@/components/GradientCard";
import {
  fetchClassScopedLessons,
  fetchStudentClasses,
  fetchStudentLessonProgress,
} from "@/lib/api";
import { store } from "@/lib/jargon-store";
import type { Lesson, StudentClass } from "@/lib/types";
import { useStudentGuard } from "@/features/student/useStudentGuard";

// v4.0 Phase 3b — the student LMS shell: a class menu → per-class dashboard (unit cards) → per-unit
// lesson list. Class scoping reuses fetchClassScopedLessons (linked courses, or the full catalog
// when a class has no links), and per-lesson progress comes from the student's own sessions. All
// three views open a lesson by handing off to the chat surface (store.setLessonId → /chat).

function pctLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

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

export function PageShell({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: { to: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        {back ? (
          <Link
            to={back.to}
            className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
            {back.label}
          </Link>
        ) : (
          <Link
            to="/chat"
            className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
            Back to chat
          </Link>
        )}
        <h1 className="font-serif text-[28px] leading-tight tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13.5px] text-muted-foreground">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function StateNote({ children }: { children: React.ReactNode }) {
  return (
    <GradientCard>
      <div className="p-6 text-center text-[13.5px] text-muted-foreground">{children}</div>
    </GradientCard>
  );
}

// Group scoped lessons into units keyed by unit_id, preserving unit_position then position order.
type UnitGroup = { unitId: string; unitTitle: string; lessons: Lesson[] };
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

function openLessonInChat(navigate: ReturnType<typeof useNavigate>, lessonId: string) {
  store.setLessonId(lessonId);
  navigate({ to: "/chat" });
}

// --- /classes ------------------------------------------------------------------------------
export function ClassMenu() {
  const { ready } = useStudentGuard();
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    fetchStudentClasses()
      .then((rows) => alive && setClasses(rows))
      .catch((e) => alive && setError((e as Error).message || "Could not load your classes."));
    return () => {
      alive = false;
    };
  }, [ready]);

  if (!ready) return <PageShell title="Classes" />;

  return (
    <PageShell title="Your classes" subtitle="Open a class to see its units, lessons, and work.">
      {error ? (
        <StateNote>{error}</StateNote>
      ) : classes === null ? (
        <StateNote>Loading your classes…</StateNote>
      ) : classes.length === 0 ? (
        <StateNote>
          You're not enrolled in a class yet. You can still browse every lesson from the chat.
        </StateNote>
      ) : (
        <div className="grid gap-3">
          {classes.map((cls) => (
            <Link key={cls.id} to="/classes/$classId" params={{ classId: cls.id }}>
              <GradientCard>
                <div className="flex items-center gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-background/45">
                    <GraduationCap className="h-5 w-5 text-foreground" strokeWidth={1.6} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-foreground">
                      {cls.name}
                    </div>
                    {cls.organizationName ? (
                      <div className="truncate text-[12.5px] text-muted-foreground">
                        {cls.organizationName}
                      </div>
                    ) : null}
                  </div>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.7}
                  />
                </div>
              </GradientCard>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}

// --- /classes/$classId ---------------------------------------------------------------------
export function ClassDashboard() {
  const { ready } = useStudentGuard();
  const { classId } = useParams({ from: "/classes/$classId" });
  const [cls, setCls] = useState<StudentClass | null>(null);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    (async () => {
      try {
        const [classes, scoped, prog] = await Promise.all([
          fetchStudentClasses(),
          fetchClassScopedLessons(classId),
          fetchStudentLessonProgress().catch(() => ({}) as Record<string, number>),
        ]);
        if (!alive) return;
        setCls(classes.find((c) => c.id === classId) || null);
        setLessons(scoped);
        setProgress(prog);
      } catch (e) {
        if (alive) setError((e as Error).message || "Could not load this class.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, classId]);

  const units = useMemo(() => groupByUnit(lessons ?? []), [lessons]);
  const unitProgress = (group: UnitGroup): number => {
    if (!group.lessons.length) return 0;
    const sum = group.lessons.reduce((acc, l) => acc + (progress[l.id] ?? 0), 0);
    return sum / group.lessons.length;
  };

  if (!ready) return <PageShell title="Class" />;

  return (
    <PageShell
      title={cls?.name || "Class"}
      subtitle={cls?.organizationName || undefined}
      back={{ to: "/classes", label: "All classes" }}
    >
      {error ? (
        <StateNote>{error}</StateNote>
      ) : lessons === null ? (
        <StateNote>Loading…</StateNote>
      ) : units.length === 0 ? (
        <StateNote>No lessons are available in this class yet.</StateNote>
      ) : (
        <div className="grid gap-3">
          {units.map((group) => (
            <Link
              key={group.unitId}
              to="/classes/$classId/unit/$unitId"
              params={{ classId, unitId: group.unitId }}
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
                        {pctLabel(unitProgress(group))} complete
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
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}

// --- /classes/$classId/unit/$unitId --------------------------------------------------------
export function UnitView() {
  const { ready } = useStudentGuard();
  const { classId, unitId } = useParams({ from: "/classes/$classId/unit/$unitId" });
  const navigate = useNavigate();
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    (async () => {
      try {
        const [scoped, prog] = await Promise.all([
          fetchClassScopedLessons(classId),
          fetchStudentLessonProgress().catch(() => ({}) as Record<string, number>),
        ]);
        if (!alive) return;
        setLessons(scoped);
        setProgress(prog);
      } catch (e) {
        if (alive) setError((e as Error).message || "Could not load this unit.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, classId]);

  const unit = useMemo(() => {
    const groups = groupByUnit(lessons ?? []);
    return groups.find((g) => g.unitId === unitId) || null;
  }, [lessons, unitId]);

  if (!ready) return <PageShell title="Unit" />;

  return (
    <PageShell
      title={unit?.unitTitle || "Unit"}
      subtitle={
        unit ? `${unit.lessons.length} lesson${unit.lessons.length === 1 ? "" : "s"}` : undefined
      }
      back={{ to: `/classes/${classId}`, label: "Back to class" }}
    >
      {error ? (
        <StateNote>{error}</StateNote>
      ) : lessons === null ? (
        <StateNote>Loading…</StateNote>
      ) : !unit ? (
        <StateNote>This unit is no longer available.</StateNote>
      ) : (
        <div className="grid gap-2">
          {unit.lessons.map((lesson) => {
            const value = progress[lesson.id] ?? 0;
            return (
              <button
                key={lesson.id}
                type="button"
                onClick={() => openLessonInChat(navigate, lesson.id)}
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
      )}
    </PageShell>
  );
}
