import { useEffect, useState } from "react";

// "Is this a touch / phone-sized surface" — used to switch header menus to a bottom-sheet
// layout that can't open off-screen. Resolved SYNCHRONOUSLY on the first render (this is a
// client-only SPA) so mobile never paints the desktop dropdown first, and detected from
// multiple signals so a device that doesn't report `pointer: coarse` (some in-app/webview or
// desktop-mode browsers) is still caught via touch points or a narrow viewport.
const COARSE_QUERY = "(pointer: coarse)";
const NARROW_QUERY = "(max-width: 639px)";

function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia;
  if (mm && (mm(COARSE_QUERY).matches || mm(NARROW_QUERY).matches)) return true;
  if (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0) return true;
  return false;
}

export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(detectTouch);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const queries = [window.matchMedia(COARSE_QUERY), window.matchMedia(NARROW_QUERY)];
    const update = () => setTouch(detectTouch());
    update();
    queries.forEach((q) => q.addEventListener?.("change", update));
    window.addEventListener("orientationchange", update);
    return () => {
      queries.forEach((q) => q.removeEventListener?.("change", update));
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return touch;
}
