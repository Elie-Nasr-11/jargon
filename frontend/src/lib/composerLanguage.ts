// The code-surface language union, extracted in chat-flow Phase 4 so the retired
// 1,095-line components/Composer.tsx (which every consumer imported ONLY for this type)
// could finally be deleted. The runtime semantics live where they always did: Jargon runs
// server-side via the run function; JavaScript/Python run in-browser.
export type ComposerLanguage = "jargon" | "javascript" | "python";
