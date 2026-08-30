/**
 * What the outline shows about a whole COURSE, rather than one lesson.
 *
 * A build in flight reports itself lesson by lesson; a finished build opens its
 * review before anything is published. The lesson editor used to live here too —
 * R79 gave it its own screen, so this file holds only the course-scale panels.
 */
import type { CourseBuild } from "@/features/teacher/authoring/stepModel";
import type { LessonReview } from "@/lib/api";
import type { Lesson } from "@/lib/types";
import { AlertCircle, Check, ClipboardCheck, Loader2, Sparkles } from "lucide-react";

// R57: the whole-course build's face. A run is minutes long and made of many model
// calls, so the teacher gets a live per-lesson ledger — not a spinner: what is being
// written now, what landed, what failed and why (with a retry that re-queues only
// R70: the review gate. A course built from a book lands as twenty-odd drafts, and
// before this the only way to know what the machine wrote was to open every lesson —
// so in practice the first reader of an AI-written lesson was a student. This panel
// reports what is actually IN each draft (steps, what teaches, what checks, figures)
// and flags what is missing or broken, then publishes the set the teacher ticked.
//
// It deliberately shows no quality score. Blocking flags mean broken-as-data (no steps;
// a multiple-choice step with nothing to choose) and hold that ONE lesson back; every
// other flag is a note the teacher can publish straight past. Judgment stays theirs.
export function CourseReviewPanel({
  review,
  loading,
  selected,
  publishing,
  onToggle,
  onSelectAll,
  onPublish,
  onOpenLesson,
}: {
  review: LessonReview[];
  loading: boolean;
  selected: Set<string>;
  publishing: boolean;
  onToggle: (lessonId: string) => void;
  onSelectAll: (next: boolean) => void;
  onPublish: () => void;
  onOpenLesson: (lessonId: string) => void;
}) {
  const drafts = review.filter((item) => item.publication_status !== "published");
  const publishable = drafts.filter((item) => item.ready);
  const allSelected =
    publishable.length > 0 && publishable.every((item) => selected.has(item.lesson_id));
  const blocked = drafts.filter((item) => !item.ready);

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-meta text-muted-foreground">
              {loading
                ? "Reading what was written…"
                : drafts.length
                  ? `${drafts.length} draft ${drafts.length === 1 ? "lesson" : "lessons"} — check what each one contains, then publish the ones you are happy with.`
                  : "Every lesson here is already published."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {publishable.length ? (
              <button
                type="button"
                onClick={() => onSelectAll(!allSelected)}
                className="btn btn-secondary btn-sm"
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
            ) : null}
          </div>
        </div>

        {drafts.length ? (
          <div className="mt-3 grid max-h-[420px] gap-1.5 overflow-y-auto">
            {drafts.map((item) => {
              const checked = selected.has(item.lesson_id);
              return (
                <div
                  key={item.lesson_id}
                  className="rounded-control border border-border/70 bg-depth-sub px-3 py-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                      checked={checked}
                      disabled={!item.ready || publishing}
                      onChange={() => onToggle(item.lesson_id)}
                      aria-label={`Publish ${item.title}`}
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpenLesson(item.lesson_id)}
                        className="block max-w-full truncate text-left text-meta font-medium text-foreground hover:underline"
                      >
                        {item.title || "Untitled lesson"}
                      </button>
                      <div className="mt-0.5 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                        {item.counts.steps} steps · {item.counts.teaching} teach ·{" "}
                        {item.counts.checks} check · {item.counts.figures} figures
                      </div>
                      {item.flags.length ? (
                        <ul className="mt-1.5 grid gap-1">
                          {item.flags.map((flag) => (
                            <li
                              key={flag.code}
                              className={`flex items-start gap-1.5 text-meta ${
                                flag.level === "blocking" ? "text-danger" : "text-muted-foreground"
                              }`}
                            >
                              {flag.level === "blocking" ? (
                                <AlertCircle
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                  strokeWidth={2}
                                />
                              ) : (
                                <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                              )}
                              <span>{flag.text}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-1.5 flex items-center gap-1.5 text-meta text-success">
                          <Check className="h-3.5 w-3.5" strokeWidth={2} />
                          Nothing missing.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {drafts.length ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-meta text-muted-foreground">
              {blocked.length
                ? `${blocked.length} ${blocked.length === 1 ? "lesson needs" : "lessons need"} fixing before ${blocked.length === 1 ? "it" : "they"} can go out.`
                : "Nothing is blocked."}
            </p>
            <button
              type="button"
              onClick={onPublish}
              disabled={!selected.size || publishing}
              className="btn btn-primary btn-sm"
            >
              {publishing
                ? "Publishing…"
                : `Publish ${selected.size || 0} ${selected.size === 1 ? "lesson" : "lessons"}`}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// that lesson), and a Stop that takes effect between lessons.
export function CourseBuildProgress({
  build,
  onCancel,
  onResume,
  onRetry,
  onDismiss,
  onReview,
}: {
  build: CourseBuild;
  onCancel: () => void;
  onResume: () => void;
  onRetry: (index: number) => void;
  onDismiss: () => void;
  onReview?: () => void;
}) {
  const done = build.items.filter((item) => item.status === "done").length;
  const failed = build.items.filter((item) => item.status === "failed").length;
  const total = build.items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const finished = !build.running;

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-title font-medium text-foreground">
              <Sparkles className="h-4 w-4" strokeWidth={1.7} />
              {build.running
                ? `Building your course — ${done} of ${total} lessons`
                : build.canceled
                  ? `Build stopped — ${done} of ${total} lessons written`
                  : `Build finished — ${done} of ${total} lessons written`}
            </div>
            <p className="mt-1 text-meta text-muted-foreground">
              {build.running
                ? "Each lesson is written from its own part of your material. You can keep working — this keeps going."
                : failed
                  ? `${failed} ${failed === 1 ? "lesson" : "lessons"} need another try. Everything written is a draft until you publish it.`
                  : "Every lesson is a draft until you publish it."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {build.running ? (
              <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
                Stop after this lesson
              </button>
            ) : (
              <>
                {done + failed < total || failed ? (
                  <button type="button" onClick={onResume} className="btn btn-secondary btn-sm">
                    Resume
                  </button>
                ) : null}
                {onReview && done ? (
                  <button type="button" onClick={onReview} className="btn btn-primary btn-sm">
                    Review &amp; publish
                  </button>
                ) : null}
                <button type="button" onClick={onDismiss} className="btn btn-ghost btn-sm">
                  Dismiss
                </button>
              </>
            )}
          </div>
        </div>

        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-pill bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Course build progress"
        >
          <div
            className="h-full rounded-pill bg-primary transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-3 grid max-h-[280px] gap-1 overflow-y-auto">
          {build.items.map((item, index) => (
            <div
              key={`${item.unitId}-${index}`}
              className="flex items-center gap-2.5 rounded-control border border-border/70 bg-depth-sub px-3 py-2"
            >
              <span className="shrink-0" aria-hidden>
                {item.status === "done" ? (
                  <Check className="h-3.5 w-3.5 text-success" strokeWidth={2} />
                ) : item.status === "building" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" strokeWidth={2} />
                ) : item.status === "failed" ? (
                  <AlertCircle className="h-3.5 w-3.5 text-danger" strokeWidth={2} />
                ) : (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-meta text-foreground">
                  {item.builtTitle || item.lessonTitle}
                </span>
                <span className="block truncate text-overline uppercase tracking-[0.08em] text-muted-foreground">
                  {item.unitTitle}
                  {item.error ? ` · ${item.error}` : ""}
                </span>
              </span>
              {item.status === "failed" && finished ? (
                <button
                  type="button"
                  onClick={() => onRetry(index)}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MissingNode() {
  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-6 text-body text-muted-foreground">
        That item is no longer available. Pick another from the outline.
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lesson detail — lesson-level meta + an ordered, multi-step content editor.
// ---------------------------------------------------------------------------
