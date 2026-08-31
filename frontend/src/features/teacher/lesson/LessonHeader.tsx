/**
 * Section 1 of 4: what this lesson IS.
 *
 * Title, objective, where it came from, whether students can see it, and the one
 * Save on the screen. It sticks to the top so the Save is reachable from
 * anywhere in a long steps list — a teacher should never scroll to find it.
 */
import { BookOpen, Check, Loader2 } from "lucide-react";
import { AutoTextarea } from "@/components/AutoTextarea";
import { SelectionRefine } from "@/features/teacher/assist/SelectionRefine";
import { useFieldProposal } from "@/features/teacher/assist/useFieldProposal";
import { OverflowMenu, type OverflowAction } from "@/components/OverflowMenu";
import { bookSourceFor, bookSourceLabel } from "@/features/teacher/bookSource";
import type { LessonMetaFields } from "@/features/teacher/lesson/lessonMeta";
import type { Lesson } from "@/lib/types";

export function LessonHeader({
  lesson,
  fields,
  onField,
  bookPages,
  busy,
  unsaved,
  saving,
  onSave,
  onPublish,
  actions,
}: {
  lesson: Lesson;
  fields: LessonMetaFields;
  onField: <K extends keyof LessonMetaFields>(field: K, value: LessonMetaFields[K]) => void;
  bookPages: Map<string, { first: number; last: number }>;
  busy: boolean;
  unsaved: number;
  saving: boolean;
  onSave: () => void;
  onPublish: () => void;
  actions: OverflowAction[];
}) {
  // R85: no assist button lives here any more. An empty title or objective ARRIVES
  // proposed (mechanism A, owned by LessonScreen); a written one is refined by
  // selecting the words you want changed (mechanism D). The brief's failure mode 3 is
  // this exact file's history: "the ask was for capability; I delivered chrome".

  const published = lesson.publication_status === "published";
  const source = bookSourceLabel(bookSourceFor(lesson, bookPages, lesson.id));

  // Mechanism A: an empty objective on a lesson that HAS something to draft from
  // arrives proposed. Grounded by default — `origin` is the book pages when there are
  // any, and doubles as the gate: no source and no title means nothing to draft from.
  const objectiveOrigin =
    source || (fields.title.trim() ? `the title "${fields.title.trim()}"` : "");
  const objective = useFieldProposal({
    field: "lesson_objective",
    lessonId: lesson.id,
    current: fields.objective,
    origin: objectiveOrigin,
    enabled: !busy,
  });

  return (
    <header className="rounded-card border border-border bg-depth-card px-4 py-4 shadow-card sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Where this lesson comes from. Silent for a hand-authored lesson — the
            page's own back link already names the unit, and saying it twice is noise. */}
        <p className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
          {source ? (
            <>
              <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
              <span className="truncate">{source}</span>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-overline uppercase tracking-[0.08em] ${
              published ? "border-success/35 text-success" : "border-border text-muted-foreground"
            }`}
          >
            {published ? "Students can see this" : "Draft"}
          </span>
          {published ? null : (
            <button
              type="button"
              onClick={onPublish}
              disabled={busy}
              className="btn btn-secondary btn-sm"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.8} />
              Publish
            </button>
          )}
          <OverflowMenu label="Lesson actions" actions={actions} />
        </div>
      </div>

      <div className="mt-2 grid gap-2">
        <div className="flex items-start gap-2">
          <SelectionRefine
            field="lesson_title"
            lessonId={lesson.id}
            value={fields.title}
            onChange={(next) => onField("title", next)}
            disabled={busy}
          >
            {/* Wraps rather than scrolls: in a one-line <input> a real lesson title
                ("Twelve pairs: reading the map") is cut off mid-word, and it got worse
                the moment the assistant panel took 400px off the page. singleLine keeps
                it a title — it wraps, it never takes a newline. */}
            <AutoTextarea
              value={fields.title}
              onChange={(next) => onField("title", next)}
              singleLine
              maxLines={3}
              aria-label="Lesson title"
              placeholder="Name this lesson"
              className="w-full rounded-control border border-transparent bg-transparent px-1 py-0.5 font-serif text-display text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-border focus:border-primary"
            />
          </SelectionRefine>
        </div>
        <div className="flex items-start gap-2">
          <SelectionRefine
            field="lesson_objective"
            lessonId={lesson.id}
            value={fields.objective}
            onChange={(next) => onField("objective", next)}
            disabled={busy}
          >
            <AutoTextarea
              value={fields.objective}
              onChange={(next) => onField("objective", next)}
              maxLines={8}
              aria-label="Lesson objective"
              placeholder="What should a student be able to do after this lesson?"
              className="w-full rounded-control border border-transparent bg-transparent px-1 py-0.5 text-body leading-relaxed text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-border focus:border-primary focus:text-foreground"
            />
          </SelectionRefine>
        </div>

        {/* Proposal state: real content, visually provisional, and it says where it came
            from. Nothing has been written — accepting fills the field, and the Save
            below is still the only thing that commits. */}
        {objective.state.status === "drafting" ? (
          <p className="flex items-center gap-1.5 px-1 text-meta text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            Drafting an objective from {objectiveOrigin}…
          </p>
        ) : objective.state.status === "offered" ? (
          <div className="rounded-card border border-primary/30 bg-primary/[0.04] px-3 py-2">
            <p className="text-body italic text-foreground">{objective.state.proposal.value}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onField("objective", objective.accept())}
                className="btn btn-primary btn-sm"
              >
                Use this
              </button>
              <button type="button" onClick={objective.dismiss} className="btn btn-ghost btn-sm">
                Dismiss
              </button>
              <span className="text-meta text-muted-foreground">
                Proposed from {objective.state.proposal.origin} · nothing is saved yet
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-end gap-3 border-t border-border/60 pt-2.5">
        <span className="text-meta text-muted-foreground">
          {unsaved ? `${unsaved} unsaved change${unsaved === 1 ? "" : "s"}` : "Everything is saved"}
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || saving || !unsaved}
          className="btn btn-primary btn-sm"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
          Save
        </button>
      </div>
    </header>
  );
}
