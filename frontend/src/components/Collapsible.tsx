import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/motion";

// A controlled disclosure shared by the sidebar's unit list and the class canvas's units. The
// header is a full-width button (rotating chevron + title slot + right-aligned meta slot); the
// body height-morphs open/closed. GSAP drives the height because the CSS reduced-motion block
// can't reach JS tweens — prefersReducedMotion() snaps instead. Collapsed content is `inert` so
// it never catches tab focus while hidden.
export function Collapsible({
  open,
  onToggle,
  title,
  meta,
  children,
  headerClassName,
  bodyClassName,
}: {
  open: boolean;
  onToggle: () => void;
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef(true);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const inner = innerRef.current;
    if (!body || !inner) return;
    // First paint: snap to the initial state, no entrance tween.
    if (firstRef.current) {
      firstRef.current = false;
      body.style.height = open ? "auto" : "0px";
      return;
    }
    if (prefersReducedMotion()) {
      body.style.height = open ? "auto" : "0px";
      return;
    }
    gsap.killTweensOf(body);
    const fromH = body.offsetHeight;
    gsap.fromTo(
      body,
      { height: fromH },
      {
        height: open ? inner.scrollHeight : 0,
        duration: 0.28,
        ease: "power3.out",
        // Release to auto once open so later content growth (e.g. async progress) isn't clipped.
        onComplete: () => {
          if (open && bodyRef.current) bodyRef.current.style.height = "auto";
        },
      },
    );
  }, [open]);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 text-left ${headerClassName ?? ""}`}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast) ${
            open ? "rotate-90" : ""
          }`}
          strokeWidth={2}
        />
        <span className="min-w-0 flex-1">{title}</span>
        {meta}
      </button>
      <div ref={bodyRef} className="overflow-hidden" style={{ height: 0 }}>
        <div ref={innerRef} className={bodyClassName} inert={open ? undefined : true}>
          {children}
        </div>
      </div>
    </div>
  );
}
