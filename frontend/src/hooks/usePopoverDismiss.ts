import { useEffect, type RefObject } from "react";

// Shared dismissal for any anchored floating surface: outside-tap + capture-phase Escape with
// preventDefault (the Radix dismissable-layer pattern), so ESC dismisses ONLY the innermost
// surface — outer listeners (e.g. the panel exit) check defaultPrevented and see it consumed.
// Used by components/Popover and the v5 edge flyouts.
export function usePopoverDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const onDoc = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [active, onClose, ref]);
}
