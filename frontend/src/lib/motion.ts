// Reduced-motion helper for GSAP-driven animation.
//
// The global CSS `@media (prefers-reduced-motion: reduce)` block in styles.css
// neutralizes CSS keyframes/transitions, but GSAP runs in JS and is unaffected
// by it. Call prefersReducedMotion() before a tween and snap to the final
// state instead of animating when the user asks for reduced motion.
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches === true
  );
}
