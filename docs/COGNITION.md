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

- ~~§19 (the rubric steering the mentor)~~ — **built in R91, see below.**
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

## §19 — the ledger steers the mentor (R91)

The rubric is explicit that measurement is not the point: *"It should influence how
Jargon Mentor responds."* So `chat` reads the student's profile for the lesson each
turn and derives — through the exported, property-tested `learnerSteer` — **at most two
imperative moves**, which ride the payload's cacheable prefix as `learner` and which the
system prompt's HOW THIS STUDENT THINKS rules place ABOVE the default help level.

The rubric's own conditionals, in priority order:

| when | the move |
|---|---|
| low independence **and** heavy recent scaffolding | REDUCE ASSISTANCE — drop a full rung below normal |
| retrieval / reasoning / elaboration / vocabulary / organization / metacognition weak | the matching §19 ask, weakest dimension first |
| expression weak **while reasoning is strong** (§18) | ask them to reformulate — never rewrite it for them |
| retrieval, reasoning **and** independence all proficient | FADE AND TRANSFER — apply it somewhere new |

Three rules make it safe rather than merely clever:

- **At most two moves.** EXACTLY ONE ASK is a hard rule of this prompt; a mentor handed
  five weaknesses would ask five things or ignore the list. Weakest first, ties broken
  in the rubric's own order (retrieval leads — everything else is built on it).
- **Never a score, never a word of it to the student.** The moves carry no digits and
  never name the measurement, and the prompt forbids quoting one back ("your
  elaboration is weak"). A learner experiences only the CHANGE: a question where there
  would have been a hint.
- **Additive, never a gate.** Fewer than three judged responses, an absent profile, or a
  failed read all mean no steering, and the mentor behaves exactly as before.

§18's separation is structural here too: weak expression beside strong reasoning asks
for a reformulation, but weak expression beside weak *reasoning* steers the reasoning —
language trouble is never mistaken for weak thinking.

## R92 — the scoring runs itself

A profile that only exists when a teacher presses a button is a profile that mostly
does not exist, and §19's steering has nothing to read. So the backlog is swept on a
schedule: **every 15 minutes, pg_cron POSTs `{"action":"sweep","limit":2}`** at the
scorer, and profiles appear for students nobody clicked on.

The awkward part is the caller. A cron job has no user behind it, so the usual door
(resolve the JWT, then `assertCanViewStudent`) does not exist. Three things make a
user-less caller acceptable:

- **Its own secret, its own door.** `cognition_sweep_auth` holds one random 32-byte
  key. RLS is on with *no policy at all*, so anon and authenticated can never read it;
  the service role and postgres can. The schedule reads it at fire time, so the
  plaintext never sits in `cron.job.command`. The function compares it in constant
  time — an early-exit compare lets a caller walk a secret one character at a time.
- **There is nothing to read out.** The sweep returns counts (`pairs_seen`,
  `pairs_scored`, `responses_scored`, `errors`, `took_ms`) and writes counts. No
  transcript, no narrative, no note ever crosses that door — so the worst a stolen key
  buys is scoring work the system was going to do anyway.
- **One scoring body.** The button and the scheduler both call `runScoring`, which
  carries no authorization of its own; each caller brings its own. If they had
  diverged, a swept profile and a pressed one could disagree about the same student.

**What is worth a model call.** `cognition_sweep_queue` mirrors the judge's
`isConstructedResponse` exactly — code counts, a bare MCQ tap does not, 25 trimmed
characters is the floor — and only surfaces a (student, lesson) pair once **five** new
responses are waiting, comfortably past the three §19 needs before it will steer. A
scored turn leaves the queue by construction (`left join … where cts.id is null`), so
the sweep is idempotent and a *failed* pair simply stays queued for the next tick.

**Bounded on purpose.** A tick takes at most 2 pairs (10 by request, never more) and
scores at most 8 responses per pair. It only starts another pair if there is room for
one as expensive as the priciest so far — a fixed cut-off cannot know whether the last
pair took forty seconds or needed a retry; measuring does.

**`cognition_sweep_runs` is the answer to "is it alive?"** — one row per tick, readable
by platform admins, holding counts and lesson ids and no student text. The row is
opened *before* any scoring and patched at the end, so a tick the gateway kills
mid-flight still leaves a row with a null `finished_at`: "started and never came back"
is a fact worth having, and silence is not.

### What the first scheduled runs found

The scheduler paid for itself immediately by failing in public. Two ticks in a row
reported `pairs_seen: 2, pairs_scored: 1, errors: 1`, and the error was "the scoring
model returned invalid JSON" — on a lesson whose *other* student had scored fine
minutes earlier.

The obvious reading was truncation: a longer transcript, a reply cut off mid-object, a
perfect JSON prefix that will not parse. That reading was **wrong**. Shrinking the
batch from 12 to 8 and doubling the output budget changed nothing, and the failing
student's longest response turned out to be 215 characters. Then the third tick scored
that same pair cleanly, from byte-identical input.

So the judge is simply not always the JSON it was asked for — intermittently, on
inputs that work fine on the next attempt. Three things came out of that:

- **One retry**, and only for an unparseable reply. A refusal, a budget overrun, a
  timeout or an API error would come back identically, so retrying them costs a model
  call and buys nothing. Without the retry, a pair like this one sits in the queue
  failing the same way every fifteen minutes forever.
- **The error names its own shape.** `[stop=… blocks=… chars=… json=…]` plus the
  parser's own complaint, cut at the first comma — which is exactly where V8 starts
  quoting the document back, so no student text can ride along. Those four facts
  separate an empty reply from a refusal from a prose preamble from a broken string.
  "Invalid JSON" alone bought a wrong diagnosis and a wasted deploy.
- **The truncation check stays.** It was not the cause here, but a genuinely truncated
  reply still looks exactly like a malformed one, and now it says so.

The batch of 8 and the 16000-token budget stayed too — not because they fixed
anything, but because they are the more comfortable numbers to have been wrong with.
