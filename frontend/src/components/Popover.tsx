import { useEffect, useRef, type ReactNode } from "react";

// The shared anchored-popover shell for header dropdowns (inbox, progress roadmap): one place
// owning outside-tap + Escape dismissal instead of each surface hand-rolling its own listeners.
// Heavy surfaces stay on ModalCard — this is the light tier of the two-tier overlay system.
export function Popover({
  open,
  onClose,
  trigger,
  children,
  panelClassName,
  panelStyle,
  placement = "bottom-end",
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
  // bottom-end: dropdown under a right-aligned trigger (default). right-start: flyout to the
  // trigger's right, top-aligned (the chat stepper's roadmap).
  placement?: "bottom-end" | "right-start";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    // Capture-phase + preventDefault (the Radix dismissable-layer pattern): ESC must dismiss
    // ONLY this innermost surface — outer listeners (e.g. the workspace-view exit) check
    // defaultPrevented and must see it consumed.
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
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className="relative">
      {trigger}
      {open ? (
        <div
          className={`absolute z-[var(--z-menu)] ${
            placement === "right-start"
              ? "left-[calc(100%+10px)] top-1/2 -translate-y-1/2"
              : "right-0 top-[calc(100%+8px)]"
          } ${panelClassName ?? ""}`}
          style={panelStyle}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
