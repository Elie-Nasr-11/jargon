# Cognition: measuring the thinking, and acting on it

How the Independent Cognitive Production Rubric (owner brief, 2026-08-31) became running
code. The rubric's own text is the authority on WHAT is measured; this file is the
authority on where each part lives, why it is shaped that way, and what it refuses to do.

Built across R90–R94. This describes the system as it stands; the release-by-release
story is in `docs/HANDOFF.md`, and the decisions in `docs/DECISIONS.md`. The one part of
the history worth keeping here — the diagnoses that turned out to be wrong — is at the
bottom, because it is the best evidence for how the thing actually behaves.

## The point

The system must not say "Ahmed scored 63%." It must say: *Ahmed understands the concept
but is confusing two related terms; he needed three hints; he is ready to progress after
one more retrieval-practice session.* That is a claim about the student's own thinking,
judged **in the context of the assistance given immediately before it** (§1) — a polished
answer that echoes the mentor is not the same as a polished answer the student produced.

That refusal is structural, not stylistic, and it holds at all three levels:

| level | what it says | what it must never say |
|---|---|---|
| a response | one sentence about what the thinking showed | a mark |
| a student | eight dimensions + scaffold trend + a narrative | a composite |
| a room | who needs which move, and what to reteach | a class average |

## The shape

```
learning_turns ──read──▶ cognition-scorer ──write──▶ cognition_turn_scores
(the transcript          ▲   (edge fn)               cognition_profiles
 chat already writes)    │                                 │
                    ┌────┴────┐                            ├──▶ chat  (§19 steers the mentor)
                 a teacher   pg_cron                       └──▶ teacher console
                 presses     every 15m                          · student ▸ Thinking
                                                                · class ▸ How the room is thinking
```

- **The mentor teaches; the assessor scores.** Scoring is a separate edge function, not
  more weight in `chat`: chat latency is untouched, the scorer can re-version without
  touching the lesson loop, and the rubric's delayed measures never fit a live turn.
  (It is also the only shape that can DEPLOY today — see *Operational state*.)
- **The transcript is already sufficient.** `learning_turns` persists every student
  response and every mentor reply. The scorer reads a window per response: the objective,
  the student's constructed text, and the mentor turns immediately before it — which is
  exactly the §1 contract.
- **Scaffold levels are judged from the mentor's words, not from stored tags.**
  `learning_evidence.hint_rung` is ~97% null (measured 2026-08-31), so the scorer assigns
  S0–S5 (§13) by reading what the mentor actually said. One judge, one context.

## Tables

**`cognition_turn_scores`** — one row per scored constructed response. `turn_id` is
UNIQUE per rubric version, so scoring is idempotent. Eight dimension columns, each 0–4 or
NULL (*not assessable on this turn* — a two-word answer has no assessable organization;
NULL is not a zero). `scaffold_level` 0–5 is the assistance immediately before the
response. `evidence` carries short verbatim quotes plus what was AI-supplied vs
student-originated (§8, made inspectable); `signals` carries the §12 quantitative underlay
(stored, never presented as the score); `note` is one teacher-readable sentence.

**`cognition_profiles`** — one row per (user, lesson): latest-weighted dimension medians,
scaffold trend (first-half vs second-half mean), `narrative`, `turns_scored`,
`rubric_version`. Upserted after every run; every reader downstream reads this.

**`cognition_sweep_auth` / `cognition_sweep_queue` / `cognition_sweep_runs`** — the
scheduler's secret, its work queue, and its run log. See *The scoring runs itself*.

RLS: teachers read rows for students who share an active class; org admins read their
org; platform admins read all. Nobody but the service role writes. Students do not see
raw scores — a product decision to revisit deliberately, not a default to fall into.

## What the judge is told

- Score the contribution, not the transcript's polish: judge **against the assistance
  visible immediately before** (§1). Echoing the mentor caps independence.
- NULL over guessing.
- Word count is not elaboration (§5); precision beats sophistication (§6); grammar,
  spelling and accent never lower a cognitive dimension (§7, §18 — expression is its OWN
  dimension, so the separation is structural).
- Normalize to grade band, subject and modality (§17).
- MCQ clicks and bare "ok" are not constructed responses: skipped, not zero-scored.
- The composite is never one number (§15).

## §19 — the ledger steers the mentor

The rubric is explicit that measurement is not the point: *"It should influence how
Jargon Mentor responds."* So `chat` reads the student's profile each turn and derives —
through the exported, property-tested `learnerSteer` — **at most two imperative moves**,
which ride the payload's cacheable prefix as `learner` and which the prompt's HOW THIS
STUDENT THINKS rules place ABOVE the default help level.

| when | the move |
|---|---|
| low independence **and** heavy recent scaffolding | REDUCE ASSISTANCE — a rung below normal |
| a dimension weak, weakest first | the matching §19 ask |
| expression weak **while reasoning is strong** (§18) | ask them to reformulate — never rewrite it |
| retrieval, reasoning **and** independence all proficient | FADE AND TRANSFER |

Three rules make it safe rather than merely clever:

- **At most two moves.** A mentor handed five weaknesses would ask five things or ignore
  the list. Weakest first, ties broken in the rubric's own order.
- **Never a score, never a word of it to the student.** A learner experiences only the
  CHANGE: a question where there would have been a hint.
- **Additive, never a gate.** Fewer than three judged responses, an absent profile, or a
  failed read all mean no steering, and the mentor behaves exactly as before.

## The scoring runs itself

A profile that only exists when a teacher presses a button is a profile that mostly does
not exist, and §19 has nothing to read. **pg_cron POSTs the scorer every 15 minutes**
(`cognition-sweep`, batch 2).

The awkward part is the caller: a cron tick has no user, so it cannot pass
`assertCanViewStudent`. Three things make that acceptable:

- **Its own secret.** `cognition_sweep_auth` holds one random 32-byte key with RLS on and
  *no policy at all*; the schedule reads it at fire time so the plaintext never sits in
  `cron.job.command`; the function compares it in constant time.
- **Nothing to read out.** The sweep returns and logs COUNTS ONLY, so the worst a stolen
  key buys is scoring work the system was going to do anyway.
- **One scoring body.** `runScoring` carries no authorization of its own; each caller
  brings its own. Otherwise a swept profile and a pressed one could disagree.

`cognition_sweep_queue` mirrors the judge's constructed-response test exactly and only
surfaces a pair once **five** new responses are waiting. A scored turn leaves the queue by
construction, so the sweep is idempotent and a failed pair simply waits for the next tick.

**Bounded, and honest about it.** A tick takes at most 2 pairs and 8 responses per pair,
and only starts another pair if there is room for one as expensive as the priciest so far.
The run-log row is opened *before* any scoring and patched at the end, so a tick the
gateway kills still leaves a row with a null `finished_at` — "started and never came back"
is a fact worth having, and silence is not.

## The teacher's two views

**A student ▸ Thinking** — eight dimensions, the S-level under each response, the scaffold
trajectory, and the narrative. This is where the numbers live, beside a lesson and the
evidence that grounds them.

**A class ▸ How the room is thinking** — the first surface that reads ACROSS a class, and
the one that had to resist the class average hardest. It is arranged by what to DO: one
sentence saying what the room as a whole needs, then students grouped by the move §19
would make for each of them.

| group | what it means | what the teacher is told |
|---|---|---|
| **Leaning on the tutor** | independence ≤ 2, recent scaffolding ≥ S3 | they need less help, not more |
| **needs: \<dimension\>** | weakest dimension, rubric order breaking ties | the §19 move, said to a person |
| **Ready for harder ground** | retrieval, reasoning, independence all ≥ 3 | give them something uncovered |
| **Holding steady** | nothing weak, not yet independent | leave them be |
| **Not read yet** | under three judged responses | named, never silently dropped |

Alarm first: a teacher reading top to bottom meets what is going wrong before what is
going well. The headline follows §19's own precedence — a room being carried by the tutor
reads as *"an assistance problem before it is a content one"* even when some dimension is
weaker.

Four rules keep it honest:

- **The view and the mentor cannot disagree.** The grouping uses `learnerSteer`'s own
  floor, thresholds and priority order. `chat` and `cognition-scorer` cannot import each
  other, so `tests/test_r93_class_room.py` reads BOTH files and fails on drift.
- **The room is the roster, not the scored rows.** Everyone active appears, read or not. A
  view built from the profiles table would shrink to whoever had been scored — losing
  exactly the students who most need attention.
- **Nothing is collapsed into one number.** A student keeps all eight dimensions; the room
  summary holds no dimension VALUE at all, only counts of students; neither rendering file
  can reach a dimension value (the wire type keeps them nested, so it is a compile error,
  not a convention).
- **A class reports on ITS courses.** Students are commonly in several classes at once, so
  an unscoped room would blend a history lesson's reasoning into the biology teacher's
  reading of the same child. Getting from a course to its lessons is three hops —
  `courses → course_versions → units → lessons`; `lessons` carries no `course_id`.

### Sections

A teacher who streams a class teaches its sections at different hours and to different
plans, so one blended reading can hide a whole stream. Measured, on a five-student class:

| view | what it says |
|---|---|
| whole class | *"1 student of the 5 read is weak on reasons with it, and no single thing is holding the whole room back."* |
| **section A** | *"2 students of the 2 read are leaning on the tutor… an assistance problem before it is a content one."* |
| **section B** | *"Nothing is weak across the 2 students read. This room is ready for harder work."* |

- The comparison **is** the sentence each section gets on its own (`sectionHeadlines`
  calls `roomHeadline` per section), so no threshold decides when sections "differ" and
  selecting one can never contradict the line that sent you there.
- No sections, or exactly ONE, means no control — a single named section is the whole
  class under another name.
- The people not in a section are a group named "No section", not a remainder. That is the
  live shape: the classes using sections today each have one named section plus a student
  outside it.
- Sections are summarized server-side by the same summarizer the class uses, because a
  client that built its own summaries would have to read the dimension values the room
  view exists to keep out of sight.

## What is deliberately NOT built

- **§10 transfer and §11 retention as scheduled tasks.** Both need a task generator — a
  delayed retrieval prompt is a new student-facing surface. The schema already
  distinguishes them: they arrive as new columns later, not a redesign.
- **A cross-class view.** The room reads one class at a time; a teacher with five classes
  still has no way to see where to spend their morning.
- **Section hygiene.** A section is an unvalidated text label on a membership, so `"A"`
  and `"a "` are two sections. A teacher will eventually create a duplicate stream by typo.

## The wrong diagnoses (kept, because they are the evidence)

Live probing found things review and 1454 offline pins did not.

- **"The scoring model returned invalid JSON" was read as truncation. It was not.** A
  smaller batch and a doubled output budget changed nothing; the failing student's longest
  response was 215 characters; the third tick scored the same pair cleanly from
  byte-identical input. The judge is *intermittently* unparseable. Fix: one retry, for
  unparseable replies only — and an error that now carries `[stop= blocks= chars= json=]`
  plus the parser's complaint cut at the first comma (exactly where V8 starts quoting the
  document back, so no student text can ride into a log). The truncation check stays: it
  was not the cause here but remains a real failure mode.
- **`lessons` has no `course_id`.** The single-hop guess would have 400'd the class view
  for every class that links a course — nearly all of them. Caught by the first probe.
- **Claude 5 rejects `temperature`, and rejects assistant prefill.** Both found by live
  calls, not by reading docs.
- **`Number(null)` is 0 and 0 is finite**, so a profile with no scaffold trend reported
  "steady" and fed the dependency rule a comparison that never happened. Caught by a
  property test on its first run.
- **`app.settings.anon_key` was never set**, so the scheduled call would have sent
  `Bearer ` and 401'd silently every fifteen minutes. Caught by checking before scheduling.
- **"1 student … are weak."** Subject-verb agreement in a sentence a teacher reads. It
  looks like a broken product, not a broken sentence.

## Verification

- **1454 python pins** over the prompt's judgment rules, the API contracts, the schedule's
  contract and the room's rules — including two that read `chat` and `cognition-scorer`
  together and fail if the §19 thresholds drift apart.
- **22 executable property tests** over the real room derivations (`tests/room_view.test.ts`
  via `tests/test_r93_room_view.py`), plus the 32 flow-core properties.
- `deno check` clean on the scorer; `tsc`, `eslint` and `vite build` clean.
- **Live, against production**, on probe rigs created and deleted each time: the sweep's
  auth door (403 / 403 / ran), the class door (403 for a teacher of another class in the
  same org), lesson scoping (a profile outside the class's courses correctly excluded),
  every grouping branch, and all three section shapes.

## Operational state

| piece | status |
|---|---|
| `cognition-scorer` | **live** (v10) — deploys through the MCP channel |
| the ledger + sweep tables, `cognition-sweep` cron | **live**, firing every 15 minutes |
| the teacher console (Thinking tab, room panel) | **live** — the frontend deploys from main |
| `chat` — §19 steering (R91) | **merged, NOT deployed** |
| `curriculum-admin` — R85 provider switch, R89 shared-book fix | **merged, NOT deployed** |

`SUPABASE_ACCESS_TOKEN` is expired. The MCP deploy channel has a per-call size ceiling
that `chat` (417KB) and `curriculum-admin` (181KB) both exceed, so those two wait on the
token being rotated and `deploy-backend.yml` re-run. Until then the profiles accumulate
but the mentor does not yet steer on them — which is the half that makes the rubric change
what a student experiences rather than only what a teacher reads.
