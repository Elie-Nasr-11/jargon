import { useEffect, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { GradientCard } from "@/components/GradientCard";

// The v5 focus lockdown for graded work (quizzes, assignment submission). Built on the raw Radix
// Dialog — NOT the house DialogContent — because there must be no baked close X and no dismissal:
// while `locked`, ESC / outside click / outside interaction are all prevented; the ONLY exits are
// Submit (the parent flips state) or the explicit inline "Leave?" confirmation. Once the work is
// done (`locked` false — e.g. viewing a submitted quiz's result) the frame relaxes to a plain
// Close. Browser-back cannot dismiss it either — it is component state, not URL state.
export function FocusLock({
  open,
  kind,
  title,
  locked,
  leaveNote = "Leave and lose this progress?",
  onExit,
  children,
}: {
  open: boolean;
  kind: "Quiz" | "Assignment";
  title?: string;
  // true while work is in progress (full lockdown); false relaxes the frame to a plain Close.
  locked: boolean;
  leaveNote?: string;
  onExit: () => void;
  children: ReactNode;
}) {
  const [confirmLeave, setConfirmLeave] = useState(false);

  // A fresh open never inherits a stale confirmation strip.
  useEffect(() => {
    if (open) setConfirmLeave(false);
  }, [open]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !locked) onExit();
      }}
    >
      <DialogPrimitive.Portal>
        {/* One tier past the ordinary dialog scrim — the room goes dark. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(e) => {
            if (locked) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (locked) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (locked) e.preventDefault();
          }}
          className="fixed left-1/2 top-1/2 z-[var(--z-overlay)] w-[calc(100vw-16px)] max-w-3xl -translate-x-1/2 -translate-y-1/2 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 data-[state=open]:duration-200"
        >
          <GradientCard className="shadow-pop">
            <div className="flex h-[86dvh] flex-col">
              <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
                <DialogPrimitive.Title className="min-w-0 truncate text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  {kind}
                  {locked ? " · locked" : ""}
                  {title ? ` — ${title}` : ""}
                </DialogPrimitive.Title>
                {locked ? (
                  confirmLeave ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-meta text-muted-foreground">{leaveNote}</span>
                      <button
                        type="button"
                        onClick={onExit}
                        className="rounded-pill border border-danger/40 bg-danger/10 px-3 py-1 text-meta font-medium text-danger transition-colors duration-(--dur-fast) hover:bg-danger/20"
                      >
                        Leave
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmLeave(false)}
                        className="rounded-pill bg-foreground px-3 py-1 text-meta font-medium text-background transition-opacity duration-(--dur-fast) hover:opacity-90"
                      >
                        Stay
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmLeave(true)}
                      className="shrink-0 text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
                    >
                      Leave?
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={onExit}
                    className="shrink-0 rounded-pill border border-border px-3 py-1 text-meta font-medium text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
                  >
                    Close
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
                {children}
              </div>
            </div>
          </GradientCard>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
