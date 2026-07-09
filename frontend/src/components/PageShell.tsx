import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/motion";

// The v6 main-area page: a plain full page over the ambient background — no scrim, no slide-over,
// no translucency (the v5 overlay anatomy died with the ChatGPT-style shell). Centered column that
// owns its scroll; an optional back pill + serif title row; a tiny fade on entry. Focus lands on
// the title (or the page root) so keyboard/AT users arrive inside the page they opened. Cards
// inside supply their own surfaces. Shared by the student and teacher shells — widthClass lets
// wide surfaces (gradebook, curriculum studio) opt out of the 880px reading column.
export function PageShell({
  title,
  onBack,
  backLabel,
  widthClass = "max-w-[880px]",
  ariaLabel,
  children,
}: {
  title?: string;
  // Present only when there is a level above this one (class canvas → classes grid).
  onBack?: () => void;
  backLabel?: string;
  widthClass?: string;
  // What AT announces for the landmark. Pass this on pages whose visible heading lives inside a
  // card (no title prop) — otherwise the fallback announces the BACK target, not this page.
  ariaLabel?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (rootRef.current && !prefersReducedMotion()) {
      gsap.fromTo(
        rootRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.16, ease: "power2.out" },
      );
    }
    (headingRef.current ?? rootRef.current)?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      // The page IS the main content: on teacher routes it's the only surface; on the student
      // shell the chat's <main> is inert (hidden from AT) whenever a view page is mounted, so
      // exactly one main landmark is exposed either way.
      role="main"
      aria-label={ariaLabel ?? title ?? backLabel ?? "Page"}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain outline-none"
    >
      <div className={`mx-auto w-full ${widthClass} px-5 pb-16 pt-8 max-lg:pt-14 md:px-8`}>
        {title || onBack ? (
          <div className="mb-6 flex items-center gap-3">
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
            {title ? (
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="min-w-0 flex-1 truncate font-serif text-display text-foreground outline-none"
              >
                {title}
              </h1>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
