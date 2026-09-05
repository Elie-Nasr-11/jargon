# Overnight run — 2026-09-05

The owner's list, verbatim: *pdf glitch · loading time · $25 supa · thinking criteria · teacher
notes to steer mentor · transcript review · better thinking and transcripts UI to make it more
useful.* Planned as seven releases, each its own file in this folder, each shippable alone.

This file is the brief: what was measured, what the owner decided, the order, the gate every
release passes, and what is deliberately not in. Read it first; then the release you are on.

## What was measured before anything was designed

Three things the list assumed turned out differently once measured. They changed the plan.

**1. The "$25 Supa" is already paid, and the tier is not the problem.** The org is on **Pro**.
The project is in **ap-southeast-2 (Sydney)**; the users are in **Beirut** and **Zürich**. The
same PostgREST query, by where it was made from (edge logs, 2026-09-02/03, `response.origin_time`):

| path | from Sydney | from Beirut | from Zürich |
|---|---|---|---|
| `/rest/v1/lessons` | p50 **80ms** | p50 **674ms** | p50 422ms |
| `/rest/v1/profiles` | p50 **77ms** | p50 **333ms** | p50 413ms |
| all REST | — | p50 334 / p95 1328 | p50 408 / p95 1201 |

Every call from Lebanon carries ~300ms of pure distance. A screen that fires ten sequential calls
spends three seconds on geography before Postgres does anything. Postgres itself is fast
(`cognition_sweep_*` from inside the region: p50 27–36ms). **Owner's decision: no region
migration this round.** So the lever that is in scope is the *number of sequential calls*, which
R108 attacks, and it pays in either region.

**2. Loading is a code problem with names.** The performance audit (agent report, 2026-09-04)
ranked nine contributors; the top four are all waterfalls in our own code: the entry route blocks
first paint on an admin-ops edge call that is fired 2–3× per load and never cached; a lesson opens
through ~11 sequential PostgREST round trips (`fetchLessons` is a 5-hop chain run twice); the
teacher dashboard is 7 waves / ~30 queries behind two serial auth gates, **re-run every 30s**;
the entry payload has regressed to 223KB gz (R82 got it to 115KB) because all of `lib/api.ts`
plus supabase-js ride the preload path. The DB is on `t4g.micro`, which the R55 incident report
blamed for burst stalls — **owner's decision: leave compute alone this round.** Details and
line numbers: `R108-cut-the-waterfalls.md`.

**3. The eight thinking criteria behave like three.** Over the 132 judged responses:

| dimension | n scored | mean | sd | never 0? |
|---|---|---|---|---|
| independence | 111 | 1.40 | **1.34** | |
| retrieval | 82 | 1.21 | 1.18 | |
| vocabulary | 88 | 1.20 | 1.08 | |
| reasoning | 61 (46% null) | 1.59 | 1.05 | |
| metacognition | 68 | 1.49 | 0.90 | |
| elaboration | 94 | 0.80 | 0.88 | |
| organization | **39 (70% null)** | 2.08 | 0.80 | |
| expression | 126 | 2.36 | **0.65** | **yes** |

Pairwise: reasoning~elaboration **0.86**, independence~reasoning **0.85**, vocabulary~retrieval
**0.82**, retrieval~reasoning 0.79 — one factor read five ways. Metacognition ~0.55 with reasoning:
partly its own thing. Expression barely varies and organization is unscorable on most turns.
Caveat: 132 rows from a handful of students inflates correlations (a strong student is strong on
everything), so this is direction, not a factor analysis. **Owner's decision: judge eight, show
three.** Details: `R110-thinking-three-headlines.md`.

**4. A defect in this week's work, found by the audit.** `chat` reads the student's cognition
profile with a column list (`chat/index.ts:5187`) that omits `share_unaided` and `load_flag`. So
R103's BREAK IT DOWN has never been able to fire on a real turn and R101b's §14 guard on mastery
has always defaulted open. The room side (scorer) is correct; the mentor side never received the
columns. Fixed first, as R105, with a pin that states the rule this broke: *chat asks for every
column it steers on.*

**5. No teacher-written word reaches the mentor today.** `teacher_notes` (fully built, zero rows)
is read by two dashboards and no edge function; `teacher_live_comments` reach the student's
browser but never the prompt — the mentor is literally unaware a teacher spoke.
`PRODUCT_ARCHITECTURE.md:9` claims otherwise; it is aspirational. R109 builds the path.

## The owner's decisions (AskUserQuestion, 2026-09-04)

| question | decision |
|---|---|
| What should the Thinking view make a teacher do? | **All four**: decide what to reteach · catch leaning on the AI · see growth over the term · act on one student |
| How should the criteria narrow? | **Judge eight, show three** — the judge and §19 unchanged; the teacher reads three headlines, expression + organization collapse to a caveat line |
| Region / round trips / compute | **No region migration. No compute upgrade. Code work only** — cut the waterfalls |
| Text reveal cadence | **Continuous, smoothed, model speed** — words flow as they arrive, a small buffer irons out bursts, nothing waits for a sentence to finish |
| Teacher note: scope | **Per student, per class** — one live note at a time, with history; the student never sees it |
| Teacher note: what and how hard | **Free text the mentor FOLLOWS** — rides beside §19's moves, outranks the default help level, same never-say rule |
| Transcript review | **One review surface** — every session of the student, chronological; S-level chip + the judge's line under each student turn; markers resolved; register labelled; the note composer pinned at the bottom; any turn quotable into it |
| Brain map (R104, earlier) | Left alone |

## Order

Risk-ascending, with the daily-felt win front-loaded. Each release ships on its own; if the
night ends mid-list, everything above the line is live and green.

| # | release | why here | est. |
|---|---|---|---|
| 1 | **R105** — hotfix: chat reads the columns it steers on | live defect, ten minutes | 0.25h |
| 2 | **R106** — the media stage belongs to the lesson that raised it | the PDF glitch, contained | 1.5h |
| 3 | **R108 a–e** — cut the waterfalls, safe slices (entry gate, catalog in one call, lesson open in one wave, dashboard cadence, cache snapshot) | biggest daily win, low blast radius | 3h |
| 4 | **R107** — text flows | contained to one hook + one pure module | 2h |
| 5 | **R109** — the note to the tutor | new backend path; view + prompt block + composer | 2.5h |
| 6 | **R110** — Thinking: three headlines | view over existing pure derivations | 2h |
| 7 | **R111** — the review surface | the largest UI change | 3.5h |
| 8 | **R108 f–i** — bundle split, indexes, hot-table RLS rewrite, notifications cadence | widest import-graph blast radius; last on purpose | 2.5h |

R110 and R111 both mount R109's `NoteToTutor` component; R109 ships it first on the existing
transcript tab so nothing is built twice.

## The gate, every release

From `CLAUDE.md` and the standing bar:

1. HANDOFF "Starting" entry before the first edit; "Finished" entry with Summary / Files /
   Tests / Concerns / Next before the PR.
2. `frontend`: `npx tsc --noEmit` 0 · `npx eslint src` 0 errors (36 pre-existing warnings) ·
   `npx vite build` green.
3. Repo root: `python3 -m unittest discover -s tests -p 'test_*.py'` green (1581 today, 4
   Flask skips) · deno harnesses flow 55 / room 32 / thinking 20 (+ any new).
4. `deno check` on every touched edge function: scorer clean, chat **7** (the unchanged
   baseline; any NEW error blocks).
5. A mock walk (`scratchpad/mock_backend.py` on 8787, `vite preview` from `frontend/`,
   playwright-core chromium) at 1440×900 and 390×844 for any UI change: no page errors,
   `scrollWidth === innerWidth`.
6. PR → squash-merge → deploy run green → the DEPLOYED build read back and grepped for the
   change (the R103 habit; a 41-second green run is what a no-op looks like) → live read-only
   verification → `git fetch origin main && git checkout -B <branch> origin/main && git push
   --force-with-lease`.
7. **Pins state rules, not shapes.** Every pin that breaks is re-expressed as the rule it
   meant, never deleted, never weakened.
8. Migrations: additive only, appended to the hardcoded list in `deploy-backend.yml`, applied
   by hand first (`execute_sql`), `notify pgrst, 'reload schema'` after any DDL a function
   reads or writes.

## Stop rules for an unattended run

- A release that fails its gate twice is written into HANDOFF as **Status: Blocked** with the
  real error text, its branch state is left pushed, and the run moves to the next release.
  `main` is never left red.
- Nothing destructive: no table drops, no policy deletions except the exact recreate-in-place
  in R108h, no data rewrites. No credential is read, printed or committed.
- Nothing that needs the owner's hands is attempted (region, compute, Render settings).
- A measurement that contradicts a plan wins over the plan. Write the contradiction down and
  do the smaller thing.

## What is deliberately NOT in this run

- **The region migration** and **the compute upgrade** — owner's call; the measurements are
  recorded in `docs/PERFORMANCE.md` (R108) so the decision can be revisited from a read.
- **The brain map** — left alone (R104, 2026-09-03).
- **§12's client-side signals** (latency, revisions, speaking duration) — still not built.
- **Cutting the judge to fewer dimensions** — declined in favour of judge-eight-show-three.
- **A cross-class room** — unchanged.
