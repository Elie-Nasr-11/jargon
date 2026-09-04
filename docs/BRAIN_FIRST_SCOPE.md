# Brain-First: the consolidation scope

Status: PROPOSED (owner brainstorm, 2026-08-03). Decisions pending at the bottom.
**Measured against production 2026-09-03 — see "What the brain actually is today" at the
end before planning anything from this document.** The gap between what this file
describes and what exists is large, and it is the reason a decision was deferred rather
than taken.

The owner's framing, verbatim in spirit: the platform is **content-agnostic** — none of
the current catalog is final — and **the brain should inform everything**: it is the
source of truth for connecting ideas, controlling flow, linking terms across subjects,
focusing students on weaknesses and honing strengths. Everything below serves that.

---

## 1. What the brain IS (the read model)

Today the brain is write-rich and read-poor: ideas, vocab_terms, curriculum_links,
student_links, student_vocab, student_mastery, misconceptions, summaries all get
WRITTEN, and almost nothing READS them back into teaching.

The fix is one first-class read model:

```
loadBrainContext(userId, lessonId) -> {
  weak:      top-5 weakest ideas/skills with evidence notes (recency-decayed score)
  strong:    top-3 strongest (for honing/stretch)
  frontier:  top-3 POSSIBLE links touching this lesson's ideas not yet earned
  traveled:  vocab terms seen in 2+ subjects (bridge words)
  misconceptions: open ledger entries touching this lesson
}
```

Compact, ranked, capped — one stable-ordered `brain` key in the mentor payload (cache
friendly). Every consumer below reads THIS, never raw tables.

New mechanics required:
- **Idea-level mastery**: extend mastery to idea_keys (score 0..1, attempts,
  last_evidence_at; decay applied on read). Every graded turn writes evidence for the
  step's idea_keys: pass up, fail down, echo-rejected neutral.
- The evidence writer lives in the existing grading path — no new model calls.

## 2. What the brain DRIVES (the consumers — this is the point)

1. **Flow control (lesson mode).** Before presenting a step whose ideas depend on a WEAK
   idea, open with one recall beat ("quick one before we build on it…"). Steps whose
   ideas are already STRONG get the compressed presentation (generalizes pre-emption
   from conversation-detected to mastery-detected). Deterministic: the directive layer
   gets `recall_opener` / `compress` hints computed from brain context, not model vibes.
2. **Practice mode = the gym.** Practice stops being generic: the mentor targets the
   weakest due idea (or a frontier link) from brain context, generates an exercise ON
   IT, grades it, and the evidence writer updates mastery. Strengths get occasional
   stretch questions (hone, don't just remediate). Practice is THE systematic consumer
   of the weak set.
3. **Discuss mode = the link mine.** Invite-thinking stops being "about once per step"
   vibes: the payload carries the top frontier link, and discuss invitations aim at it.
   Earned links come from the student articulating the connection (existing mint path).
4. **Graders calibrate by tier.** The understanding grader sees the student's tier for
   the step's ideas — "solid" for a beginner is not "solid" for an advanced student.
5. **Progress can mean mastery.** Today progress = steps done. Brain-first progress =
   idea coverage x mastery. (Decision below: replace, blend, or show both.)

## 3. Content-agnostic authoring (the intake)

Since no content is final, ideas/vocab/links must be DERIVED, not hand-seeded:
- On lesson create/import (curriculum-admin, resource-processing), an extraction pass
  drafts: ideas (the objectives), vocab terms (+variants, definitions), and candidate
  curriculum links to existing ideas across the org's catalog.
- Teacher reviews/edits in studio-lite (draft -> published). Nothing ships unreviewed.
- The brain schema becomes the interlingua: ANY content in, same graph out, same
  mentor behaviors — that's what makes the platform content-agnostic.

## 4. Modes consolidation (owner decisions, locked)

- TurnModes become **lesson | practice | discuss**. `open` is removed.
- **Quiz and assignment are NOT modes** — they're teacher posts. They surface as work
  items (checkpoint dock, class pages) and launch their own flows; the mode picker
  never shows them. In-lesson MCQ steps were always lesson-mode anyway.
- **mentor_preferences is retired** (pace/tone/hint_level/mentor-mode). Redundant with
  the modes + the student profile note + brain-informed calibration. Server keeps
  tolerating the field (normalize-and-ignore) so old clients don't break; the UI goes.
- Mode ceiling simplifies to three rows: lesson advances; practice grades mastery but
  never lesson gates; discuss grades nothing.

## 5. Advancing consolidation (owner direction, locked)

- **Continue is THE advance verb.** Typed messages never conclude a content step
  (continue_signal-by-text is removed; applyTurn's acknowledge path accepts only the
  control). You don't type when there's nothing to say.
- **Calls-to-action become chrome, not prose.** The failure mode "action sentence
  buried in a wall of text" dies by moving the action out of text: the envelope gains
  `mode_offer` — e.g. `{ mode: "practice", topic: "specific purposes", label: "Practice
  this idea" }` — rendered as tappable pills above the composer next to Continue.
  The mentor's prose stays short; the pills carry the actions.
- **The mentor directs INTO modes at checkpoints.** Instead of "…and try to think of
  three technologies we haven't discussed" buried mid-paragraph, the close of a content
  beat offers: [Practice this idea] [Talk it through] [Continue]. Practice/discuss
  offers are brain-informed (weak idea -> practice offer; frontier link -> discuss
  offer). Engagement comes from the loop, not from longer paragraphs.

## 6. Performance (felt speed)

- **Server: merge router + understanding grader into ONE fast-tier call** returning
  `{kind, understanding}`. Turn = 2 model calls (classify+grade, mentor) instead of 3+.
  Mentor stream starts sooner; sentence pacing hides the rest.
- **Client: preload + cache.** Home/classes/lesson-open are slow because every surface
  fetches serially on mount. Plan: (a) one RPC/view per surface (student_home returns
  classes+due+grades+resume in one round trip), (b) in-memory session cache with
  stale-while-revalidate so returning to a surface paints instantly, (c) prefetch a
  lesson's session+turns+activities on sidebar hover/click-intent, (d) localStorage
  snapshot of the catalog for instant first paint after login.

## 7. Phasing (proposed)

- **A. Modes + advancing** (pure consolidation, no new intelligence): 3 modes,
  mentor_preferences retired, Continue-only advancing, mode_offer pills.
- **B. Brain read model**: idea mastery evidence writer + loadBrainContext + payload.
- **C. Brain consumers**: practice targeting, discuss frontier invites, recall openers,
  mastery compression, tier-calibrated grading.
- **D. Content-agnostic intake**: extraction pass + studio-lite review flow.
- **E. Performance**: router+grader merge; client preload/caching.

A before C (consumers need the simplified modes). B is prerequisite for C. E is
independent and can run first or interleave. D can run any time; it pays off the moment
real content arrives.

## 8. Open decisions (owner)

1. Phase order — which first?
2. Progress metric: steps-done, mastery-based, or blend?
3. Typed "next"/"ready" on a content step: literally does nothing except a nudge toward
   Continue, or acts as pressing Continue?
4. Practice question source: fully mentor-generated from brain context, or
   teacher-authorable question banks with mentor fallback?

---

## 9. What the brain actually is today (measured 2026-09-03, R104)

This file describes a fine-grained concept graph that informs everything. Six weeks of
building later, here is what is actually in production. The numbers are the point; the
plan above is not wrong, but nothing in it should be started without reading these first.

| | count |
|---|---|
| ideas, all | 189 |
| ideas, published | 132 |
| of those, **minted one-per-lesson** by R97 (`lesson-<id>`) | 90 |
| of those, hand-authored | 42 |
| `student_idea_mastery` rows | 953 |
| students with any mastery | 198 |
| **distinct ideas with ANY evidence, school-wide** | **17** |
| ...of which are hand-authored ideas | 5 (of 42) |
| ideas one student has evidence on: min / **median** / max | 1 / **5** / 9 |

Three things follow, and they are what the brain-map decision turned on:

1. **It is lesson-grained, not concept-grained.** 948 of the 953 mastery rows sit on
   ideas that R97 minted from a lesson's own milestone objective — one per lesson, a
   floor so that mastery had something to accrue against. That is not the graph this
   document describes; it is a lesson list wearing a graph's clothes. Anything here that
   assumes ideas link concepts *across* lessons is assuming something not yet true.
2. **The map draws mostly other people's lessons.** `fetchIdeas` (`lib/api.ts`) is
   **unscoped** — every published idea, `.limit(300)`, no class, course or student
   filter — and `BrainGraph` renders `ideas.slice(0, 90)`. So a student sees ~90 nodes of
   which ~5 are theirs. It is also the HERO of the student home (StudentHome.tsx),
   420px tall, always rendered, not behind a click: the most prominent thing a student
   sees is ~94% lessons they may never open.
3. **Nobody knows whether it is used.** There is no client event table anywhere in this
   repository and `BrainGraph` records nothing. "Is the map worth its space" cannot be
   answered from data today, only from a judgement.

**The decision, 2026-09-03: leave it alone this release.** Three fixes were costed —
scope `fetchIdeas` to the student's own classes (~half a day, no schema change), add
telemetry first, or demote it below the fold — and the owner chose to ship none of them
while the school is starting. The numbers are recorded here so revisiting is a read
rather than a re-investigation.

**When to revisit, concretely.** The two conditions that would change the answer:
- the ideas stop being lesson-grained (hand-authored ideas carrying real evidence, not 5
  of 42), which is what makes a *graph* worth drawing at all; or
- a term of real usage arrives and the map is still ~5 lit nodes in 90, at which point
  scoping is a half-day fix and the empty-state is the only design question.
Re-run the counts above first; they are one query over `ideas` and `student_idea_mastery`.
