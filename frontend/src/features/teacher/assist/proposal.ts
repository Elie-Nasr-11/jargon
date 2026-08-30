/**
 * Proposal state — the shape all four AI mechanisms share.
 *
 * Rebuild brief, Part 5: "the assistant is the empty state and the default, never a
 * button. A teacher should not decide to use AI. They should find that the work is
 * already started."
 *
 * A proposal is real content that has NOT been written down. It is visually
 * provisional, it names where it came from, one keystroke replaces it, and one undo
 * returns exactly what was there. The four non-negotiables are structural here rather
 * than a convention each screen re-implements:
 *
 *   Never writes     — a proposal only ever fills a field; the teacher's Save commits.
 *   Always attributed — `origin` says what it was drafted from, and callers render
 *                       proposal state distinctly from what a teacher wrote.
 *   Always reversible — `previous` holds the exact prior value, so dismissing restores it.
 *   Grounded         — `origin` is set by whoever asked, from the lesson's book pages.
 */
export type Proposal<T> = {
  value: T;
  /** What this was drafted from, in the teacher's words ("pages 31–45"). */
  origin: string;
  /** Exactly what was there before, for the one undo. */
  previous: T;
};

export type ProposalState<T> =
  | { status: "idle" }
  | { status: "drafting" }
  | { status: "offered"; proposal: Proposal<T> }
  | { status: "failed"; message: string };

export const idle = <T>(): ProposalState<T> => ({ status: "idle" });

/**
 * A field is worth proposing into only when it is EMPTY. Proposing over something a
 * teacher wrote would make the assistant an editor rather than a starting point, and
 * that is the difference between "the work is already started" and "the machine
 * changed my lesson".
 */
export function wantsProposal(current: string): boolean {
  return current.trim().length === 0;
}
