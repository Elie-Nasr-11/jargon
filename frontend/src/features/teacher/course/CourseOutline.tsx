/**
 * The course, as one outline: units, and the lessons inside them.
 *
 * This is the whole screen (rebuild brief, step 4) — there are no panels beside
 * it. Every row says its state in the words a teacher would use ("draft · pp.
 * 31–45", "empty"), one Add control sits at each level and names what it adds,
 * and both levels reorder by drag.
 *
 * Material does not appear here. It belongs to the lesson that shows it, which
 * is where it now lives.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChevronRight,
  GripVertical,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { OverflowMenu } from "@/components/OverflowMenu";
import { ReorderList, dropClass } from "@/features/teacher/authoring/dragList";
import { bookSourceFor } from "@/features/teacher/bookSource";
import type { CurriculumUnit, Lesson } from "@/lib/types";

/** "draft · 8 steps · pp. 31–45" — what this lesson is, in one line. */
export function lessonStateLine(
  lesson: Lesson,
  bookPages: Map<string, { first: number; last: number }>,
  stepCount: number,
): string {
  const parts: string[] = [];
  const status = lesson.publication_status || "published";
  if (status !== "published") parts.push(status);
  // An empty lesson is invisible in a tree of titles — say so, because it is the
  // one a teacher has to open.
  parts.push(stepCount === 0 ? "empty" : `${stepCount} step${stepCount === 1 ? "" : "s"}`);
  const source = bookSourceFor(lesson, bookPages, lesson.id);
  if (source?.firstPage) {
    parts.push(
      source.lastPage && source.lastPage !== source.firstPage
        ? `pp. ${source.firstPage}–${source.lastPage}`
        : `p. ${source.firstPage}`,
    );
  }
  return parts.join(" · ");
}

export function CourseOutline({
  units,
  lessonsForUnit,
  bookPages,
  stepCountFor,
  busy,
  renamingUnitId,
  onRenameStart,
  onRenameUnit,
  onDeleteUnit,
  onAddUnit,
  onAddLesson,
  onDraftLessons,
  onOpenLesson,
  onReorder,
  onBuildCourse,
  menu,
}: {
  units: Array<{ unit: CurriculumUnit }>;
  lessonsForUnit: (unitId: string) => Lesson[];
  bookPages: Map<string, { first: number; last: number }>;
  stepCountFor: (lessonId: string) => number;
  busy: boolean;
  renamingUnitId: string | null;
  onRenameStart: (unitId: string) => void;
  onRenameUnit: (unitId: string, title: string) => void;
  onDeleteUnit: (unitId: string) => void;
  onAddUnit: () => void;
  onAddLesson: (unitId: string) => void;
  onDraftLessons: (unitId: string) => void;
  onOpenLesson: (lessonId: string) => void;
  onReorder: (nodeType: "unit" | "lesson", orderedIds: string[]) => void;
  onBuildCourse: () => void;
  /** The course-scale actions, rendered inside the outline's own header. */
  menu?: ReactNode;
}) {
  if (!units.length) {
    return (
      <section className="rounded-card border border-dashed border-border bg-depth-card px-4 py-10 text-center shadow-card">
        <p className="text-body text-foreground">This class has no course yet.</p>
        <p className="mx-auto mt-1 max-w-[52ch] text-meta text-muted-foreground">
          Put your book in and Jargon drafts the units and lessons from it — you read what it
          wrote and publish what you approve. Or start an empty unit and write it yourself.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={onBuildCourse} disabled={busy} className="btn btn-primary">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
            Build the course from a book
          </button>
          <button type="button" onClick={onAddUnit} disabled={busy} className="btn btn-ghost">
            or add a unit yourself
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-border bg-depth-card p-2 shadow-card sm:p-3">
      {menu ? <div className="flex items-center justify-end px-1.5 pt-0.5">{menu}</div> : null}
      <ReorderList
        items={units.map(({ unit }) => unit)}
        disabled={busy}
        onReorder={(ids) => onReorder("unit", ids)}
      >
        {(unit, state) => (
          <div className={dropClass(state)}>
            <UnitBlock
              unit={unit}
              lessons={lessonsForUnit(unit.id)}
              bookPages={bookPages}
              stepCountFor={stepCountFor}
              busy={busy}
              renaming={renamingUnitId === unit.id}
              dragging={state.dragging}
              onRenameStart={() => onRenameStart(unit.id)}
              onRename={(title) => onRenameUnit(unit.id, title)}
              onDelete={() => onDeleteUnit(unit.id)}
              onAddLesson={() => onAddLesson(unit.id)}
              onDraftLessons={() => onDraftLessons(unit.id)}
              onOpenLesson={onOpenLesson}
              onReorderLessons={(ids) => onReorder("lesson", ids)}
            />
          </div>
        )}
      </ReorderList>
      <div className="px-1.5 pb-1 pt-2">
        <button type="button" onClick={onAddUnit} disabled={busy} className="btn btn-secondary btn-sm">
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          Add a unit
        </button>
      </div>
    </section>
  );
}

function UnitBlock({
  unit,
  lessons,
  bookPages,
  stepCountFor,
  busy,
  renaming,
  dragging,
  onRenameStart,
  onRename,
  onDelete,
  onAddLesson,
  onDraftLessons,
  onOpenLesson,
  onReorderLessons,
}: {
  unit: CurriculumUnit;
  lessons: Lesson[];
  bookPages: Map<string, { first: number; last: number }>;
  stepCountFor: (lessonId: string) => number;
  busy: boolean;
  renaming: boolean;
  dragging: boolean;
  onRenameStart: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onAddLesson: () => void;
  onDraftLessons: () => void;
  onOpenLesson: (lessonId: string) => void;
  onReorderLessons: (orderedIds: string[]) => void;
}) {
  return (
    <div className={`rounded-card px-1.5 py-2 ${dragging ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2 px-1.5">
        <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" strokeWidth={1.7} />
        {renaming ? (
          <UnitNameInput initial={unit.title} onCommit={onRename} />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-title font-medium text-foreground">
            {unit.title}
          </h3>
        )}
        <span className="shrink-0 text-meta text-muted-foreground">
          {lessons.length} lesson{lessons.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onAddLesson}
          disabled={busy}
          className="btn btn-ghost btn-sm shrink-0"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          Add a lesson
        </button>
        <OverflowMenu
          label={`Actions for ${unit.title}`}
          actions={[
            { label: "Rename this unit", icon: Pencil, disabled: busy, onClick: onRenameStart },
            {
              label: "Draft lessons from material…",
              icon: Sparkles,
              disabled: busy,
              onClick: onDraftLessons,
            },
            {
              label: "Delete this unit",
              icon: Trash2,
              tone: "danger",
              separatorBefore: true,
              disabled: busy || lessons.length > 0,
              onClick: onDelete,
            },
          ]}
        />
      </div>

      {lessons.length ? (
        <div className="mt-1.5 grid gap-1">
          <ReorderList items={lessons} disabled={busy} onReorder={onReorderLessons}>
            {(lesson, state) => (
              <div className={dropClass(state)}>
                <button
                  type="button"
                  onClick={() => onOpenLesson(lesson.id)}
                  className="flex w-full items-center gap-2 rounded-control border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-depth-sub"
                >
                  <GripVertical
                    className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/50"
                    strokeWidth={1.7}
                  />
                  <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                    {lesson.title}
                  </span>
                  <span className="shrink-0 text-meta text-muted-foreground">
                    {lessonStateLine(lesson, bookPages, stepCountFor(lesson.id))}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                </button>
              </div>
            )}
          </ReorderList>
        </div>
      ) : (
        <div className="mt-1.5 rounded-control border border-dashed border-border px-3 py-3 text-center">
          <span className="text-meta text-muted-foreground">No lessons in this unit yet. </span>
          <button
            type="button"
            onClick={onDraftLessons}
            disabled={busy}
            className="text-meta text-primary underline-offset-2 hover:underline"
          >
            Draft one from your material
          </button>
          <span className="text-meta text-muted-foreground"> or </span>
          <button
            type="button"
            onClick={onAddLesson}
            disabled={busy}
            className="text-meta text-primary underline-offset-2 hover:underline"
          >
            add an empty one
          </button>
          <span className="text-meta text-muted-foreground">.</span>
        </div>
      )}
    </div>
  );
}

/** The unit name edits in place — Enter or blur commits, Escape abandons. */
function UnitNameInput({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (title: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(value.trim());
        if (event.key === "Escape") onCommit(initial);
      }}
      aria-label="Unit name"
      className="jargon-input min-w-0 flex-1"
    />
  );
}
