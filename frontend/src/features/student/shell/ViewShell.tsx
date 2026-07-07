import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/motion";

// The chrome every workspace view sits in: a back-to-chat pill + serif display title + optional
// actions, above a scroll body that reproduces the old ModalCard scroll semantics — WITHOUT any
// dialog mechanics (no backdrop, no focus trap; the sidebar stays live). Entrance is a single
// crisp rise; there is no exit animation (the outgoing view is removed instantly — solid, not
// springy). ESC-to-chat lives in the ViewHost, not here.
export function ViewShell({
  title,
  onBack,
  actions,
  fill = false,
  children,
}: {
  title: string;
  onBack: () => void;
  actions?: ReactNode;
  // fill: the body child stretches to the full view height (Messages' thread layout);
  // default: content flows and the body scrolls.
  fill?: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReducedMotion() || !rootRef.current) return;
    gsap.fromTo(
      rootRef.current,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.2, ease: "power2.out" },
    );
  }, []);

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-[880px] items-center gap-3 px-6 pb-4 pt-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border bg-depth-card px-3 py-1.5 text-meta font-medium text-muted-foreground shadow-card transition-colors duration-(--dur-fast) hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
          Chat
        </button>
        <h1 className="min-w-0 flex-1 truncate font-serif text-display text-foreground">{title}</h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-10">
        <div
          className={`mx-auto w-full max-w-[880px] ${fill ? "flex h-full min-h-0 flex-col" : ""}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
