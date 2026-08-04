# Brain-First: the complete implementation plan

Status: PLANNED IN FULL, build not started (owner: "plan everything first in complete
detail"). Companion to BRAIN_FIRST_SCOPE.md (the why); this is the what/how, phase by
phase, down to schema, signatures, directives, and test strategy.

Owner decisions locked in:
- Progress = BLEND: steps-done drives the in-lesson arc; mastery drives class/home
  "what you know".
- Typed "next"/"ready" on a content step ACTS AS CONTINUE (one advance verb
  semantically; the keyboard path presses the button).
- Practice questions: TEACHER BANKS ARE PRIMARY when provided; mentor-generated
  otherwise, under strict guidelines (below).

Recommended build order: **A → E → B → C → D** (foundation, then felt speed, then the
read model, then its consumers, then intake). E-client could interleave with A if a
speed win is wanted immediately. Each phase ships independently: additive migrations,
tolerant server (old clients never break), tests re-pinned, live demo replay before
sign-off.

---

## Phase A — Modes + advancing consolidation (the foundation)

### A1. Three modes: lesson | practice | discuss

**Client (`frontend/src/student/turnModes.ts` + consumers)**
- `TurnMode = "lesson" | "practice" | "discuss"`. `open`, `quiz`, `assignment` leave
  the picker.
- Legacy transcript rendering: old persisted turns carry `turn_mode` values like
  "open"/"quiz" — keep a `LEGACY_MODE_LABELS` map so historical sections still render
  their label; only the PICKER is restricted. Never relabel history.
- `OfferPills` conditional-mode machinery (quiz/homework offers, hide-while-selected)
  is deleted. Teacher-posted quizzes/assignments surface ONLY as work items: the
  checkpoint dock above the composer and the class pages. Tapping a dock item launches
  its existing flow; the mode picker is untouched by it.
- `Chatbox`/`StudentApp`: mode picker shrinks to the 3 modes; `turnMode` reset rules
  unchanged (reset to lesson on lesson open).

**Server (`supabase/functions/chat/index.ts`)**
- Mode normalization (tolerant): `open → discuss`, `quiz|assignment → lesson`,
  unknown/absent → lesson. Old clients keep working forever.
- SYSTEM_PROMPT `student_mode` contract rewritten for 3 modes:
  - lesson — the spine; gates discharge here (and only here).
  - practice — mentor-posed exercises; grades PRACTICE evidence (Phase B mastery),
    never lesson gates.
  - discuss — exploration/recap/gap-filling; grades nothing.
- `applyModeCeiling` simplifies to those three rows. Practice keeps its current
  conversational behavior in Phase A (brain-driven targeting arrives in C); the only
  Phase A guarantee is that practice/discuss can never discharge lesson gates
  (already true — verify + pin).

### A2. mentor_preferences retired
- Client: the Customize "mentor style" section (pace/tone/hint level/mentor mode) is
  removed; the profile note-to-mentor, voice, and theme remain. `mentorToPreferences`
  call sites stop sending the field.
- Server: `normalizeMentorPreferences` stays as a tolerant no-op parser (old clients
  still send it); the payload's `policy.pace/tone/mentor_mode` lines and every prompt
  reference to them are deleted. The teacher-level help ceiling
  (`LessonHelpCeiling`/final-answer policy) is UNTOUCHED — that's a teacher control,
  not a student preference.

### A3. Continue is the advance verb; typed readiness presses it
- `applyTurn` acknowledge path becomes exactly two doors:
  1. control `continue` (the button), and
  2. routedKind `continue_signal` (typed "next"/"ready"/… — router-classified, regex
     fallback) — same effect as the button, per owner decision.
  The legacy fallback "any contentful text acknowledges when the router is down"
  NARROWS to `CONTINUE_SIGNAL_RE` matches only — ordinary sentences never advance a
  content step even in a router outage.
- `readiness_ack` (gated steps) is unchanged — readiness on an understanding step is
  still not an answer.

### A4. mode_offer: calls-to-action become chrome
- Envelope gains `mode_offer?: { mode: "practice" | "discuss", topic: string,
  label: string } | null` — like `continue_offer`, it rides the message and only the
  LATEST offer is live.
- Phase A source: the mentor's JSON contract gains an optional `mode_offer` output
  field (same pattern as `link`/`new_idea`): the model proposes, the orchestrator
  validates (mode in set, topic non-empty, ≤60-char label) and attaches only on
  eligible turns — a content-step conclusion or a checkpoint pass. Phase C upgrades
  the source to brain-informed deterministic offers; the envelope shape doesn't change.
- Directive rule wherever an offer is eligible: "If you propose a mode_offer, the PILL
  carries the action — your prose must NOT contain the 'try practicing X' sentence.
  Close short; let the buttons speak."
- Client: `ChatWindow` renders the offer pills in the composer-lead row next to
  Continue: `[Practice this idea] [Talk it through] [Continue]`. Tapping one sends a
  CONTROL turn `{ type: "mode_offer", mode, topic }` (deterministic — no synthesized
  student text), switches the picker to that mode, and the server directive for that
  control is: practice → "give the first exercise on {topic} now, one question only";
  discuss → "open the conversation on {topic} with one inviting question".
- `TypedChatControl` union gains `"mode_offer"`; control turns remain mode-ceiling
  exempt (they're buttons).

### A5. Client hygiene riding along
- Extract the sentence splitter shared by Transcript.tsx and useConversation.ts into
  `frontend/src/lib/sentences.ts` (one regex, two consumers).
- Re-pin: test_student_surface (mode picker), test_flow_v3 pins touching
  offers/ceiling, new pins for mode_offer + narrowed acknowledge fallback.

---

## Phase E — Performance (felt speed)

### E1. Server: one assessment call per turn
- Merge `classifyTurn` (router) + `checkUnderstanding` (grader) into `assessTurn` —
  ONE fast-tier model call returning:
  `{ kind, understanding: { demonstrated, level, note }, preempted: [] }`.
- Everything that consumed either output keeps its exact semantics: the echo gate
  stays code-side and still overrides; `applyModeCeiling` still lifts kinds; MCQ/code
  turns still skip it entirely (deterministic kinds); parse failure falls back to
  `heuristicKind` + null grader exactly as router-outage does today.
- The code grader stays separate (code turns only). Net: a text turn is 2 model calls
  (assess → mentor) instead of 3; the mentor stream starts one round-trip sooner.
- Telemetry: record the merged call as task "assessment" in model_usage (pricing table
  entry), keep router-disagreement telemetry (kind vs demonstrated).

### E2. Client: preload + cache
- `frontend/src/lib/surfaceCache.ts`: an in-memory read-through cache keyed by
  (userId, resource), TTL ~60s, stale-while-revalidate (return cached instantly,
  refetch in background, notify subscribers). No new dependency — ~80 lines.
- Home/ClassSummary/LessonTree/Profile fetch through it; every mount after the first
  paints instantly.
- Parallelize each surface's queries (today several run serially on mount) —
  Promise.all the independent ones.
- Prefetch: sidebar hover/pointerdown on a lesson warms (session, turns, activities);
  login completion warms the home bundle + catalog.
- localStorage snapshot (versioned, per user) of the catalog + home bundle for instant
  first paint after reload; revalidate immediately.
- Optional (measure first): a `student_home_bundle` RPC collapsing home's N queries
  into one round trip. Only if parallelization + cache still feels slow.

---

## Phase B — The brain read model

### B1. Schema (one additive migration)
```sql
create table student_idea_mastery (
  user_id uuid not null references auth.users(id) on delete cascade,
  idea_key text not null,
  score numeric not null default 0,          -- 0..1 EMA
  attempts int not null default 0,
  last_result text,                          -- pass | fail | neutral
  last_evidence_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, idea_key)
);
-- RLS: owner select/insert/update (caller-JWT writes, same pattern as student_links)
```
- `lesson_activities.idea_keys text[]` (nullable, additive): authored/extracted mapping
  from step → ideas. Fallback when null: the lesson's primary ideas.

### B2. Evidence writer (no new model calls)
- In the existing grading path, after the effective verdict resolves:
  `result = pass (demonstrated/quiz-correct/code-pass) | fail (graded miss) |
  neutral (echo-rejected, conversation)`.
- Update rule (EMA, α = 0.3): `score ← clamp01(score + α·(target − score))` with
  target 1 for pass, 0 for fail; neutral only bumps `attempts`/`last_evidence_at`.
- Read-time decay (never stored): `effective = score · exp(−days_since/45)` floored at
  `score·0.4` — knowledge fades toward "needs a refresh", never to zero.
- Written best-effort via scheduleBackground; a mastery write can never fail a turn.

### B3. loadBrainContext
```ts
loadBrainContext(config, userId, lessonId) -> {
  weak:      [{ idea_key, title, effective, note }]   // ≤5, ascending effective
  strong:    [{ idea_key, title, effective }]          // ≤3, descending
  frontier:  [{ from_key, to_key, titles, kind }]      // ≤3 possible-not-earned links
             // touching this lesson's ideas
  traveled:  [{ term, subjects }]                      // ≤5 vocab seen in 2+ subjects
  misconceptions: [{ note, seen_at }]                  // ≤3 open, lesson-relevant
}
```
- Batched REST (one Promise.all), hard caps, stable ordering → payload key `brain` in
  the STABLE section (prompt-cache friendly). Loaded once per turn alongside the
  existing context loads (piggybacks the same round-trip budget).
- SYSTEM_PROMPT gains a compact BRAIN block: what each field means and the standing
  instruction that weakness → shore up, strength → stretch, frontier → invite.

### B4. Progress blend (owner decision)
- In-lesson arc: steps-done (unchanged).
- Class/home: a "what you know" mastery summary — client aggregates
  student_idea_mastery per class (avg effective over that class's published ideas,
  plus counts: solid/developing/needs-refresh). Rendered on StudentHome and
  ClassSummary next to (not replacing) completion. BrainMap idea stars get a
  strength halo driven by `effective`.

---

## Phase C — The brain drives teaching

### C1. Deterministic flow hooks (directive layer, not vibes)
- `recall_opener`: when this turn PRESENTS a step (presentsThisTurn) and
  brain.weak contains an idea linked to the step (same lesson or via curriculum_links),
  prepend: "Open with ONE quick recall question on {weak.title} before presenting —
  it underpins this step. Then present as directed." Max once per session per idea
  (tracked in step_state.recall_asked or session-level set).
- `mastery_compression`: presenting a step whose mapped ideas are ALL effective ≥ 0.8
  → reuse the compressed-presentation directive (generalizes P4 pre-emption from
  conversation-detected to mastery-known). The conversational pre-emption path stays;
  whichever fires first wins.
- Both are computed in code from brain context; the model just follows the directive.

### C2. Practice mode = the gym (owner decision: banks primary)
- Target selection (deterministic): lowest `effective` among (a) ideas of the current
  lesson, then (b) the class's ideas with `attempts > 0`, tie-broken by oldest
  last_evidence_at. Frontier links are eligible targets every ~4th exercise
  (connection practice). Strength stretch: every ~5th exercise targets a STRONG idea
  at higher difficulty (hone, don't just remediate).
- Source priority: published `practice_items` for the target idea (Phase D table) →
  else mentor-generated under STRICT GUIDELINES (a dedicated prompt block):
  1. ONE question at a time, answerable from taught material —
     never require facts outside the lesson's resources/ideas.
  2. Difficulty matched to the student's tier for that idea.
  3. Never reveal the answer before an attempt; after a miss, one hint, then the idea.
  4. Every attempt is graded (assessTurn) and writes mastery evidence.
  5. Vary exercise shapes (existing PACING rule applies).
- Practice turns NEVER touch lesson gates (ceiling row already guarantees).

### C3. Discuss mode = the link mine
- The invite-thinking behavior stops being frequency-vibes: payload.brain.frontier
  carries the top candidate links, and the discuss directive says: "when the
  conversation touches {from_title} or {to_title}, invite the student to articulate
  the connection — the link mints only from THEIR articulation (existing
  student_articulated path)."
- mode_offer generation turns deterministic here: a content-step close with a frontier
  link on its ideas emits `[Talk it through]`; one with a weak idea emits
  `[Practice this idea]` — computed in code, not model-proposed (the Phase A
  model-proposed path stays as fallback).

### C4. Tier-calibrated grading
- assessTurn's user message gains one line: "Student's current level for this step's
  ideas: {tier}. Calibrate 'demonstrated': a beginner's solid is plain-language
  correctness; an advanced student's solid requires precision." Named-criterion rule
  and latest-message-only rule unchanged.

---

## Phase D — Content-agnostic intake

### D1. Schema
```sql
create table practice_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  idea_key text not null,
  lesson_id text,                 -- optional anchor
  prompt text not null,
  expected text not null,         -- the idea the answer must demonstrate
  difficulty text not null default 'core',   -- intro | core | stretch
  status text not null default 'draft',      -- draft | published | retired
  created_by uuid, created_at timestamptz default now()
);
```
- ideas / vocab_terms / curriculum_links already have status columns — extraction
  writes drafts into the SAME tables.

### D2. Extraction pass (curriculum-admin action `extract_knowledge`)
- Trigger: on lesson import/create, and a "Draft knowledge" button in studio-lite.
- One model pass over the lesson's steps + resource chunks →
  drafts: ideas (objectives, slugged idea_keys, deduped against org index),
  vocab terms (+variants, student-grade definitions), candidate curriculum_links
  (against the org's PUBLISHED ideas only, capped ~5), practice_items (2-3 per idea).
- HARD RULES: extraction only ever writes status='draft'; never mutates published
  rows; re-running upserts drafts idempotently (keyed by idea_key/term).
- Studio-lite review surface: a "Knowledge" tab per lesson listing drafts with
  approve/edit/publish/discard per row + publish-all. Nothing reaches students
  unreviewed — processKnowledge and the brain read only `published`.
- This is what makes the platform content-agnostic: ANY imported content produces the
  same graph, and every brain behavior lights up automatically once a teacher approves.

---

## Cross-cutting

- **Chat-fn module split (optional Phase A0, recommended):** mechanical extraction into
  `prompt.ts` (SYSTEM_PROMPT + directive ladder), `assess.ts` (router/grader/echo),
  `knowledge.ts` (processKnowledge + brain), `stream.ts` (SSE adapters), `rest.ts`
  (REST helpers), `index.ts` (handler). Pure moves, no behavior change; static pins
  re-anchored once. Makes every later phase reviewable.
- **Testing per phase:** keep static pins for drift; ADD behavioral tests for the pure
  functions each phase touches (applyTurn doors, mastery EMA/decay math, target
  selection, sentence splitter) — they're pure and cheap to test properly.
- **Live replay per phase:** the pg_net demo-account harness (R22b/c) re-runs a lazy
  student + a teen through one lesson before sign-off.
- **Rollout:** every phase is server-tolerant of old clients and client-tolerant of old
  envelopes (all new fields optional). Deploy backend first via the existing main
  push; no coordinated cutover ever needed.

## What gets DELETED (the simplification ledger)
- mentor_preferences UI + payload policy lines (server parser stays as tolerant no-op).
- `open`, `quiz`, `assignment` from the mode picker; OfferPills conditional-mode
  machinery; the hide-while-selected logic.
- The "any contentful text acknowledges" legacy door (narrowed to readiness only).
- Buried action sentences at step closes (replaced by mode_offer pills).
- Duplicate sentence-splitting regexes (one shared util).
- After E1: classifyTurn + checkUnderstanding as separate calls (one assessTurn).
