import { useCallback, useEffect, useRef, useState } from "react";
import { usePopoverDismiss } from "@/hooks/usePopoverDismiss";

// The rest → peek → open state machine behind every v5 edge presence (the interaction law:
// rest = minimal glyph · hover = slightly-more-desirable info · click = the tucked-away surface).
//   fine pointer — hover-intent 120ms in / 240ms grace out (crossing into the flyout keeps it);
//                  click opens.
//   keyboard     — focus peeks instantly; Enter/Space opens (native button click); ESC rests.
//   touch        — first tap peeks (the flyout carries an explicit Open row), second tap opens.
export function useEdgePresence(onOpen: () => void) {
  const [peek, setPeek] = useState(false);
  // The current peek came from a touch tap → the flyout is interactive (Open row), not aria-hidden.
  const [touchPeek, setTouchPeek] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerType = useRef("mouse");

  const clearTimers = () => {
    if (inTimer.current) clearTimeout(inTimer.current);
    if (outTimer.current) clearTimeout(outTimer.current);
    inTimer.current = null;
    outTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const rest = useCallback(() => {
    clearTimers();
    setPeek(false);
    setTouchPeek(false);
  }, []);

  const open = useCallback(() => {
    rest();
    onOpen();
  }, [onOpen, rest]);

  // A touch peek behaves like a tiny popover: outside tap (or ESC) rests it.
  usePopoverDismiss(wrapRef, rest, touchPeek);

  return {
    peek,
    touchPeek,
    rest,
    open,
    wrapRef,
    // Spread on the WRAP (glyph + flyout) so moving the pointer into the flyout keeps it open.
    hoverProps: {
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        if (outTimer.current) clearTimeout(outTimer.current);
        if (!inTimer.current) inTimer.current = setTimeout(() => setPeek(true), 120);
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        if (inTimer.current) {
          clearTimeout(inTimer.current);
          inTimer.current = null;
        }
        outTimer.current = setTimeout(() => {
          setPeek(false);
          setTouchPeek(false);
        }, 240);
      },
    },
    // Spread on the glyph BUTTON.
    triggerProps: {
      onFocus: () => setPeek(true),
      onBlur: (e: React.FocusEvent) => {
        if (wrapRef.current?.contains(e.relatedTarget as Node)) return;
        setPeek(false);
        setTouchPeek(false);
      },
      onPointerDown: (e: React.PointerEvent) => {
        lastPointerType.current = e.pointerType;
      },
      onClick: () => {
        if (lastPointerType.current === "touch" && !touchPeek) {
          setPeek(true);
          setTouchPeek(true);
          return;
        }
        open();
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape" && peek) {
          e.preventDefault();
          e.stopPropagation();
          rest();
        }
      },
    },
  };
}
