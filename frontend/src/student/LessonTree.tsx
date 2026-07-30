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
// A single unit reads better as a flat list than as one collapsible containing everything, so
// that case skips the accordion.

export type LessonTreeProps = {
  lessons: Lesson[];
  currentLessonId: string | null;
  onOpenLesson: (lessonId: string) => void;
  // Switching lesson mid-turn is refused upstream; disabling the rows means the refusal never
  // reads as a broken click.
  disabled?: boolean;
};

export function LessonTree({ lessons, currentLessonId, onOpenLesson, disabled }: LessonTreeProps) {
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
        <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
      </button>
    );
  };

  return (
    <>
      <div className="mb-1 px-2.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Lessons
      </div>
      {groups.length > 1
        ? groups.map((group) => (
            <Collapsible
              key={group.unitId}
              open={openUnits[group.unitId] ?? false}
              onToggle={() =>
                setOpenUnits((s) => ({ ...s, [group.unitId]: !(s[group.unitId] ?? false) }))
              }
              headerClassName="mt-0.5 rounded-control px-2 py-1.5 text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted/60"
              title={<span className="truncate font-medium">{group.unitTitle}</span>}
              meta={
                <span className="shrink-0 pl-1 text-meta tabular-nums text-muted-foreground">
                  {group.lessons.length}
                </span>
              }
              bodyClassName="pb-1 pl-1.5"
            >
              {group.lessons.map(row)}
            </Collapsible>
          ))
        : (groups[0]?.lessons ?? []).map(row)}
    </>
  );
}
