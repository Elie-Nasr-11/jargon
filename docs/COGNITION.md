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


## R93 — the whole room

R90 reads one student in one lesson. R92 makes those readings appear on their own. R93
is the first surface that reads ACROSS a class, and the thing it exists to resist is the
class average: **"this room is at 2.7 / 4" is §15's failure one level up**, and there is
nothing a teacher can do with it on Monday.

So the room is arranged by what to DO. One sentence saying what the room as a whole
needs, then students grouped by the move §19 would make for each of them:

| group | what it means | what the teacher is told |
|---|---|---|
| **Leaning on the tutor** | independence ≤ 2 while recent scaffolding ≥ S3 | they need less help, not more |
| **needs: <dimension>** | the weakest dimension, rubric order breaking ties | the §19 move, said to a person |
| **Ready for harder ground** | retrieval, reasoning and independence all ≥ 3 | give them something the lesson has not covered |
| **Holding steady** | nothing weak, not yet independent | leave them be |
| **Not read yet** | under three judged responses | named, never silently dropped |

Alarm first, opportunity later: a teacher reading top to bottom meets what is going
wrong before what is going well. The headline follows §19's own precedence too — a room
being carried by the tutor is reported as *"an assistance problem before it is a content
one"* even when some dimension is weaker.

### The three rules that keep it honest

- **The view and the mentor cannot disagree.** The grouping uses `learnerSteer`'s own
  thresholds (3-response floor, weak ≤ 2, proficient ≥ 3) and its own priority order. A
  room view saying "these four are leaning on the tutor" while the mentor treats them as
  fine would be worse than no view. `chat` and `cognition-scorer` cannot import each
  other, so `tests/test_r93_class_room.py` reads BOTH files and fails if they drift.
- **The room is the roster, not the scored rows.** Everyone active in the class appears,
  read or not. A view built from the profiles table would quietly shrink to whoever had
  been scored — losing exactly the students who most need attention.
- **Nothing is collapsed into one number.** A student keeps all eight dimensions; the
  room summary holds no dimension VALUE at all, only counts of students. Neither
  rendering file reads a dimension value: what a teacher sees is which group someone is
  in and what to do about it, with the eight numbers one click away on the student,
  where a lesson and evidence sit beside them.

### Scope, and the bug the probe caught

A class reports on ITS courses. Students here are commonly in several classes at once,
so an unscoped room would blend a history lesson's reasoning into the biology teacher's
reading of the same child.

Getting from a course to its lessons is **three hops** — `courses → course_versions →
units → lessons`; `lessons` carries no `course_id`. The first implementation guessed one
hop, and the live probe answered `column "course_id" does not exist`. That would have
400'd the entire class view for every class that links a course — which is nearly all of
them — and no offline test would have noticed. The scope is then applied in memory
rather than in the query string, so a course with a hundred lessons cannot fail the
request on URL length.

### Verification

Deno-checked; 26 source pins; 12 executable property tests over the real `room.ts`
(group order, needs-splitting, no-student-dropped, not-a-ranking, every headline
branch, and that no headline can carry a score). Live against production, on a probe
class built for the purpose and deleted afterwards: a teacher of the class got the room
(dependent / mastered / needs:reasoning / unread, all correct), a teacher of another
class in the same organization got **403**, an anon caller got **403**, and a profile
belonging to a lesson outside the class's course was correctly excluded — the student's
totals stayed at their in-course values instead of being dragged down by it.


## R94 — the room has streams

A teacher who splits a class into sections teaches them at different hours and to
different plans, so one blended reading hides the thing they most need to see. The
probe made this concrete rather than theoretical. A five-student class:

| view | what it says |
|---|---|
| whole class | *"1 student of the 5 read is weak on reasons with it, and no single thing is holding the whole room back."* |
| section A | *"2 students of the 2 read are leaning on the tutor for most of their thinking. That is an assistance problem before it is a content one."* |
| section B | *"Nothing is weak across the 2 students read. This room is ready for harder work."* |

Blended, the class reads as unremarkable. Section A is **entirely** dependent. That
divergence is the whole feature.

- **The section control appears only when there is a choice to make.** A class that has
  never used sections gets `sections: []` and no control — and a class with ONE named
  section gets none either, because that is the whole class under another name and a
  control that does nothing is worse than no control.
- **The people not in a section are a group, named "No section".** That is the live
  shape, not the tidy two-stream one: the classes using sections today each have one
  named section plus an unsectioned student.
- **The comparison is the same sentence each section gets on its own.** `sectionHeadlines`
  calls `roomHeadline` per section rather than inventing a second way of saying what a
  room needs — so selecting a section can never tell a teacher something different from
  what the comparison line just told them, and no threshold rule had to be invented to
  decide when two sections "differ".
- **The arithmetic stays on the server.** Each section is summarized by the SAME
  `summarizeRoom` the class uses. A client that summarized sections itself would have to
  read dimension values, which is precisely what the room view is not allowed to put in
  front of a teacher. The client picks a summary; it never builds one.
- **A section named "all" is still selectable.** Choice keys are prefixed (`section:A`),
  so a label can never collide with the whole-class view and make a real section
  unreachable.

Two smaller things the probe caught: a stale choice (a section that disappears between
loads) falls back to the whole class rather than stranding the teacher in an empty room,
and the headline said *"1 student … are weak"* — which reads as a bug in the product,
not in a sentence. Both are pinned.
