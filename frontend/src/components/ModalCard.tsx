import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { GradientCard } from "./GradientCard";

// The centered mid-screen popup used across the student surface (profile, mentor, grades,
// notifications, classes). A Radix Dialog (dimmed backdrop, Escape/focus-trap) whose content is the
// app's GradientCard, so popups keep the house look. DialogContent's default box styling is stripped
// so only the GradientCard shows; the built-in close X sits in the card's top-right corner.

export function ModalCard({
  open,
  onOpenChange,
  title,
  children,
  className,
  overlayClassName,
  size = "default",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
  // Per-modal scrim override — e.g. a strong whole-background blur for focus cards.
  overlayClassName?: string;
  // "large" = the near-full-viewport hub variant: wider, and a FIXED height so tab switches
  // inside don't make the card jump.
  size?: "default" | "large";
}) {
  const width = className ?? (size === "large" ? "sm:max-w-4xl" : "sm:max-w-md");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName={overlayClassName}
        className={`block border-0 bg-transparent p-0 shadow-none ${width}`}
      >
        <GradientCard className="shadow-pop">
          <div className={`flex flex-col ${size === "large" ? "h-[86dvh]" : "max-h-[82vh]"}`}>
            <DialogTitle className="px-5 pb-2 pr-10 pt-4 text-[12px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {title}
            </DialogTitle>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
          </div>
        </GradientCard>
      </DialogContent>
    </Dialog>
  );
}
