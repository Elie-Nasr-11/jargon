# Cognition: measuring the thinking, and acting on it

How the Independent Cognitive Production Rubric (owner brief, 2026-08-31) became running
code. The rubric's own text is the authority on WHAT is measured; this file is the
authority on where each part lives, why it is shaped that way, and what it refuses to do.

Built across R90–R104, and **finished**: every section of the rubric that can be measured
without a surface that does not exist is live, including all eight of §19's steering rules.
The coverage table below says which release closed each one and where it lives. This
describes the system as it stands; the release-by-release story is in `docs/HANDOFF.md`,
and the decisions in `docs/DECISIONS.md`. The one part of the history worth keeping here —
the diagnoses that turned out to be wrong — is at the bottom, because it is the best
evidence for how the thing actually behaves.

## Where each section of the rubric lives

| § | what it asks for | where it is | shipped |
|---|---|---|---|
| **§1** | judge a response in the context of the assistance immediately before it | `lessonFraming` + the judge prompt; independence is capped when the answer echoes the mentor | R90 |
| **§2–§9** | the eight dimensions, with 0–4 anchors for each | `DIMENSIONS`, `JUDGE_SYSTEM`'s full anchor text | R90, anchors R99 |
| **§8** | attribution — what was AI-supplied vs student-originated | `evidence.attribution`, five categories per side, rendered as two columns | R99 |
| **§10** | transfer, assessed by a *separate task* rather than inferred | the in-session probe; `transfer` scored only on a probe answer | R100 |
| **§11** | retention, by *delayed independent retrieval* | the same probe, ≥20h after the idea's last evidence | R100 |
| **§12** | quantitative signals stored as underlay, never determining a score | `textSignals` computes four in code and spreads them OVER the judge's, so code wins the counting | R99 |
| **§13** | the S0–S5 assistance ladder | `scaffold_level`, read off what the mentor actually said | R90 |
| **§14** | cognitive independence; supported vs unsupported mastery | `unaided_count` / `share_unaided` / `split` on the profile; the count beside every student in the room; a guard on mastery in both the mentor and the room | R100, R101, **R101b** |
| **§15** | never one composite number | no column, wire type or screen holds one; the room's summary carries no dimension value at all | R90, held since |
| **§16** | longitudinal trajectories | the Thinking tab's line by sitting, "first → now", and the cross-lesson dependency pattern | R101 |
| **§17** | normalize to grade band, subject and modality | `SUBJECT:` and `PRIOR ASSISTANCE ON THIS LESSON:` in the framing | R99 |
| **§18** | expression is its own dimension; mechanics never lower a cognitive one | the anchor text, and the steer that asks for a reformulation rather than a rewrite | R90, R91 |
| **§19** | the measurement must change how the mentor responds | `learnerSteer`, at most two moves — **all eight rules** | R91, R100, **R103** |
| **§20** | the delayed unaided ask | the probe opener, one per session, one per day | R100 |

The one part not built is inside §12: **latency, revisions and speaking duration**. They
need client-side events the product does not emit, and they are not faked. Everything else
the rubric asks for is running.

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
                         │                                 ├──▶ chat  (§19 steers the mentor)
                      pg_cron                              └──▶ teacher console
                    every 15m                                   · student ▸ Thinking
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
| **cognitive load excessive** (R103) | BREAK IT DOWN — one step, one sentence, one example |
| a dimension weak, weakest first | the matching §19 ask |
| expression weak **while reasoning is strong** (§18) | ask them to reformulate — never rewrite it |
| retrieval, reasoning **and** independence all proficient | FADE AND TRANSFER |

### The eighth rule: cognitive load

*"If cognitive load appears excessive: break the task into smaller steps."* This one could
not be read off the eight dimensions, because **overload is not weakness**. A student who
finds the work hard produces weak answers. An overloaded student produces almost nothing
*while the tutor carries the turn* — and the two need opposite responses.

So the flag needs two facts at once, and `cognition-scorer`'s `buildProfile` is the only
place that has both. Over the last `LOAD_WINDOW = 6` judged responses, **more than half**
must be heavily scaffolded (S3+, the same level §14 calls *supported*) **and** more than
half must come back short (≤ 8 words, counted by R99's `textSignals`). Either condition
alone is a different student: heavy help with full answers is a scaffolded learner
working, and short answers with no help is someone disengaged or simply fast. Breaking
the task down would be the wrong move for both.

**Eight words, and the live corpus picked it.** The first draft of this rule said twelve.
Measured against the 132 judged responses on production, the median response is **11
words** — so a twelve-word cutoff put "short" *above* the middle of the distribution and
would have flagged **6 of the 15** eligible (student, lesson) pairs. A rule that fires on
40% of a school is a description of the corpus, not a signal. Eight words is one clause,
an answer with no room for a *because*; it sits at the corpus's 25th percentile, fires on
nobody today, and leaves three pairs one response short of it. The threshold is a
measurement, not a taste — re-measure before moving it.

Three details are deliberate:

- **A response with no word count is never short.** `signals.words` arrived with R99, so
  older rows carry none, and treating them as short would have flagged every student
  whose recent work predates it — on evidence that does not exist.
- **The arithmetic is stored beside the verdict.** `load_signals` holds
  `{ window, heavy_scaffold, short_answers, words_missing }`, so a reader can disagree
  with the thresholds rather than with the machine. A bare boolean is unfalsifiable.
- **The scorer decides whether; `chat` decides what.** `learnerSteer` reads `load_flag`
  and never recomputes it — the arithmetic needs ledger rows a profile does not carry, and
  a second implementation of one rule is a second answer to one question. It also blocks
  FADE AND TRANSFER: withdrawing help from someone already producing stubs under heavy
  scaffolding is reading the same evidence backwards.

Overload is a **state, not a trait** — read over the recent window only, so a student who
was drowning three weeks ago and is fine now is not still flagged.

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

`cognition_sweep_queue` mirrors the judge's constructed-response test exactly and surfaces
a pair on one of three conditions: **five** new responses are waiting; a probe answer is
waiting (R100); or — R101 — the pair's last constructed response is **two hours** old, at
whatever count. The third rule is what lets the Thinking tab show without a button. Before
it, a lesson a student finished or abandoned with one to four responses waiting was never
read at any age (measured 2026-09-03: nine such pairs holding eighteen responses, all
older than two hours, and a sweep that had run 96 times in a day and scored nothing) —
the teacher's "Read the thinking" button had been the only thing reading them. The cost
is one short judge call per abandoned tail, under five responses by definition; the sweep
orders by last activity, so live work goes first and aged tails fill the idle ticks. The
thirty-day window stays: the responses beyond it predate the ledger, and `score_lesson`
remains as an API for anyone who wants a specific lesson read. A scored turn leaves the
queue by construction, so the sweep is idempotent and a failed pair simply waits for the
next tick.

**Bounded, and honest about it.** A tick takes at most 2 pairs and 8 responses per pair,
and only starts another pair if there is room for one as expensive as the priciest so far.
The run-log row is opened *before* any scoring and patched at the end, so a tick the
gateway kills still leaves a row with a null `finished_at` — "started and never came back"
is a fact worth having, and silence is not.

## The teacher's two views

**A student ▸ Thinking** — the whole student, and it shows without a click (R101). One
read, `student_view`, brings every judged response of the student as numbers and ids —
never `evidence`, `signals` or a `note`; the quotes that ground a score stay on the
per-lesson `profile` read and appear when a lesson is selected. A scope selector
(Everything / Classes / Units / Lessons, each with its response count) is computed in the
browser from that one payload plus the lesson catalogue and the class→course links the
console already holds, so switching scope costs no request. A class scopes by the room's
own strict rule — a lesson's course is one the class links; no links means everything —
so "this class" here agrees with the room the teacher came from.

The eight dimensions are the **median over every response in the scope**. That is
deliberately not `buildProfile`'s last-ten: the profile feeds §19, which must react to
now, so it windows; a scope is the teacher's question "how has this student done across
this unit", and a last-ten window would make Everything equal to the most recent lesson.
Recency lives beside each dimension instead: a line **by sitting** (one session is one
point, the running middle of the last five so one bad afternoon is a dip, not a spike)
and "first → now", the earlier half of their sittings against the later half, shown only
at four or more. A lesson keeps the judge's own narrative; every other scope reads a
deterministic sentence built from the numbers — counts beside their denominators, never
a percentage — so it is exact and never stale. §16 / §14 is read across lessons: a
pattern ("work that holds up while the tutor carries it") is called only at three or more
lessons and two or more concurring signals, and it names them. It is a reading for the
teacher; it is not a §19 input and steers nothing. One caveat, stated: the order of
sittings uses the time the judge read the work, which trails the work by up to fifteen
minutes (the sweep) or two hours (a lesson's tail).

**A class ▸ How the room is thinking** — the first surface that reads ACROSS a class, and
the one that had to resist the class average hardest. It is arranged by what to DO: one
sentence saying what the room as a whole needs, then students grouped by the move §19
would make for each of them.

| group | what it means | what the teacher is told |
|---|---|---|
| **Leaning on the tutor** | independence ≤ 2, recent scaffolding ≥ S3 | they need less help, not more |
| **Overloaded — break tasks down** | `load_flag` on the freshest lesson | one step at a time, not a reteach |
| **needs: \<dimension\>** | weakest dimension, rubric order breaking ties | the §19 move, said to a person |
| **It did not stick** | strong on the three, but a delayed check found nothing | consolidate; do not fade yet |
| **Ready for harder ground** | strong on the three, it held, **and** they have been seen working alone | give them something uncovered |
| **Holding steady** | nothing weak, not yet independent | leave them be |
| **Not read yet** | under three judged responses | named, never silently dropped |

Alarm first: a teacher reading top to bottom meets what is going wrong before what is
going well. The headline follows §19's own precedence — a room being carried by the tutor
reads as *"an assistance problem before it is a content one"* even when some dimension is
weaker, and a room where half the read students are overloaded is told to break the work
into smaller steps *before* it reteaches anything. Both outrank the weakest dimension for
the same reason: in an overloaded room the dimensions are weak because the task is too
big, so reteaching the weakest one is the wrong instruction. A student who is both
carried and overloaded is grouped as **Leaning on the tutor** — the same order in which
the mentor pushes the two moves, so the room never names a different first move than the
one being made.

### §14 beside every student (R101b)

The groups say what to DO about a student. §14 says what the saying rests on. A teacher
reading *"needs: reasoning"* could not tell whether that reading came from work the child
did alone or work the tutor carried — and those are different lessons. So every read
student's chip carries **the count of their answers that had no help before them, over
its own denominator**: `2/14`, turned amber below a quarter, with the full sentence and
*"never checked a day later"* in the tooltip. Never a percentage: "2 of 14" and "14%" are
different claims, and the second hides what decides how much the first is worth. The share
is one fraction over one denominator across every lesson, not a mean of per-lesson shares,
which would weight a three-response lesson like a thirty-response one.

`probes_answered` reads **zero for the whole school** today. Rendering nothing there would
have looked like "fine"; it means nobody has ever asked these students cold.

Two guards came with it, and both close disagreements that existed **in code**:

- **§11.** Since R100 `chat` has told the mentor CONSOLIDATE, DO NOT FADE for a student
  who is strong in the lesson but failed a delayed check — while this view went on calling
  them *"ready for harder ground"*. That is precisely the contradiction the first rule
  below forbids. The room now has the matching group.
- **§14.** Mastery additionally requires having been seen working alone
  (`MASTERY_MIN_SHARE_UNAIDED`, one number cross-pinned across `chat`, `cognition-scorer`
  and `room.ts`). Absent evidence does not block — the guard fires on evidence of low
  independence, never on its silence, the same posture R100 took for retention.

**What was deliberately not built, and why it is worth recording.** The release was
planned as a positive "looks strong, but only with help" chip. Measured on production
first: **zero of the nineteen profiles are mastery-shaped, and zero of the fifteen eligible
have no weak dimension** — every read student today is *Leaning on the tutor* (5) or
*needs* (10), and `mastered` and `steady` are both empty groups. A chip gated on "looks
strong" **could not have fired on anyone**, which makes it an unfalsifiable rule, exactly
what R103's twelve-word threshold nearly shipped in the opposite direction. So §14 became
a number shown beside every student and a guard that can only withhold — the safe home for
a threshold nothing has calibrated.

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
- **A cross-class ROOM.** The room reads one class at a time; a teacher with five classes
  still has no way to see where to spend their morning. (The student's Thinking tab does
  read across classes since R101 — one student, their own work — which is a different
  object from a room.)
- **A model-written whole-student narrative.** Offered and declined on 2026-09-03: the
  whole-student reading is built from the numbers, so it costs nothing, is exact, and is
  never stale. The sweep is where it would hook in if it is ever wanted.
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
- **The idea-mastery table held zero rows for its entire life, and three things hid it.**
  The worst one here, because nothing failed loudly. `chat` called the four-argument
  `upsertRows` with three, so every write went out as `?on_conflict=undefined`, PostgREST
  rejected it, and **a bare `catch {}` swallowed the rejection**. `deno check` had been
  reporting it as a TS2554 the whole time — inside the "8 pre-existing errors" nobody
  re-read — and the belief that the deploy pipeline enforced `deno check` was simply not
  true. Fixing the call alone would have changed almost nothing: **973 of 992 graded
  attempts sat on lessons with no authored ideas**, so there was nothing to write against;
  and the EMA seeded from 0, so a first correct answer scored 0.3 and read as "to refresh".
  Three faults, each hiding the next. The lessons, in order of how much they cost: a
  swallowed write is worse than a failed one; a type error you have decided to tolerate is
  a type error you will not read; and a feature can be "shipped" for weeks while its table
  is empty, because nothing on any screen says "zero rows" out loud. (R97 — the table now
  holds 953 rows across 198 students.)
- **A 41-second green deploy.** Run #171 succeeded in less time than a deploy takes, which
  is exactly the shape of a workflow that ran nothing. It had not: the migration replay is
  deliberately skipped on function-only pushes (R50b), and the CLI no-ops on an unchanged
  bundle hash, so only the two changed functions were pushed. Worth writing down because
  the instinct to check was right even though the answer was fine — the versions and the
  deployed source are what settle it, not the green tick.

## Verification

- **1579 python pins** over the prompt's judgment rules, the API contracts, the schedule's
  contract, the room's rules and the Thinking tab's — including the pins that read `chat`,
  `cognition-scorer` and `thinking.ts` together and fail if a shared threshold drifts.
- **32 executable property tests** over the real room derivations (`tests/room_view.test.ts`
  via `tests/test_r93_room_view.py`), **20** over the Thinking tab's derivations
  (`tests/thinking_view.test.ts` via `tests/test_r101_thinking_view.py` — scopes, medians,
  the line by sitting, the §16 pattern, and that no sentence carries a grade), plus the 55
  flow-core properties. Both deno harnesses assert that every `Deno.test` in the file
  actually ran: a green suite that quietly filtered half its properties is the failure mode
  they exist to prevent.
- `deno check` clean on the scorer; `tsc`, `eslint` and `vite build` clean.
- **Live, against production**, on probe rigs created and deleted each time: the sweep's
  auth door (403 / 403 / ran), the class door (403 for a teacher of another class in the
  same org), lesson scoping (a profile outside the class's courses correctly excluded),
  every grouping branch, and all three section shapes.
- **R103, live and read-only** (2026-09-03): the two columns exist with their
  not-overloaded defaults across all 19 profiles; PostgREST's schema cache was reloaded so
  the profile upsert cannot fail with `PGRST204` on the first sweep after the DDL; and the
  DEPLOYED builds were read back and grepped rather than assumed — `cognition-scorer` v16
  carries the eight-word threshold, `buildProfile`'s two writes, `wordsOf`, the `load`
  group and `load_flag` in the class-view select; `chat` v122 carries BREAK IT DOWN,
  `profile.load_flag === true` and the `!loaded` guard on mastery. What is NOT yet proven
  live is the flag ever being TRUE: it fires on nobody in today's ledger, by design, so
  the first genuinely overloaded student is the end-to-end test.
- **R101b, live and read-only** (2026-09-03): no migration — every column it reads
  (`unaided_count`, `probes_answered`, `retention`, `transfer`) arrived with R100, so the
  deploy carried no schema risk and CI correctly skipped the replay. The deployed builds
  were read back: `cognition-scorer` **v17** carries `strongOnTheThree`, the `not_held`
  group, `seenWorkingAlone`, the §14 columns in the class-view select and `not_held: 0` in
  the room summary; `chat` **v123** carries `MASTERY_MIN_SHARE_UNAIDED`, the
  `share_unaided` read and the guard on mastery. Neither guard can fire on today's
  population, which is stated above rather than discovered later.

## Operational state

Everything in this document is live as of 2026-09-03.

| piece | status |
|---|---|
| `cognition-scorer` | live (**v17** — R101b's §14 counts and `not_held`; R103's `load_flag` before it) |
| the ledger + sweep tables, `cognition-sweep` cron, the two-hour tail rule | live, firing every 15 minutes |
| the teacher console (Thinking tab without a button, room panel) | live |
| `chat` — §19 steering, R100's probe opener, R103's BREAK IT DOWN, R101b's §14 guard | **live (v123)** |
| `curriculum-admin` — R85 provider switch, R89 shared-book fix, R102's restored importer | **live (v45)** |

The expired `SUPABASE_ACCESS_TOKEN` that held the last three of those for two days was
rotated on 2026-09-01. Two things are worth keeping from how that went:

- **The token was the real blocker, and it was also hiding a second one.** Run #158's log
  is a flat `unexpected list functions status 401`. Once the token was valid, run #163 got
  all the way to `curriculum-admin` (deployed, v43) and then died on the next function:
  `failed to bundle function: exit 135` — 128+7, a SIGBUS out of the local edge-runtime
  Docker bundler. It was invisible until then because `chat` had not been *attempted*
  since it grew.
- **`chat` bundles server-side now.** It is 426KB, five times the next largest function,
  and it crossed 416KB → 426KB when R91 landed; `curriculum-admin` bundled cleanly seconds
  earlier in the same run. `--use-api` hands bundling to Supabase instead of a container on
  the runner. Only `chat` carries the flag — everything else bundled fine in that same run.

§19 was then checked against production rather than assumed: a probe student with a profile
built to trip the dependency rule (weak reasoning, low independence, heavy recent
scaffolding) got two real lesson turns, both HTTP 200 with coherent replies and no errors,
and the rig — including the transcript rows `chat` wrote for it — was deleted afterwards.
That proves the wiring does not break a lesson. It does not prove the steer changed the
mentor's wording; one turn cannot show that, and the derivation is covered by the property
tests instead.

**Housekeeping:** three edge functions in the project have no source in this repo —
`key-probe-oneoff`, `ops-probe-r49` and `deploy-probe-r90` (the last from testing the MCP
deploy channel during R90). They are inert, and they are exactly the set `--prune` would
remove, but the safer removal is one-off:
`supabase functions delete <name> --project-ref qztpieiizmiayzjhezwh`.
