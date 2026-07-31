import { useEffect, useMemo, useState } from "react";
import { Collapsible } from "@/components/Collapsible";
import { groupByUnit } from "@/features/student/lessonGroups";
import type { Lesson } from "@/lib/types";

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

function ProgressGlyph({ value, current }: { value: number; current: boolean }) {
  // Three states, one legible 14px glyph: unstarted = hollow ring, in progress = ring with its
  // right half filled, done = filled disc with a check. The old 7px dots read as specks; at
  // this size the state is knowable without squinting. Color stays in the neutral ramp except
  // "current", which borrows the shared accent var so both themes work without a hex here.
  const ink = current ? "var(--accent-text)" : "currentColor";
  if (value >= 1) {
    return (
      <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0">
        <circle cx="8" cy="8" r="6.75" fill={ink} />
        <path
          d="M5.1 8.3l2.1 2.1 3.8-4.4"
          fill="none"
          stroke="var(--background)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (value > 0) {
    return (
      <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0">
        <circle cx="8" cy="8" r="6" fill="none" stroke={ink} strokeWidth="1.5" />
        {/* Right half filled: started, not finished. */}
        <path d="M8 2.75a5.25 5.25 0 0 1 0 10.5Z" fill={ink} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-50">
      <circle cx="8" cy="8" r="6" fill="none" stroke={ink} strokeWidth="1.5" />
    </svg>
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
        aria-current={current ? "true" : undefined}
        className={`flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-body transition-colors duration-(--dur-fast) disabled:opacity-40 ${
          current
            ? "bg-muted font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`}
      >
        <ProgressGlyph value={value} current={current} />
        <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
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
                className="shrink-0 pl-1 text-meta tabular-nums text-muted-foreground"
                aria-label={`${done} of ${total} lessons complete`}
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
