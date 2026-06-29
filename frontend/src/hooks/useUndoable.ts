// Deferred-commit undo for hard-to-reverse actions (deletes, and status changes
// the server can't set back to their prior value). The optimistic change shows
// immediately, but the real network call is held for an undo window — if the
// teacher hits Undo we just revert the local change and never call the server;
// otherwise we commit when the window closes.
//
// Use this when an action can't be cleanly reversed by re-running it with the old
// value. For plainly reversible status changes, prefer notifyUndo() with an inverse
// call instead — no deferral needed.
import { useCallback, useEffect, useRef } from "react";
import { UNDO_WINDOW_MS, notifyUndo } from "@/lib/feedback";

type Pending = { commit: () => void; timer: ReturnType<typeof setTimeout> };

export type UndoableAction = {
  /** Stable key per target; a new action on the same key commits the previous one first. */
  key: string;
  message: string;
  /** Apply the change to local state now. */
  optimistic: () => void;
  /** Put local state back the way it was (only runs if the user undoes). */
  revert: () => void;
  /** Persist the change (only runs if the window closes without an undo). */
  commit: () => void;
  delay?: number;
};

export function useUndoable() {
  const pending = useRef<Map<string, Pending>>(new Map());

  // If the view unmounts with actions still pending, persist them immediately so a
  // deferred delete / status change is never silently dropped.
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const [, p] of map) {
        clearTimeout(p.timer);
        p.commit();
      }
      map.clear();
    };
  }, []);

  return useCallback((action: UndoableAction) => {
    // A new action on the same target supersedes the previous one — commit the
    // earlier change now so the server stays consistent step by step.
    const prev = pending.current.get(action.key);
    if (prev) {
      clearTimeout(prev.timer);
      prev.commit();
      pending.current.delete(action.key);
    }

    action.optimistic();

    let settled = false;
    const commitOnce = () => {
      if (settled) return;
      settled = true;
      pending.current.delete(action.key);
      action.commit();
    };
    const timer = setTimeout(commitOnce, action.delay ?? UNDO_WINDOW_MS);
    pending.current.set(action.key, { commit: commitOnce, timer });

    notifyUndo(
      action.message,
      () => {
        if (settled) return; // already committed — nothing to undo
        settled = true;
        const p = pending.current.get(action.key);
        if (p) clearTimeout(p.timer);
        pending.current.delete(action.key);
        action.revert();
      },
      action.delay ?? UNDO_WINDOW_MS,
    );
  }, []);
}
