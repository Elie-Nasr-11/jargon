// ONE sentence-boundary definition for the whole app (Phase A consolidation): the
// streaming pacer (useConversation) and the transcript's sentence treatment (Transcript)
// must agree on where a sentence ends, or the pacer's release points and the renderer's
// whiten points drift apart. A boundary is whitespace following a sentence-ending mark,
// optionally closed by a quote/bracket.
export const SENTENCE_BREAK_SOURCE = String.raw`(?<=[.!?…]["')\]]?)\s+`;

export function sentenceBreaks(text: string): { at: number; len: number }[] {
  return Array.from(text.matchAll(new RegExp(SENTENCE_BREAK_SOURCE, "g")), (m) => ({
    at: m.index ?? 0,
    len: m[0].length,
  }));
}

// Completed sentences + the still-forming tail (the last piece is ALWAYS the tail, even
// if it happens to end with punctuation — it only "completes" when whitespace follows).
export function splitSentences(text: string): { done: string[]; tail: string } {
  const parts = text.split(new RegExp(SENTENCE_BREAK_SOURCE));
  if (parts.length <= 1) return { done: [], tail: text };
  return { done: parts.slice(0, -1), tail: parts[parts.length - 1] };
}
