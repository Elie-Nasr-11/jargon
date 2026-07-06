import type { ReactNode } from "react";

// The shared loading/empty/error note used across the student popup layer — one empty-state
// shape instead of per-surface hand-rolled variants.
export function StateNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-6 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  );
}
