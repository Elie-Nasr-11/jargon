import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/motion";

// An animated count for sidebar badges (unread, work due). DESIGN_V6 §3: "number flips
// animate; badges never blink" — when the value changes, the old digit slides out and the
// new one slides in; the badge itself never appears/disappears mid-flip (mount/unmount is
// the CALLER's concern, this component only ever animates a value it is given).
//
// Reduced motion snaps to the new value instantly — the flip is a JS tween, out of reach of
// the CSS reduced-motion block, so the guard lives here.

export function FlipNumber({ value, max = 99 }: { value: number; max?: number }) {
  const [shown, setShown] = useState(value);
  const spanRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef(value);

  useLayoutEffect(() => {
    if (value === prevRef.current) return;
    const rising = value > prevRef.current;
    prevRef.current = value;
    const el = spanRef.current;
    if (!el || prefersReducedMotion()) {
      setShown(value);
      return;
    }
    // Out the old, swap, in the new. 2×140ms keeps the whole flip inside the fast band.
    gsap.killTweensOf(el);
    gsap.to(el, {
      y: rising ? -7 : 7,
      opacity: 0,
      duration: 0.14,
      ease: "power2.in",
      onComplete: () => {
        setShown(value);
        gsap.fromTo(
          el,
          { y: rising ? 7 : -7, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.14, ease: "power2.out" },
        );
      },
    });
  }, [value]);

  return (
    <span ref={spanRef} className="inline-block tabular-nums">
      {shown > max ? `${max}+` : shown}
    </span>
  );
}
