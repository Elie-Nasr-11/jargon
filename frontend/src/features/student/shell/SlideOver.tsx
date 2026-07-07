import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/motion";

// The v5 panel surface: everything non-chat opens as a right-aligned slide-over ABOVE the dimmed
// stage — the chat never unmounts and never moves. md+ gets a min(600px,100vw) column with a soft
// see-through scrim (click closes); below md the column is effectively full-screen. Entrance only
// (x 24→0, crisp); removal is instant — solid, not springy. ESC handling lives in the route (one
// URL level per press); the back pill pops one level while the scrim/X close outright.
export function SlideOver({
  title,
  onClose,
  onBack,
  backLabel,
  actions,
  fill = false,
  children,
}: {
  title: string;
  onClose: () => void;
  // Present only when there is a level above this one (class canvas → classes grid).
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  // fill: the body child stretches to the full panel height (thread layouts); default: content
  // flows and the body scrolls.
  fill?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (panelRef.current && !prefersReducedMotion()) {
      gsap.fromTo(
        panelRef.current,
        { opacity: 0, x: 24 },
        { opacity: 1, x: 0, duration: 0.26, ease: "power3.out" },
      );
    }
    // Focus lands on the heading so keyboard/AT users arrive inside the panel they opened.
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 justify-end">
      {/* Soft scrim — the stage stays visible (dimmed + blurred) underneath; a click closes. The
          floating corner/edge chrome sits at --z-header, above this layer. */}
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: "color-mix(in oklab, var(--background) 45%, transparent)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        className="relative flex h-full w-full min-w-0 flex-col border-l border-border bg-[var(--surface-3)] shadow-pop backdrop-blur-md md:w-[min(600px,100vw)]"
      >
        <div className="flex items-center gap-3 px-5 pb-3 pt-5 sm:px-6">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border bg-depth-card px-3 py-1.5 text-meta font-medium text-muted-foreground shadow-card transition-colors duration-(--dur-fast) hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
              {backLabel ?? "Back"}
            </button>
          ) : null}
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="min-w-0 flex-1 truncate font-serif text-display text-foreground outline-none"
          >
            {title}
          </h1>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-surface-hover hover:text-foreground"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10 sm:px-6">
          <div className={fill ? "flex h-full min-h-0 flex-col" : undefined}>{children}</div>
        </div>
      </div>
    </div>
  );
}
