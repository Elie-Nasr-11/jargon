/**
 * Everything across all classes that is waiting on the teacher.
 *
 * The landing view's one job: if something needs marking or a look, it appears
 * here before the teacher has to go looking for it.
 */
import { relTime } from "@/features/teacher/console/derive";
import type { GlobalReviewRow } from "@/features/teacher/console/derive";

export function GlobalReviewQueue({
  rows,
  onOpen,
}: {
  rows: GlobalReviewRow[];
  onOpen: (row: GlobalReviewRow) => void;
}) {
  const nowMs = Date.now();
  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-body-lg font-medium text-foreground">To review</h2>
          <span className="text-meta text-muted-foreground">
            {rows.length ? `${rows.length} across your classes` : "all caught up"}
          </span>
        </div>
        {rows.length ? (
          <div className="mt-3 grid gap-2">
            {rows.map((row) => (
              <button
                key={`${row.kind}:${row.itemId}:${row.studentName}:${row.at}`}
                type="button"
                onClick={() => onOpen(row)}
                className="flex min-w-0 items-center gap-3 rounded-card border border-border bg-depth-sub px-4 py-2.5 text-left transition-colors hover:bg-muted"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />
                <span className="min-w-0 flex-1 truncate text-body text-foreground">
                  {row.studentName}
                  <span className="text-muted-foreground"> · {row.itemTitle}</span>
                </span>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-meta text-muted-foreground">
                  {row.kind === "assignment" ? "assignment" : "quiz"}
                </span>
                <span className="shrink-0 text-meta text-muted-foreground">{row.className}</span>
                <span className="shrink-0 text-meta text-muted-foreground">
                  {relTime(row.at, nowMs)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-meta text-muted-foreground">
            Nothing waiting on you — submitted work lands here the moment it arrives.
          </p>
        )}
      </div>
    </section>
  );
}
