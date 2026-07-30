import { useMemo } from "react";
import { CheckCircle2, ClipboardCheck, Clock, Loader2 } from "lucide-react";
import { formatDate, formatScore } from "@/lib/format";
import { checkpointRows, type CheckpointRowModel } from "@/student/checkpoints";
import type { StudentAssessmentBundle } from "@/lib/types";

// The Checkpoints destination: every formal assessment assigned to this student, split into
// "to do" (assigned / attempt open) and "done" (submitted / returned / complete). Rows open
// the focused AssessmentSurface — this panel never starts an attempt itself. Row derivation
// lives in student/checkpoints.ts, shared with Home's due strip and the sidebar badge.
//
// Data arrives from the shell (one fetchStudentAssessments per mount of the student app);
// null means still loading.

export type CheckpointsPanelProps = {
  bundle: StudentAssessmentBundle | null;
  onOpenAssessment: (assessmentId: string) => void;
};

function Row({ row, onOpen }: { row: CheckpointRowModel; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-card border border-border bg-depth-card p-3 text-left transition-colors duration-(--dur-fast) hover:bg-muted/40"
      >
        <ClipboardCheck className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.6} />
        <span className="min-w-0 flex-1 truncate text-body text-foreground">{row.title}</span>
        {row.dueAt ? (
          <span className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
            <Clock className="h-3 w-3" strokeWidth={1.8} /> {formatDate(row.dueAt)}
          </span>
        ) : null}
        <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
          {row.state === "scored" ? (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" strokeWidth={1.8} />
              {row.score !== null ? formatScore(row.score) : "Returned"}
            </span>
          ) : row.state === "waiting_review" ? (
            "Waiting for review"
          ) : row.state === "in_progress" ? (
            "Continue"
          ) : (
            "Start"
          )}
        </span>
      </button>
    </li>
  );
}

export function CheckpointsPanel({ bundle, onOpenAssessment }: CheckpointsPanelProps) {
  const rows = useMemo(() => (bundle ? checkpointRows(bundle) : []), [bundle]);
  const todo = rows.filter((r) => r.state === "todo" || r.state === "in_progress");
  const done = rows.filter((r) => r.state === "waiting_review" || r.state === "scored");

  if (bundle === null) {
    return (
      <p className="flex items-center gap-2 text-body text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your checkpoints…
      </p>
    );
  }
  if (!rows.length) {
    return (
      <p className="rounded-card border border-dashed border-border bg-depth-sub p-6 text-body text-muted-foreground">
        Nothing assigned right now. Quizzes and tests your teacher assigns show up here.
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <section>
        <h2 className="mb-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          To do
        </h2>
        {todo.length ? (
          <ul className="flex flex-col gap-2">
            {todo.map((row) => (
              <Row key={row.id} row={row} onOpen={() => onOpenAssessment(row.id)} />
            ))}
          </ul>
        ) : (
          <p className="text-meta text-muted-foreground">All caught up.</p>
        )}
      </section>
      {done.length ? (
        <section>
          <h2 className="mb-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Done
          </h2>
          <ul className="flex flex-col gap-2">
            {done.map((row) => (
              <Row key={row.id} row={row} onOpen={() => onOpenAssessment(row.id)} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
