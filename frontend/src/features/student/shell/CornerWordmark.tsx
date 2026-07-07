// The only fixed identity mark on the v5 stage: the wordmark floating in the top-left corner.
// With a panel open it closes the panel (the "get me home" reflex); on the bare stage it scrolls
// the conversation to the top.
export function CornerWordmark({
  panelOpen,
  onClosePanel,
  onScrollTop,
}: {
  panelOpen: boolean;
  onClosePanel: () => void;
  onScrollTop: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => (panelOpen ? onClosePanel() : onScrollTop())}
      aria-label={panelOpen ? "Back to the conversation" : "Scroll to the top of the conversation"}
      className="fixed left-4 top-3 z-[var(--z-header)] font-serif text-[20px] tracking-tight text-foreground"
    >
      Jargon
    </button>
  );
}
