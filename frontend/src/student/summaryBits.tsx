import type { ReactNode } from "react";
import { ClipboardCheck, NotebookPen } from "lucide-react";
import { formatDate, formatScore } from "@/lib/format";
import type { CheckpointRowModel } from "@/student/checkpoints";

// The summary-page vocabulary, shared by ClassSummary and the Home overview so both surfaces
// speak the same visual language: mono-overline section labels, the identity-band stat pills,
// and the 4-state work row (Start / Continue / Submitted / score).

export function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="mb-2 font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h2>
  );
}

// Identity-band pill. Outline = quiet mono counter (optionally tinted, e.g. success when
// complete); filled = the one loud variant, reserved for actionable "n due" (open-orange).
export function StatPill({
  filled = false,
  color,
  ariaLabel,
  children,
}: {
  filled?: boolean;
  color?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  if (filled) {
    return (
      <span
        className="ds-tag px-3 py-1.5 text-meta"
        style={{
          ["--tag-bg" as string]: "var(--mode-open)",
          ["--tag-ink" as string]: "var(--mode-open-ink)",
        }}
        aria-label={ariaLabel}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className="rounded-pill border border-border px-3 py-1.5 font-mono text-meta tracking-[0.08em]"
      style={{ color: color ?? "var(--ink-62)" }}
      aria-label={ariaLabel}
    >
      {children}
    </span>
  );
}

export function WorkRow({
  row,
  onOpen,
}: {
  row: CheckpointRowModel;
  // R48: receives the whole row — the shell dispatches on row.kind to the right surface.
  onOpen: (row: CheckpointRowModel) => void;
}) {
  const actionable = row.state === "todo" || row.state === "in_progress";
  const Icon = row.kind === "assignment" ? NotebookPen : ClipboardCheck;
  const body = (
    <>
      <Icon
        className="h-3.5 w-3.5 shrink-0"
        strokeWidth={1.7}
        style={{ color: actionable ? "var(--mode-open)" : "var(--ink-30)" }}
      />
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{row.title}</span>
      {row.dueAt ? (
        <span className="hvr shrink-0 text-meta text-muted-foreground">
          Due {formatDate(row.dueAt)}
        </span>
      ) : null}
      <span
        className="shrink-0 text-meta font-semibold"
        style={{ color: actionable ? "var(--mode-open)" : "var(--ink-45)" }}
      >
        {row.state === "todo"
          ? "Start"
          : row.state === "in_progress"
            ? "Continue"
            : row.state === "waiting_review"
              ? "Submitted"
              : formatScore(row.score)}
      </span>
    </>
  );
  return (
    <li>
      {actionable ? (
        <button
          type="button"
          onClick={() => onOpen(row)}
          className="hvp flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
        >
          {body}
        </button>
      ) : (
        <div className="hvp flex w-full items-center gap-2.5 px-2 py-2">{body}</div>
      )}
    </li>
  );
}
