# R110 — Thinking: judge eight, show three

## Context

Owner, on the criteria: *"go over all of the thinking criteria … narrow it down and make it more
focused."* The purpose he chose is **all four** — reteach, catch leaning on the AI, growth,
act on one student. The shape he chose: **judge eight, show three.**

The numbers that drove it (132 responses; `OVERNIGHT-2026-09-05.md` §3): retrieval, vocabulary,
reasoning, elaboration and independence co-move at r ≈ 0.8; metacognition is partly separate
(r ≈ 0.55); expression barely varies (sd 0.65, never 0); organization is unscorable on 70% of
turns. Eight rows ask a teacher to read eight things that are mostly one.

Nothing in the judge, the ledger, §19 or the room changes. This is a **view over the same
numbers**, computed where R101 already computes everything: `cognition/thinking.ts`.

## Files

- `frontend/src/features/teacher/cognition/thinking.ts` — `HEADLINES`, `headlineOf(row)`,
  `headlineSummary`, `headlineSittings`, `caveatSentence`.
- `frontend/src/features/teacher/cognition/labels.ts` — the three labels + the caveat words
  (one home for vocabulary, R93).
- `frontend/src/features/teacher/console/CognitionPanel.tsx` — three `HeadlineRow`s on top; the
  eight `DimensionRow`s move under a collapsed disclosure; the "act" link from R109 sits under
  the reading.
- `tests/thinking_view.test.ts` (+ properties), `tests/test_r101_thinking_view.py` (any shape
  pin re-expressed), `tests/test_r110_three_headlines.py` (new pins).
- `docs/COGNITION.md` "The teacher's two views", DECISIONS (with the correlation table), HANDOFF.

## Design — `thinking.ts`

```ts
export const HEADLINES = [
  { key: "came_back",  label: "What came back",           members: ["retrieval", "vocabulary", "reasoning", "elaboration"] },
  { key: "theirs",     label: "How much was theirs",      members: ["independence"] },
  { key: "checks",     label: "Do they check themselves", members: ["metacognition"] },
] as const;
export const CAVEAT_DIMENSIONS = ["expression", "organization"] as const;
// Pinned: HEADLINES' members ∪ CAVEAT_DIMENSIONS === the eight, disjoint.
```

- `headlineOf(row, headline): number | null` — the **median of the present member dims on that
  response**; null when none present. Medians, not means, for the same reason the whole ledger
  uses them (one bad dim does not drag).
- `headlineSummary(rows)` — per headline: value = median over responses of `headlineOf`;
  `movement` via the existing halves rule over sittings (`movement()`); `series` via `smoothed()`
  over `headlineSittings`. "How much was theirs" additionally carries `unaided_count /
  turns_scored` from `summarize()` — the §14 fraction beside the independence reading, never a
  percentage.
- `headlineSittings(rows)` — reuse `sittings()`; per sitting the median of `headlineOf` over its
  responses. `Σ n` unchanged.
- `caveatSentence(summary)` — deterministic, from expression + organization: e.g. *"Wording is
  clear."* (expression ≥ PROFICIENT) / *"Wording gets in the way of the thinking."* (≤ WEAK) /
  nothing at null; then *"Structure was assessable on 5 of 21 responses."* when organization's
  scored count is below half (the null rate is the finding), else *"Structure holds."*/*"Ideas
  are listed, not linked."* No `%`, no `/4`, no "score".

Everything is a pure function over `ThinkingRow[]`; every rule becomes a deno property.

## Design — the panel

Order inside the existing Panel, replacing the block at `CognitionPanel.tsx:500-526`:

1. Toolbar, truncation note, reading paragraph, §14 pattern — unchanged.
2. **"Write a note to the tutor →"** (R109's link) under the reading — the "act" purpose.
3. **Three `HeadlineRow`s** — label in the mono micro-label voice (the one place letter-spacing
   is allowed), 4-pip bar + `n of 4`, the by-sitting sparkline, `first → now` (the "growth"
   purpose). "How much was theirs" adds `3/14 with no help` in mono, amber below a quarter (the
   room's `MOSTLY_SUPPORTED_BELOW`, cross-pinned) — the "catch leaning" purpose.
4. **Caveat line** — `caveatSentence`, muted.
5. `<details>` **"All eight dimensions"** — the existing eight `DimensionRow`s + hairline + two
   probe rows, byte-for-byte, collapsed by default. The rubric's granularity stays one click
   away; the R99 evidence disclosures still hang off lesson scope below.
6. Counts line, lessons list, response-by-response — unchanged.

"Reteach" is the room's job (`class_view` groups by §19 move); the Thinking tab points at it only
through the lesson list, as today.

Tone rules unchanged: one hue, pips in `text-primary`, no gradients, `min-w-0` + `flex-wrap`
(the R98 rule) on the new row too.

## Tests

- `thinking_view.test.ts` (+~8): members ∪ caveat = the eight, disjoint; `headlineOf` is null
  iff no member present, else the median of present members; `headlineSummary` is
  permutation-invariant; each headline's series has one point per sitting and `Σ n ===
  rows.length`; "theirs" carries `unaided_count`/`turns_scored` equal to `summarize()`'s;
  `caveatSentence` contains no `%`, `/4`, "score", "average"; organization's caveat names the
  count only when scored on fewer than half.
- `test_r110_three_headlines.py`: `HEADLINES` labels come from `labels.ts`; the panel renders
  three `HeadlineRow`s before the disclosure and the eight `DimensionRow`s inside it (both still
  present — the eight are not deleted); `MOSTLY_SUPPORTED_BELOW` is the same number as
  `room.ts`'s and the scorer's `MASTERY_MIN_SHARE_UNAIDED`; COGNITION.md carries the
  correlation table and the phrase "judge eight, show three".
- R101 pins expected to hold: `DimensionRow` still exists and wraps (`:198`); the sparkline
  still has words (`:191`); the select still groups (`:204`). If a pin counted rows, re-express
  it as "all eight rendered".
- Mock walk: the three rows render at 1440 and 390 with no overflow; the disclosure opens to
  eight; the caveat has no digit-slash-digit.

## Verification

Gate 2–6 (frontend only — no deploy of functions). Live: the owner opens one student's
Thinking tab; the three rows should read as a sentence a teacher can act on. Record what he says.

## Risks

- Medians over one member (independence, metacognition) equal the dimension itself — by design;
  the labels do the narrowing, the data is untouched.
- Collapsing eight rows risks hiding the R99 attribution evidence: it stays on the
  response-by-response block, not inside the disclosure.

## Est. 2h
