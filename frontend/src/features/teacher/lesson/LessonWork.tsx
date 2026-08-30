/**
 * Section 3 of 4: the work set on this lesson.
 *
 * Job 3 is "attach an assignment or quiz to a lesson, for specific students,
 * with a due date" — so every row says all three, and the two Add buttons live
 * here, on the lesson, rather than behind a generic Create that would ask which
 * lesson afterwards.
 */
import { ClipboardCheck, NotebookPen, Plus } from "lucide-react";
import { dueLabel, recipientLabel, type LessonWorkRow } from "@/features/teacher/lesson/lessonWork";

export function LessonWork({
  rows,
  busy,
  onOpen,
  onCreate,
}: {
  rows: LessonWorkRow[];
  busy: boolean;
  onOpen: (kind: "assignment" | "assessment", id: string) => void;
  onCreate: (kind: "assignment" | "assessment") => void;
}) {
  return (
    <section className="rounded-card border border-border bg-depth-card p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title font-medium text-foreground">Work</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onCreate("assignment")}
            disabled={busy}
            className="btn btn-secondary btn-sm"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Assignment
          </button>
          <button
            type="button"
            onClick={() => onCreate("assessment")}
            disabled={busy}
            className="btn btn-secondary btn-sm"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Quiz
          </button>
        </div>
      </div>
      {rows.length ? (
        <div className="grid gap-1.5">
          {rows.map((row) => (
            <button
              key={`${row.kind}-${row.id}`}
              type="button"
              onClick={() => onOpen(row.kind, row.id)}
              className="flex items-start gap-2.5 rounded-control border border-border bg-depth-sub px-3 py-2.5 text-left transition-colors hover:border-primary"
            >
              {row.kind === "assignment" ? (
                <NotebookPen
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.7}
                />
              ) : (
                <ClipboardCheck
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.7}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-meta font-medium text-foreground">
                  {row.title}
                </span>
                <span className="mt-0.5 block truncate text-meta text-muted-foreground">
                  {recipientLabel(row.recipients)} · {dueLabel(row.dueAt)}
                  {row.stepNumber ? ` · step ${row.stepNumber}` : ""}
                </span>
              </span>
              {row.toMark ? (
                <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-overline uppercase tracking-[0.06em] text-warning">
                  {row.toMark} to mark
                </span>
              ) : null}
              <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                {row.status}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-meta text-muted-foreground">
          No assignment or quiz is set on this lesson.
        </p>
      )}
    </section>
  );
}
