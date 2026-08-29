/**
 * Section 1 of 4: what this lesson IS.
 *
 * Title, objective, where it came from, whether students can see it, and the one
 * Save on the screen. It sticks to the top so the Save is reachable from
 * anywhere in a long steps list — a teacher should never scroll to find it.
 */
import { useState } from "react";
import { BookOpen, Check, Loader2 } from "lucide-react";
import { DraftFieldButton } from "@/features/teacher/DraftFieldButton";
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
  // R79: the assist is not standing chrome. It appears for a field that is EMPTY
  // (there is nothing to lose and everything to offer) or one the teacher is
  // actually writing in — and is invisible the rest of the time. The owner's note
  // on R76 was exact: "not as just an AI button for everything".
  const [writing, setWriting] = useState<"title" | "objective" | null>(null);
  const assistOn = (field: "title" | "objective") =>
    writing === field || !fields[field].trim();
  const fieldFocus = (field: "title" | "objective") => ({
    onFocus: () => setWriting(field),
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setWriting(null);
    },
  });

  const published = lesson.publication_status === "published";
  const source = bookSourceLabel(bookSourceFor(lesson, bookPages, lesson.id));

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
        <div className="flex items-start gap-2" {...fieldFocus("title")}>
          <input
            value={fields.title}
            onChange={(event) => onField("title", event.target.value)}
            aria-label="Lesson title"
            placeholder="Name this lesson"
            className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1 py-0.5 font-serif text-display text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-border focus:border-primary"
          />
          <div className="pt-1">
            {assistOn("title") ? (
            <DraftFieldButton
              field="lesson_title"
              current={fields.title}
              lessonId={lesson.id}
              disabled={busy}
              onDraft={(text) => onField("title", text)}
            />
            ) : null}
          </div>
        </div>
        <div className="flex items-start gap-2" {...fieldFocus("objective")}>
          <textarea
            value={fields.objective}
            onChange={(event) => onField("objective", event.target.value)}
            aria-label="Lesson objective"
            rows={2}
            placeholder="What should a student be able to do after this lesson?"
            className="min-w-0 flex-1 resize-y rounded-control border border-transparent bg-transparent px-1 py-0.5 text-body leading-relaxed text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-border focus:border-primary focus:text-foreground"
          />
          <div className="pt-1">
            {assistOn("objective") ? (
            <DraftFieldButton
              field="lesson_objective"
              current={fields.objective}
              lessonId={lesson.id}
              disabled={busy}
              onDraft={(text) => onField("objective", text)}
            />
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-3 border-t border-border/60 pt-2.5">
        <span className="text-meta text-muted-foreground">
          {unsaved
            ? `${unsaved} unsaved change${unsaved === 1 ? "" : "s"}`
            : "Everything is saved"}
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
