/**
 * The outline: the class's units and lessons as a single ordered tree.
 *
 * ClassworkList renders the tree (units, their lessons, and the work items each
 * lesson carries); OutlineRow is one row of it; ReorderList is the drag surface
 * both levels share. outlineLessonMeta is the one-line summary under a lesson
 * title - where it came from, how much of it exists.
 */
import { useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronRight, GripVertical, Plus } from "lucide-react";
import { OverflowMenu } from "@/components/OverflowMenu";
import { bookSourceFor, bookSourceLabel } from "@/features/teacher/bookSource";
import type { CurriculumNodeType, CurriculumUnit, Lesson } from "@/lib/types";
import type { ClassworkItem } from "@/features/teacher/authoring/types";
import { EmptyHint } from "@/features/teacher/authoring/fields";
import { ReorderList, dropClass } from "@/features/teacher/authoring/dragList";

// R44/R50 shared-content honesty, one banner for both faces (R60): the outline and the
// lesson editor both announce when the class is looking at a shared course, and carry
// the fork button the server's "duplicate first" refusal points at.
export function SharedCourseNotice({
  notice,
  busy,
  onDuplicate,
}: {
  notice: { courseId: string; names: string; isGlobal: boolean };
  busy: boolean;
  onDuplicate: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-border bg-depth-sub px-3.5 py-2.5 text-meta text-muted-foreground">
      <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
      <span className="min-w-0 flex-1">
        {notice.isGlobal ? (
          <>
            This is a shared book — duplicate it to edit or add lessons
            {notice.names ? (
              <>
                {" "}
                (also used by <span className="text-foreground">{notice.names}</span>)
              </>
            ) : null}
            .
          </>
        ) : (
          <>
            This course is shared — changes here also reach{" "}
            <span className="text-foreground">{notice.names}</span>.
          </>
        )}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onDuplicate}
        className="btn btn-secondary btn-sm shrink-0"
      >
        Duplicate for this class
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classwork list — the full-width face of the Classwork tab (R47). Units are topic
// headings (always expanded, Classroom-style); beneath each: lesson rows, then the
// work items (assignments / quizzes / materials) attached to those lessons. ONE
// "+ Create" menu makes everything; per-unit "+ Lesson" adds in place.
// ---------------------------------------------------------------------------

// R60: the unit name edits in place — commit on Enter or blur (a no-op when the title
// is unchanged or emptied), Escape cancels. A just-created unit mounts straight into
// this input so "New unit" -> type -> Enter is the whole flow.
export function UnitRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value.trim());
  };
  return (
    <div className="flex items-center gap-2 py-0.5 pl-1.5 pr-1">
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            done.current = true;
            onCancel();
          }
        }}
        aria-label="Unit name"
        className="jargon-input flex-1 !py-1.5 text-meta font-medium"
      />
    </div>
  );
}

// R45 consolidated (still true here): the class curriculum is ONE flat list of units —
// subject/course stay invisible plumbing (each unit knows its backing course, which
// powers the shared-content annotation). Unit drag-reorder stays off (adjacent units
// can live in different backing courses); lessons still drag within their unit.
// R73: what a lesson row says about itself. Draft state leads when there is one —
// that is what a teacher must act on — and a book lesson then names its pages, so the
// outline can be checked against the physical copy on the desk.
export function outlineLessonMeta(
  lesson: Lesson,
  bookPages: Map<string, { first: number; last: number }>,
  stepCount?: number,
): string {
  const status = lesson.publication_status || "published";
  // R74: an empty lesson is invisible in a tree of titles — say so on the row, because
  // a lesson with no steps teaches nothing and is the one a teacher must open.
  if (stepCount === 0) return status !== "published" ? `${status} · empty` : "empty";
  const source = bookSourceFor(lesson, bookPages, lesson.id);
  const pages = source?.firstPage
    ? source.lastPage && source.lastPage !== source.firstPage
      ? `pp. ${source.firstPage}–${source.lastPage}`
      : `p. ${source.firstPage}`
    : "";
  if (status !== "published") return pages ? `${status} · ${pages}` : status;
  return pages || status;
}

export function ClassworkList({
  units,
  lessonsForUnit,
  bookPages,
  stepCountFor,
  emptyHint,
  workItems,
  busy,
  renamingUnitId,
  onRenameUnit,
  onRenameStart,
  canDeleteUnit,
  onDeleteUnit,
  onBuildLesson,
  onSelectLesson,
  onOpenItem,
  onCreate,
  onAddUnit,
  onAddLesson,
  onReorder,
}: {
  units: Array<{ unit: CurriculumUnit; annotation: string | null }>;
  lessonsForUnit: (unitId: string) => Lesson[];
  // R73: min/max book page per lesson, for the source line on each row.
  bookPages: Map<string, { first: number; last: number }>;
  // R74: how many steps each lesson has, so an empty one is visible in the tree.
  stepCountFor: (lessonId: string) => number;
  emptyHint?: string;
  workItems: ClassworkItem[];
  busy: boolean;
  // R60: units are managed inline — click the name (or Rename) to edit it in place,
  // delete from the row menu once its lessons are gone. No unit pane exists.
  renamingUnitId: string | null;
  onRenameUnit: (id: string, title: string) => void;
  onRenameStart: (id: string) => void;
  canDeleteUnit: (id: string) => boolean;
  onDeleteUnit: (id: string) => void;
  // R75: "+ Lesson" opens the ONE builder; whether to work from reference material is
  // a choice inside it, not a fork before it.
  onBuildLesson: (unitId: string) => void;
  onSelectLesson: (id: string) => void;
  onOpenItem?: (kind: ClassworkItem["kind"], id: string) => void;
  onCreate?: (kind: "assignment" | "assessment" | "material") => void;
  onAddUnit: () => void;
  onAddLesson: (unitId: string) => void;
  onReorder: (type: CurriculumNodeType, orderedIds: string[]) => void;
}) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);

  // Work items grouped under the unit their lesson belongs to; anything whose lesson
  // isn't in this class's outline falls into a trailing "Other classwork" bucket so
  // nothing ever silently disappears.
  const lessonUnitById = new Map<string, string>();
  for (const { unit } of units) {
    for (const lesson of lessonsForUnit(unit.id)) lessonUnitById.set(lesson.id, unit.id);
  }
  const itemsByUnit = new Map<string, ClassworkItem[]>();
  const otherItems: ClassworkItem[] = [];
  for (const item of workItems) {
    const unitId = item.lessonId ? lessonUnitById.get(item.lessonId) : undefined;
    if (unitId) {
      const list = itemsByUnit.get(unitId) ?? [];
      list.push(item);
      itemsByUnit.set(unitId, list);
    } else {
      otherItems.push(item);
    }
  }

  const kindLabel = (kind: ClassworkItem["kind"]) =>
    kind === "assignment" ? "assignment" : kind === "assessment" ? "quiz" : "material";

  const itemRow = (item: ClassworkItem) => (
    <button
      key={`${item.kind}:${item.id}`}
      type="button"
      onClick={() => onOpenItem?.(item.kind, item.id)}
      className="flex min-w-0 items-center gap-2.5 rounded-control py-1.5 pl-7 pr-2 text-left transition-colors hover:bg-muted"
    >
      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-meta text-muted-foreground">
        {kindLabel(item.kind)}
      </span>
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{item.title}</span>
      {item.needsReviewCount > 0 ? (
        <span className="shrink-0 rounded-full border border-warning/40 bg-warning/12 px-2 py-0.5 text-meta text-warning">
          {item.needsReviewCount} to review
        </span>
      ) : null}
      <span className="shrink-0 text-meta text-muted-foreground">
        {item.status}
        {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ""}
      </span>
    </button>
  );

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Content
          </span>
          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCreateMenuOpen((value) => !value)}
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={createMenuOpen}
              className="btn btn-primary btn-sm gap-1"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              Create
            </button>
            {createMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 w-44 rounded-card border border-border bg-depth-card p-1 shadow-card"
              >
                {/* R60: assignments and quizzes are created in Activity — Content
                    creates the things students learn from. */}
                {([{ kind: "material", label: "Material" }] as const).map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onCreate?.(option.kind);
                    }}
                    className="block w-full rounded-control px-3 py-1.5 text-left text-meta text-foreground transition-colors hover:bg-muted"
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    onAddUnit();
                  }}
                  className="block w-full rounded-control px-3 py-1.5 text-left text-meta text-foreground transition-colors hover:bg-muted"
                >
                  Unit
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {units.length === 0 ? (
          <div className="rounded-card border border-dashed border-border px-3 py-6 text-center text-meta text-muted-foreground">
            {emptyHint ?? "No units yet. Create one to start the class's classwork."}
          </div>
        ) : (
          <div className="grid min-w-0 gap-4">
            {units.map(({ unit, annotation }) => {
              const lessons = lessonsForUnit(unit.id);
              const unitItems = itemsByUnit.get(unit.id) ?? [];
              return (
                <div key={unit.id} className="min-w-0">
                  {renamingUnitId === unit.id ? (
                    <UnitRenameInput
                      initial={unit.title}
                      onCommit={(title) => onRenameUnit(unit.id, title)}
                      onCancel={() => onRenameUnit(unit.id, "")}
                    />
                  ) : (
                    <div className="relative">
                      <OutlineRow
                        depth={0}
                        label={unit.title}
                        meta={[
                          `${lessons.length} lesson${lessons.length === 1 ? "" : "s"}`,
                          annotation ? "shared" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        metaTitle={annotation ?? undefined}
                        hasChildren={false}
                        selected={false}
                        onSelect={() => onRenameStart(unit.id)}
                        // R75: one door. The new-lesson builder itself asks whether to
                        // work from reference material, so there is no menu to pick a
                        // build STYLE before you have decided what the lesson is.
                        onAdd={() => onBuildLesson(unit.id)}
                        addLabel="Add lesson"
                        dragging={false}
                        showGrip={false}
                        trailing={
                          <OverflowMenu
                            label="Unit actions"
                            actions={[
                              { label: "Rename", onClick: () => onRenameStart(unit.id) },
                              {
                                label: "Delete unit",
                                tone: "danger",
                                disabled: busy || !canDeleteUnit(unit.id),
                                onClick: () => onDeleteUnit(unit.id),
                              },
                            ]}
                          />
                        }
                      />
                      {/* R75: there is no longer a fork between "build from material"
                          and "start blank". A lesson is a lesson; the ONE new-lesson
                          dialog offers reference material as an option inside it, which
                          is where the choice belongs — you decide what to build from
                          while you are building, not before you have started. */}
                    </div>
                  )}
                  <div className="mt-0.5 grid min-w-0 gap-0.5">
                    <ReorderList
                      items={lessons}
                      disabled={busy}
                      onReorder={(ids) => onReorder("lesson", ids)}
                    >
                      {(lesson, lessonState) => (
                        <div className={dropClass(lessonState)}>
                          <OutlineRow
                            depth={1}
                            label={lesson.title}
                            // R73: a book lesson says which pages it covers, so a
                            // teacher can check it against the copy on their desk.
                            // Draft state still leads when there is one — that is the
                            // thing they must act on.
                            meta={outlineLessonMeta(lesson, bookPages, stepCountFor(lesson.id))}
                            metaTitle={bookSourceLabel(bookSourceFor(lesson, bookPages, lesson.id))}
                            hasChildren={false}
                            selected={false}
                            onSelect={() => onSelectLesson(lesson.id)}
                            dragging={lessonState.dragging}
                          />
                        </div>
                      )}
                    </ReorderList>
                    {lessons.length === 0 ? <EmptyHint depth={1} label="No lessons" /> : null}
                    {unitItems.map(itemRow)}
                  </div>
                </div>
              );
            })}
            {otherItems.length ? (
              <div className="min-w-0">
                <div className="flex items-center gap-2 px-1.5 py-1 text-body font-medium text-foreground">
                  Other classwork
                  <span className="text-meta font-normal text-muted-foreground">
                    not attached to a unit here
                  </span>
                </div>
                <div className="mt-0.5 grid min-w-0 gap-0.5">{otherItems.map(itemRow)}</div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

export function OutlineRow({
  depth,
  label,
  meta,
  hasChildren,
  open,
  selected,
  onToggle,
  onSelect,
  onAdd,
  addLabel,
  dragging,
  showGrip = true,
  metaTitle,
  trailing,
}: {
  depth: number;
  label: string;
  meta?: string;
  hasChildren: boolean;
  open?: boolean;
  selected: boolean;
  onToggle?: () => void;
  onSelect: () => void;
  onAdd?: () => void;
  addLabel?: string;
  dragging: boolean;
  // R45: unit rows in the flat outline are not draggable — no grip affordance.
  showGrip?: boolean;
  // Tooltip for the meta chip (e.g. the full "also in …" class list behind "shared").
  metaTitle?: string;
  // R60: unit rows carry an overflow menu (Rename / Delete) after the add button.
  trailing?: ReactNode;
}) {
  return (
    <div
      className={`group flex min-w-0 items-center gap-1 overflow-hidden rounded-lg pr-1 transition-colors ${
        selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      } ${dragging ? "opacity-40" : ""}`}
      style={{ paddingLeft: `${depth * 14 + 2}px` }}
    >
      {showGrip ? (
        <span className="shrink-0 cursor-grab text-muted-foreground/60 group-hover:text-muted-foreground">
          <GripVertical className="h-3.5 w-3.5" strokeWidth={1.6} />
        </span>
      ) : (
        <span className="w-1 shrink-0" />
      )}
      {hasChildren ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          className={`shrink-0 ${selected ? "text-primary-foreground/80" : "text-muted-foreground"}`}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
            strokeWidth={1.7}
          />
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <span className={`min-w-0 flex-1 truncate text-meta ${depth === 0 ? "font-medium" : ""}`}>
          {label}
        </span>
        {meta ? (
          <span
            className={`max-w-[45%] shrink-0 truncate text-overline uppercase tracking-[0.08em] ${
              selected ? "text-primary-foreground/70" : "text-muted-foreground"
            }`}
            title={metaTitle}
          >
            {meta}
          </span>
        ) : null}
      </button>
      {onAdd ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAdd();
          }}
          title={addLabel}
          aria-label={addLabel}
          className={`shrink-0 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 ${
            selected
              ? "text-primary-foreground/80 hover:bg-background/20"
              : "text-muted-foreground hover:bg-depth-field"
          }`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      ) : null}
      {trailing ?? null}
    </div>
  );
}
