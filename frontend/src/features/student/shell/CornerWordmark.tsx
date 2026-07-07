// The only fixed identity mark on the v5 stage: the wordmark floating in the top-left corner.
// With a panel open it closes the panel (the "get me home" reflex); on the bare stage it scrolls
// the conversation to the top.
export function CornerWordmark({
  panelOpen,
  dimmed = false,
  onClosePanel,
  onScrollTop,
}: {
  panelOpen: boolean;
  // Lockdown retraction: inert, faded, nudged toward its edge.
  dimmed?: boolean;
  onClosePanel: () => void;
  onScrollTop: () => void;
}) {
  return (
    <button
      type="button"
      inert={dimmed ? true : undefined}
      onClick={() => (panelOpen ? onClosePanel() : onScrollTop())}
      aria-label={panelOpen ? "Back to the conversation" : "Scroll to the top of the conversation"}
      className={`fixed left-4 top-3 z-[var(--z-header)] font-serif text-[20px] tracking-tight text-foreground transition-[opacity,translate] duration-(--dur) ${
        dimmed ? "pointer-events-none -translate-x-2 opacity-30" : ""
      } ${
        // Below md the panel is full-screen and its back pill sits exactly here — hiding the
        // wordmark stops it stealing those taps (the panel's own X covers the close action).
        panelOpen ? "max-md:hidden" : ""
      }`}
    >
      Jargon
    </button>
  );
}
