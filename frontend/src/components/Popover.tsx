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
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className="relative">
      {trigger}
      {open ? (
        <div
          className={`absolute right-0 top-[calc(100%+8px)] z-[var(--z-menu)] ${panelClassName ?? ""}`}
          style={panelStyle}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
