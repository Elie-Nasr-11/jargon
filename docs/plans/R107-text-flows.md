# R107 — text flows

## Context

Owner: *"I told you previously to do sentences incrementally, but if we can have a text
appearing logic similar to the way ChatGPT and Claude work, that would be very cool."*
Decision: **continuous, smoothed, at the model's speed.**

What exists (agent report, verified line refs):
- **The server already streams tokens.** `sseResponse` (`chat/index.ts:791-846`) emits one
  `event: delta` per provider chunk with the contents of the reply's `"reply"` key
  (`makeReplyExtractor`, `:2078-2130`); no sentence assembly server-side. The terminal
  `event: envelope` carries everything else.
- **The client deliberately holds text back.** `useConversation.ts:786-854`: `streamedText`
  accumulates off-screen; `sentenceBreaks()` (`lib/sentences.ts`) finds boundaries; `pump()`
  releases **one completed sentence at a time** and holds `words × 150ms` clamped 0.35–2.5s
  (`WORD_MS`, `HOLD_MIN_MS`, `HOLD_MAX_MS` at `:796-798`). `paint()` (`:807-822`) writes into the
  thinking placeholder; tail repaints are throttled to 80ms. Settle is deferred until the pacer
  drains (`pendingSettle`, `:805, :836-841, :915-923`).
- Per-word fade on the forming tail: `Transcript.tsx:442-487` (`StreamingBody`, `.stream-word`,
  0.18s). Markers stripped per paint including a half-formed `[[…` at the edge (`:448-452`).

So the change is entirely client-side: **replace the sentence pacer with a smoother.**

## The contract that must survive (PLATFORM.md §11.3, pinned in `test_conversation_smoothness_r33.py`)

1. The send lock releases at **settle**, not at first token (`useConversation.ts:856-874`).
2. Nothing raw reaches a student — marker holdback runs on every paint.
3. Text already read never re-animates (the `streamed` flag on the settle swap, `Transcript.tsx:1193-1195`).
4. A failed stream keeps what was written, with Retry (`:925-957`).
5. A lesson switch kills the reveal (`pacerCleanupRef`).
6. Scrolling never fights the stream (`ChatWindow.tsx:72-89`).
7. Envelope-only fields — quiz choices, figures, material cards, offers, arc dividers — appear
   only at settle. Structural: a token reveal can make the *prose* incremental, nothing else.

One rule changes: *"sentence release ~150ms/word, holds clamped 0.35–2.5s … exist to make a reply
readable, never to simulate typing"* becomes **"the stream is smoothed, never held: words appear
as they arrive, a small buffer irons out bursts, and nothing waits for a sentence to finish."**

## Files

- `frontend/src/student/streamSmoother.ts` — **new, pure**: the release arithmetic.
- `frontend/src/student/useConversation.ts:786-854` — the pacer becomes a tick loop over the
  smoother; `pendingSettle`, the kill switch and the settle swap keep their shape.
- `frontend/src/student/Transcript.tsx` — `StreamingBody` unchanged in contract; verify the
  edge-holdback regex runs on every paint (it does, `:452`); `.prose-question` applies to
  complete sentences, which now complete word by word — a sentence is coloured the moment its
  `?` is revealed, before anyone has read it as complete, so R32's "nothing recolours after it
  has been read" holds.
- `tests/stream_smoother.test.ts` (deno) + `tests/test_r107_text_flows.py` (runner + pins).
- `tests/test_conversation_smoothness_r33.py` — `test_paced_sentences_keep_the_word_fade` and
  any pin on the three constants are re-expressed.
- `docs/PLATFORM.md` §11.3, HANDOFF, DECISIONS.

## Design — `streamSmoother.ts`

```ts
export const TICK_MS = 50;              // 20 paints/s; today's tail repaint is 80ms
export const MIN_WORDS_PER_SEC = 14;    // the floor when the model trickles — never slower than this
export const CATCHUP_TICKS = 6;         // a burst drains over ~300ms, never dumped in one paint
export const MAX_WORDS_PER_TICK = 40;   // an absolute ceiling so a 2,000-word backlog still animates

export type Smoother = { revealed: number /* chars */; lastTick: number };

/** Chars of `buffer` to show at `now`. Word-aligned: never splits a word; always >= previous. */
export function advance(s: Smoother, buffer: string, now: number, settled: boolean): Smoother;
```

Rules (each a deno property):
- **Monotonic**: `revealed` never decreases; never exceeds `buffer.length`.
- **Word-aligned**: the cut lands on whitespace or at the end of the buffer.
- **Floor**: with a non-empty backlog, at least `MIN_WORDS_PER_SEC × dt` words are released.
- **Catch-up**: the words released per tick are `max(floor, ceil(backlogWords / CATCHUP_TICKS))`,
  capped at `MAX_WORDS_PER_TICK` — a burst of 60 words is on screen within ~300ms.
- **Settled drains**: once the envelope has landed, catch-up continues until `revealed ===
  buffer.length`; the hook settles on the tick that reaches it (so `pendingSettle` keeps its
  meaning).
- **No sentence logic**: the module never imports `lib/sentences.ts`.

`useConversation`: `setInterval(TICK_MS)` (or rAF gated to TICK_MS) while a stream is open;
each tick `advance`s, then paints `buffer.slice(0, revealed)` through the existing
`StreamingBody` path. The 80ms throttle goes away (the tick *is* the throttle). The kill switch
clears the interval. On stream error, `streamedText` is what is kept — unchanged.

Cost: one `setMessages` per 50ms for the streaming message. If the mock walk shows the whole
transcript re-rendering, memoize the non-streaming bubbles (`React.memo` on the message row);
that is a follow-up inside the release, not a design change.

## Tests

- `stream_smoother.test.ts`: the six properties above over seeded random buffers and chunk
  arrival patterns (trickle, burst, silence-then-burst, settled-mid-backlog).
- `test_r107_text_flows.py`: runner (the R93/R101 harness shape, asserts `N passed`); pins —
  `useConversation` imports `advance` from `streamSmoother`; no `HOLD_MIN_MS`/`HOLD_MAX_MS`/
  `sentenceBreaks(` in the streaming path; `pendingSettle` still gates the swap; `streamed: true`
  still marks the swap; the lock release is still after settle; the edge-holdback regex is still
  in `StreamingBody`.
- Re-express R33's `test_paced_sentences_keep_the_word_fade` → *the forming text is rendered
  through `StreamingBody` with the per-word fade* (the fade is the rule; the pacer was the shape).
- Mock walk: send a turn; assert text appears within one tick of the first delta, that the
  bubble grows continuously (sample `innerText.length` at 100ms intervals — strictly
  non-decreasing, no plateau longer than 400ms while deltas are arriving), that no `[[` is ever
  visible, and that the settle swap does not change the rendered text. The mock backend needs a
  delta-emitting stream for `chat`; add one (bursty on purpose).

## Verification

Gate 2–6. Live: the owner sends one message and watches; server-side nothing changes
(`chat` is untouched — no deploy).

## Risks

- A model that trickles at 3 words/s will now visibly trickle (the floor only applies to a
  backlog). That is the honest cadence the owner chose.
- `.prose-question` colouring mid-sentence: avoided by applying it only once the sentence is
  complete — verify in the walk that a question sentence does not flicker.

## Est. 2h
