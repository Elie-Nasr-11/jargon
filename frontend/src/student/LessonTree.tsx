import { useEffect, useMemo, useState } from "react";
import { prefetchLesson } from "@/lib/api";
import { Collapsible } from "@/components/Collapsible";
import { groupByUnit } from "@/features/student/lessonGroups";
import type { Lesson } from "@/lib/types";
import { countOf } from "@/lib/format";

// The class → unit → lesson tree in the sidebar.
//
// Grouping is delegated to groupByUnit (features/student/lessonGroups.ts), the shared helper
// every catalog surface already uses — unit ordering and the "lessons with no unit" fallback
// are subtle enough that a second implementation would drift.
//
// Progress (DESIGN_V6 §4, owner decision): each unit header carries a done/total FRACTION
// ("2/5"), not a bare lesson count, and each lesson row carries a state dot. The signal is
// fetchStudentLessonProgress's per-lesson 0..1 map (1 = complete, 0.5 = in progress, absent =
// unstarted) — derived from the student's own learning_sessions, the same source the class
// canvas bars use, so the two surfaces can never disagree about what "done" means.
//
// A single unit reads better as a flat list than as one collapsible containing everything, so
// that case skips the accordion (its fraction moves up to the "Lessons" overline).

export type LessonTreeProps = {
  lessons: Lesson[];
  currentLessonId: string | null;
  // Per-lesson progress 0..1 keyed by lesson id (absent = unstarted).
  progress?: Record<string, number>;
  onOpenLesson: (lessonId: string) => void;
  // Switching lesson mid-turn is refused upstream; disabling the rows means the refusal never
  // reads as a broken click.
  disabled?: boolean;
};

export function ProgressGlyph({ value, current }: { value: number; current: boolean }) {
  // The design system's ring-and-dot (board 5b, lesson tree): a 15px ring whose HUE carries the
  // state — blue ring+dot on the live lesson, green ring+dot when done, ink ring+dot while in
  // progress, a faint hollow ring when unstarted. Hue does the work; no shape puzzle.
  const hue = current
    ? "var(--accent-text)"
    : value >= 1
      ? "var(--success)"
      : value > 0
        ? "var(--ink-45)"
        : null;
  if (!hue) {
    return (
      <span
        aria-hidden
        className="relative h-[15px] w-[15px] shrink-0 rounded-full"
        style={{ border: "1.5px solid var(--ink-16)" }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="relative h-[15px] w-[15px] shrink-0 rounded-full"
      style={{
        border: `1.5px solid ${hue}`,
        background: `radial-gradient(circle, ${hue} 40%, transparent 45%)`,
      }}
    />
  );
}

function unitFraction(lessons: Lesson[], progress: Record<string, number>) {
  const done = lessons.filter((l) => (progress[l.id] ?? 0) >= 1).length;
  return { done, total: lessons.length };
}

export function LessonTree({
  lessons,
  currentLessonId,
  progress = {},
  onOpenLesson,
  disabled,
}: LessonTreeProps) {
  const groups = useMemo(() => groupByUnit(lessons), [lessons]);
  const [openUnits, setOpenUnits] = useState<Record<string, boolean>>({});

  // Open the unit holding the current lesson, on load and whenever the lesson changes, while
  // merging so a unit the student opened themselves stays open.
  useEffect(() => {
    const unit = groups.find((g) => g.lessons.some((l) => l.id === currentLessonId))?.unitId;
    if (unit) setOpenUnits((s) => (s[unit] ? s : { ...s, [unit]: true }));
  }, [currentLessonId, groups]);

  if (!groups.length) return null;

  const row = (lesson: Lesson) => {
    const current = lesson.id === currentLessonId;
    const value = progress[lesson.id] ?? 0;
    return (
      <button
        key={lesson.id}
        type="button"
        disabled={disabled && !current}
        onClick={() => onOpenLesson(lesson.id)}
        // Phase E: hovering (or touch-starting) a lesson warms its steps, session, and
        // transcript so the actual open paints from cache.
        onPointerEnter={() => prefetchLesson(lesson.id)}
        aria-current={current ? "true" : undefined}
        className={`relative flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body transition-colors duration-(--dur-fast) disabled:opacity-40 ${
          current
            ? "bg-muted font-semibold text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`}
      >
        {/* Aurora is rationed to the ONE live thing per view — here, the live lesson. */}
        {current ? <span className="aurora-glow -inset-2 opacity-60" aria-hidden /> : null}
        <ProgressGlyph value={value} current={current} />
        <span
          className={`relative min-w-0 flex-1 truncate ${
            value >= 1 && !current ? "line-through decoration-[var(--ink-16)]" : ""
          }`}
        >
          {lesson.title}
        </span>
        {value >= 1 ? <span className="sr-only">(completed)</span> : null}
      </button>
    );
  };

  // No "Lessons" heading — the unit titles ARE the tree's labels. Every unit renders as a
  // collapsible (a lone unit just starts open), so the fraction always has a header to ride.
  return (
    <>
      {groups.map((group) => {
        const { done, total } = unitFraction(group.lessons, progress);
        return (
          <Collapsible
            key={group.unitId}
            open={openUnits[group.unitId] ?? groups.length === 1}
            onToggle={() =>
              setOpenUnits((s) => ({
                ...s,
                [group.unitId]: !(s[group.unitId] ?? groups.length === 1),
              }))
            }
            headerClassName="mt-0.5 rounded-control px-2 py-1.5 text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted/60"
            title={<span className="truncate font-medium">{group.unitTitle}</span>}
            meta={
              <span
                className="shrink-0 pl-1 font-mono text-overline tracking-[0.14em] text-muted-foreground"
                aria-label={`${done} of ${countOf(total, "lesson")} complete`}
              >
                {done}/{total}
              </span>
            }
            bodyClassName="pb-1 pl-1.5"
          >
            {group.lessons.map(row)}
          </Collapsible>
        );
      })}
    </>
  );
}
