/**
 * The ambient layer, loaded after the page is.
 *
 * AmbientCanvas is a WebGL shader plane built on three.js — about 600 kB of the
 * bundle for a background wash. It is decoration: nothing depends on it and
 * nobody waits for it, so it must not sit on the path to first paint. This
 * wrapper mounts the real canvas only once the page has rendered, and renders
 * nothing at all for a viewer who asked for reduced motion.
 */
import { Suspense, lazy, useEffect, useState, type ComponentProps } from "react";
import { prefersReducedMotion } from "@/lib/motion";

const AmbientCanvas = lazy(() =>
  import("@/components/AmbientCanvas").then((module) => ({ default: module.AmbientCanvas })),
);

export function AmbientBackdrop(props: ComponentProps<typeof AmbientCanvas>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    // One frame after paint: the page is on screen before the shader starts loading.
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <AmbientCanvas {...props} />
    </Suspense>
  );
}
