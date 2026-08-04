import { supabase } from "@/lib/supabase";

// Phase E (brain-first): a tiny in-memory read-through cache for the student surfaces.
// Home/classes/lesson-open felt slow because every mount refetched everything; now a
// fresh hit returns instantly, an in-flight fetch is shared (no duplicate requests),
// and hover-prefetch (see api.prefetchLesson) warms a lesson before it opens.
//
// Deliberately NOT stale-while-revalidate: without component subscriptions a stale
// value returned "for now" would never visibly refresh. Fresh-or-fetch keeps
// correctness obvious: within TTL you get the cached value, past TTL you pay the
// normal fetch. Envelope-driven invalidation (useConversation) keeps conversational
// state honest inside the TTL window.
type Entry = { at: number; value: unknown; inflight?: Promise<unknown> };

const entries = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && !hit.inflight && Date.now() - hit.at < ttlMs) return hit.value as T;
  if (hit?.inflight) return hit.inflight as Promise<T>;
  const inflight = fetcher()
    .then((value) => {
      entries.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      // A failed fetch must not poison the key — the next call retries.
      if (entries.get(key)?.inflight === inflight) entries.delete(key);
      throw err;
    });
  entries.set(key, { at: 0, value: undefined, inflight });
  return inflight;
}

// Fire-and-forget warmer (hover/intent prefetch). Errors are swallowed — a failed
// prefetch just means the real open pays the normal fetch.
export function warm<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): void {
  void cached(key, ttlMs, fetcher).catch(() => {});
}

// Invalidate every key starting with the prefix (e.g. "turns:" after a turn settles).
export function invalidateSurface(prefix: string): void {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

// A different signed-in user must never see the previous user's cached surfaces.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT") entries.clear();
});
