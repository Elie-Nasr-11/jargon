import { useRef, type PointerEvent as ReactPointerEvent } from "react";

// A vertical drag handle for resizable columns. Pointer capture keeps the drag alive even
// over iframes (pdf/youtube panels swallow plain mousemove); the parent owns the width —
// this component only reports the horizontal delta from the drag's start.

export function ResizeHandle({
  ariaLabel,
  onStart,
  onDelta,
  onEnd,
}: {
  ariaLabel: string;
  onStart: () => void;
  // Total horizontal movement since pointerdown, in px (positive = right).
  onDelta: (dx: number) => void;
  onEnd: () => void;
}) {
  const startXRef = useRef(0);
  const draggingRef = useRef(false);

  const handleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startXRef.current = event.clientX;
    draggingRef.current = true;
    onStart();
  };
  const handleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onDelta(event.clientX - startXRef.current);
  };
  const handleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onEnd();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      // A slim always-there hit area that tints on hover/drag so the affordance is
      // discoverable without adding chrome.
      className="relative z-[var(--z-base)] -mx-[3px] w-[7px] shrink-0 cursor-col-resize touch-none self-stretch bg-clip-content px-[3px] transition-colors duration-(--dur-fast) hover:bg-border active:bg-[var(--accent-text)]"
    />
  );
}
