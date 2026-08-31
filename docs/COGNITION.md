# The Cognition Ledger (R90)

How the Independent Cognitive Production Rubric (owner brief, 2026-08-31) becomes
running code. The rubric's own text is the authority on WHAT is measured; this file is
the authority on WHERE each part lives and why.

## The point

The system must not say "Ahmed scored 63%." It must say: *Ahmed understands the
concept but is confusing two related terms; he needed three hints; he is ready to
progress after one more retrieval-practice session.* That sentence is a claim about
the student's own thinking, judged **in the context of the assistance given
immediately before it** (rubric §1) — a polished answer that echoes the mentor is not
the same as a polished answer the student produced.

## Where it lives

```
learning_turns  ──read──▶  cognition-scorer (edge fn)  ──write──▶  cognition_turn_scores
(the transcript              one model call per                     cognition_profiles
 the chat fn                 scoring run, rubric                        │ RLS read
 already writes)             encoded in its prompt                     ▼
                                                            teacher console
                                                            (StudentDetail ▸ Thinking)
```

- **The mentor teaches; the assessor scores.** Scoring is a NEW, separate edge
  function (`cognition-scorer`), not more weight in `chat`. Chat latency is untouched,
  the scorer can re-run and re-version without touching the lesson loop, and the
  rubric's delayed measures (retention §11, trajectories §16) never fit a live turn
  anyway. (It is also the only shape that can DEPLOY today: functions ship through a
  channel with a per-call size ceiling, `chat` and `curriculum-admin` are both far
  over it, and a fresh small function is far under it.)
- **The transcript is already sufficient.** `learning_turns` persists every student
  response (`text`/`code`/`choice_id`, input modality) and every mentor turn's full
  reply. The scorer reads a window per response: the objective, the student's
  constructed text, and the mentor turns immediately before it — which is exactly the
  §1 contract.
- **Scaffold levels are judged from the mentor's words, not from stored tags.**
  `learning_evidence.hint_rung` exists but is ~97% null (measured 2026-08-31), so the
  scorer assigns S0–S5 (§13) by reading what the mentor actually said before the
  response. One judge, one context, no reliance on sparse telemetry.

## Tables

**`cognition_turn_scores`** — one row per scored constructed response (the ledger).
`turn_id` is UNIQUE: scoring is idempotent, a turn is judged once per rubric version.
Eight dimension columns (`retrieval, organization, reasoning, elaboration, vocabulary,
expression, independence, metacognition`), each 0–4 or NULL (= not assessable on this
turn — a two-word answer has no assessable organization; NULL is not a zero).
`scaffold_level` 0–5 is the assistance level immediately before the response.
`evidence` jsonb carries short verbatim quotes per dimension plus what was AI-supplied
vs student-originated (§8's comparison, made inspectable). `signals` jsonb carries the
§12 quantitative underlay (word count, propositions, self-corrections, hints_before…)
— stored, never presented as the score. `note` is one teacher-readable sentence about
this response.

**`cognition_profiles`** — one row per (user, lesson): latest-weighted dimension
medians, scaffold trend (first-half vs second-half mean), `narrative` (the teacher
paragraph: what they understand, what they confuse, what to do next), `turns_scored`,
`rubric_version`. Upserted after every scoring run; the console's list views read this
without invoking anything.

RLS: teachers read rows for students who share an active class with them; org admins
read their org's students; platform admins read all. Nobody but the service role
writes. Students do not see raw scores (a product decision to revisit deliberately,
not a default to fall into).

## The scorer's judgment rules (encoded in its prompt, pinned by tests)

- Score the contribution, not the transcript's polish: judge **against the assistance
  visible immediately before** (§1); echoing the mentor's reasoning caps independence.
- NULL over guessing: a dimension with no evidence in this response stays null.
- Word count is not elaboration (§5); precision beats sophistication (§6); grammar,
  spelling and accent do not lower cognitive dimensions when the reasoning is clear
  (§7, §18 — expression is its OWN dimension, so the separation is structural).
- Normalize to the student's grade band, the subject, and the response modality (§17)
  — the lesson's `grade_band`/`level` and the profile's grade ride into the prompt.
- MCQ clicks and bare "yes/ok/next" turns are not constructed responses; they are
  skipped, not zero-scored.
- The composite is never one number (§15). The profile stores dimensions + scaffold +
  narrative; no column holds a percentage.

## What is deliberately NOT in R90

- **§19 (the rubric steering the mentor).** That is a `chat/index.ts` change — the
  world brief gains the student's cognition profile and the standing rules gain the
  §19 responses (weak retrieval → retrieval prompts before information; low
  independence → reduce assistance; …). Blocked until SUPABASE_ACCESS_TOKEN is
  rotated; the ledger this release ships is exactly the input that slice will read.
- **§10 transfer and §11 retention as scheduled tasks.** Both need a task generator
  (a delayed retrieval prompt is a new student-facing surface). The schema already
  distinguishes them: they arrive as new dimension columns/rows later, not a redesign.
- **Class-level dashboards.** R90 lands the per-student truth; aggregation is a read.

## Verification

Deno-checked; python pins on the prompt's judgment rules and the API contract; the
scorer deployed via MCP and smoke-tested live (unauthenticated → 401; a probe teacher
account scored a synthetic Pressure-Test student end to end, rows inspected, probe
removed); the Thinking tab walked offline against the mock backend, which implements
the same contract.
