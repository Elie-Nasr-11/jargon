import { useEffect, type RefObject } from "react";

// Shared dismissal for any anchored floating surface: outside-tap + capture-phase Escape with
// preventDefault (the Radix dismissable-layer pattern), so ESC dismisses ONLY the innermost
// surface — outer listeners (e.g. the route's view exit) check defaultPrevented and see it
// consumed. The Escape listener binds to WINDOW, not document: capture propagation visits window
// first, so this runs before Radix's document-capture escape handler regardless of registration
// order — ESC inside a Radix Sheet/Dialog closes the innermost popover, not the whole layer.
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
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [active, onClose, ref]);
}
