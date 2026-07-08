import { useRef, type ReactNode } from "react";
import { usePopoverDismiss } from "@/hooks/usePopoverDismiss";

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
  // bottom-end: dropdown under a right-aligned trigger (default). bottom-start: dropdown under a
  // left-aligned trigger (the full-width lesson roadmap strip). right-start: flyout to the
  // trigger's right, top-aligned. top-start: menu opening UPWARD from a bottom-anchored trigger
  // (the sidebar account row).
  placement?: "bottom-end" | "bottom-start" | "right-start" | "top-start";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(wrapRef, onClose, open);

  return (
    <div ref={wrapRef} className="relative">
      {trigger}
      {open ? (
        <div
          className={`absolute z-[var(--z-menu)] ${
            placement === "right-start"
              ? "left-[calc(100%+10px)] top-1/2 -translate-y-1/2"
              : placement === "top-start"
                ? "bottom-[calc(100%+8px)] left-0"
                : placement === "bottom-start"
                  ? "left-0 top-[calc(100%+8px)]"
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
