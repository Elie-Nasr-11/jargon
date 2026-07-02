# Handoff Log

Use this file for async communication between the human, Codex, and Claude Code.

Newest entries should go at the top under `Active Handoff`.

## Active Handoff

## Claude -> Codex / Human - 2026-07-02 (HOTFIX: lesson_resources.display_mode does not exist)

Summary: Phase D added display_mode to the lesson_resources select in loadContext assuming the
column existed — it never has (the old B13 note "display_mode never selected" was wrong: it is a
LessonChatResource WIRE-TYPE field with no backing column; resourceForEnvelope always coerced the
missing value to "card"). PostgREST rejected the whole wave-1 query, so every typed chat turn
500ed from the Phase D deploy until this fix. Fix: removed display_mode from the select (exact
pre-D column list); resourceForEnvelope untouched (still defaults "card"). If teachers ever
author display modes, add the column via migration FIRST.
Files changed: supabase/functions/chat/index.ts (one line), docs/HANDOFF.md.
Tests run: node --experimental-strip-types --check; python3 -m unittest
tests.test_supabase_chat_function (12 OK). Verified live schema via information_schema before
and confirmed the first post-deploy turn against runtime_events after.
Remaining concerns: none for this fix; lesson learned recorded — never add a column to a select
without checking information_schema (the adversarial review lenses checked trimmed selects
against consumers but not ADDED columns against the schema).

## Claude -> Codex / Human - 2026-07-02 (Tutor v2.0 Phase D: latency + cleanup — DONE)

Summary: A tutor turn's I/O collapsed from ~9 serial reads + ~7 serial writes to two parallel
read waves + (mentor insert -> one parallel record batch -> session patch). loadContext wave 1
(lesson, allActivities select=* with the cursor row derived in code — the separate
current-activity query is gone, recentTurns, mastery, resources +display_mode now actually
selected, interactions, profile) then wave 2 (milestone, activity quiz, single-activity quiz
fallback, misconceptions by activity skills, chunks), checkpoints chain overlapping both. The
student-turn insert runs inside the grader Promise.all (handler attached immediately — review
caught the unhandled-rejection window). advanceToActivityId derives from context.activities.
Post-model: mentor turn insert first (transcript/dedup source of truth), then a parallel batch
of [misconception, attempt->evidence chain, quiz_attempts, recommendation], THEN the session
patch (review caught the patch racing a failed attempt insert: the session must never advance
past lost graded records). Mastery loop -> one in.() read + one PostgREST upsert
(on_conflict=user_id,skill_key — PK verified live; new upsertRows helper). All
runtime_events/model_usage_events writes go through scheduleBackground (guarded
EdgeRuntime.waitUntil) — telemetry off the critical path incl. error paths. Legacy {messages}
path deleted (sole caller was the undeployed standalone mentor/mentor.js — it now gets a typed
400). run fn marks terminal engine timeouts with timeout:true; chat runTimedOut prefers the
flag (string heuristics kept as fallback). Frontend: fetchLatestLearningSession adds an explicit
user_id filter (newest-first pick KEPT — it is the authoritative choice; "prefer active" would
boot zombie sessions on completed lessons); dead helpRequest/hintRung plumbing removed; voice
tool-result no longer forwards envelope.assessment; fabricated "min left" estimate deleted;
resource/voice telemetry uses the cached session instead of per-event auth.getUser();
resource-card dead ternary; the always-true dictation/read-aloud/live-voice flags deleted from
VoiceSettings + every consumer branch (Composer no longer takes a voice prop).
Files changed: supabase/functions/chat/index.ts, supabase/functions/run/index.ts,
tests/test_supabase_chat_function.py, frontend/src/lib/api.ts, frontend/src/lib/jargon-store.ts,
frontend/src/routes/chat.tsx, frontend/src/components/Composer.tsx,
frontend/src/components/HeaderMenus.tsx, docs/HANDOFF.md.
Tests run: node --experimental-strip-types --check (chat + run); python3 -m unittest
tests.test_supabase_chat_function (12 OK, legacy test now asserts the path is gone); frontend
tsc/lint/build (0 errors, 12 pre-existing warnings); adversarial multi-agent review (6 findings
-> 4 confirmed after 2-verifier refutation, deduped to 3 fixes, all applied: student-turn insert
joined into the grader Promise.all; session patch staged AFTER the record batch; dead empty
import removed).
Remaining concerns: the run fn's timeout:true flag is unreachable through the SHIPPED frontend
(invokeJargonRun throws on the 502 and discards the body; the fabricated fallback message still
matches the string heuristics, so detection works — forwarding structured 502 bodies would make
the flag load-bearing, a small future client change); misconception read filter narrowed to
activity skills (verified: authored activity skills mirror milestone skills, and an empty filter
falls back to unfiltered — accepted); voice-session's session pick left as-is by design (matches
the client's authoritative updated_at-desc pick). The branch now carries the frontend halves of
Phases A+B+D awaiting the user-OK'd main fast-forward.
Suggested next task: fast-forward main (frontend A+B+D goes live on Render), then a live
behavioral matrix pass + latency p50/p95 comparison via runtime_events once student traffic
accrues.

Status was: Starting
Task: loadContext -> two parallel read waves (activity derived from a widened allActivities
select); post-model writes batched (mentor turn insert stays first, then one Promise.all;
attempt->evidence stays chained); mastery per-skill loop -> one read + one PostgREST upsert
(on_conflict=user_id,skill_key — PK verified); telemetry via guarded EdgeRuntime.waitUntil;
legacy {messages} path deleted (sole caller: undeployed mentor/mentor.js); run fn returns
timeout:true and runTimedOut prefers it; frontend F11 cruft (dead helpRequest/hintRung plumbing,
voice-flag dead branches, fabricated "min left", getUser->getSession for telemetry, resource-card
ternary) + explicit user_id on fetchLatestLearningSession.
Files I expect to touch: supabase/functions/chat/index.ts, supabase/functions/run/index.ts,
tests/test_supabase_chat_function.py, frontend/src/lib/api.ts, frontend/src/routes/chat.tsx,
frontend/src/components/HeaderMenus.tsx, frontend/src/components/Composer.tsx,
frontend/src/lib/jargon-store.ts, docs/HANDOFF.md.
Notes: no schema changes; wire envelope unchanged; voice-session session pick intentionally
left as-is (it already matches the client's authoritative updated_at-desc pick).

## Claude -> Codex / Human - 2026-07-02 (Tutor v2.0 Phase C: instruction layer + prompt diet + routing — DONE)

Summary: The mentor's instruction layer is now one coherent build. SYSTEM_PROMPT rewritten as a
single static block (persona/conversation craft + lightest-help teaching ladder + governance +
reduced output contract {reply, understanding, misconception}). selectTeachingMove, MOVE_GUIDANCE,
MODE_HELP_WANT, pedagogyPromptBlock, and the six ad-hoc per-turn directive strings are deleted,
replaced by turnDirective() — one composed instruction from a priority ladder (post_completion >
runtime_timeout > understanding_demonstrated > code_objective_met > step_concluding_stuck >
quiz_first_presentation > quiz_passed > quiz_wrong > quiz_active_chat > run_failed >
explanation_pending > present_step > converse) placed as the LAST user-JSON key; its key persists
as learning_evidence.teaching_move. User JSON rebuilt on a diet with STABLE->VOLATILE key order
for prompt caching: slim lesson/activity/milestone, arc, resources (no transcript_text), policy,
student (mastery top-5, misconceptions <=3, recent questions <=4), checkpoints <=3, step_contract,
conditional quiz (only while live, never the answer key), conditional resource chunks (step-open
or request; attached-resource chunks first; 6x1000ch), content-only history x8 oldest-first, turn
facts (message w/ resolved quiz-choice text, run_summary <=400, grade, understanding_check,
help/hint/intent/timeout), directive. Grading is deterministic-only: parsedAssessment/
mergeAssessment deleted, assessment = orchestrator's; assessAnswer gained a narrow
MCQ-no-quiz-row pass-on-valid-choice branch (one legacy demo activity needs it). modelRouteFor
deleted; routes reduced to default (TUTOR_MODEL_CONVERSATION -> gpt-4o @0.6) + understanding
(gpt-4o-mini @0.2). hintRung clamped 0-4 ("show me how" floors at 2). loadContext diet:
recentAttempts query deleted, mastery select trimmed, transcript_text unloaded. Backfill also
seeds quiz_presented_at for pre-v2 mid-quiz students.
Files changed: supabase/functions/chat/index.ts, tests/test_supabase_chat_function.py (stale
pre-v2 fingerprints updated), docs/DECISIONS.md, docs/HANDOFF.md.
Tests run: node --experimental-strip-types --check; python3 -m unittest
tests.test_supabase_chat_function (12 OK); adversarial multi-agent review (16 findings -> 8
confirmed after 2-verifier refutation, deduped to 5 fixes, all applied: code_objective_met no
longer shadows the quiz's first presentation on code+quiz steps; hintRung clamp; MCQ auto-pass
narrowed to the activity's own choices; backfill quiz_presented_at seed; attached-resource
chunks preferred under the cap) + a follow-up verification agent over the fix delta (0 new
defects; added quiz_passed directive + tapped-choice text resolution).
Remaining concerns: text-step turns still write lesson_attempts with null score and no mastery
rows — parity with pre-C behavior, but a deterministic understanding-based mastery write is a
good future addition; token audit pending live traffic (compare model_usage_events.input_tokens
for task_type=mentor_turn before/after this deploy — prior baseline ~5.5k avg mentor turns).
Suggested next task: v2.0 Phase D — latency (loadContext two waves, batched writes,
EdgeRuntime.waitUntil telemetry), legacy-path deletion, F10/F11 cleanup.

## Claude -> Codex / Human - 2026-07-02 (Tutor v2.0 Phase B: flow core simplification — DONE)

Summary: Replaced flowFor's answer-mode-derived stage machine with persisted per-step progress.
New column learning_sessions.step_state jsonb {activity_id, presented_at, code_passed_at,
quiz_presented_at, quiz_passed_at, understanding_at, attempts, graded_fails} + pure functions
requirementsFor/parseStepState/loadStepState(lazy backfill for pre-v2 live sessions)/applyTurn/
deriveTurn/stepDone/quizEligible. FlowDecision shape + draft/final two-phase kept. Grading
eligibility: presentation turns never grade or write records (fixes B3/B11); MCQ answers grade only
while their quiz is eligible (stale taps inert; voice/text turns can never trip or pass a quiz —
fixes B1/B2). Quiz choices attach on every eligible turn until passed; quiz_presented tells the
prompt the options are already on screen. Server-side turn dedup via answer.client_msg_id replays
the stored mentor envelope (B4). Envelope gains authoritative session {status, current_activity_id,
activities_complete}; chat.tsx merges it into learningSession (F7) and keys lessonComplete off it.
step_contract replaces orchestrator_flow in the model's user JSON. Teacher signals preserved:
needs_rescue/needs_retry now derive from step_state.graded_fails (deterministic failures only —
side questions are not struggle), retry_count increments per graded fail, rescue_count frozen,
mentor_recommendations fires once at the 3rd graded fail.
Files changed: supabase/functions/chat/index.ts, supabase/migrations/20260702000000_tutor_v2_step_state.sql
(new; also applied live via Management API ahead of deploy), .github/workflows/deploy-backend.yml
(migration list), frontend/src/lib/types.ts, frontend/src/routes/chat.tsx, docs/HANDOFF.md.
Tests run: node --experimental-strip-types --check (chat fn); frontend tsc/lint/build (0 errors,
12 pre-existing warnings); adversarial multi-agent review (18 findings -> 6 confirmed after
2-verifier refutation, all fixed: graded_fails split from attempts for teacher alerts, backfill
failure no longer persists an unseeded state, checkpoint hold nudge appends once, dedup replay
breaks on interleaved student turns, recommendation gated on the failing turn) + a follow-up
verification agent over the fix delta (1 new defect found + fixed).
Remaining concerns: post-completion turns re-derive stage complete each turn (parity with old
behavior, prompt-side polish lands in Phase C); modelRouteFor's rescue route + fallbackReply's
retry/rescue branches are dead code (deleted in Phase C/D); frontend half of Phases A+B is on the
branch but not yet fast-forwarded to main (needs user OK).
Suggested next task: v2.0 Phase C — instruction layer consolidation + prompt diet + routing polish
(see /root plan "Tutor v2.0"): rewrite SYSTEM_PROMPT, delete selectTeachingMove/MOVE_GUIDANCE/six
directives for a turnDirective() priority ladder, content-only history, reduced model output schema.

## Claude -> Codex / Human - 2026-07-01 (Checkpoint unification: drift/inefficiency review + follow-ups)

Reviewed the whole unification for drift + inefficiencies (3 parallel review agents + a full DB field-parity
sweep). Result: the SQL/data layer is TIGHT — 0 drift on every mirrored column, 0 unmirrored recipients, 0
orphans; trigger<->backfill<->schema mappings all agree; RLS parity preserved for student/teacher/org-admin;
the gate got faster (4 queries -> 2); index coverage complete. Findings were all in the TS consumers, mostly
latent. Applied fixes:

1. (correctness) unifiedLessonStatus now evaluates "Checkpoints due" BEFORE "Complete" — a required checkpoint
   added/reset after an earlier session already reached status 'complete' now surfaces (matching the runtime,
   which re-holds the lesson open next turn) instead of showing a stale "Complete".
2. (product, user-chosen) Gate until COMPLETE: a required checkpoint blocks the lesson until the student
   COMPLETES it — any recipient status != 'complete' (assigned/started/submitted/returned) is outstanding.
   Before, merely starting a required quiz un-gated it. Backend chat gate filter status=eq.assigned ->
   status=neq.complete; gradebook mirrors it. NOTE: teacher-graded required work stays gated until the teacher
   grades it to 'complete' — intended, but flag if that latency is undesirable (could relax to 'submitted').
3. (perf, user-chosen) Memoized the gradebook checkpoint lookups: requiredCheckpointStatus was
   O(students x lessons x (checkpoints+recipients)) rescanning per cell; now a per-dashboard WeakMap-cached
   index (requiredByLesson + recipientStatus maps) built once, O(required-per-lesson) per cell.

NOT applied (documented, deferred): trigger self-heal for the child `cp_id is null` silent-skip (reviewers
split LOW vs HIGH; my analysis: unreachable under FK-cascade + parent-first ordering, 0 actual drops,
reconciled by the every-deploy backfill); checkpoint_items delete-mirroring (no editor/reader yet); dropping
the 2 unused indexes (checkpoints kind/org) + unused mirrored columns (cleanup at contract); narrowing the
dashboard select("*") (skipped — breaks Checkpoint-type honesty for negligible payload at this scale). The
gate predicate is still re-implemented in backend + frontend (can't share across Deno/React) — kept in sync by
convention + cross-referencing comments.

## Claude -> Codex / Human - 2026-07-01 (Checkpoint unification Phases 2-4: the data-model merge)

Summary: Completed the checkpoint unification data-model merge (expand -> dual-write -> migrate reads)
on top of Phase 1's gated completion. The three fragmented checkpoint systems now have ONE unified read
model, and the completion gate + teacher gradebook read from it.

Phase 2 (expand) — 20260701120000_checkpoints_unified.sql: new checkpoints / checkpoint_items /
checkpoint_recipients tables, superset of assignments + assessments. RLS = faithful per-kind union of the
legacy policies via new can_manage_checkpoint / is_checkpoint_recipient helpers; student self-update gated
to kind='assignment' (assessment progress stays edge-fn-written). legacy_id back-ref + unique(kind,legacy_id).

Phase 3 (dual-write + backfill) — 20260701130000_checkpoints_dualwrite.sql: 5 SECURITY DEFINER triggers on
assignments/assessments/their items+recipients upsert-mirror into the checkpoint tables (bypass RLS, cover
EVERY writer incl. edge fns + student self-update, atomic). Lossless idempotent backfill (parents-first).
Re-runs on every deploy = reconciliation. Verified: backfill exact (26 checkpoints / 3 items / 386
recipients, 0 mismatches/orphans); trigger INSERT/UPDATE/DELETE round-trips mirror + clean up.

Phase 4 (migrate reads): chat loadPendingCheckpoints + teacher gradebook requiredCheckpointStatus now read
the unified checkpoints/checkpoint_recipients (one source, no gate/gradebook logic drift). Behavior-equivalent
to the legacy two-table read — verified on 384 real recipiencies (symmetric diff 0) + required path
blocks-when-assigned / unblocks-when-done. Also fixed a latent bug the review caught: the old unsorted
slice(0,6) in loadPendingCheckpoints could drop a required item ahead of a non-required one and wrongly open
the gate — now required-first sorted before slicing. fetchTeacherDashboard loads checkpoints +
checkpoint_recipients (RLS lets teachers read their class's via can_manage_checkpoint).

Files: 2 migrations, deploy-backend.yml (both migrations wired in + Supabase CLI pinned to 2.109.0 after a
transient setup-cli rate-limit), chat/index.ts, api.ts, types.ts, TeacherConsole.tsx. Tests: frontend tsc 0 /
lint 0 / build green; 4 adversarial reviews across P3+P4, all SHIP, all findings applied. Applied+verified via
Supabase MCP throughout.

NOT DONE (deliberately out of scope — a separate, larger initiative): the physical CONTRACT — dropping the
legacy assignments/assessments tables and unifying the attempts/submissions subsystems (assessment_attempts/
assessment_item_attempts/assignment_submissions still key off assignment_id/assessment_id, and the student-
facing quiz/assignment pages + grading flows write them). The legacy tables remain the write-of-record and
dual-write to checkpoints; checkpoints is the unified READ model for gating + the gradebook. A future
initiative can migrate the authoring UIs to write checkpoints directly, unify attempts/submissions, then drop
the legacy tables. Also worth extracting a single shared source of truth for the gate predicate (backend +
gradebook currently re-implement the same "required + live-status + recipient assigned" logic).

## Claude -> Codex / Human - 2026-07-01 (Checkpoint unification P1b: assessment required toggle + unified gradebook)

Summary: Completes Phase 1 of the checkpoint unification. Two pieces.

1) Assessment "required for lesson completion" toggle, mirroring the P1a assignment one. A checkbox on the
quiz create form (AssessmentManager) flows draft.required -> saveAssessment -> createAssessment (api.ts) ->
assessment-admin `create_assessment`, which now inserts `assessments.required`. The chat gate already reads
`assessments.required` via loadPendingCheckpoints. IMPORTANT deploy fix: deploy-backend.yml did NOT cover
`assessment-admin` (not in trigger paths, not deployed) — added both so the edge fn actually ships. Backend
deploy run for 8f8e0dc is green (assessment-admin + chat + curriculum-admin deployed; migrations re-applied).

2) Teacher gradebook UNIFIED status. New helpers `requiredCheckpointStatus` + `unifiedLessonStatus` in
TeacherConsole.tsx track the runtime completion gate: a required checkpoint blocks the lesson only while its
recipient row is still `assigned` (parent live: assignment status assigned / assessment status published).
The Gradebook and Lesson Progress grid now show the honest status the student is subject to — "Checkpoints
due" (warning) when activities are done but required checkpoints remain — plus an "N required outstanding"
detail + needs-attention flag.

Adversarial review (2 agents) verdicts: assessment-required flow SHIP (boolean-safe through every hop, no
regressions); gate-consistency found one must-fix and one doc-fix, both applied:
- (d, must-fix) The runtime holds a gated lesson at session status "active" with a persisted
  `activities_complete=true` (NOT status "complete"), so keying the badge off lessonProgressStatus
  (status==="complete") meant it never fired in its primary case. FIX: exposed `activities_complete` on the
  frontend LearningSession type (already returned by select("*")) and derive "activities finished" from it
  (sticky across sessions). Now the held-open state correctly surfaces as "Checkpoints due".
- (c, doc) The gradebook can't reproduce the runtime's fail-closed checkpoint read (pendingCheckpointsOk);
  softened the "mirrors" comment to say it reflects the teacher's current data, not that transient state.

Files: assessment-admin/index.ts, deploy-backend.yml, api.ts, types.ts (LearningSession.activities_complete +
Assessment.required already had it), TeacherConsole.tsx. Tests: frontend tsc 0 / lint 0 / build green.
Deploy: backend green (8f8e0dc run). Frontend awaiting `main` FF (assessment toggle + unified gradebook).
Next: after P1b frontend lands on main, Phase 2-4 = the actual checkpoints/items/recipients table merge
(expand -> dual-write -> migrate reads -> contract). A shared source of truth for the gate logic (backend +
gradebook currently reimplement it) would be worth extracting during that merge.

## Claude -> Codex / Human - 2026-07-01 (Checkpoint unification P1a: gated lesson completion + assignment "required")

Summary: Workstream 4 "unify the checkpoints" — the user chose the FULL data-model merge with teacher-chosen
required checkpoints, sequenced value-first. This is Phase 1a: a lesson is now complete only when its
activities AND all REQUIRED checkpoints are done. (The actual three-table merge is later phases; this delivers
the gated-completion value on top of the existing tables.)

Migration (20260701000000_checkpoint_required.sql, idempotent, wired into deploy-backend.yml's loop):
`assignments.required`, `assessments.required`, `learning_sessions.activities_complete` (all bool default false).

Backend (chat/index.ts): `loadPendingCheckpoints` now selects `required`. The handler computes
`requiredRemaining` (pending checkpoints with required=true), `activitiesDoneThisTurn`, and `activitiesComplete`
(this turn OR the sticky `session.activities_complete`), then GATES the session status: activities done +
required remaining => stay 'active' (NOT complete); done + none => 'complete'; else the normal flow. On the
gating turn the envelope becomes a "finish the required work: X — open it from the panel above" message; when
the student returns after finishing it, a re-completion branch fires once (status 'complete' + "you've
completed all the required work"). `activities_complete` is persisted (sticky; reset only on advance).

Teacher (frontend): a "Required for lesson completion" checkbox on the assignment create form
(AssignmentManager) → `createAssignment` inserts `required`. `Assignment.required`/`Assessment.required` added
to types.

Files: chat/index.ts, the migration, deploy-backend.yml, types.ts, api.ts, TeacherConsole.tsx. Tests: frontend
tsc 0 / lint 0 / build green; backend Deno via review.

SHIPPED 2026-07-01: backend deploy run green (migration applied — confirmed the three columns exist in the DB;
`chat` fn deployed). Frontend fast-forwarded to `main` (f4c34cf..65895ca) → Render rebuilding. A late
adversarial-review fix (F1) made `loadPendingCheckpoints` fail-CLOSED: it returns `null` on a transient load
error (not `[]`), `loadContext` exposes `pendingCheckpointsOk`, and `unifiedComplete` now requires a confident
checkpoint read — so a load hiccup keeps the lesson active and self-corrects next turn instead of wrongly
flipping a gated lesson to complete.
DEFERRED to P1b (kept small/safe): the ASSESSMENT required toggle (needs the assessment-admin edge fn) and the
teacher GRADEBOOK unified-status view (completion logic is spread across the huge TeacherConsole file — a
separate change). Later phases (2–4): the actual checkpoints/items/recipients table merge (expand → dual-write
→ migrate reads → contract).

## Claude -> Codex / Human - 2026-07-01 (Tutor v1.6: mentor-aware pending checkpoints)

Summary: Workstream 4, first (high-value) slice. Assignments/assessments live in separate UI docks the mentor
never saw; now it knows about the ones assigned to the student for the current lesson and can point them there
("there's an assignment, 'X', to try — open it from the panel above"). Backend-only.

- New `loadPendingCheckpoints(config, userId, lessonId)`: loads `assignments` (status='assigned') and
  `assessments` (status='published') for the lesson, then the student's recipient rows with status='assigned'
  (pending; 'complete' = done), returns `{kind, title, due_at}[]` (capped 6). Wrapped in try/catch → returns
  [] on any error so it can never break a turn. Wired into `loadContext` (kicked off concurrently, awaited
  near the return) as `pendingCheckpoints`.
- Injected into the mentor payload as `pending_checkpoints` + a SYSTEM_PROMPT paragraph: mention pending work
  when relevant (lesson wrap / "what's next" / "am I done"), route to the dock, note due dates, don't nag,
  never invent checkpoints not listed.

Schema (verified live): recipient status 'assigned' = pending, 'complete' = done; assignments.status
'assigned' = published, assessments.status 'published'. Live data present (13 assignments/assessments, 192
recipients each). Files: `supabase/functions/chat/index.ts` only. No migration, no frontend change.
Remaining in workstream 4 (deferred, bigger): unify the three fragmented checkpoint systems (in-lesson quiz /
assignments / assessments) into a coherent, gated completion model; optionally surface pending work in the
chat header too. This slice is just "mentor awareness + routing."

## Claude -> Codex / Human - 2026-07-01 (Tutor v1.5: visible lesson progress — Step N of M + roadmap)

Summary: Workstream 3 of the structured/guided effort — the student now SEES the arc the mentor narrates. A
slim "Step N of M" strip under the chat header with a segmented bar; tap to expand a roadmap (done ✓ / current
/ upcoming step titles). Hidden for single-step lessons.

Backend (chat/index.ts): the already-computed `lessonArc` is now RETURNED in the chat envelope (added
`lesson_arc?` to the `Envelope` type + `makeEnvelope` default + the envelope construction, placed AFTER the
`...parsed` spread so the server value wins over any model-supplied field). On an advancing turn the envelope's
`lesson_arc` is rebuilt from the next activity so progress advances in sync with the "next up: …" hand-off.
Frontend (chat.tsx + types.ts): new `LessonArc`/`LessonArcStep` types; `TypedChatEnvelope.lesson_arc?`; a
client `deriveLessonArc(activities, currentActivityId)` (mirrors the backend, for immediate/resume display
from the already-fetched activities + session cursor); a `LessonProgress` component; `lessonArc` state set on
load (derive) and updated from each envelope's `lesson_arc` (4 sites, authoritative).

Files: `supabase/functions/chat/index.ts`, `frontend/src/routes/chat.tsx`, `frontend/src/lib/types.ts`. No
migration. Tests: frontend tsc 0 / lint 0 (12 pre-existing warnings) / build green; backend Deno via review.
Remaining concerns: progress reflects the runtime cursor (forward-only). Still open in the effort: workstream
4 — make the mentor aware of pending quizzes/assignments/assessments + tighten those three fragmented
checkpoint systems.

## Claude -> Codex / Human - 2026-07-01 (Tutor v1.4: the guided arc — lesson-arc awareness + situated turns)

Summary: First step of a larger "make the tutor feel structured/guided/engaged" effort (two Explore agents
mapped the current state: the mentor was context-blind to the lesson arc AND unaware of assignments/quizzes/
assessments, which live in separate UI docks; checkpoints are three disconnected systems). This ships
workstream 1+2 — lesson-arc awareness so the mentor can situate every turn.

Backend (chat/index.ts, backend-only):
- `loadContext` now also loads the full ORDERED activity list (id,position,title,prompt,stage,response_mode,
  skill_keys) into a new `activities` field (no expected_output/choices/starter_code — no answer leakage).
- `buildLessonArc(activities, currentActivity)` computes {step, total, current:{title,prompt}, completed[],
  upcoming[] (TITLES only), next}; null for single-step lessons. Injected into the mentor payload as
  `lesson_arc`.
- The advance transition message is now situated: "That completes '<title>' — step N of M done. Next up:
  '<next title>'." (falls back to the generic line when there's no arc).
- SYSTEM_PROMPT gained a "Guide the lesson arc" section (situate turns, add context to transitions — "now
  that we've done X, let's…" / "before we get to Y, let's first…" — preview the next step's title but never
  do its work early) + a "Shape each turn" line (acknowledge → do the current step → situate → ONE next action).

Files: `supabase/functions/chat/index.ts` only. No migration, no frontend change (workstream 3 = visible
"step X of Y" UI, and workstream 4 = mentor-aware checkpoints, are deferred/next).
Tests: backend Deno (not locally type-checked) validated via adversarial review; self-verified the Promise.all
destructure alignment (highest silent-failure risk).
Remaining concerns: the arc's "completed" is inferred from position < current cursor (forward-only advance) —
correct given the runtime never moves the cursor back. Next candidates: visible progress UI (step X of Y /
roadmap), and making the mentor aware of pending assignments/assessments + tightening checkpoint mechanics.

## Claude -> Codex / Human - 2026-07-01 (Tutor v1.3: open-ended code grading + lively tutor text)

Summary: A real transcript showed the tutor trapping a student on an OPEN-ENDED code task ("change the
starter into another everyday process") — every original answer was rejected and the tutor invented a
"be positive" rule. Root cause: `assessAnswer` grades code by exact substring match against
`activity.expected_output`, which was mis-authored to the STARTER example ("Gather ingredients / Mix /
Serve"), so no original answer ever passed and `flowFor`'s code branch never completed. Fixed three ways:

CONTENT (already live, via Supabase MCP): cleared the mis-set `expected_output` on the two trapped lessons —
`coding1` ("Turn a Process Into Code") and the identical `lesson1` ("hammer -> hammers nails") — at both the
activity and lesson level. With it null, a clean run passes immediately.

RUNTIME (chat/index.ts): a `checkCodeObjective` semantic grader — when a code run is CLEAN but fails the
strict match, a separate model call (route "understanding") judges whether the code meets the OBJECTIVE and,
if so, upgrades the assessment so the activity completes. The judge decides open-ended vs. exact from the
task wording and LEANS STRICT when unsure (so exact-output tasks aren't leniently passed). A judge-based pass
is capped at score 0.8 → "developing", NOT the "secure" tier (the server never re-executes the code and
run_result is client-supplied, so it earns solid-but-unverified credit). Also: a SYSTEM_PROMPT rule against
inventing requirements the objective doesn't state (no "positive"/topic/wording/match-example demands) and to
acknowledge when the student is right.

LIVELINESS (chat.tsx + styles.css + a prompt nudge): tutor messages now render the opening affirmation (a
short sentence ending in "!") as a large animated-gradient Instrument Serif headline (`.tutor-beat`, reusing
the app's existing rainbow gradient) and support minimal `**bold**` markdown for key concept terms. The model
is nudged to open with a short "!" affirmation and bold 1-3 terms. Reduced-motion freezes the shine; shine is
on the opening line only (body stays readable); no XSS (React text children, no dangerouslySetInnerHTML).

Adversarial review (2 rounds, ~18 agents): round 1 found 7 issues in the grading change — a HIGH mastery-mint
from unexecuted client code (→ capped to "developing"), a HIGH stuck-cap quiz-skip + forced/wrong-completion
(→ removed the code stuck-cap entirely), a lenient-exact-repro path (→ judge decides, leans strict), a
contradictory payload (→ fixed). Round 2 confirmed 2 LOW: a keyword gate re-looped open-ended tasks without
cue words (→ removed the keyword gate; the JUDGE now decides intent), and a cosmetic `**` in the headline
(→ stripped). All fixed.

Files: `supabase/functions/chat/index.ts`, `frontend/src/routes/chat.tsx`, `frontend/src/styles.css`
(+ the live DB content fix). Tests: frontend tsc 0 / lint 0 (12 pre-existing warnings) / build green; backend
Deno validated via the two review rounds.
Remaining concerns: run_result is client-supplied and the server does not re-execute code — a determined
student can fabricate a clean run to complete an open-ended task at "developing" mastery (pre-existing
property, now capped; a full fix is server-side execution / signed run results, out of scope). Open-ended
code tasks should ideally be authored with an EMPTY expected_output (then the strict path passes clean runs
with no judge needed). Spot-check a live transcript for the loop fix + the new headline/bold rendering.
Suggested next task: audit remaining lessons for mis-set expected_output on open-ended prompts; consider
server-side code execution for trustworthy code mastery.

## Claude -> Codex / Human - 2026-07-01 (Tutor v1.2 loop-closure + chat UX: hidden pedagogy controls + ChatGPT-style voice)

Summary: Bundled change (shipped together at the user's request). Two parts.

PART A — Tutor v1.2 (backend `chat/index.ts`): fixes residual issues from a fresh transcript on deployed v1.1.
- Deterministic loop-closure: a dedicated `checkUnderstanding` grader (its own cheap `"understanding"` model
  route, temp 0.2) judges whether a free-text explanation demonstrates the step objective and HARD-GATES
  completion (`understanding = gradedUnderstanding ?? mentor-self-report`) — the conversation model can no
  longer loop by affirming-but-never-completing. Runs on text-answer turns (skips only an explicit summary
  request); records its own model usage.
- Reliable confusion handling: broadened the `confused` INTENT regex to colloquial phrasings ("didn't figure
  out", "no clue", "over my head", …) minus high-false-positive fragments ("not really"/"can't tell"), plus a
  hard SYSTEM_PROMPT rule to explain-not-praise on any confusion wording.
- Timeout is infra, not a student error: `runTimedOut` (guards `ok===true`, matches only real sentinels
  "took too long"/"timed out") → `assessAnswer` returns null (no failed-attempt ding) + a kind prompt note.
- De-formulaic tone (don't open every turn with praise).

PART B — Chat UX (per the user's request):
- Hid all student-facing pedagogy controls (the 6 Mentor Modes + Hint + "Show me how") from `chat.tsx`
  (`MentorModeBar` removed) and `HeaderMenus.tsx` (mode picker removed); kept tone/verbosity/difficulty. Mode
  still defaults to "guide" and flows to the backend unchanged. To preserve help pedagogy without buttons, the
  backend now INFERS help from typed text (`detectHelpRequest` → hint/show_me_how) with an escalating rung
  derived from recent turns (`deriveHintRung`).
- ChatGPT-style voice: removed the always-on bottom `RealtimeVoicePanel` bar. The composer's send button, when
  the textbox is empty, becomes a sound-wave (AudioLines) voice-mode button (gated on `realtimeEnabled`);
  activating it auto-starts the live session and replaces the input row with a fuller in-composer voice panel
  (status + Stop/Close + Retry). The mic/dictation button is unchanged. Composer is HIDDEN (not unmounted)
  during voice so code edits + composerRef survive.

Adversarial review (2 rounds, ~4 agents): caught and FIXED a HIGH-severity integrity regression — an inferred
help request typed as a text answer counted as an "attempt" (`Boolean(answer)`), so "just tell me the answer"
as a first message bypassed attempt-first + final-answer gating; fixed by excluding an inferred-help-only text
turn from `hasAttempt`/`attemptedBeforeHelp` and inferring help from text answers only. Also fixed: a
hint-vs-conclude prompt conflict (tightened HINT_RE + told the model to ignore hint recs when understanding is
demonstrated), a voice autostart with no retry (added Retry + fixed the error-status overwrite), and the
Composer-unmount data-loss/composerRef no-op (hide instead of unmount). v1.2 review round earlier also fixed 4
items (activity-scoped depth confirmation, Anthropic temp/max_tokens, provider telemetry, timeout false-positive).

Files changed: `supabase/functions/chat/index.ts`, `frontend/src/routes/chat.tsx`,
`frontend/src/components/Composer.tsx`, `frontend/src/components/HeaderMenus.tsx`. No migration.
Tests run: frontend tsc 0 / lint 0 (12 pre-existing warnings) / build green; backend Deno validated via the
adversarial multi-agent review.
Remaining concerns: the Anthropic adapter is still dormant/untested from the sandbox. The understanding grader
adds one cheap model call per text-explanation turn (accepted). Worth spot-checking a few live transcripts for
the loop-closure + the new voice flow (esp. mic-permission-denied → Retry).
Suggested next task: collect regression transcripts (clean completion, code-only, MCQ, help-request, voice
session); consider the deferred items (spaced review, rubric partial-credit, teacher dashboards).

## Claude -> Codex / Human - 2026-06-30 (Tutor v1.1 — adaptive conversation + understanding-advance + model-agnostic LLM; DEPLOYED)

Summary: v1 made the tutor pedagogy-aware but a real session was rigid and looped — it repeated near-verbatim
questions, ignored the student's actual message (a breakthrough, an "I don't understand", an explicit "give me
a summary"), never recognized a correct free-text explanation (so an explanation activity never advanced), and
didn't correct stated misconceptions. v1.1 fixes the conversation layer while keeping the integrity gates HARD.

- Understanding-based advancement (fixes the loop): the mentor now returns a structured
  `understanding {demonstrated, level, note}` in the JSON envelope, separate from graded `assessment`. For a
  free-text/explanation activity, `flowFor` completes ONLY when `understanding.demonstrated === true` (or after
  a stuck cap of `conversationDepth >= 4`); an incomplete explanation keeps conversing instead of looping or
  blind-completing. `conversationDepth` is ACTIVITY-scoped (`priorActivityAttempts`, resets on advance) — not
  session-scoped — so a later step in a multi-step lesson can't complete prematurely.
- Advisory move + behavioral rules (fixes rigidity): the selected teaching move is now a RECOMMENDATION in the
  prompt, not a lock. Hard rules force the model to acknowledge the latest message, NEVER repeat a question it
  already asked (its own recent questions are extracted from `recentTurns` and passed in an `askedBefore`
  block), correct stated misconceptions, and respond to intent/meta-requests. Integrity clauses stay mandatory.
- Lightweight intent signal: server-side `detectIntent` (frustrated / confused / wants_summary / breakthrough)
  biases `selectTeachingMove` away from another Socratic re-ask when confused/stuck, and is surfaced in the
  prompt for the model to act on.
- Model-agnostic LLM gateway (the user's chosen path to better dynamism): `callOpenAI` is replaced by
  `callModel(messages, jsonMode, route)` which dispatches by `TUTOR_PROVIDER` (default `openai`) to
  `callOpenAIChat` or `callAnthropic`. Per-route model + temperature via `TUTOR_MODEL_*` /
  `TUTOR_TEMPERATURE_DEFAULT` (legacy `OPENAI_MODEL_*` still honored as fallback). Conversation temperature
  raised 0.35 -> 0.6; grading/extraction stay deterministic (0.2). OpenAI remains the default, so production
  behavior is unchanged unless `TUTOR_PROVIDER=anthropic` (then `ANTHROPIC_API_KEY` is required).

Adversarial review (the Deno fn isn't locally type-checkable) found 6 confirmed defects, all fixed before
deploy: (1/2) session-scoped depth -> activity-scoped + cap 6->4; (3) Anthropic rejected `temperature` ->
omitted; (4) `modelFor` dropped legacy RESCUE/RESOURCE_CONTEXT env fallbacks -> restored; (5) Anthropic
max_tokens 2048 truncation -> 4096 + throw on `stop_reason==="max_tokens"`; (6) provider telemetry hardcoded
"openai" -> threaded the resolved provider through `OpenAIResult` and both adapters into `model_usage_events`.

Files changed: `supabase/functions/chat/index.ts` only (backend-only; no migration — reuses the v1
`20260630000000_tutor_pedagogy.sql` schema). Frontend untouched in v1.1.

Tests run: frontend tsc 0 errors / lint 0 errors (12 pre-existing warnings) / build green (sanity — backend
change). Backend is Deno (not locally type-checked) → validated via the adversarial multi-agent review.

Deploy: DONE. Commits `02f1137` (v1.1) + `c293203` (review fixes) on `claude/happy-johnson-wseex8`; the push
triggered `.github/workflows/deploy-backend.yml` run #5 (commit `c293203`) — GREEN: migrations applied
(idempotent) + `chat` (and `curriculum-admin`) edge functions deployed. Live to students on OpenAI default.

Remaining concerns: the Anthropic adapter is dormant (untested against a live key from this sandbox — egress
blocked); flip `TUTOR_PROVIDER=anthropic` + set `ANTHROPIC_API_KEY` to exercise it, and watch the first turn's
`stop_reason`. Understanding-based advancement leans on the model honestly setting `understanding.demonstrated`
— worth spot-checking a few real transcripts (a correct explanation should affirm+advance, not re-ask).

Suggested next task: collect 3–4 fresh transcripts (a clean explanation completion, a code-only lesson, an MCQ
lesson, a "show me how" flow) as regression fixtures; then consider the deferred items — spaced review across
sessions, rubric partial-credit grading, and the teacher independence/misconception dashboard UI.

## Claude -> Codex / Human - 2026-06-29 (Curriculum authoring redesign — Phase 4: AI authoring; branch-only, backend deploy pending)

Summary: Final phase. Teachers can now draft a course outline or a lesson's steps with AI, review the draft,
and apply it. Generation NEVER writes — apply uses the existing create/upsert actions, so it's
review-before-save by construction.

- `curriculum-admin` new `generate` action (server-side OpenAI call via OPENAI_API_KEY / OPENAI_MODEL_DEFAULT,
  json_object response): `mode:"course_outline"` (org from body, assertCanAuthor) returns
  `{outline:{units:[{title,lessons:[{title}]}]}}`; `mode:"lesson_steps"` (org from lesson) returns
  `{steps:[{kind,title,prompt,choices,correct_choice_id}]}`. Both validate/clamp the model output before
  returning; neither writes to the DB.
- Frontend: a "Draft an outline with AI" panel on the course detail and a "Draft steps with AI" panel in the
  lesson editor — prompt → Generate → review the draft → Apply (or Discard). Apply for an outline loops
  `create_unit` + `create_lesson_stub`; apply for steps loops `upsert_step` (mapped from the draft kind). New
  `generateCurriculumDraft` api wrapper + `CurriculumOutlineDraft`/`CurriculumStepDraft` types.

Tests: tsc 0 errors; lint 0 errors / 12 pre-existing warnings; build green.

Deploy: branch-only. Backend deploy is the human's: redeploy `curriculum-admin` (it now calls OpenAI; the
same OPENAI_API_KEY the `chat` fn already uses must be set on the function). Frontend to main on your OK.

This completes the four-phase curriculum authoring redesign (outline + IDE + multi-step + structure mgmt +
AI). The whole feature is on `claude/happy-johnson-wseex8`. Backend to deploy in order: apply the Phase 1
migration, then redeploy `curriculum-admin` and `chat`.

## Claude -> Codex / Human - 2026-06-29 (Curriculum authoring redesign — Phase 3: multi-step lessons + runtime sequencing; branch-only, backend deploy pending)

Summary: Lessons are now an ordered sequence of steps, and the student `chat` runtime walks them. A step is a
`lesson_activities` row (ordered by `position`); a checkpoint step also has a `quiz_items` row. The lesson
keeps ONE milestone (lesson-level goal). NO new DB column was needed — the runtime already tracks
`learning_sessions.current_activity_id`, so advancement just points the cursor at the next activity.

- `chat` edge fn (runtime advancement, backward-compatible): after computing `finalFlow`, if the current
  activity is finished (`stage==="complete"`/`nextAction==="complete"`) AND a later activity exists
  (`position > current`), the session advances to that next activity (`current_activity_id=next`,
  `stage="intro"`, `status="active"`, retry/rescue reset) instead of completing; the completing turn's
  envelope is rewritten to a "continue to the next part" transition (`stage=review`, `next_action=reply`)
  so the client keeps the session open, and the completion event is suppressed. A single-activity lesson
  has no next step → `advancing=false` → byte-for-byte unchanged behavior. (loadContext already loaded the
  activity at `current_activity_id`, so no read change was needed.)
- `curriculum-admin` new actions (reuse assertCanAuthor via courseScopeForLesson):
  - `save_lesson_meta` — lesson-level fields + the single milestone ONLY; never touches activities/quizzes
    or subject/course status (this fixes the old save_lesson_blueprint status-revert clobber for the new
    editor) and updates the EXISTING milestone (resolved by lesson, not a hardcoded id).
  - `upsert_step` — create/update a `lesson_activities` row (ids collision-proofed; position = max+1 on
    create, preserved on edit). A checkpoint upserts its `quiz_items` row (`${activityId}-quiz`); a
    non-checkpoint archives any quiz so the runtime stops treating it as an assessment.
  - `reorder_steps` — direct 1..N position assignment (lesson_activities has no unique(position) constraint)
    + realigns quiz_items.position; validates same-lesson + no duplicates.
  - `delete_step` — refuses the last step; archives the quiz then deletes the activity. lesson_attempts and
    learning_sessions reference activity_id ON DELETE SET NULL, so learner history survives and any live
    cursor falls back to the first step.
- Frontend: rebuilt `LessonDetail` (teacher.curriculum.tsx) into a lesson-basics form (save_lesson_meta) +
  an ordered, drag-reorderable **Steps** editor (Teach / Practice / Checkpoint / Reflect kinds, each an
  expandable card; add/edit/delete via the step actions) + a step-by-step student-walkthrough Preview +
  Publish/Archive/Move/Delete. Removed the old single-activity blueprint form (`DraftState`,
  `BlueprintEditor`, `draftToBlueprint`, the resource-attach panel — resources are managed in the teacher
  console). New `lib/api.ts` wrappers (`saveCurriculumLessonMeta`, `upsertCurriculumStep`,
  `reorderCurriculumSteps`, `deleteCurriculumStep`) + `lib/types.ts` step/meta input types.

Tests: tsc 0 errors; lint 0 errors / 12 pre-existing warnings; build green. Edge fns not Deno-checkable in
sandbox — reviewed by hand + an adversarial review agent.

Remaining concerns / deploy: branch-only. Backend deploy is the human's: **redeploy `curriculum-admin` AND
`chat`** (and Phase 1's migration must already be applied). The runtime change is the only edit that touches
the live student path; it's guarded so single-step lessons are unaffected. End-to-end after deploy: author a
2–3 step lesson, run it as a student (each step advances; the last completes + records mastery), and confirm
an existing single-activity lesson still runs identically. A checkpoint added to an already-published lesson
needs a re-publish for its quiz to go live (publish promotes quiz_items). Frontend deploy to main on your OK.

Suggested next task: Phase 4 — AI authoring (`generate` action drafting a course outline / lesson steps from
a prompt, review-before-save).

## Claude -> Codex / Human - 2026-06-29 (Curriculum authoring redesign — Phase 2: outline sidebar + IDE detail pane; branch-only)

Summary: Rebuilt `frontend/src/routes/teacher.curriculum.tsx` from the old single-column
tree-card → flat-form → preview into a persistent outline sidebar + an IDE-style detail pane on a URL
spine. Structure (subjects/courses/units/lessons) is now managed directly via the Phase 1 actions, not
back-filled from a lesson save. Frontend-only; relies on the Phase 1 backend being deployed for the
create/rename/reorder/move/delete buttons to work (reads/viewing degrade gracefully until then).

- Layout: two columns on lg — a sticky, scrollable **Outline** (Subject ▸ Course ▸ Unit ▸ Lesson) on the
  left and a **detail pane** that edits whatever node is selected on the right. ConsoleShell widened to
  1440px.
- URL spine: `?subject=` / `?course=` / `?unit=` / `?lesson=` — exactly one is set (the selected node);
  ancestors resolve from data for the outline + breadcrumb. The old `?lesson=` deep link (TeacherConsole's
  "Edit in curriculum") still works.
- Outline: per-row inline create (+ Subject at top, + on each subject/course/unit to add a child), collapse
  toggles, and **native HTML5 drag-reorder scoped per sibling group** (a reusable `ReorderList` whose drag
  state is isolated per group via stopPropagation, so dragging a course never bubbles to the subject list).
  No dnd library added.
- Detail panes: `StructureDetail` (subject/course/unit) = rename title + description, add-child, archive
  (subject/course), and a guarded delete (disabled with a hint while children exist). `LessonDetail` reuses
  today's blueprint editor (`BlueprintEditor`/`draftToBlueprint`/`save_lesson_blueprint`) with an
  Edit/Preview toggle, Save/Publish/Archive, a **Move to unit** dropdown (move_lesson), and a confirm-delete.
  The redundant structure fields were removed from the lesson form (the outline owns structure now); the
  draft still carries subject/course/unit ids so a lesson save patches by id (never re-derives).
- Removed the old `CurriculumTree`/`SubjectBlock`/`CourseBlock`/`UnitBlock` flat-tree components.

Tests: tsc 0 errors; lint 0 errors / 12 pre-existing warnings (prettier autofixed); build green.

Remaining concerns: (1) backend Phase 1 must be deployed (migration + curriculum-admin) for structure
edits to function — flagged. (2) Pre-existing `save_lesson_blueprint` quirk unchanged: saving a lesson
re-asserts its subject/course to status=draft (publish re-promotes) — to be cleaned up in Phase 3 when the
lesson editor moves off the monolithic blueprint. (3) The outline shows only the selected class's org
subjects (global seeded content has null org and isn't shown to org teachers) — intended for top-down
authoring. Frontend-only → deploy to main on your OK.

Suggested next task: Phase 3 — multi-step lesson editor over `lesson_activities`/`quiz_items` + the
backward-compatible `chat` runtime sequencing patch (highest risk; ship on its own).

## Claude -> Codex / Human - 2026-06-29 (Curriculum authoring redesign — Phase 1: foundation; branch-only, backend deploy pending)

Summary: First phase of the curriculum authoring redesign (persistent outline + IDE detail pane + multi-step
lessons + first-class structure management + AI authoring). Phase 1 is the runtime-safe foundation only:
additive ordering columns + new direct structure-management actions on `curriculum-admin`, plus the frontend
api/type plumbing. NO UI behavior change yet (the outline/IDE rebuild is Phase 2).

- Migration `supabase/migrations/20260629000000_curriculum_authoring.sql` (additive, backfilled): adds
  `subjects.position`, `courses.position`, and `lessons.unit_position` (per-unit lesson order, distinct from
  the global `lessons.position` spine the runtime still uses), backfills each to current title/spine order,
  and adds `(organization_id, position)` / `(subject_id, position)` / `(unit_id, unit_position)` indexes.
  Student runtime untouched.
- `supabase/functions/curriculum-admin/index.ts`: new actions, all reusing `assertCanAuthor` + the
  service-role helpers, each resolving the node's organization from its PARENT (so a teacher can't write
  outside their org via the service path):
  - `create_subject` / `create_course` / `create_unit` / `create_lesson_stub` — ids derived from titles via
    `safeId()` but made collision-proof by `uniqueId()` (appends a short suffix if taken, so a create never
    silently merges). `create_course` also creates its `v1` course_version (is_current=true).
    `create_lesson_stub` writes a valid, runnable draft lesson + milestone-1 + activity-1.
  - `rename_node` — PATCHes by id (never re-derives), so renaming never orphans children (the key
    correctness catch). Lessons carry only `title`/`module` (no updated_at/description columns).
  - `reorder` — sets per-parent positions; validates every id shares one parent (anti cross-org) and that
    the list has no duplicates; `units` use a two-pass negative-offset shuffle to dodge the
    unique(course_version_id, position) constraint. Caller must send the FULL ordered set for the parent.
  - `move_lesson` — re-parents a lesson to a target unit (updates unit_id, unit_position, module, and the
    denormalized course_id/course_version_id in curriculum_metadata).
  - `archive_node` (subject/course → status=archived; lesson → publication_status=archived) and
    `delete_node` (leaf-only + history-safe: refuses to delete a node with children, or a lesson with any
    `learning_sessions`, so published lessons never orphan and learner data is never cascaded away — use
    archive instead).
- Frontend `lib/types.ts`: `position` on CurriculumSubject/Course, `unit_position` on Lesson, new
  `CurriculumNodeType`, and an extended `CurriculumAdminResponse`. `lib/api.ts`: extracted
  `callCurriculumAdmin()` + typed wrappers (`createCurriculumSubject/Course/Unit/LessonStub`,
  `renameCurriculumNode`, `reorderCurriculumNodes`, `moveCurriculumLesson`,
  `archiveCurriculumNode`, `deleteCurriculumNode`). `invokeCurriculumAdmin` unchanged for callers.

Tests: `npx tsc --noEmit` 0 errors; `npm run lint` 0 errors / 12 pre-existing warnings; `npm run build`
green. Edge fn not Deno-checkable in sandbox (no deno); reviewed by hand.

Remaining concerns / deploy: branch-only (`claude/happy-johnson-wseex8`). Backend deploy is the human's:
**apply the migration BEFORE redeploying the `curriculum-admin` edge fn** (the new create actions write the
`position`/`unit_position` columns). No frontend behavior changes yet, so no main deploy is needed for
Phase 1 — the new wrappers are dormant until Phase 2 wires the UI.

Suggested next task: Phase 2 — rebuild `frontend/src/routes/teacher.curriculum.tsx` into the persistent
outline sidebar + IDE detail pane on a URL spine (`?course=&unit=&lesson=`), using these structure actions
for create/rename/reorder/drag/move/archive/delete; lessons still edited with today's blueprint fields.

## Claude -> Codex / Human - 2026-06-28 (Separate platform vs org admin portals + remove page titles from profile menu; LIVE)

Summary: Platform admin and org admin are now genuinely separate portals, and the redundant page-title link
was removed from the profile (Settings) menu for every role.

- 4-way primary role: `fetchPrimaryRole`/`PrimaryRole` now return `platform_admin | org_admin | teacher |
  student` (read from `fetchAdminScope` actor level). `roleHome`: platform_admin→`/platform`,
  org_admin→`/admin`, teacher→`/teacher`, student→`/chat`. `useConsoleAccess` exposes `role` +
  `platformAdmin`/`orgAdmin`/`admin` booleans + `home`.
- New `/platform` route (`routes/platform.tsx`) renders the same `AdminPage` (exported from `routes/admin`),
  reusing `validateAdminSearch`. Registered in the hand-maintained `routeTree.gen.ts`.
- `admin.tsx`: the in-page Platform/Org toggle is removed; `isPlatformLevel = isPlatformAdmin`; an
  `adminHome` (`/platform` for platform admins, `/admin` for org admins) drives ALL in-portal navigation
  (org picker, tabs, integration sub-tab, OAuth return, org cards, breadcrumb, logo). A guard effect
  cross-redirects an admin who lands on the wrong route (OAuth-exempt while `?code&state` present), and a
  `routeMismatch` render gate holds the neutral RouteLoader so the other admin portal never flashes.
- `PlaceSwitcher`: added a `platform` destination; filters by `platformAdmin`/`orgAdmin` so each admin sees
  only its own (single → static "you are here" label: "Platform admin" / "Organization admin").
- `SettingsMenu`: removed the role/page-title "Home" link entirely (the user's ask) — menu is now
  appearance/voice/Campus Live/log out only; dropped the now-unused `useConsoleAccess` + icon imports.

Net: signing in as each of the four types (student, teacher, org admin, platform admin) lands on and is
locked to a distinct portal (`/chat`, `/teacher`, `/admin`, `/platform`); the profile menu shows no page
title; switching between platform and org admin requires being that account (no in-app crossover).

Tests: tsc 0 errors; lint 0 errors / 12 warnings (one new react-refresh notice from exporting AdminPage —
harmless); build green. Deployed: fast-forwarded `main` (frontend-only). NOTE: to actually log in as the
org-admin/student/teacher demo accounts, the `admin-seed` edge fn still needs redeploying so the "Create
demo logins" button works; the platform-admin portal is testable now with the existing platform-admin
account.

## Claude -> Codex / Human - 2026-06-28 (Lock down per-role nav: remove cross-portal links + no flash; LIVE on main)

Summary: Follow-up to the role-gating commit — closed the gaps so each role sees ONLY its own portal with no
nav to anything else, and shipped it to main. An audit (grep of `to="/chat|/teacher|/admin"`) found
cross-portal affordances the first pass missed because they live in shells that don't use ConsoleShell.

- Removed cross-portal links: `admin.tsx` AdminShell logo `/chat`→`/admin`; deleted the "Open teacher
  shell" (→/teacher) button and the "Return to Jargon" (→/chat) link; `TeacherConsole.tsx` deleted the
  "Student chat" (→/chat) button (and the now-unused `Link` import).
- No foreign-chrome flash: new `components/RouteLoader.tsx` (neutral full-screen loader, no portal chrome).
  `admin.tsx` renders it while booting/!authorized (was rendering AdminShell chrome); `TeacherConsole`
  sets `authChecked` only after role===teacher confirmed and early-returns RouteLoader until then;
  `teacher.curriculum.tsx` adds a `roleOk` gate + RouteLoader. `chat.tsx` already gated on `!email ||
  booting` with a neutral loader (student guard keeps those unset for non-students) — no change needed.
- `PlaceSwitcher.tsx`: when only one destination is reachable (admin), render a static "you are here"
  label instead of an interactive switcher; teachers keep the dashboard↔curriculum switch.

Net effect per role: header shows no link to any other portal; logo → own home; a direct URL to another
portal redirects to your home with no flash of the foreign shell; admin has no switcher control.

Tests: tsc 0 errors; lint 0 errors / 11 pre-existing warnings; build green. Shipped: fast-forwarded `main`
(frontend-only, Render auto-build) so the full role-gating (prior `5cba9fd` + this) is now LIVE. The
demo-login seeder button still needs the `admin-seed` edge fn redeployed to function.

## Claude -> Codex / Human - 2026-06-28 (Strict role-gated navigation + demo-login seeder; branch)

Summary: Each user now sees and can reach ONLY their own portal. Introduced a single **primary role**
(precedence admin > teacher > student; "student" is now a true fallback, not "anyone logged in") and used it
to (1) gate the header nav, (2) guard every portal route with a redirect, and (3) make login + `/` land each
role on its home. Plus a platform-admin-only one-click **demo-login seeder** so the 4 portals can be tested.

Part 1 — navigation (frontend-only):
- `lib/api.ts`: `fetchPrimaryRole(accessToken,userId)` (admin via fetchAdminScope → teacher via
  fetchTeacherClasses → student) + `roleHome(role)`.
- `hooks/useConsoleAccess.ts`: now resolves the single `role` (+ `home`); the `student/teacher/admin`
  booleans are exclusive.
- Header: `SettingsMenu` drops the always-on "Student chat" + conditional Teacher/Admin links → one
  role-aware Home link. `ConsoleShell` logo → `roleHome`. `PlaceSwitcher` already filtered by the (now
  exclusive) booleans, so a student sees only chat, a teacher only teacher+curriculum, an admin only admin.
- Route guards (redirect to `roleHome` when the role doesn't match): `routes/chat.tsx` (student-only),
  `features/teacher/TeacherConsole.tsx` (teacher-only; also covers `/teacher/class/*` which reuse it),
  `routes/teacher.curriculum.tsx` (teacher-only), `routes/quiz.$assessmentId.tsx` (student-only),
  `routes/admin.tsx` (non-admins now redirected instead of the soft "admins only" message).
- Landing: `routes/index.tsx` beforeLoad + `routes/login.tsx` (pre-check + post-login) → `roleHome`.

Part 2 — four test logins (one-click seeder):
- `supabase/functions/admin-seed/index.ts`: new platform-admin-only `seed_demo_logins` action. Idempotent;
  reuses the existing seed primitives. Creates a "Demo Org" + "Demo Class" and 3 accounts with a chosen
  password: `demo-student@example.com` (student), `demo-teacher@example.com` (teacher),
  `demo-admin@example.com` (org_admin). Does NOT mint a platform_admin (no escalation path) — the 4th login
  is the caller's own account.
- `lib/api.ts` `seedDemoLogins(accessToken, password)`; admin **Seeding** tab gained a platform-admin-only
  "Create demo logins" card (password field, button, result list).

The four logins (after running the seeder once; default password `JargonDemo123!`):
1. Student — demo-student@example.com  2. Teacher — demo-teacher@example.com
3. Org admin — demo-admin@example.com  4. Platform admin — your own elie.nasr11@gmail.com

Tests run: `tsc --noEmit` 0 errors; `npm run lint` 0 errors / 11 pre-existing warnings; `npm run build`
green.

Remaining concerns: Part 1 is frontend-only (ships to main, Render auto-build). Part 2's "Create demo
logins" button needs the **admin-seed edge fn redeployed** (Supabase) before it works. Precedence note: a
user who is both org_admin and teacher resolves to admin (highest privilege). Route guards add up to two
extra calls (fetchAdminScope + fetchTeacherClasses) on portal load — acceptable, cached via React Query in
the nav hook. The AskUserQuestion tool failed twice this turn (permission stream); proceeded with the
recommended defaults (precedence + seeder) — user can redirect.

## Claude -> Codex / Human - 2026-06-28 (Admin IA: consolidate all integrations under one "Integrations" tab; branch)

Summary: Frontend-only IA reorg of the admin console. The separate **Google Classroom** and **Canvas**
top-level tabs are gone, and **CSV/OneRoster import** + **Campus Live link-out** are pulled out of the
"School data" tab. All four now live under a single **Integrations** tab with an in-tab provider selector
(segmented pill row): Google Classroom · Canvas · CSV / OneRoster · Campus Live. Pure relocation — every
piece of state/handlers/effects already lived at `AdminPage` scope, so nothing was rewired; no
api/types/backend/migration changes.

Details:
- `frontend/src/routes/admin.tsx`: top tab list now `readiness · school · integrations · (cost) · ops ·
  seeding`. New `<WorkspacePanel value="integrations">` wraps a nested `<Tabs value={integrationMode}>`
  (reusing WorkspaceTabList/WorkspaceTab/WorkspacePanel — Radix nests fine) with sub-panels google/canvas/
  csv/campuslive. The Google and Canvas panels moved in verbatim; the CSV-import card and Campus-Live card
  were lifted out of the School-data panel into the `csv`/`campuslive` sub-panels (each given a short
  intro header). School-data keeps Student records & reports + Class consent (intro reworded).
- Sub-selector is deep-linkable: `?integration=` (default `google`), mirroring the existing `?tab=`
  pattern; added `integration` to `validateSearch` and the `useSearch` cast. OAuth return now lands on
  `?tab=integrations&integration=<google|canvas>` (replaced the bare history.replaceState in the callback).
- `frontend/src/components/WorkspaceTabs.tsx`: TAB_ICONS gained `integrations` (Plug) + canvas/csv/
  campuslive icons; imported Plug + ExternalLink.

Tests run: `tsc --noEmit` 0 errors; `npm run lint` 0 errors / 11 pre-existing warnings; `npm run build`
green.

Remaining concerns: branch-only (`claude/happy-johnson-wseex8`); deploy to `main` on the user's OK
(frontend-only, Render auto-build — no backend redeploy needed for this reorg). Backend edge fns
(`canvas`, updated `admin-ops`) + Canvas migration + secrets are still the user's to deploy for the
integration features to function (unchanged by this reorg).

## Claude -> Codex / Human - 2026-06-28 (Campus Live fallback — OneRoster CSV + link-out; branch, NOT deployed)

Summary: Campus Live (campus.live) has no public API, so instead of a native integration we shipped two
provider-agnostic surfaces (also useful for any SIS). **No migration.** Doc: `docs/CAMPUS_LIVE_INTEGRATION.md`.

1) **OneRoster CSV import.** The existing admin CSV roster import now also accepts a OneRoster `users.csv`
   with no reformatting. Only `admin-ops` `normalizedRosterRow()` changed: it maps `givenName`+`familyName`
   → name, `grades` → grade, `username` → email fallback (only if it looks like an email), in addition to
   the existing aliases. `parseCsv` lowercases headers so the function reads `givenname`/`familyname`/`grades`.
   Behavior otherwise unchanged (links existing users; unmatched = needs_seed; still requires an `email`
   column; does not create accounts). Admin hint text updated.
2) **Per-org Campus Live link-out.** Admins set a per-org URL; students+teachers in that org see a "Campus
   Live" item in the shared Settings menu (opens in a new tab).
   - Storage: `organization_settings.resource_settings.campus_live_url` (existing JSONB; RLS already lets
     members SELECT, org admins write).
   - New `admin-ops` action `organization_links` (org/platform-admin): merges/validates campus_live_url into
     resource_settings (https-normalized; blank clears); empty payload = read. Added to `AdminOpsAction`.
   - Frontend: `fetchOrganizationLinks`/`setOrganizationLinks` (admin path) + `fetchCampusLiveLink` (member
     RLS read: memberships → organization_settings); `useCampusLiveLink` hook feeds `SettingsMenu` (rendered
     for students via chat + teachers/admins via ConsoleShell, so one insertion covers all roles). Admin
     School-data tab gained a "Campus Live link-out" card (load on org select, save via runSchoolOp).

Files: `supabase/functions/admin-ops/index.ts` (normalizedRosterRow + handleOrganizationLinks + dispatch);
`frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`, `frontend/src/routes/admin.tsx`,
`frontend/src/components/SettingsMenu.tsx`, new `frontend/src/hooks/useCampusLiveLink.ts`;
`docs/CAMPUS_LIVE_INTEGRATION.md`.

Tests run: `tsc --noEmit` 0 errors; `npm run lint` 0 errors / 11 pre-existing warnings; `npm run build`
green. Deno not in sandbox.

Remaining concerns: redeploy the `admin-ops` edge function (Supabase) — can't be exercised from the sandbox
(egress). No migration. The member read assumes users can SELECT their own `organization_memberships` and
their org's `organization_settings` (RLS `is_org_member`); if a self-select policy is missing the link
simply won't appear (graceful). Frontend branch-only. **This completes the integrations plan (Canvas C1-C4
+ Campus Live).** Remaining backlog is the deferred zero-friction per-role rebuild (Phases 1-5).

## Claude -> Codex / Human - 2026-06-28 (Canvas C4 — ongoing scheduled sync; branch, NOT deployed)

Summary: Added **Canvas C4**, the last Canvas phase. A `sync` action keeps imported classes + grades current
after the initial import/push, driven by a daily **GitHub Actions** workflow, plus a manual "Sync now" button
and a per-connection auto-sync opt-out. **No migration** — reuses `canvas_sync_runs.action='sync'` and
`canvas_connections.metadata`.

System auth (the C4 unknown): there's no cron-secret path in the repo. The Supabase gateway accepts the
**service-role key as a Bearer JWT**, so the edge function treats `Authorization == "Bearer " +
SUPABASE_SERVICE_ROLE_KEY` as the trusted system caller — it skips user/actor resolution and sweeps all
active connections. The service-role key lives only as a GitHub Actions secret (full access; never in repo
or logs).

Edge function `supabase/functions/canvas/index.ts`:
- Extracted reusable helpers (no behavior change to C1/C3): `pushGradesForLink` (from `handlePushGrades`) and
  a new link-only `refreshMappingRoster` (reconciles memberships + `canvas_user_mappings` for matched users;
  never creates classes/accounts). `handlePushGrades` now calls `pushGradesForLink`.
- `syncConnection(connection, {actorId, includeGrades})` — refresh token (mark connection `error` on
  failure), refresh each active course mapping's roster, re-push every grade link, write one
  `canvas_sync_runs` row (`action:'sync'`, counts `{courses, memberships, grades_pushed, grades_skipped,
  grades_failed}`).
- `handleSync` (user "Sync now": `connection_id`, or org-wide), `handleSystemSync` (sweep all active,
  skipping `metadata.auto_sync === false`), `handleSetSyncEnabled` (toggle the opt-out). Dispatch detects
  service-role-bearer → `handleSystemSync` before `fetchCurrentUser`; 409 stub removed.
- `redactedConnection` now exposes `auto_sync` (from `metadata.auto_sync !== false`).

New `.github/workflows/canvas-sync.yml`: daily `cron: '0 7 * * *'` + `workflow_dispatch`; curls
`{action:"sync"}` to `$SUPABASE_URL/functions/v1/canvas` with the service-role bearer; fails on non-2xx or
`"status":"error"`. Repo secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

Frontend: `CanvasConnection.auto_sync`; `syncCanvas` + `setCanvasSyncEnabled` api helpers (+ `set_sync_enabled`
action / `enabled` param on `invokeCanvas`); Canvas connection card gained a **"Sync now"** button + an
**"Auto-sync on schedule"** checkbox. Existing "Recent Canvas syncs" panel surfaces the `'sync'` rows.

Tests run: `tsc --noEmit` 0 errors; `npm run lint` 0 errors / 11 pre-existing warnings; `npm run build`
green; `canvas-sync.yml` validated as YAML. Deno not in sandbox (edge fn not Deno-checked locally).

Remaining concerns / deploy: redeploy the `canvas` edge fn and add the two GitHub Actions repo secrets;
backend can't be exercised from the sandbox (egress). C4 needs no migration. Grade re-push on schedule will
overwrite a grade a teacher changed directly in Canvas (idempotent percentage) — intended per the chosen
"rosters + grades" scope; disable per-connection auto-sync to avoid it. **Canvas (C1-C4) is now feature-
complete on `claude/happy-johnson-wseex8`.** Frontend still branch-only. Next remaining integration work:
Campus Live OneRoster/CSV import upgrade + per-org link-out (no native API).

## Claude -> Codex / Human - 2026-06-28 (Canvas C3 — grade passback; branch, NOT deployed)

Summary: Added **Canvas C3** grade passback on top of C1/C2. Admins/teachers can link a Jargon
assessment or assignment to a Canvas assignment and push student scores to Canvas. Uses the
pre-declared `canvas_grade_links` table — no new migration.

Score model (important): Jargon scores follow the gradebook `formatScore` convention — a value <= 1 is a
0..1 fraction, > 1 is already a 0..100 percent. We push a **percentage string** to Canvas
(`submission[posted_grade]` ending in `%`), which Canvas converts against the assignment's
points_possible. This is scale-independent and identical for assessments (`assessment_recipients.final_score`,
0..1) and assignments (`assignment_recipients.score`). Jargon user -> Canvas user via
`canvas_user_mappings`; recipients with no Canvas mapping or no numeric score are skipped.

Edge function `supabase/functions/canvas/index.ts` new actions:
- `list_grade_targets` (course_mapping_id) → class's Jargon graded items + the course's Canvas
  assignments (`GET /courses/:id/assignments`) + existing links.
- `upsert_grade_link` / `delete_grade_link` (validates the Jargon item's org/class).
- `push_grades` (grade_link_id, or course_mapping_id for all links) → `PUT
  /courses/:id/assignments/:id/submissions/:user_id`; records pushed/skipped/failed + per-row errors in
  `canvas_sync_runs`, stamps `last_pushed_at`. Tokens cached per connection across links.
- `list_mappings` now also returns `grade_links`. `sync` still 409 (C4).

Frontend: `Canvas*` grade types (`CanvasGradeLink/Assignment/GradeTarget/GradeTargets`) + `grade_links` on
`CanvasIntegrationState`; `api.ts` `fetchCanvasGradeTargets`/`upsertCanvasGradeLink`/`deleteCanvasGradeLink`/
`pushCanvasGrades` (+ extended `invokeCanvas`); admin Canvas tab gained a **Grade passback** section (pick
imported course → see/add/remove links → push per link or all, with last-pushed + result counts).

Tests run: `tsc --noEmit` 0 errors; `npm run lint` 0 errors / 11 pre-existing warnings; `npm run build`
green. Deno not in sandbox (edge fn not Deno-checked locally).

Remaining concerns: needs **grade-write permission** on the connected Canvas account (+ matching write
scope if the dev key enforces scopes) — read-only C1 connections can connect/import but `push_grades` will
fail until write access is granted. Same deploy prerequisites as C1/C2 (Supabase deploy of migration
`20260628000000` + `canvas` edge fn, `CANVAS_*` secrets, per-institution dev key; can't be exercised from
the sandbox). Frontend branch-only. Next: C4 scheduled sync (pg_cron / scheduled fn calling `push_grades`
+ roster refresh per active connection); plus Campus Live OneRoster/CSV + link-out.

## Claude -> Codex / Human - 2026-06-28 (Canvas C2 — create accounts on import; branch, NOT deployed)

Summary: Added **Canvas C2** on top of C1. `import_course` can now provision Jargon accounts for
unmatched roster members instead of only linking existing users. Admin-only (rejected for teacher-level
Canvas connections), gated behind a checkbox + a shared temporary password the admin chooses.

How it works: in `supabase/functions/canvas/index.ts` `handleImportCourse` reads `create_missing_accounts`
+ `default_password`. For each roster row whose email has no Jargon user, it creates an email-confirmed
Auth user (`/auth/v1/admin/users`) with `name` metadata + `app_metadata.jargon_seeded_role` and a
`profiles` row — the exact shape `admin-seed` uses — then links org+class membership like a matched user.
Counts gained `created`; response returns `created_accounts` (no passwords) + `creation_errors`; sync run
records both. Password must be >= 6 chars (`MIN_TEMP_PASSWORD_LENGTH`), validated client- and server-side.
Rows without a usable email stay "missing".

Files changed (all on `claude/happy-johnson-wseex8`):
- `supabase/functions/canvas/index.ts`: `createCanvasAuthUser` + `upsertProfile` helpers; import loop
  creates accounts when enabled; new counts/created_accounts/creation_errors in response + sync run.
- `frontend/src/lib/api.ts`: `invokeCanvas`/`importCanvasCourse` accept `createMissingAccounts` +
  `defaultPassword`.
- `frontend/src/lib/types.ts`: `CanvasResponse.data` gained `created_accounts` + `creation_errors`.
- `frontend/src/routes/admin.tsx`: Canvas tab create-accounts checkbox + temp-password field (shown when
  checked), import button relabels to "Import + create accounts" and is disabled until the password is
  long enough; success message reports how many accounts were created.
- `docs/CANVAS_INTEGRATION.md`: C1/C2 status + a C2 account-creation section.

Tests run: `tsc --noEmit` 0 errors; `npm run lint` 0 errors / 11 pre-existing warnings; `npm run build`
green. Deno not in sandbox (edge fn not Deno-checked locally).

Remaining concerns: same as C1 — backend (migration `20260628000000` + `canvas` edge fn) still needs
Supabase deploy + `CANVAS_*` secrets + a per-institution Canvas developer key; can't be exercised from
the sandbox (egress). Frontend branch-only. Next: C3 grade passback (`canvas_grade_links` +
`PUT .../submissions/:user_id`) → C4 scheduled sync; plus Campus Live OneRoster/CSV + link-out.

## Claude -> Codex / Human - 2026-06-28 (Canvas LMS integration — C1 connect+import; branch, NOT deployed)

Summary: Built **Canvas C1** (connect + import), the first shippable Canvas milestone, mirroring the
Google Classroom integration. Canvas is per-institution, so connections store a `base_url`
(`https://school.instructure.com`) and the OAuth2 flow + all API calls run against that base. Read-only:
Jargon stays the source of truth for grades/mastery. C2 (account creation), C3 (grade passback, tables
already pre-declared), and C4 (scheduled sync) are scoped but not built. Doc: `docs/CANVAS_INTEGRATION.md`.

Files changed:
- New `supabase/migrations/20260628000000_canvas_integration.sql`: `canvas_connections` (+`base_url`),
  `canvas_course_mappings`, `canvas_user_mappings`, `canvas_sync_runs` (actions incl. `push_grades`/`sync`),
  `canvas_grade_links` (reserved for C3). RLS/grants/indexes mirror `0014` (connection table
  service-role-only; mapping/sync/grade-link tables org-admin SELECT via `is_org_admin`).
- New `supabase/functions/canvas/index.ts`: mirrors `google-classroom` with Canvas OAuth2
  (`{base}/login/oauth2/auth` + `/login/oauth2/token`, refresh tokens, AES-GCM token encryption, HMAC
  signed state carrying `base_url`), Link-header pagination, rosters via `/api/v1/courses` +
  `/courses/:id/users?enrollment_type[]=...&include[]=email`. Actions: diagnose/start_oauth/oauth_callback/
  list_courses/preview_roster/import_course/list_mappings/disconnect; push_grades/sync return 409 for now.
  Secrets: `CANVAS_CLIENT_ID/SECRET/REDIRECT_URI`, `CANVAS_TOKEN_ENCRYPTION_KEY` (falls back to
  `GOOGLE_TOKEN_ENCRYPTION_KEY`), optional `CANVAS_SCOPES`.
- `frontend/src/lib/types.ts`: `Canvas*` types (Connection/Course/Person/CourseMapping/UserMapping/
  SyncRun/IntegrationState/Response).
- `frontend/src/lib/api.ts`: `invokeCanvas` dispatcher + `diagnose/start/complete OAuth`, `fetchCanvasMappings`,
  `fetchCanvasCourses`, `previewCanvasRoster`, `importCanvasCourse`, `disconnectCanvas`.
- `frontend/src/lib/supabase.ts`: added `"canvas"` to the `functionUrl` slug union.
- `frontend/src/routes/admin.tsx`: new **Canvas** admin tab (base-URL field + connect→load→preview→import),
  Canvas state/handlers/memos, and the OAuth callback effect now routes Google vs Canvas via a
  `jargon_oauth_provider` sessionStorage hint (both providers redirect to `/admin` with `?code&state`).
  `RosterPreviewTable` generalized to a minimal person shape so both integrations share it.

Tests run: `tsc --noEmit` 0 errors; `npm run lint` 0 errors / 11 pre-existing warnings; `npm run build`
green. Deno not in sandbox (matches the google-classroom toolchain); edge fn not Deno-checked locally.

Remaining concerns / NOT done:
- **Backend not deployed.** The migration + `canvas` edge function must be applied via Supabase (MCP
  deploy is gated this session). Set the `CANVAS_*` secrets first. A **Canvas developer key** per
  institution (client id/secret + redirect URI) is a hard prerequisite before C1 can actually connect;
  functional verification can't run from the sandbox (egress).
- Frontend is branch-only (`claude/happy-johnson-wseex8`), not yet on main.
- Canvas `email`/`login_id` visibility depends on the connected account's Canvas permissions; roster
  rows without an email fall to "needs seed".

Suggested next task: deploy backend + secrets + dev key, verify C1 end-to-end against a Canvas test
course, then C2 (create missing accounts on import via admin-seed) → C3 (grade passback via
`canvas_grade_links`) → C4 (scheduled sync). Campus Live = OneRoster/CSV import upgrade + per-org link-out
(no native API).

## Claude -> Codex / Human - 2026-06-27 (Zero-friction Phase 0 + portal polish — LIVE/branch)

Context: kicked off a "zero-friction" UI simplification (master vision in
`/root/.claude/plans/...`; not in repo). Phase 0 (additive foundation) is LIVE on main; a polish
pass on the teacher+admin portals is on branch `claude/happy-johnson-wseex8`. Frontend-only.

Phase 0 (live): `lib/feedback.ts` + `<Toaster>` (one toast channel, success≠error) routed through the
admin op-wrappers; color-coded health badges on teacher class cards (`classAttention`) and admin org
cards (per-org readiness); `components/ConfirmButton.tsx` guards destructive admin actions (data
delete, password reset); `components/PlaceSwitcher.tsx` (role-gated place indicator + Cmd/Ctrl+K
command palette) backed by `hooks/useConsoleAccess.ts`, wired into ConsoleShell + AdminShell;
SettingsMenu Teacher/Admin links role-gated.

Polish pass (branch): unified the admin shell to ConsoleShell (max-w-[1240px], AmbientCanvas 0.24);
replaced ALL hard-coded palette colors with semantic tokens across admin/teacher/curriculum
(red-500→danger, emerald-500→success, amber-500→warning, sky-500/blue-*→info — use the soft-fill
recipe border-X/40 bg-X/12 text-X going forward); connective links: gradebook rows clickable→student,
flagged class card→Gradebook tab, org card "N need fixing"→that org's Readiness tab. Deliberately
did NOT add an admin→teacher-class deep link (teacher console is scoped to the logged-in user's own
classes, so it dead-ends for non-teacher admins).

Verified each step: tsc 0 errors, lint 0 errors / 11 pre-existing warnings, build green. (Playwright
boot smoke flaky in-sandbox this stretch; relied on tsc+build.) Next planned: per-role rebuild phases
1-5 (student stage rail; teacher home queue + tab collapse + Work builder; admin fleet/split;
curriculum) — see the plan file.

## Claude -> Codex / Human - 2026-06-27 (Org-admin account onboarding — Part A2; LIVE)

Status: A+B and A2 are all LIVE on main. The `admin-seed` edge function was deployed by the human via
the Supabase dashboard; the frontend scoped Seeding tab is merged to main (`13f2c43`).

What A2 does (lets principals create student/teacher accounts for their own school):
- Backend `supabase/functions/admin-seed/index.ts`: `assertPlatformAdmin` → `resolveActorAccess`
  (platform_admin OR org_admin). Org admins are scoped by `resolveSeedOrganization`: must target an
  EXISTING org they administer (rejects name/slug-only → no new-org creation), class is created/reused
  by name in their org (no cross-org class id), roles stay student/teacher. `list_seed_batches` scoped
  to their orgs. Platform path unchanged.
- Frontend `routes/admin.tsx`: Seeding tab shown to org admins with a scoped form (org fixed to the
  selected org, no org-create fields); `seedRoster` sends the existing org id for org admins.

**Verify on the live deploy** (couldn't be auth-tested from the sandbox): (a) platform seeding still
works for us; (b) an org_admin can seed student/teacher into *their* org only; (c) an org_admin cannot
create a new org, seed an admin role, or target another org. The org-scope boundary lives in
`resolveSeedOrganization` / `resolveActorAccess` in `admin-seed/index.ts`.

Note: the Supabase MCP `deploy_edge_function` was blocked in-session ("requires approval"), so the human
deployed the function from the dashboard. If future edge-function deploys are needed, either clear that
MCP approval or use `supabase functions deploy <name> --project-ref qztpieiizmiayzjhezwh`.

## Claude -> Codex / Human - 2026-06-27 (Org-admin experience + curriculum integration — Parts A/B)

Status: On branch `claude/happy-johnson-wseex8` (build-verified; NOT on main — awaiting deploy OK).
Frontend-only so far; no backend/data changes.

- **Part A — organization-admin console** (`routes/admin.tsx`): `/admin` is now level-aware. For an
  `org_admin` actor (principal / school-chain owner) it labels "Organization admin", scopes the org
  picker to their own org(s), and hides the platform-only Cost tab. Platform-admin view unchanged.
  Backend already authorizes org_admins (admin-ops scopes by `actorAccess.level`); this matches the UI.
- **Part B — shared shell + nav switcher** (`components/ConsoleShell.tsx` new): the teacher dashboard and
  curriculum now render inside one shared shell with a Dashboard ⇄ Curriculum segmented switcher in the
  header, so curriculum no longer feels like a separate page. Removed the redundant hero "Curriculum" /
  "Teacher dashboard" links; lesson breadcrumb retained. (Admin keeps its own `AdminShell` for now.)

Commits: `53e7676` (Part A), `6405194` (Part B). Verified: tsc 0 errors, lint 0 errors / 11 pre-existing
warnings, build green, Playwright boot smoke passes on `/teacher`, `/teacher/curriculum`, `/admin`.

**Part A2 — org-admin account onboarding — BLOCKED ON A DECISION.** Investigation found the *only*
account-creation path is the `admin-seed` edge function, which is **platform-admin-only**
(`assertPlatformAdmin`); the CSV roster import (`admin-ops apply_csv_roster_import`) only links
*existing* users, it does not create accounts. So letting principals create new teacher/student accounts
requires editing the auth-critical `admin-seed` function (authorize org_admin, restrict to their existing
org, no new-org creation, student/teacher only) and deploying it — which can't be fully auth-tested from
this sandbox. Holding for the human's call: do the backend change, or keep account creation platform-side
(we seed a new school; principals then manage classes/rosters/roles of those accounts, which already works).

## Claude -> Codex / Human - 2026-06-27 (Push the spine further — Phase 5)

Status: On branch `claude/happy-johnson-wseex8` (build-verified). Phases 1-4 are now on `main`
(deployed). Frontend-only; no feature/data/API changes.

Follow-on to the URL-spine redesign, continuing it with the deferred items (existing APIs only):
- **Shared `Breadcrumb` component** (`frontend/src/components/Breadcrumb.tsx`): segments
  `{ label, onClick? }`, last = current. Replaces the inline breadcrumb markup in
  `TeacherConsole` and `admin.tsx` (both now import it; `ChevronRight` import dropped from both).
- **Curriculum on the spine** (`routes/teacher.curriculum.tsx`): added a `?lesson=` search param
  (`validateSearch` + `useSearch`); selecting a lesson in the tree now `navigate`s to
  `?lesson=<id>`, and an effect loads that lesson into the editor on deep-link/back-forward. Added
  a Teacher / Curriculum / {lesson} breadcrumb. So a lesson editor view is now shareable.
- **Entry point**: each row of the class **Lessons** tab now has an "Edit in curriculum" button →
  `/teacher/curriculum?lesson=<id>` (alongside "Open in gradebook"). (Teacher header already had a
  Curriculum link.)
- **Class context**: the class header eyebrow now shows `{org} · {status}` (read-only; teachers
  can't edit class settings — that's admin-only, confirmed via api.ts).

Deliberately NOT done (rationale in `docs/DECISIONS.md`): admin stays on search params (no
path-param rewrite); no subject/course/unit CRUD (needs new backend actions). Optional `ConsoleShell`
unification not done (Breadcrumb already gives most of the consistency).

Verified: tsc 0 errors, lint 0 errors / 11 pre-existing warnings, build green, Playwright boot smoke
passes on all routes incl. `/teacher/curriculum?lesson=...`. Held on branch for your review (deploy
on request).

## Claude -> Codex / Human - 2026-06-27 (Docs sync — Phase 4/4)

Status: On branch `claude/happy-johnson-wseex8` (build-verified; NOT on main — holding for review).

Closes the teacher/admin structural redesign. Docs brought in sync with the new structure:
- `frontend/src/routes/README.md`: corrected the false "routeTree.gen.ts is auto-generated"
  note (there is no router-plugin — it is hand-maintained) and documented the current route table.
- `docs/DECISIONS.md`: added "2026-06-27: Teacher/Admin URL Spine Mirrors The Domain" recording
  the path-params-for-teacher (+ React Query cache) vs search-params-for-admin decision and the
  hand-maintained route tree.

Deep-link / refresh / back-forward correctness was validated by the Playwright boot smoke
navigating directly to each deep URL (equivalent to a refresh) — all mount and resolve.
Deferred (optional polish, not blocking): extract a single shared breadcrumb component across both
consoles; surface class settings in-class (needs an edit endpoint); optionally unify admin onto
path params (would require a React Query data layer there too).

Whole redesign is on the branch across commits 303c511, d14ae76, d2d4629, b856f41, + this docs
commit. Nothing deployed to main yet (your call).

## Claude -> Codex / Human - 2026-06-27 (Admin on the spine — Phase 3/4)

Status: On branch `claude/happy-johnson-wseex8` (build-verified; NOT on main — holding for review).
Frontend-only; no feature/data/API changes.

Admin now puts org + tab in the URL so context is set once and is deep-linkable:
- `/admin?org=<id>&tab=<section>`. Chosen **search params** (not a path segment like the teacher
  side) deliberately: admin is a single console where org is a context filter, and its data
  loading is state-based across many handlers. Search params keep it on one route — **no remount,
  no refetch, no loading flash** when switching org — while still deep-linkable with working
  back/forward. (Org/tab `selectedOrgId`/`adminTab` are now thin shims over `useSearch` + navigate,
  so the ~25 existing read sites and 3 write sites were untouched.)
- `/admin` (no `?org`) is now an **org picker home** (cards per organization with class counts);
  the boot loader no longer auto-selects the first org.
- When an org is selected: an **Admin / {org} breadcrumb** sits above the existing six tabs
  (Readiness / School data / Google / Cost / Operations / Seeding), all reading the URL org.
- `validateSearch` preserves unknown params so the Google OAuth `code`/`state` callback still works.

Note (consistency): teacher uses path params (`/teacher/class/$classId/...`), admin uses search
params. Both are real, deep-linkable URL state; can unify to path-based for admin in Phase 4 if
desired (would need a React Query data layer to avoid remount refetch).

Verified: tsc 0 errors, lint 0 errors / 11 pre-existing warnings, build green, Playwright boot smoke
passes on `/admin` and `/admin?org=...&tab=cost`. Next: Phase 4 (polish + docs).

## Claude -> Codex / Human - 2026-06-27 (Teacher IA on the spine — Phase 2/4)

Status: On branch `claude/happy-johnson-wseex8` (build-verified; NOT on main — holding for review
per your call). Frontend-only; no feature/data/API changes.

Builds on the Phase 1 URL spine:
- Home (`/teacher`): class picker grouped by **Organization** (mirrors Org -> Class); the empty
  detail area is now a "needs attention" action queue (submissions to grade, assessments to review,
  open alerts) computed from the cached dashboard.
- Class/student pages: a clickable **breadcrumb** (Teacher / Org / Class / Student) replaces the
  always-on class list and the ad-hoc "Back to class" button; Student is now an explicit child.
- New **Lessons** tab in the class workspace: lists every lesson that has student activity or
  attached work, each with its resources/assignments/assessments counts + sessions-complete
  progress, plus "Open in gradebook" (sets the gradebook lesson filter + switches tab). Addresses
  "Lesson isn't navigable" — work is the bridge between class and lesson. Long list bounded to a
  60vh scroll region.
- WorkspaceTabs: added a `lessons` -> BookOpen icon.

Commits: `d14ae76` (breadcrumb + org-grouped home) + this commit (Lessons tab). Verified: tsc 0
errors, lint 0 errors / 11 pre-existing warnings, build green, Playwright boot smoke passes.
Deferred: class settings surfaced in-class (needs an edit endpoint), and Phase 3 (admin on the
same spine).

## Claude -> Codex / Human - 2026-06-27 (Teacher console: URL spine + React Query — Phase 1/4)

Status: On branch `claude/happy-johnson-wseex8` (build-verified; held on branch, NOT on main).
Frontend-only; no feature/data/API changes.

Phase 1 of the teacher/admin structural redesign ("URL spine = the domain"). Teacher drill-down
is now real URLs instead of component state:
- New flat routes (hand-added to `routeTree.gen.ts`, same pattern as `quiz.$assessmentId` /
  `teacher.curriculum`): `/teacher/class/$classId` and
  `/teacher/class/$classId/student/$studentId`; active tab is a `?tab=` search param. Deep-linkable;
  back/forward traverses Home -> Class -> Student.
- The teacher page body moved out of `routes/teacher.tsx` (now a ~14-line route shell) into
  `features/teacher/TeacherConsole.tsx`, reused as the `component` for all three routes. It reads
  `classId`/`studentId` from `useParams({strict:false})`, tab from `useSearch`, and uses
  `navigate()` instead of `setSelectedClassId/StudentId`.
- Data layer: `fetchTeacherDashboard` now lives in a React Query cache
  (`["teacherDashboard", userId]`, staleTime 5m) so class<->student drill-down no longer refetches.
  Existing optimistic `setDashboard(updater)` call sites are preserved — `setDashboard` now writes
  to the query cache; Refresh / returnAssessment use `invalidateQueries`.
- `ClassDetail`/`StudentDetail` tabs made controllable (optional `tab`/`onTabChange`, fall back to
  local state) so the URL drives them.

No component decomposition yet (ClassDetail/StudentDetail/managers still live together in
`TeacherConsole.tsx`) — deferred to Phase 2, where the lesson cross-section needs them separable.
Verified: tsc 0 errors; lint 0 errors / 11 pre-existing warnings; build green; Playwright boot smoke
loads `/login` + all three teacher routes (unauth -> redirect to `/login`) with no JS/route errors
(only the expected egress-blocked Supabase calls).

Next (Phase 2, held until you review the deploy): breadcrumb shell, lesson cross-section view, class
settings surfaced, action-queue home. Then Phase 3 = admin on the same spine.

## Claude -> Codex / Human - 2026-06-26 (Teacher & Admin structure-clarity pass)

Status: Shipped to `main` (build-verified). Frontend-only; no feature/data/API changes.

Follow-up to the tab reorg, after loading heavy demo data (Pressure Test Academy: 12 classes,
192 students, 44 lessons). Made the hierarchy obvious:
- teacher.tsx: the right pane now shows ONE level at a time — Class workspace, or (when a
  student is selected) the Student workspace with a "Back to {class}" breadcrumb (new
  `classLabel` prop on StudentDetail). Kills the previous double-tab-bar (class tabs + student
  tabs stacked). The class header already sits above the class tabs.
- Gradebook: lesson filter grouped by module via `<optgroup>` (44 lessons no longer a flat
  list); Student column pinned (sticky) during horizontal scroll.
- WorkspaceTabs: each tab now shows a lucide icon by value (overview/gradebook/roster/…,
  readiness/school/google/cost/ops/seeding) — both teacher + admin tab bars read as a clear,
  consistent nav strip. Single-file change.

Deferred (needs eyes-on review of the live deploy first): deeper admin per-tab sub-headings
(esp. splitting the "School data" tab into Roster import / Exports / Retention / Consent
sub-sections) and a class-list search for the 16-class rail. Held back to avoid blind visual
churn on the authed dashboards (this sandbox's egress blocks Supabase, so I can't screenshot them).

Commits: `684e713` (teacher drill-down/breadcrumb/gradebook), `62d2766` (tab icons).
Verified: tsc clean, build green, lint unchanged (0 errors / 11 pre-existing warnings); /login boots.

## Claude -> Codex / Human - 2026-06-26 (Teacher & Admin reorganized into tabs)

Status: Shipped on branch `claude/happy-johnson-wseex8` (build-verified; NOT on main).

Task: Make the teacher/admin consoles human-friendly — the dense single-scroll pages now read
as a few simple tabs. Approach: in-page tabs (no new URL routes — `routeTree.gen.ts` is
hand-maintained, no router-plugin), reusing a new shared `WorkspaceTabs` wrapper over the
shadcn/Radix Tabs primitive. Panels use `forceMount` so all form state, fetches, refreshers,
the Google OAuth callback effect, and the live-watch heartbeat behave exactly as before —
only visibility is tab-gated. Pure JSX regrouping; no `@/lib/api`, data, or feature changes.

- `admin.tsx`: 6 tabs — Readiness · School data · Google Classroom · Cost & runtime · Operations
  · Seeding (Seeding only when `isPlatformLevel`). Dropped the redundant org-admin
  "seeding unavailable" note (org admins just don't see that tab).
- `teacher.tsx`: ClassDetail → Overview · Gradebook · Roster · Resources · Assignments ·
  Assessments. StudentDetail → Overview · Transcript & notes · Records. Class/student headers
  stay above their tabs; master-detail selection unchanged.
- New file `frontend/src/components/WorkspaceTabs.tsx`.

Verification: `tsc --noEmit` clean, `npm run build` green, `npm run lint` unchanged (0 errors,
11 pre-existing warnings); semantic diffs (git diff -w) are just tab scaffolding (admin +105/-47,
teacher +62/-6); the large raw line counts are prettier reindent from the new nesting. `/login`
re-screenshotted OK (app boots with the new bundle). The authed dashboards can't be screenshot
from this sandbox (egress blocks *.supabase.co) — please review the tabs on the live deploy of
this branch. Commits: `4b49272` (admin), `14a8ae5` (teacher), plus `WorkspaceTabs`.

## Claude -> Codex / Human - 2026-06-26 (UI cleanup pass — PAUSED for review)

Status: IN PROGRESS (build-verified). Branch `claude/happy-johnson-wseex8` (based on `main`
c60d43f). NOT on main. Shipped: stages 1, 3, 6 (reduced-motion), 4 (login), 5 (status palette).
Authed pages can't be screenshot-verified from this sandbox (egress blocks *.supabase.co), so
they're build-verified here and reviewed on the live deploy.

Task: Frontend-only UI cleanup / polish pass over `frontend/` (the "pre-UI-cleanup" gate the
roadmap pointed to). Detail-quality only — preserves IA, page layout, workflows, and data
placement. No backend/engine/migration/route-data changes. The dead root static SPA is untouched.

Plan: 6 staged commits — (1) token foundation in `styles.css`, (2) shared AppShell + canvas/header
consistency, (3) HeaderMenus/SettingsMenu fixes, (4) cards/forms/buttons/inputs, (5) status pills/
tables/state parity, (6) responsive + reduced-motion sweep. Verified per stage with
`tsc --noEmit` + `npm run lint` + `npm run build` (baseline: 0 errors, 11 pre-existing warnings).

Stage 1 (done): added radius/surface-tier/status/shadow/z-index/motion token scales to
`styles.css`, wired the shadcn primitive tokens (primary/secondary/accent/card/popover/input/ring/
destructive — they were previously undefined so Button/Card/Badge were unstyled), unified
`--input`→`--border`, added a global `:where(...):focus-visible` ring and a global
`prefers-reduced-motion` block. Additive only; build green.

Stage 3 (done): `HeaderMenus` desktop dropdown click-trap fixed (closed panel stayed
display:block + pointer-events:auto), 380px panels clamped to the viewport, tokenized menu
z-index on both `HeaderMenus` and `SettingsMenu`. (Both menus were otherwise solid — no churn.)

Stage 6 reduced-motion (done): GSAP now honors prefers-reduced-motion app-wide via
`gsap.globalTimeline.timeScale` in `main.tsx` + `lib/motion.ts` (the CSS half was stage 1).

Stage 4 — login (done): failed sign-in styled as an error (danger token + role=alert) and a
disabled submit state. Visually verified on /login (light/dark/mobile) via Playwright.

Stage 5 — status palette (done): ad-hoc emerald/amber/blue/cyan/sky/red status colors are
consolidated onto semantic success/warning/info/danger tokens across teacher (chips + pills),
admin (readiness + form errors), and chat (live banner, voice dots, pending text, teacher msg).
Non-status uses of those hues (mastery heatmap, ghost buttons) left intentionally.

Remaining (best done with eyes on the deploy, or with *.supabase.co egress opened so the
Playwright harness can log in): surface-tier + radius harmonization across the dashboards (a
blind remap is risky, so held back), table row-density unification + a shared StatePanel for
loading/empty/error, quiz scroll-to-error, and the Stage 2 shared-AppShell extraction
(deferred: highest visual risk, lowest payoff).

Verification per shipped stage: `tsc --noEmit` clean, `npm run build` green, `npm run lint`
unchanged (0 errors, 11 pre-existing warnings). Commits: `6fd4398` (stage 1), `fe74b9d` (stage 3),
`1aea96b` (stage 6 reduced-motion), `87b4c27` (stage 4 login), `e120329` (stage 5 status palette).

Codex: please avoid large `frontend/styles.css` / shared-component rewrites until this branch
merges, to keep the diff clean.

## Codex -> Claude / Human - 2026-06-24 09:36

Status: Phase 11 Pilot Reliability + Model Routing v1 live activation passed

What went live:

- GitHub `main` is at `338986b` (`Add pilot reliability and model routing`).
- Deployed Supabase Edge Functions:
  - `run` v6;
  - `chat` v12;
  - `resource-processing` v4;
  - `admin-ops` v4.
- Render is serving the latest frontend bundle, including `/admin` AI/runtime operations and Runtime health.

Live smoke:

- Student auth passed for the seeded pilot student.
- `run` with `PRINT 5 // 2` returned `status=ok` and output `["2"]`.
- Controlled bad Jargon code returned `status=error` without crashing the function.
- Typed `chat` start returned `status=ok`, `stage=practice`.
- Code-review Mentor turn returned `status=ok` and wrote model telemetry.
- `model_usage_events` now includes route payloads such as `grading` and `resource_context`.
- `runtime_events` includes retry, stage transition, completion, controlled-error, and run-failure records.
- Platform admin `admin-ops` cost/model dashboard returned `status=ok` with `runtime_health`.
- Runtime health currently reports live wake-timeout and controlled-error counts, proving the dashboard is reading real pilot telemetry.
- Normal lesson completion smoke passed for `lesson1`: `practice -> assessment -> complete`, persisted as `learning_sessions.status=complete`, `stage=complete`, `score=1`.

Notes:

- `teacher1@gmail.com` is currently blocked from `/admin` with `403 Admin access is required`, which is correct because no active org-admin account exists in the current pilot data.
- The org-admin cost-hidden check remains untested until a teacher is intentionally promoted to `org_admin`.
- Existing `.playwright-cli/` remains unrelated and untracked.

Suggested next task:

- Cost-to-quality calibration: run representative lesson/resource/assessment turns through the configured model routes, compare quality, latency, and estimated cost, then tune `OPENAI_MODEL_DEFAULT`, `OPENAI_MODEL_GRADING`, `OPENAI_MODEL_RESCUE`, and `OPENAI_MODEL_RESOURCE_CONTEXT` before the classroom pilot.

## Codex -> Claude / Human - 2026-06-24 01:05

Status: Phase 11 Pilot Reliability + Model Routing v1 implemented repo-side

What changed:

- Hardened Supabase `run` around sleeping Render engine behavior:
  - retry count and delay are configurable with `JARGON_ENGINE_RETRY_COUNT` and `JARGON_ENGINE_RETRY_DELAY_MS`;
  - retryable engine statuses and timeout/unreachable attempts write structured `runtime_events`;
  - retry recovery is recorded with payload reason `engine_retry_success`.
- Added server-side Mentor model routing in `chat`:
  - `OPENAI_MODEL_DEFAULT` defaults routine Mentor turns;
  - `OPENAI_MODEL_GRADING` handles deterministic grading/review turns;
  - `OPENAI_MODEL_RESCUE` handles rescue turns;
  - `OPENAI_MODEL_RESOURCE_CONTEXT` handles resource-context-heavy turns;
  - model usage rows include a `payload.route` field.
- Added a soft chat rate limit using recent `learning_turns`.
  - Rate-limit hits return the existing typed error envelope with HTTP `429`.
  - Hits write `runtime_events` as `controlled_error` with reason `chat_rate_limit`.
- Added media-processing cost telemetry and safety:
  - OCR writes `model_usage_events` with task type `summarization`;
  - audio/video transcription writes `model_usage_events` with task type `speech_to_text`;
  - expensive OCR/transcription jobs are softly rate-limited from recent `resource_processing_jobs`.
- Extended `admin-ops` Cost/Model Dashboard response with `runtime_health`.
- `/admin` AI/runtime operations now shows run failures, wake timeouts, retry recoveries, rate-limit hits, and controlled errors.

Local verification:

- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with the existing 11 warnings.
- `cd frontend && npm run build` -> passed.
- `python3 -m unittest discover -s tests -q` -> 157 tests passed, 4 skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files ok.
- `git diff --check` -> passed.
- `deno check ...` was not run because `deno` is unavailable locally.

Deploy needed:

- Deploy Supabase Edge Functions `run`, `chat`, `resource-processing`, and `admin-ops`.
- Let Render deploy the frontend bundle from GitHub `main`.
- Optional secrets to set/tune:
  - `OPENAI_MODEL_DEFAULT`
  - `OPENAI_MODEL_GRADING`
  - `OPENAI_MODEL_RESCUE`
  - `OPENAI_MODEL_RESOURCE_CONTEXT`
  - `JARGON_ENGINE_RETRY_COUNT`
  - `JARGON_ENGINE_RETRY_DELAY_MS`

Live smoke:

- Cold/wake `run` with `PRINT 5 // 2` and confirm retry telemetry if Render sleeps.
- Trigger one controlled Jargon error and confirm runtime health updates.
- Complete a normal chat lesson and confirm a `model_usage_events.payload.route` value.
- Run one OCR/transcription if needed and confirm model usage task type.
- Open `/admin` as platform admin and confirm Runtime health appears in AI/runtime operations.

## Codex -> Claude / Human - 2026-06-24 00:24

Status: Assessment Expansion v1 live activation passed

What went live:

- GitHub `main` is at `e4d8037` (`Add teacher-assigned lesson assessments`).
- Applied live migration `0017_assessment_expansion.sql`.
- Deployed `assessment-admin` v1 with JWT verification enabled.
- Render is serving the assessment frontend bundle; `/quiz/:assessmentId` resolves through the SPA.

Live smoke:

- Used `teacher1@gmail.com` to create and publish a lesson quiz for `Jargon Pilot Class`.
- Quiz contained 2 MCQ questions and 1 text question.
- Assigned quiz to `student1@gmail.com`.
- Used `student1@gmail.com` to start and submit the quiz.
- MCQ items auto-graded.
- Text item remained `pending_review`.
- Used teacher account to review the text item and return final result.
- Student could read returned final score/feedback.
- `student2@gmail.com` could not read the assessment row.
- Anon REST access to `assessments` returned `401`.

Smoke IDs:

- Assessment: `868b7d6f-8555-49d4-816d-559821106691`
- Attempt: `e884e5b7-57bb-446f-8b62-7e537d046efc`
- Class: `5e986a8c-fe96-498d-bb88-3c8f14379a1a`
- Student: `60dd869f-2cae-474f-bd14-4c5a76bb8428`

Data checks:

- `assessments`: 1 row for smoke quiz.
- `assessment_items`: 3 rows.
- `assessment_recipients`: 1 row.
- `assessment_attempts`: 1 row.
- `assessment_item_attempts`: 3 rows.
- `learning_evidence`: 1 assessment-backed row.
- `student_mastery`: 3 assessment skill rows.

Regression notes:

- Direct Render engine `/health` and `/run` are healthy.
- First signed Supabase `run` call timed out while the free Render engine was waking; retry after direct engine wake returned `["2"]`.
- Existing run/chat infrastructure remains unchanged by this assessment slice.

## Codex -> Claude / Human - 2026-06-23 23:59

Status: Assessment Expansion v1 implemented repo-side; live activation pending

What changed:

- Added migration `0017_assessment_expansion.sql`.
- Added grouped assessment tables:
  - `assessments`
  - `assessment_items`
  - `assessment_recipients`
  - `assessment_attempts`
  - `assessment_item_attempts`
- Added RLS and explicit Data API grants for authenticated/service-role access; anon access is revoked.
- Added JWT-protected `assessment-admin` Edge Function with:
  - `create_assessment`
  - `set_assessment_status`
  - `start_assessment`
  - `submit_assessment`
  - `review_assessment_item`
  - `return_assessment`
- Added teacher UI in `/teacher` for creating/publishing/archiving lesson quizzes, assigning recipients, reviewing text/code items, and returning final results.
- Added student `/quiz/$assessmentId` dedicated quiz page.
- Added `/chat` assessment dock so assigned lesson quizzes appear alongside lesson work.
- Existing chat checkpoint quizzes remain on `quiz_attempts`.

Live activation steps:

1. Apply only `supabase/migrations/0017_assessment_expansion.sql`.
2. Deploy `assessment-admin`.
3. Let Render deploy the frontend bundle.
4. Live-smoke: teacher creates a quiz with 2 MCQ + 1 text question, assigns it to a pilot student, student completes `/quiz/$assessmentId`, teacher reviews text answer and returns final score.

Notes:

- I attempted to use the Supabase CLI-generated migration path, but CLI/version discovery was blocked in this sandbox. The migration follows the repo's existing numbered migration convention.
- No live Supabase changes have been applied in this implementation pass.

## Codex -> Claude / Human - 2026-06-23 23:59

Status: Media Polish v3 live smoke passed with one resource-card ordering note

What changed live:

- GitHub `main` is at `8ba2afa` (`Add PDF page previews and OCR`).
- Applied live migration `pdf_page_assets_ocr`.
- Deployed `resource-processing` v3 with JWT verification enabled.
- Deployed `chat` v11 pinned to GitHub commit `8ba2afa`.

Browser smoke:

- Signed in as `teacher1@gmail.com`.
- Created published PDF resource `OCR Smoke Scanned PDF` for `lesson1`.
- Uploaded generated scanned PDF `/tmp/jargon-scanned-ocr-test.pdf`.
- Ran `Generate page previews`; UI showed `1 rendered page`, `1 OCR image`, and a page preview.
- Ran `OCR scanned pages`; UI created one draft OCR chunk.
- Approved the OCR chunk.
- Signed in as `student1@gmail.com`.
- Asked Mentor about the scanned PDF; Mentor used the approved OCR content in its reply:
  - "a good reason clearly supports a claim, and evidence helps others check the reason."

Live data:

- Resource: `5fe84af6-d8d0-41df-850e-77a819cab61a`
- `resource_processing_jobs`: `pdf_page_render` complete, `pdf_ocr` complete.
- `resource_text_chunks`: one approved page-1 document chunk.
- `lesson_resources.thumbnail_path` populated with a private derived thumbnail path.

Note:

- The student chat initially surfaced an older `lesson1` resource card because the chat response currently returns one resource card ordered by creation time. The OCR resource still reached Mentor context correctly once approved. A future polish pass should let the student browse all lesson resources or prioritize newer/teacher-selected resources.

## Codex -> Claude / Human - 2026-06-23 23:08

Status: Media Processing v2 live smoke passed via deployed API path

What passed:

- Confirmed the deployed `resource-processing` function can transcribe an uploaded audio resource through OpenAI.
- Created a safe synthetic audio resource for `lesson2` in `Jargon Pilot Class`.
- Transcribed it successfully into one draft transcript chunk.
- Approved the transcript chunk.
- Recorded a student `resource_interactions.opened` event.
- Called live `chat` as a student; Mentor used the approved audio transcript context in its reply.

Smoke IDs:

- Class: `5e986a8c-fe96-498d-bb88-3c8f14379a1a` (`Jargon Pilot Class`)
- Lesson: `lesson2`
- Audio resource: `a40fbc2d-ba8a-4f04-af5c-c71e3e035791`
- Processing job: `b0f0662f-277f-4c1f-99f5-163b909f01aa`
- Resource interaction: `b49f7ce0-7df5-476f-8e68-b9e119207936`

Result:

- `resource_processing_jobs.status = complete`
- `resource_text_chunks.status = approved`
- `resource_text_chunks.source_kind = audio`
- transcript preview: "A good reason explains why a claim makes sense."
- `chat.status = ok`, `chat.stage = complete`, `chat.next_action = complete`

Notes:

- I avoided uploading any private local files from Downloads. The first generated audio attempt was empty; regenerating with the local speech service outside the sandbox produced a valid 2.7s synthetic WAV.
- Prior PDF extraction/approval path was already verified through the live function. Browser click-through for the teacher UI remains a useful manual QA item, but the live backend/media contract is working.
- Video is covered by the same `transcribe_media_resource` code path and file validation, but this smoke used audio to avoid needing a large/private sample file.

## Codex -> Claude / Human - 2026-06-23 22:45

Status: Media Processing v2 Edge Functions deployed; browser media smoke pending

What changed live:

- Deployed `resource-processing` from GitHub commit `1333159`.
- Deployed `chat` from GitHub commit `1333159`.
- Kept JWT verification enabled on both functions.

Live versions:

- `resource-processing`: version 2, ACTIVE.
- `chat`: version 10, ACTIVE.

Verification:

- `resource-processing` unauthenticated request returns expected `401 UNAUTHORIZED_NO_AUTH_HEADER`.
- `chat` unauthenticated request returns expected `401 UNAUTHORIZED_NO_AUTH_HEADER`.
- `https://jargon-9bv5.onrender.com/chat` returns `200` and serves the app shell.
- Existing migration `media_transcription` was already applied successfully.

Still pending for acceptance:

- Browser smoke with a real teacher account:
  - upload/open PDF -> extract text -> approve chunk;
  - upload small audio/video under 25 MB -> transcribe -> approve chunk;
  - student opens lesson/resource;
  - Mentor cites approved PDF page or media time range.

## Codex -> Claude / Human - 2026-06-23 22:20

Status: Media Processing v2 implemented and pushed; DB migration live; Edge Function deploy blocked by missing local Supabase access token

What changed:

- Added migration `0015_media_transcription.sql`:
  - expands `resource_processing_jobs.job_type` to include `audio_transcription` and `video_transcription`;
  - adds transcript metadata to `resource_text_chunks`: `source_kind`, `start_seconds`, `end_seconds`, `confidence`;
  - keeps anon access revoked.
- Extended `resource-processing`:
  - new `transcribe_media_resource` action for uploaded `audio`/`video`;
  - validates OpenAI-supported file types: `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, `webm`;
  - rejects files over 25 MB;
  - uses `OPENAI_API_KEY` server-side only;
  - saves transcript chunks as `draft` for teacher review.
- Extended `/teacher` resource manager:
  - uploaded PDFs still show `Extract PDF text`;
  - uploaded audio/video now show `Transcribe audio` / `Transcribe video`;
  - review UI labels audio/video chunks by timestamp instead of page.
- Extended `chat` Mentor context:
  - still loads only `approved` resource chunks;
  - PDF/document chunks can be cited by title/page;
  - audio/video chunks can be cited by title/time range.
- Updated `docs/MEDIA_PROCESSING.md`, roadmap docs, and static media tests.

Verification:

- Commit: `a4ccbe5` (`Add audio video resource transcription`).
- Pushed GitHub `main`: success.
- Applied Supabase migration `media_transcription` to project `qztpieiizmiayzjhezwh`: success.
- Local checks:
  - `python3 -m unittest tests/test_media_processing.py -q` -> passed.
  - `python3 -m unittest discover -s tests -q` -> 143 tests passed, 4 skipped.
  - `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
  - `cd frontend && npx tsc --noEmit` -> passed.
  - `cd frontend && npm run lint` -> passed with existing warnings only.
  - `cd frontend && npm run build` -> passed.
  - `git diff --check` -> passed.

Deploy blocker:

- Local `supabase` CLI is not installed.
- `npx supabase` works, but deploy failed because no `SUPABASE_ACCESS_TOKEN` is available:
  `Access token not provided. Supply an access token by running supabase login or setting the SUPABASE_ACCESS_TOKEN environment variable.`

Required next live step:

```bash
cd /Users/elias/Documents/Codex/2026-06-15/heres-the-jargon-interpreter-code-this/jargon-rebuild
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy resource-processing --project-ref qztpieiizmiayzjhezwh
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy chat --project-ref qztpieiizmiayzjhezwh
```

Then live-smoke:

- Teacher uploads/transcribes a small audio/video file under 25 MB.
- Draft transcript chunks appear in `/teacher`.
- Teacher approves one chunk.
- Student opens the lesson/resource in `/chat`.
- Mentor references the approved transcript context with title/time range.

## Codex -> Claude / Human - 2026-06-23 21:23

Status: Google Classroom OAuth acceptance attempted; blocked on missing Google OAuth secrets

What was verified:

- Repo is clean on `main` through `c8f95b8`.
- Live `google-classroom` Edge Function still rejects unauthenticated requests with
  `401 UNAUTHORIZED_NO_AUTH_HEADER`.
- Signed in as the platform admin and successfully reached the live `google-classroom`
  function with action `start_oauth`.
- The function returned the expected controlled configuration error:
  `Google Classroom OAuth is not configured. Set GOOGLE_CLASSROOM_CLIENT_ID,
  GOOGLE_CLASSROOM_CLIENT_SECRET, GOOGLE_CLASSROOM_REDIRECT_URI, and
  GOOGLE_TOKEN_ENCRYPTION_KEY.`

Blocker:

- The Google Cloud OAuth client credentials have not been set as Supabase Edge Function secrets.
- No `GOOGLE_CLASSROOM_*` or `GOOGLE_TOKEN_*` values are available in the local environment.

Next action:

- Create/use a Google Cloud OAuth web client with authorized redirect URI
  `https://jargon-9bv5.onrender.com/admin`.
- Set Supabase Edge Function secrets:
  - `GOOGLE_CLASSROOM_CLIENT_ID`;
  - `GOOGLE_CLASSROOM_CLIENT_SECRET`;
  - `GOOGLE_CLASSROOM_REDIRECT_URI=https://jargon-9bv5.onrender.com/admin`;
  - `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- Retry browser smoke:
  connect Google Classroom -> load courses -> preview roster -> import course -> verify `/teacher`.

## Codex -> Claude / Human - 2026-06-23 21:06

Status: Google Classroom roster-import spike implemented, pushed, migrated, deployed; OAuth smoke pending Google secrets

What changed:

- Added Google Classroom integration schema:
  - `google_classroom_connections`;
  - `google_classroom_course_mappings`;
  - `google_classroom_user_mappings`;
  - `google_classroom_sync_runs`.
- Added JWT-protected Supabase Edge Function `google-classroom`.
- Added `/admin` Google Classroom panel:
  - connect Google Classroom;
  - load courses;
  - preview teacher/student rosters;
  - import a course into a Jargon class;
  - map existing users by email;
  - disconnect a connection;
  - view recent sync runs.
- Kept v1 intentionally narrow:
  - read-only course/roster/profile scopes only;
  - no Google assignment creation;
  - no grade passback;
  - no Google-driven account creation;
  - Jargon remains source of truth for learning records.
- Added `docs/GOOGLE_CLASSROOM_INTEGRATION.md` and static integration tests.

Verification:

- Implementation commit: `0844b43` (`Add Google Classroom roster import`).
- Pushed GitHub `main` through `0844b43`.
- Applied Supabase migration `google_classroom_integration` to project `qztpieiizmiayzjhezwh`: success.
- Live DB check confirmed all Google Classroom tables exist with RLS enabled:
  - `google_classroom_connections`;
  - `google_classroom_course_mappings`;
  - `google_classroom_user_mappings`;
  - `google_classroom_sync_runs`.
- Deployed Supabase Edge Function:
  - `google-classroom` version `1`, status `ACTIVE`, `verify_jwt=true`,
    deployment hash `3d37b272327cc9a6d2fb7dc60e419e5340002272622ec97ab396e0b5a73a8ca1`.
- Unauthenticated `POST /functions/v1/google-classroom` returned `401 UNAUTHORIZED_NO_AUTH_HEADER`.
- Render live bundle at `https://jargon-9bv5.onrender.com/admin` contains:
  - `google-classroom`;
  - `Google Classroom`;
  - roster preview/import UI strings.
- Local checks passed:
  - `cd frontend && npx tsc --noEmit`;
  - `cd frontend && npm run lint` with the existing 11 warnings;
  - `cd frontend && npm run build`;
  - `python3 -m unittest discover -s tests -q`;
  - `python3 tools/validate_examples.py examples legacy/examples`;
  - `git diff --check`.
- Official Google docs reviewed for resource model, OAuth flow, and narrow Classroom scopes:
  - Classroom REST reference;
  - Classroom auth scopes;
  - Google OAuth web server flow.

Live OAuth smoke still needed:

- Set Edge Function secrets:
  - `GOOGLE_CLASSROOM_CLIENT_ID`;
  - `GOOGLE_CLASSROOM_CLIENT_SECRET`;
  - `GOOGLE_CLASSROOM_REDIRECT_URI` (the admin callback URL);
  - `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- Browser smoke:
  - teacher/org-admin connects Google Classroom;
  - courses load;
  - roster preview marks matched vs needs-seed users;
  - import creates/maps one Jargon class;
  - teacher sees imported class in `/teacher`.

## Codex -> Claude / Human - 2026-06-23 20:36

Status: Media Processing / Mentor Context v1 implemented, pushed, migrated, deployed, and API-smoked

What changed:

- Added PDF-first media processing schema:
  - `resource_processing_jobs`;
  - `resource_processing_errors`;
  - `resource_text_chunks`.
- Added JWT-protected Supabase Edge Function `resource-processing`.
- Added teacher resource manager controls in `/teacher`:
  - `Extract PDF text`;
  - review/edit chunks;
  - approve/reject/delete chunks.
- Added browser-side PDF extraction through `pdfjs-dist`.
- Updated `chat` so Mentor can load only `approved` resource chunks as bounded private context.
- Added `docs/MEDIA_PROCESSING.md` and static tests.

Verification:

- Implementation commit: `72024ec` (`Add PDF resource processing`).
- Pushed GitHub `main` through `72024ec`.
- Applied Supabase migration `media_processing` to project `qztpieiizmiayzjhezwh`: success.
- Deployed Supabase Edge Functions:
  - `resource-processing` version `1`, status `ACTIVE`, `verify_jwt=true`,
    deployment hash `30b9599769b0f35eb37c09c005107b0a54009c5747ca8f50d794df4c68311588`;
  - `chat` version `9`, status `ACTIVE`, `verify_jwt=true`,
    deployment hash `f97c8d440fd50bf74b02ac242b1c1dbc1099cc5c2d4f8ef1c39d9bc57d922708`.
- Live DB check confirmed all new tables exist with RLS enabled and policies present.
- Unauthenticated `POST /functions/v1/resource-processing` returned `401 UNAUTHORIZED_NO_AUTH_HEADER`.
- Render live bundle at `https://jargon-9bv5.onrender.com/teacher` contains:
  - `resource-processing`;
  - `Extract PDF text`;
  - PDF worker asset reference.
- Credentialed API smoke using existing published PDF resource for `lesson1`:
  - teacher saved one extracted draft chunk through `resource-processing`;
  - teacher approved it;
  - student REST/RLS read returned one approved chunk.
- Local checks:
  - `cd frontend && npx tsc --noEmit`: passed;
  - `cd frontend && npm run lint`: passed with existing 11 warnings;
  - `cd frontend && npm run build`: passed;
  - `python3 -m unittest discover -s tests -q`: passed;
  - `python3 tools/validate_examples.py examples legacy/examples`: passed;
  - `git diff --check`: passed;
  - `deno --version`: unavailable locally (`deno` not installed).

Remaining browser smoke:

- Teacher opens `/teacher`, uploads or opens a PDF resource, clicks `Extract PDF text`,
  reviews and approves chunks through the UI.
- Student opens the lesson/resource in `/chat` and confirms Mentor can naturally cite the
  approved PDF title/page during the lesson.

Next roadmap slice if browser smoke passes:

- School integrations/readiness planning and first integration spike for Google Classroom,
  Clever/ClassLink, or Canvas.

## Codex -> Claude / Human - 2026-06-23 16:35

Status: Cost/Model Dashboard v1 implemented, pushed, deployed, and boundary-smoked

What changed:

- Extended `admin-ops` with read-only action `list_cost_model_dashboard`.
- Dashboard is scoped by existing admin rules:
  - platform admins see all organizations/classes plus estimated dollar cost;
  - org admins see only their organization usage/reliability and no dollar-cost totals.
- Aggregates existing telemetry:
  - `model_usage_events`;
  - `runtime_events`;
  - `speech_usage_events`;
  - `learning_sessions`.
- `/admin` now has an `AI/runtime operations` section with:
  - estimated cost;
  - total tokens;
  - model event count;
  - average latency;
  - error count/rate;
  - model breakdown;
  - task type breakdown;
  - class operating load;
  - recent model events;
  - recent runtime errors.
- Added `docs/COST_MODEL_DASHBOARD.md`.
- Updated `docs/ROADMAP.md` to mark Cost/Model Dashboard v1 as implemented repo-side.

Verification:

- Implementation commit: `f634aa4` (`Add cost model dashboard`).
- Handoff commit: `dc07ffd` (`Record cost dashboard handoff`).
- Pushed GitHub `main` through `dc07ffd`.
- Deployed Supabase Edge Function `admin-ops` to project `qztpieiizmiayzjhezwh`:
  - version `3`;
  - status `ACTIVE`;
  - `verify_jwt=true`;
  - deployment hash `ee474ed617c62b24409f119da3cb4687fab5886c66084d09c421416cb13fbafd`.
- Confirmed Render live bundle at `https://jargon-9bv5.onrender.com/admin` contains:
  - `AI/runtime operations`;
  - `list_cost_model_dashboard`.
- Anonymous `POST /functions/v1/admin-ops` with `list_cost_model_dashboard` returned
  `401 UNAUTHORIZED_NO_AUTH_HEADER`.
- Authenticated `teacher1@gmail.com` call to `list_cost_model_dashboard` returned
  `403 Admin access is required`, confirming teachers remain blocked from `/admin` operations.
- `cd frontend && npx tsc --noEmit`: passed.
- `cd frontend && npm run lint`: passed with the existing 11 warnings.
- `cd frontend && npm run build`: passed.
- `python3 -m unittest discover -s tests -q`: passed.
- `python3 tools/validate_examples.py examples legacy/examples`: passed.
- `git diff --check`: passed.
- `deno check supabase/functions/admin-ops/index.ts`: unavailable locally (`deno` not installed).

Remaining browser smoke:

- Platform admin opens `/admin` and confirms `AI/runtime operations` loads with cost visible.
- Org admin opens `/admin` and confirms usage/reliability is scoped and cost reads `Hidden`.
- Complete one lesson, refresh metrics, and confirm sessions/completions update.
- Trigger one controlled Jargon error and confirm a runtime error appears.

## Codex -> Claude / Human - 2026-06-23 15:47

Status: School-readiness / Pilot Ops v1 implemented, pushed, and `admin-ops` deployed

What changed:

- Extended `admin-ops` with scoped read-only pilot operations:
  - `list_pilot_readiness`;
  - `export_class_snapshot`.
- Pilot readiness is deterministic and scoped by the same platform-admin/org-admin rules:
  - platform admins see all orgs/classes;
  - org admins see only their active organization scope.
- `/admin` now has a Pilot Readiness section with:
  - class status chips: `Ready`, `Needs setup`, `Needs attention`, `Blocked`;
  - class launch checklist;
  - roster/account health table;
  - recent runtime errors;
  - open interventions;
  - selected-class CSV export;
  - copyable login instructions that intentionally contain no passwords.
- `/teacher` now has a compact class readiness strip with roster count, open work, latest
  completions, open alerts, and runtime errors.
- Added `docs/PILOT_OPERATIONS.md` as the classroom launch runbook.
- Updated `docs/ROADMAP.md` so the next roadmap slice after deploy/live smoke is cost/model
  dashboards; media extraction and Voice v2 remain deferred.

Verification:

- Pushed commit `db25127` to GitHub `main`.
- Deployed Supabase Edge Function `admin-ops` to project `qztpieiizmiayzjhezwh`:
  - version `2`;
  - status `ACTIVE`;
  - `verify_jwt=true`;
  - deployment hash `58003eacdf5b0509d01e55a6a85906b7835cc10e36b8c4f81cdec9c2b39a7648`.
- Listed live Edge Functions and confirmed `admin-ops` is active alongside `chat`, `run`,
  `admin-seed`, and `curriculum-admin`.
- Anonymous `POST /functions/v1/admin-ops` with `list_pilot_readiness` returned
  `401 UNAUTHORIZED_NO_AUTH_HEADER`.
- Authenticated `teacher1@gmail.com` call to `list_pilot_readiness` returned
  `403 Admin access is required`, confirming non-admins remain blocked.
- `cd frontend && npx tsc --noEmit`: passed.
- `cd frontend && npm run lint`: passed with the existing 11 warnings.
- `cd frontend && npm run build`: passed.
- `python3 -m unittest discover -s tests -q`: passed.
- `python3 tools/validate_examples.py examples legacy/examples`: passed.
- `git diff --check`: passed.
- `deno check supabase/functions/admin-ops/index.ts`: unavailable locally (`deno` not installed).

Next live steps:

- Wait for Render to deploy the frontend.
- Live smoke:
  - platform admin opens `/admin` and confirms Pilot Readiness loads;
  - org admin opens `/admin` and sees only their organization;
  - export a class CSV and confirm no plaintext passwords;
  - copy login instructions and confirm they contain no passwords;
  - teacher opens `/teacher` and confirms the readiness strip;
  - student completes one lesson, then refresh readiness and confirm completion/support counts.

## Codex -> Claude / Human - 2026-06-23 15:20

Status: Admin Operations org-admin polish implemented, pushed, and `admin-ops` deployed

What changed:

- Extended `admin-ops` from platform-admin-only to scoped admin access:
  - platform admins keep global access;
  - active `organization_memberships.role = org_admin` users can manage only their own org scope.
- Added server-side authorization checks for each privileged operation:
  - org admins can create/update/archive classes inside their org;
  - add existing active org users to org classes;
  - reset passwords for users already in their org;
  - disable/reactivate class memberships;
  - change class roles between `student` and `teacher`;
  - only platform admins may grant/revoke `org_admin` or manage other organizations.
- Extended `admin-ops` responses with `actor_access` so `/admin` can display `Platform admin`
  or `Org admin` and hide global-only controls.
- Updated `/admin` so org admins can load the operations console while bulk roster seeding remains
  platform-admin-only.
- Kept service-role access inside Edge Functions only; no service-role material was added to the
  frontend.

Verification:

- Pushed commit `f391546` to GitHub `main`.
- Deployed Supabase Edge Function `admin-ops` to project `qztpieiizmiayzjhezwh`:
  - version `1`;
  - status `ACTIVE`;
  - `verify_jwt=true`;
  - deployment hash `cf3bf10597a7e391a994d02ded50245a83a533fa8d05f701260446e0d811e777`.
- Listed live Edge Functions and confirmed `admin-ops` is active alongside `chat`, `run`,
  `admin-seed`, and `curriculum-admin`.
- Anonymous `POST /functions/v1/admin-ops` returned `401 UNAUTHORIZED_NO_AUTH_HEADER`, confirming
  the live JWT boundary.
- `cd frontend && npx tsc --noEmit`: passed.
- `cd frontend && npm run lint`: passed with the existing 11 warnings.
- `cd frontend && npm run build`: passed.
- `python3 -m unittest discover -s tests -q`: passed.
- `python3 tools/validate_examples.py examples legacy/examples`: passed.
- `git diff --check`: passed.
- `deno check supabase/functions/admin-ops/index.ts`: unavailable locally (`deno` not installed).

Remaining live smoke:

- Wait for Render to deploy frontend commit `f391546`.
- Browser smoke:
  - platform admin completes the Admin Operations v1 smoke;
  - platform admin promotes one teacher to `org_admin`;
  - org admin signs in and sees only their organization;
  - org admin creates a class, adds existing org users, resets one password, disables/reactivates
    one class membership, and changes a class role;
  - confirm audit rows for sensitive operations.

## Codex -> Claude / Human - 2026-06-23 12:30

Status: Admin Operations v1 implemented repo-side

What changed:

- Added privileged Supabase Edge Function `admin-ops`.
  - Requires signed-in JWT.
  - Verifies caller in `public.platform_admins`.
  - Uses `SUPABASE_SERVICE_ROLE_KEY` only server-side.
  - Supports `list_admin_scope`, `create_class`, `update_class`, `reset_user_password`,
    `update_membership_status`, `update_membership_role`, and `add_existing_user_to_class`.
- Expanded `/admin` from seed-only into a pilot operations console:
  - organization/class/user summary;
  - class selector and roster view;
  - class create/rename/archive/reactivate;
  - add an already seeded user to a class;
  - change class membership role;
  - disable/reactivate class membership;
  - reset temporary passwords without storing plaintext;
  - recent seed batches and audit events.
- Added frontend `admin-ops` API/types and kept `admin-seed` as the bulk roster creation path.
- Updated `docs/ADMIN_SEEDED_PILOT.md` and `docs/ROADMAP.md`.
- Added static tests in `tests/test_admin_ops.py`.

Verification:

- `cd frontend && npx tsc --noEmit`: passed.
- `cd frontend && npm run lint`: passed with the existing 11 warnings.
- `cd frontend && npm run build`: passed.
- `python3 -m unittest discover -s tests -q`: passed.
- `python3 tools/validate_examples.py examples legacy/examples`: passed.
- `git diff --check`: passed.
- `deno check supabase/functions/admin-ops/index.ts`: not run because `deno` is unavailable
  in this workspace.

Next live steps:

- Deploy Supabase Edge Function `admin-ops` with existing Edge Function secrets:
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- Push/deploy the frontend bundle.
- Live smoke: platform admin creates/updates a class, adds an existing user, resets a student
  password, disables/reactivates a class membership, verifies teacher roster update, and confirms
  `audit_events` rows for sensitive actions.

## Codex -> Claude / Human - 2026-06-23 11:55

Status: Live Teacher Intervention smoke passed; realtime auth hardening pushed next

Live smoke result:

- Confirmed `https://jargon-9bv5.onrender.com` deployed bundle contains `Watch live`,
  `Teacher viewing`, `live_session_viewers`, and `teacher_live_comments`.
- Ran a two-client Supabase smoke with seeded accounts:
  - teacher: `teacher1@gmail.com`;
  - student: `student1@gmail.com`;
  - class id: `5e986a8c-fe96-498d-bb88-3c8f14379a1a`;
  - active session id: `73c6c5c7-d474-49e7-9288-e184ab17ac93`.
- Teacher started a live viewer row; student realtime subscription received the active viewer.
- Teacher sent smoke tip:
  `Smoke live teacher tip jwt 2026-06-23T11:45:55.606Z`.
- Student realtime subscription received the teacher comment.
- Teacher stopped watching; student realtime subscription received the inactive viewer update.
- Verified DB side effects:
  - `live_session_viewers.status = inactive`;
  - `teacher_live_comments.visibility = student_visible`;
  - exactly one `transcript_heatmap_events` row with `event_type = teacher_intervention`;
  - zero matching `learning_turns`, `lesson_attempts`, or `learning_evidence` rows.

Fix made after smoke:

- The first automated realtime attempt timed out until the student client explicitly set the
  session JWT on Supabase Realtime.
- Hardened frontend session helpers so `getSession`, `signIn`, and `onAuthStateChange` call
  `supabase.realtime.setAuth(session.access_token)`.
- Added a static regression assertion for the realtime auth hook.

Verification:

- `cd frontend && npx tsc --noEmit`: passed.
- `cd frontend && npm run lint`: passed with the existing 11 warnings.
- `cd frontend && npm run build`: passed.
- `python3 -m unittest discover -s tests -q`: passed.
- `python3 tools/validate_examples.py examples legacy/examples`: passed.
- `git diff --check`: passed.

Remaining browser QA:

- After Render deploys the follow-up frontend commit, manually confirm the visual UI flow in two
  browser contexts: teacher clicks `Watch live`, student sees `Teacher viewing`, teacher sends a
  tip, student sees the `Teacher` bubble.

## Codex -> Claude / Human - 2026-06-23 10:35

Status: Live Teacher Intervention v1 implemented; realtime migration applied live

What changed:

- Added teacher live-session helpers for starting, heartbeating, stopping, and sending
  student-visible teacher comments.
- Added `/teacher` controls:
  - `Watch live` / `Stop watching` on an active selected student session;
  - heartbeat every ~20 seconds while watching;
  - compact live teacher tip composer near the transcript;
  - alert actions for `acknowledged`, `resolved`, and `dismissed`.
- Added `/chat` realtime subscription for the active learning session:
  - student sees a `Teacher viewing` indicator when a recent active viewer row exists;
  - teacher comments render inline as distinct `Teacher` chat bubbles;
  - teacher comments do not become Mentor turns, grades, or evidence.
- Fixed intervention alert mapping to use the real SQL column `message`, not a non-existent
  `detail` field.
- Added migration `0012_live_teacher_intervention_realtime.sql` to add
  `live_session_viewers` and `teacher_live_comments` to the Supabase Realtime publication.

Live database:

- Applied `0012_live_teacher_intervention_realtime` to project `qztpieiizmiayzjhezwh`.
- Verified both `public.live_session_viewers` and `public.teacher_live_comments` are in
  publication `supabase_realtime`.

Verification:

- `cd frontend && npx tsc --noEmit`: passed.
- `cd frontend && npm run lint`: passed with the existing 11 warnings.
- `cd frontend && npm run build`: passed.
- `python3 -m unittest discover -s tests -q`: passed.
- `python3 tools/validate_examples.py examples legacy/examples`: passed.
- `git diff --check`: passed.

Next live QA:

- After Render deploys the frontend commit, sign in as `teacher1@gmail.com`, select an active
  student session, click `Watch live`, and confirm the student chat shows `Teacher viewing`.
- Send a teacher tip and confirm it appears inline in the student chat without refreshing.
- Stop watching and confirm the indicator clears after heartbeat expiry.

## Codex -> Claude / Human - 2026-06-23 09:50

Status: Teacher Analytics & Intervention Intelligence v1 implemented repo-side

What changed:

- Expanded `/teacher` with evidence-backed analytics:
  - class overview metrics for completion rate, average quiz score, assignment submission
    rate, and resource engagement;
  - class mastery heatmap from `student_mastery`;
  - deterministic `Needs Attention` signals from teacher alerts, quiz misses, retries/rescues,
    incomplete assignments, failed code runs, low mastery, and low activity;
  - student detail analytics with strongest/weakest skill, latest signal, and linked evidence
    context.
- Extended teacher data adapters to load:
  `resource_interactions`, `intervention_alerts`, `transcript_heatmap_events`,
  `runtime_events`, and `model_usage_events`.
- Added best-effort telemetry writes:
  - `chat` records runtime events for stage transitions, completions, retries, rescues,
    invalid Mentor JSON, and chat failures;
  - `chat` records `model_usage_events` for Mentor turns when OpenAI usage/latency is available;
  - `run` records runtime events for controlled Jargon errors and engine/config failures.
- No response-shape changes were made to `chat` or `run`.

Verification:

- `cd frontend && npx tsc --noEmit`: passed.
- `cd frontend && npm run lint`: passed with the existing 11 warnings.
- `cd frontend && npm run build`: passed.
- `python3 -m unittest discover -s tests -q`: passed.
- `python3 tools/validate_examples.py examples legacy/examples`: passed.
- `git diff --check`: passed.
- `deno check`: not run locally because `deno` is not installed in this environment.

Deployment note:

- Render will pick up the teacher analytics UI after the GitHub push.
- Supabase function `run` was deployed live as version 5 after the push, so controlled Jargon
  errors/failures can record `runtime_events`.
- Supabase function `chat` still needs deployment for stage/completion/retry/rescue and
  `model_usage_events` telemetry. Local `supabase` CLI is not logged in here; deploy with:
  `npx supabase functions deploy chat --project-ref qztpieiizmiayzjhezwh` after setting
  `SUPABASE_ACCESS_TOKEN`, or deploy the committed `supabase/functions/chat/index.ts` through
  the Supabase dashboard.
- Existing runtime contracts continue to work before the `chat` redeploy.

## Codex -> Claude / Human - 2026-06-23 09:40

Status: Phase 7 Multi-Subject Chat-LMS accepted live; Voice v2 still parked

Live acceptance result:

- Published the first non-coding pilot lesson through the real teacher/curriculum path:
  `Logic Foundations -> Clear Thinking -> Claims, Reasons, Evidence -> What Makes a Good Reason?`.
- Live lesson id:
  `pilot-school-logic-foundations-clear-thinking-v1-1-claims-reasons-evidence-what-makes-a-good-reason`.
- Attached and published one teacher-approved link resource:
  `Claim, Reason, Evidence Quick Guide`.
- Completed the lesson as seeded student `student2@gmail.com` through the normal typed `chat`
  orchestrator with no Jargon/code dependency.

Verified live records:

- `learning_sessions`: latest session is `complete`, stage `complete`, score `1`.
- `learning_turns`: 5 turns.
- `lesson_attempts`: 2 attempts (`text` discussion + `multiple_choice` quiz).
- `quiz_attempts`: 1 passed attempt, choice `b`, score `1`.
- `learning_evidence`: 1 evidence row.
- `student_mastery`: 4 logic skill summaries (`logic.clarity`, `logic.claims`,
  `logic.reasons`, `logic.evidence`).
- `resource_interactions`: `shown` and `opened`.

Notes:

- The direct resource write must use the same minimal-return pattern as the frontend
  resource manager; asking PostgREST to return a draft resource row immediately can trip
  RLS/representation behavior even though the normal UI write path is valid.
- The lesson menu grouping code for subject/course/unit is already pushed in commit `97b5f3f`.
- Recommended next slice: Phase 8 should be tightened around org/admin management and pilot
  operations only if needed for the school demo; otherwise move to Phase 9 media processing
  or Phase 10 analytics depending on demo priority.

## Codex -> Claude / Human - 2026-06-23 09:00

Status: Phase 7 implementation started; Voice v2 parked

What changed:

- Deferred Voice v2 live activation. The `voice-session` endpoint is intentionally not deployed
  until the OpenAI student voice/text processing boundary is explicitly approved.
- Updated the student lesson menu data path so `/chat` can group authored lessons by the real
  curriculum hierarchy instead of only the old `module` label.
- Updated the curriculum studio default draft to the first multi-subject slice:
  `Logic Foundations -> Clear Thinking -> Claims, Reasons, Evidence -> What Makes a Good Reason?`.
- This lesson is discussion-first, has no Jargon/code dependency, and targets claim/reason/evidence
  skill mastery.

Next acceptance target:

- Teacher saves and publishes the Logic Foundations lesson from `/teacher/curriculum`.
- Student sees it grouped under the Logic curriculum path in `/chat`.
- Student completes resource open, discussion answer, MCQ checkpoint, and lesson completion.
- Teacher sees transcript, quiz attempt, evidence, and mastery for the non-code lesson.

## Codex -> Claude / Human - 2026-06-23 00:00

Status: Voice v2 implemented locally; deploy/QA next

What changed:

- Added `0010_voice_realtime.sql` for OpenAI Realtime session records, private Mentor
  audio cache records, expanded voice event types, and private `mentor-audio-cache`
  storage bucket.
- Added Supabase Edge Function `voice-session`:
  - `realtime_session` bridges browser WebRTC SDP to OpenAI Realtime without exposing
    `OPENAI_API_KEY`;
  - `mentor_audio` generates OpenAI TTS audio and caches it privately behind signed URLs.
- Updated `/chat`:
  - new `Live voice` strip starts/stops realtime voice sessions;
  - realtime tool calls submit spoken answers through the existing typed `chat` orchestrator
    using `input_modality: "audio_session"`;
  - existing Mentor read-aloud now prefers cached OpenAI audio and falls back to browser speech.
- Updated student settings with live voice on/off and approved voice choices.
- Updated teacher transcript/attempt labels so audio-session work appears as `Voice`, separate
  from browser dictation.

Important contract:

- The Realtime model is not the source of truth for lesson state or grading. It must call
  `submit_voice_turn`; the frontend calls the existing `chat` Edge Function; then the realtime
  model speaks the returned Mentor reply.
- Raw student audio is still not stored by default.

Deployment needed:

- Apply `supabase/migrations/0010_voice_realtime.sql` live.
- Deploy Supabase Edge Function `voice-session`.
- Confirm Edge Function secrets include `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_URL`, and `SUPABASE_ANON_KEY`.
- Redeploy Render frontend after push.

## Codex -> Claude / Human - 2026-06-22 22:01

Status: Voice v1 live acceptance passed; Phase 7 is next

Live acceptance notes:

- GitHub `main` commit: `af98766` (`Polish voice dictation fallback`).
- Render static app is serving the updated Voice v1 bundle at
  `https://jargon-9bv5.onrender.com/chat`.
- Supabase `chat` remains active as version 8, JWT required.
- Render engine reliability gate still passes:
  - `/health` returns `{"service":"jargon-engine","status":"ok"}`;
  - direct `/run` with `PRINT 5 // 2` returns `output: ["2"]`.

Voice acceptance result:

- Student login smoke passed with `student2@gmail.com`.
- Student `/chat` shows mic control and read-aloud/replay controls.
- In the browser automation environment, mic access is blocked; the UI now degrades cleanly with:
  `Microphone access was blocked. Allow the mic in your browser settings, then try again.`
- Dictated-answer data path was live-smoked through the typed `chat` API:
  - `learning_turns.payload.input_modality = "dictated"`;
  - `lesson_attempts.input_modality = "dictated"`;
  - `transcript_confidence = null` is accepted and preserved.
- Student chat displays the submitted dictated answer with a `Dictated` chip.
- Mentor read-aloud button and replay button are present and clickable without console errors.
- `voice_interaction_events` records student UI events:
  `dictation_started`, `read_aloud_started`, and `read_aloud_finished`.
- Teacher dashboard smoke passed with `teacher1@gmail.com`:
  - active `s2` session transcript shows `Dictated`;
  - corresponding lesson attempt summary shows `Dictated - ungraded - score n/a`.
- Raw student audio is still not stored.

Verification:

- `python3 -m unittest discover -s tests -q` -> `114` tests passed, `4` skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with existing `11` warnings only.
- `cd frontend && npm run build` -> passed with existing large chunk warning.
- `git diff --check` -> passed.

Roadmap status:

- Voice v1 is accepted.
- Next build slice: Phase 7 Multi-Subject Chat-LMS.
- Recommended Phase 7 target: one non-coding, non-computer-science lesson path using
  text, MCQ, teacher resource, mastery evidence, and teacher visibility.

## Codex -> Claude / Human - 2026-06-22 21:42

Status: Reliability gate passed; Voice v1 implemented and deployed to `chat`

Reliability gate:

- `https://jargon-engine.onrender.com/health` returned
  `{"service":"jargon-engine","status":"ok"}` quickly.
- Direct engine `/run` smoke with `PRINT 5 // 2` returned `output: ["2"]`,
  `status: "ok"`.
- No Render engine code/config change was needed in this pass.

Voice v1 changes:

- GitHub `main` commit: `7be7233` (`Add student voice controls`).
- Supabase `chat` redeployed active as version 8, JWT required, pinned to commit `7be7233`.
- Student `/chat` composer now supports browser dictation where available:
  dictated text lands in the editable textbox before submit.
- Dictated text is sent through the existing typed chat contract with
  `input_modality: "dictated"` and optional `transcript_confidence`.
- Mentor messages now have read-aloud controls with play/pause/replay and slow/normal/fast
  speed settings.
- Voice preferences are local student settings: dictation on/off, read-aloud on/off,
  read speed.
- Teacher transcript and attempt summaries show a `Dictated` marker when a student submits
  dictated text.
- Voice telemetry writes lightweight `voice_interaction_events`; raw student audio is not
  stored.

Verification:

- `python3 -m unittest discover -s tests -q` -> `114` tests passed, `4` skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with existing `11` warnings only.
- `cd frontend && npm run build` -> passed with existing large chunk warning.
- `git diff --check` -> passed.

Next QA:

- Wait for Render static deploy of `7be7233`.
- Browser-smoke `/chat` as a student:
  mic button appears or degrades cleanly, dictated text can be edited/submitted,
  Mentor read-aloud works where `speechSynthesis` is available.
- Verify a teacher sees `Dictated` on the corresponding turn/attempt.

## Codex -> Claude / Human - 2026-06-22 20:00

Status: Curriculum Authoring Studio v1 live acceptance passed

Live deploy / fix notes:

- GitHub `main` commit: `55a56f8` (`Advance authored discussion lessons`).
- Supabase `chat` redeployed active as version 7, JWT required, pinned to commit `55a56f8`.
- Supabase `curriculum-admin` redeployed active as version 2, JWT required, pinned to commit `55a56f8`.
- Acceptance fix included:
  - authored text/file discussion answers now advance to MCQ assessment or completion instead
    of drifting into open chat;
  - publishing an authored lesson also publishes attached draft lesson resources.

Accepted live lesson:

- Subject: `Computer Science Foundations`
- Course: `Before Coding`
- Unit: `Instructions and Systems`
- Lesson: `What Is An Instruction?`
- Lesson id:
  `pilot-school-computer-science-foundations-before-coding-v1-1-instructions-and-systems-what-is-an-instruction`
- Resource: `Clear Instruction Example` (`link`, published, attached to the lesson).
- Teacher: `teacher1@gmail.com`
- Student smoke account: `student2@gmail.com`

Live acceptance result:

- Teacher created/saved/published the lesson through `/teacher/curriculum`.
- Draft lesson was hidden from `/chat` before publish.
- Published lesson appeared in `/chat` under the authored unit grouping.
- Mentor surfaced the attached resource card in the student lesson.
- Student opened the resource.
- Student answered the discussion prompt.
- Chat advanced to the MCQ checkpoint.
- Student selected the correct choice.
- Session completed with `status = complete`, `stage = complete`, `score = 1`.
- Teacher dashboard shows `s2` with `Completed: What Is An Instruction?`,
  `complete - complete - score 100%`.

Live records verified:

- `learning_sessions`: complete session written.
- `learning_turns`: 5 turns written, including practice, assessment, and complete stages.
- `lesson_attempts`: 2 attempts written (`text`, then `multiple_choice`).
- `quiz_attempts`: 1 passed quiz attempt written.
- `learning_evidence`: 1 quiz-backed evidence row written.
- `student_mastery`: 2 skill mastery rows updated (`cs.instructions`, `logic.clarity`).
- `resource_interactions`: `shown` and `opened` events written.

Verification:

- `python3 -m unittest discover -s tests -q` -> `113` tests passed, `4` skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with existing `11` warnings only.
- `cd frontend && npm run build` -> passed with existing large chunk warning.
- `git diff --check` -> passed.

Roadmap status:

- Phase 6, Curriculum Authoring Studio v1, is accepted.
- Next build slice can be Voice v1: browser dictation + Mentor read-aloud, unless the human
  chooses to harden curriculum authoring further first.

## Codex -> Claude / Human - 2026-06-22 18:30

Status: Curriculum Authoring Studio v1 implemented, pushed, and `curriculum-admin` deployed

Context:

- Human confirmed the assignment workflow works flawlessly, so Phase 5 is accepted.
- Next roadmap slice is Phase 6: structured curriculum authoring.
- GitHub `main` commit: `4d082ee`.
- Supabase project `qztpieiizmiayzjhezwh`: `curriculum-admin` deployed active, version 1, JWT required.

Repo changes:

- Added `supabase/functions/curriculum-admin` as the privileged curriculum write path.
  - Requires a signed-in user.
  - Verifies platform admin, org admin, org teacher, or class teacher scope.
  - Uses `SUPABASE_SERVICE_ROLE_KEY` only inside the Edge Function.
  - Supports `save_lesson_blueprint`, `publish_lesson`, and `archive_lesson`.
  - Writes existing curriculum tables: subjects, courses, course versions, units, lessons,
    milestones, lesson activities, quiz items, completion rules, and resource placements.
- Added `/teacher/curriculum`.
  - Teacher class scope selector.
  - Subject/course/unit/lesson tree.
  - Lesson blueprint editor for non-coding or coding lessons.
  - Milestone, activity, MCQ quiz, rubric notes, resource attachment, and preview panel.
  - Save draft, publish, and archive actions.
- Student/runtime integration:
  - Student lesson fetch now hides draft/archived lessons.
  - Teacher dashboard still loads drafts with `includeDrafts`.
  - Repo `chat` edge function now rejects non-published lessons; deploy `chat` when doing the live smoke if server-side draft enforcement is required beyond the frontend picker.
  - Student lesson menu groups by lesson module/unit label.

Verification:

- `python3 -m unittest discover -s tests -q` -> `113` tests passed, `4` skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with the existing `11` warnings only.
- `cd frontend && npm run build` -> passed with the existing large chunk warning.
- `git diff --check` -> passed.
- `deno check supabase/functions/curriculum-admin/index.ts` -> unavailable locally (`deno` command not found).

Next live smoke after deploy:

1. Sign in as `teacher1@gmail.com`.
2. Open `/teacher/curriculum`.
3. Create a small non-coding “computer science before coding” lesson.
4. Add one milestone, one discussion activity, one MCQ quiz, and one resource.
5. Save draft, publish it, then confirm it appears in `/chat`.
6. Assign it from `/teacher`.
7. Sign in as a student, complete it through chat, and confirm teacher evidence appears.

## Codex -> Claude / Human - 2026-06-22 17:15

Status: Assignments End-To-End v1 implemented locally; ready for deploy/live smoke

Repo changes:

- Added typed assignment models for assignments, recipients, submissions, submission files, and
  student assignment bundles.
- Extended the frontend Supabase API helpers to:
  - load assignments/recipients/submissions/files into the teacher dashboard
  - create teacher-authored assignments for selected students
  - link existing lesson resources to assignments
  - update assignment status between draft/assigned/archived
  - load assigned student work in `/chat`
  - submit text/code/file work to `assignment_submissions` and private `student-submissions`
    storage
  - teacher-review submissions as complete/returned, update recipient state, and create
    assignment-backed `learning_evidence`
  - open private submission files through signed URLs
- Added an `Assignments` manager to `/teacher` class detail:
  - lesson/resource-linked assignment builder
  - whole-class or selected-student recipients
  - due date and draft/assigned status
  - assignment list with recipient status
  - submission review with score, feedback, file opening, mark complete, and return actions
- Added a student assignment dock to `/chat`:
  - shows assigned work for the active lesson
  - displays latest teacher feedback/score
  - supports text, code, and file submissions
  - leaves the normal Mentor composer unchanged

Verification:

- `python3 -m unittest discover -s tests -q` -> `107` tests passed, `4` skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with the existing `11` warnings only.
- `cd frontend && npm run build` -> passed with the existing large chunk warning.
- `git diff --check` -> passed.

Next live smoke after deploy:

1. Teacher creates an assignment for `lesson1`, links an existing resource, assigns it to
   `student1@gmail.com`.
2. Student opens `/chat`, sees the assignment dock for `lesson1`, submits text/code and one file.
3. Teacher opens `/teacher`, reviews the submission, opens the private file, marks complete with
   score/feedback.
4. Student sees returned feedback/score.
5. Confirm rows exist in `assignments`, `assignment_recipients`, `assignment_submissions`,
   `assignment_submission_files`, and assignment-backed `learning_evidence`.

## Codex -> Claude / Human - 2026-06-22 16:56

Status: Resource-backed Lesson v1 live QA passed; frontend resource create/update fix deployed

Live QA:

- Signed in successfully as the seeded teacher and student accounts.
- Confirmed `teacher1@gmail.com` is a teacher in `Jargon Pilot Class`.
- Found the first real bug in the resource manager path:
  - direct teacher insert into `lesson_resources` with `Prefer: return=minimal` succeeds
  - insert with `return=representation` fails RLS with `42501`
  - the frontend had been using `.insert(...).select("*").single()`, so the UI would fail
- Patched the frontend helper to:
  - generate the resource id client-side
  - insert the resource with minimal return
  - fetch the created row in a separate select
  - use the same update-then-fetch pattern for resource updates

Live resource smoke:

- Created and published two class-private resources for `lesson1`:
  - YouTube/link resource
  - uploaded PDF resource in private `lesson-resources` storage
- Confirmed `chat` surfaced the published resource for `student1@gmail.com`.
- Inserted student resource interaction events: `shown` and `opened`.
- Continued the same session through Jargon run, assessment quiz, and lesson completion.
- Verified session `9b3643f1-bce3-40a0-a0b0-e2c2d1281757` is now `status=complete`,
  `stage=complete`, `score=1`.
- Verified live smoke counts:
  - `2` smoke resources
  - `2` placements
  - `2` resource interactions
  - `1` uploaded smoke PDF file
- Cleaned up the temporary unplaced `RLS diagnostic` draft resource created during diagnosis.

Verification:

- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with existing warnings only.
- `cd frontend && npm run build` -> passed with the existing large chunk warning.
- `python3 -m unittest discover -s tests -q` -> `107` tests passed, `4` skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
- `git diff --check` -> passed.

Deploy:

- Pushed frontend fix commit `8e2d7c6`.
- Confirmed Render is serving fixed bundle `index-BxjOD8N5.js`.

Next:

- Browser smoke the `/teacher` UI:
  - create a new resource from the UI
  - publish/archive it
  - confirm it remains visible in the teacher resource list
- After that, Resource-Backed Lesson v1 is accepted and the next roadmap slice should be
  Assignments End-To-End v1.

## Codex -> Claude / Human - 2026-06-22 16:32

Status: Resource-backed Lesson v1 implemented; live `chat` edge function deployed

Repo changes:

- Added lesson resource types and frontend API helpers for:
  - private Supabase Storage uploads to `lesson-resources`
  - external YouTube/link resources
  - resource metadata rows in `lesson_resources`
  - placement rows in `lesson_resource_placements`
  - signed URL open flow for uploaded resources
  - student resource interaction events in `resource_interactions`
- Added a `Lesson resources` manager inside `/teacher` class detail:
  - create/edit resource metadata for a selected lesson
  - upload PDF/video/audio/image/document files
  - add external YouTube/link resources
  - draft/published/archived status control
  - class-private default visibility
  - open/edit/publish/archive actions
- Extended `/chat` to render optional typed-chat `resources` as inline resource cards:
  - PDF/image/video/audio inline preview where practical
  - file/link fallback opens in a new tab
  - YouTube uses `youtube-nocookie.com` embed URLs
  - records `shown`, `opened`, `played`, `paused`, and `completed` events
- Updated `supabase/functions/chat/index.ts` so the orchestrator:
  - loads published lesson resources and recent resource interactions
  - includes teacher-approved resource metadata in Mentor context
  - returns at most one resource card in the typed envelope
  - keeps old typed responses valid when no resources exist
  - never asks the AI to claim a resource was viewed unless interaction records prove it

Live:

- Confirmed `lesson_resources`, `lesson_resource_placements`, and `resource_interactions`
  exist live.
- Confirmed private buckets `lesson-resources` and `student-submissions` exist live.
- Deployed Supabase `chat` edge function version `6` with `verify_jwt=true`.

Verification:

- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with existing warnings only.
- `cd frontend && npm run build` -> passed with the existing large chunk warning.
- `python3 -m unittest discover -s tests -q` -> `107` tests passed, `4` skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
- `git diff --check` -> passed.
- `deno check supabase/functions/chat/index.ts` was unavailable locally (`deno` not installed);
  deployment succeeded through Supabase MCP.

Next:

- Push/deploy the frontend commit, then browser smoke:
  1. Sign in as `teacher1@gmail.com`.
  2. Open `/teacher`, choose a class, upload/publish a PDF or add a YouTube/link resource for
     `lesson1`.
  3. Sign in as a student, open `lesson1`, confirm Mentor surfaces the resource card.
  4. Open/play the resource and confirm `resource_interactions` records the event.
- If this passes, the next roadmap slice should be assignment foundations or resource polish
  (teacher-authored resource preview/list filters), not new schema.

## Codex -> Claude / Human - 2026-06-22 16:20

Status: Teacher completion visibility live-verified; Teacher Dashboard v1.1 hardening added

Live QA:

- Confirmed `https://jargon-9bv5.onrender.com/teacher` serves the deployed Vite bundle
  `index-2tCoPF2o.js`, and that bundle contains the `Lesson Progress` completion-visibility fix.
- Confirmed live Supabase still has `teacher1@gmail.com` assigned as teacher to all 4 pilot
  classes.
- Confirmed live Supabase has `student1@gmail.com` in the exact mixed state that caused the UI
  confusion:
  - `lesson1` / `Purpose`: `status=complete`, `stage=complete`, `score=1`
  - `lesson2` / `Systems & Signals`: active newer session
  - `lesson3` / `Signal Processing`: active session
- Confirmed teacher-shaped RLS read as `teacher1@gmail.com` can see student1 runtime records:
  `3` sessions, `1` completed Purpose session, `11` turns, `4` attempts, `1` quiz attempt,
  `3` evidence rows, and `3` mastery rows.

Repo changes:

- Added a gradebook-first section to `/teacher` class detail:
  - all-lessons summary by student
  - lesson filter
  - score, attempts, quiz attempts, evidence, mastery, latest activity
  - simple `Needs attention` chip from failed attempts/quizzes or retry/rescue sessions
  - direct `Inspect` action per student
- Kept the previous roster and `Lesson Progress` matrix.
- Improved student detail so transcript, lesson attempts, quiz attempts, and evidence follow the
  selected session instead of mixing records from later active lessons into the completed Purpose
  inspection view.

Verification:

- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with existing warnings only.
- `cd frontend && npm run build` -> passed with the existing large chunk warning.
- `python3 -m unittest discover -s tests -q` -> `106` tests passed, `4` skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
- `git diff --check` -> passed.

Next:

- Push/deploy this dashboard hardening.
- Browser smoke as `teacher1@gmail.com`: confirm the gradebook shows `student1` with `1/10 complete`
  and the Purpose session is inspectable without the newer lesson2 active session hiding it.
- After this passes, the next product slice should be assignment/resource foundations, not more
  teacher visibility plumbing.

## Codex -> Claude / Human - 2026-06-22 15:43

Status: Teacher Dashboard v1 built; live RLS blocker fixed

Live smoke / correction:

- Confirmed through live Supabase that `teacher1@gmail.com` is assigned to all 4 `Pilot School`
  classes, and each class has `1` active teacher and `2` active students.
- Confirmed `student1@gmail.com` and `student2@gmail.com` currently have no lesson runtime
  records yet: `learning_sessions = 0`, `learning_turns = 0`, `lesson_attempts = 0`,
  `quiz_attempts = 0`, `learning_evidence = 0`, `student_mastery = 0`.
- Found a schema drift/RLS blocker before building the UI: `learning_sessions`,
  `learning_turns`, and `lesson_attempts` still only allowed owner reads from the original
  runtime migration. Teacher dashboards would have shown blank transcript/session/attempt data.
- Added and applied live `0011_teacher_runtime_read_policies.sql`, granting authenticated
  teachers/admins `SELECT` only on those runtime tables via `public.can_view_student(user_id)`.
  No teacher write policy was added.
- Verified live policies now exist for:
  - `Teachers can view managed learning sessions`
  - `Teachers can view managed learning turns`
  - `Teachers can view managed lesson attempts`

Repo changes:

- Expanded `/teacher` from a class shell into Teacher Dashboard v1:
  - teacher home metrics
  - class list and class detail
  - roster with latest session status
  - student detail
  - transcript viewer
  - lesson attempts
  - quiz attempts
  - learning evidence
  - student mastery
  - teacher notes create/list
- Added frontend adapters/types for teacher dashboard data using existing live tables:
  `classes`, `class_memberships`, `profiles`, `lessons`, `learning_sessions`,
  `learning_turns`, `lesson_attempts`, `quiz_attempts`, `learning_evidence`,
  `student_mastery`, and `teacher_notes`.

Verification:

- `python3 -m unittest discover -s tests -q` -> 106 passing, 4 skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files ok.
- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run lint` -> passed with existing warnings only.
- `cd frontend && npm run build` -> passed.
- `git diff --check` -> passed.

Not completed:

- Browser sign-in smoke as `teacher1@gmail.com` / `student1@gmail.com` is still pending because
  this session does not have the seeded temporary password. Next QA should sign in with the known
  pilot password, confirm `/teacher` shows the 4 classes, then complete `lesson1` as a seeded
  student and re-open `/teacher` to confirm the transcript/attempt/evidence panels populate.

Pushed:

- Dashboard/RLS repo commit: `46f5964` (`Build teacher dashboard v1`).
- GitHub `main` now contains the dashboard implementation and `0011` migration file.

Next action:

- Let Render deploy the frontend, then run the credential-backed live smoke:
  sign in as `teacher1@gmail.com`, confirm `/teacher` shows 4 classes, sign in as a seeded
  student, complete `lesson1`, then re-open `/teacher` to confirm learning panels populate.

## Codex -> Claude / Human - 2026-06-22 15:35

Status: Live pilot platform populated with multiple classes

Live data changes:

- Confirmed `Pilot School` exists (`7744763a-e160-446f-b5b1-6ceb092ff13b`).
- Confirmed original `Jargon Pilot Class` exists (`5e986a8c-fe96-498d-bb88-3c8f14379a1a`).
- Added three additional active classes under `Pilot School`:
  - `Grade 4 Logic Studio` (`78483eea-b2dc-4b6d-a6f6-92e81c585ef7`)
  - `Grade 6 Systems Thinking` (`46227c96-68f9-4cc2-932b-e9e0bd542fcc`)
  - `Grade 9 Computer Science Foundations` (`4afec3e9-dce7-4703-813f-27b10b0fe4a5`)
- Corrected the seeded teacher account from student membership to teacher membership:
  - `teacher1@gmail.com` is now `teacher` at org level and in all 4 classes.
- Added the two existing seeded students to all 4 classes:
  - `student1@gmail.com`
  - `student2@gmail.com`

Verified live:

- Each of the 4 classes now has `1` active teacher and `2` active students.
- `teacher1@gmail.com` has teacher membership in 4 classes.
- Each student has student membership in 4 classes.

Important note:

- This was a direct controlled Supabase population pass, not a new Auth-user seed. No new
  passwords were created or stored.
- The next live smoke is to sign in as `teacher1@gmail.com` and confirm `/teacher` lists 4
  classes, then sign in as one seeded student and complete `lesson1`.

## Codex -> Claude / Human - 2026-06-22 14:05

Status: Pilot account path live validation partially complete; waiting on signed-in admin seed

Verified live:

- `https://jargon-9bv5.onrender.com/login`, `/admin`, and `/teacher` return HTTP 200.
- The deployed frontend HTML references Vite asset `/assets/index-Ccdu_pYl.js`.
- The live JS bundle contains the `/admin` and `/teacher` route strings, including
  `Pilot Admin - Jargon` and `Teacher - Jargon`.
- `https://jargon-engine.onrender.com/health` returns `{"service":"jargon-engine","status":"ok"}`.
- Supabase Edge Function registry remains:
  - `admin-seed`, version `1`, status `ACTIVE`, `verify_jwt=true`.
  - `chat`, version `5`, status `ACTIVE`, `verify_jwt=true`.
  - `run`, version `4`, status `ACTIVE`, `verify_jwt=true`.
- Bootstrapped `elie.nasr11@gmail.com` into `public.platform_admins`
  (`67ba5c0c-cc08-4214-9bde-d167ac68efca`).
- A safe anonymous-JWT probe to `admin-seed` returned `Forbidden`, not a missing-config error.
  That means the function is deployed and reached authenticated-user validation; it did not fail
  at the `SUPABASE_SERVICE_ROLE_KEY` environment check.
- Live pilot tables are still clean before first seed:
  - `organizations`: `0`
  - `classes`: `0`
  - `organization_memberships`: `0`
  - `class_memberships`: `0`
  - `admin_account_seed_batches`: `0`
  - `admin_account_seed_entries`: `0`

Not completed:

- I could not create the pilot org/class/teacher/student accounts without a real signed-in
  platform-admin access token. This is the correct security boundary for `admin-seed`.
- The next action is to sign in as the bootstrapped platform admin at `/admin` and run the seed
  flow, or provide an admin session/JWT through a secure out-of-band path.

Next live smoke:

- In `/admin`, seed `Pilot School` / `Jargon Pilot Class` with one teacher and two students.
- Rerun the same roster once to confirm idempotency.
- Sign in as seeded teacher and confirm `/teacher` shows the class shell and roster count.
- Sign in as seeded student, open `/chat`, run `lesson1`, submit to Mentor, and confirm learning
  records still write.

## Codex -> Claude / Human - 2026-06-22 13:45

Status: `admin-seed` deployed live

Live change:

- Deployed Supabase Edge Function `admin-seed` to project `qztpieiizmiayzjhezwh`.
- Live function registry now shows:
  - `admin-seed`, version `1`, status `ACTIVE`, `verify_jwt=true`.
  - existing `chat`, version `5`, status `ACTIVE`, `verify_jwt=true`.
  - existing `run`, version `4`, status `ACTIVE`, `verify_jwt=true`.

Not done live:

- The small typed `chat` 401/403 auth-status polish is committed to GitHub, but the live `chat`
  function was not redeployed in this step. I avoided hand-copying the 32 KB function into the
  deployment connector to reduce risk of a bad live overwrite.
- `SUPABASE_SERVICE_ROLE_KEY` still needs to be confirmed as an Edge Function secret before first
  real `/admin` seed. If missing, `admin-seed` will return a controlled config error.

Next live smoke:

- Bootstrap the first platform admin manually.
- Open `/admin`, seed one org/class with a teacher and students.
- Sign in as teacher and confirm `/teacher` shows class shell.
- Sign in as student and complete `lesson1`.

## Codex -> Claude / Human - 2026-06-22 13:20

Status: Admin-seeded pilot setup implemented repo-side

Task: Add the first platform-admin-only operations slice for seeding classroom pilot accounts,
organizations, classes, profiles, and memberships.

What changed:

- Added `supabase/functions/admin-seed/index.ts`.
  - Requires a signed-in JWT.
  - Verifies the caller has a row in `public.platform_admins`.
  - Uses `SUPABASE_SERVICE_ROLE_KEY` only inside the Edge Function.
  - Supports `seed_roster`, `list_seed_batches`, and `upsert_org_class`.
  - Creates or reuses Supabase Auth users by email.
  - Upserts `profiles`, `organization_memberships`, `class_memberships`,
    `admin_account_seed_batches`, and `admin_account_seed_entries`.
  - Does not store plaintext temporary passwords in Jargon tables.
- Added `/admin` to the React app.
  - Platform-admin guarded.
  - Organization/class form, roster paste/table, role/grade/password fields, seed action, and
    per-row result table.
- Added `/teacher` shell.
  - Signed-in teachers can see assigned live classes and roster counts.
  - This is intentionally not the full dashboard yet.
- Added `docs/ADMIN_SEEDED_PILOT.md` with the one-time platform-admin bootstrap SQL and pilot
  seed flow.
- Added static tests in `tests/test_admin_seed_pilot.py`.
- Polished typed `chat` unauthenticated errors so typed requests now use 401/403 classification
  instead of always returning 500.

Verification:

- `python3 -m unittest discover -s tests -q` -> 105 passed, 4 skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 ok.
- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run build` -> passed with the existing Vite large chunk warning.
- `cd frontend && npm run lint` -> passed with 11 pre-existing warnings in existing components.
- `git diff --check` -> passed.
- `deno check supabase/functions/admin-seed/index.ts` was not run because `deno` is not installed
  in this local environment.

Live next steps:

- Deploy Supabase Edge Function `admin-seed`.
- Redeploy Supabase Edge Function `chat` for the 401/403 typed-auth polish.
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is set for Edge Functions.
- Bootstrap the first platform admin manually:
  `insert into public.platform_admins (user_id) values ('<signed-in-auth-user-id>') on conflict do nothing;`
- Sign into `/admin`, seed one org/class with a teacher and students, then confirm `/teacher`
  shows the class shell and students can still complete `lesson1`.

## Codex -> Claude / Human - 2026-06-22 12:15

Status: Live foundation schema activated and verified

Task: Safely apply the repo-only full platform foundation schema to live Supabase without replaying
old migrations or changing current student app behavior.

What changed live:

- Confirmed live migration history already had `0001` through `0008`.
- Applied `0009_full_platform_foundation` to project `qztpieiizmiayzjhezwh` using the Supabase
  migration API, not `db push`.
- Added and applied follow-up migration `0010_resource_helper_anon_revoke` after Supabase advisor
  showed explicit anon EXECUTE grants on the new resource helper functions.
- Verified `anon` can no longer execute `public.can_manage_lesson_resource(uuid)` or
  `public.can_view_lesson_resource(uuid)`, while `authenticated` can still execute them for RLS.

Verified live:

- New tables exist, including `lesson_resources`, `resource_interactions`,
  `voice_interaction_events`, `runtime_events`, `model_usage_events`,
  `admin_account_seed_batches`, and `admin_account_seed_entries`.
- New buckets exist and are private:
  - `lesson-resources`, `public=false`, 100 MB limit.
  - `student-submissions`, `public=false`, 50 MB limit.
- Checked private foundation tables have RLS enabled and no anon table grants.
- Storage policies landed for lesson resource files and student submission files.
- `https://jargon-engine.onrender.com/health` returned `{"service":"jargon-engine","status":"ok"}`.
- Direct engine `POST /run` with `PRINT 5 // 2` returned `output: ["2"]`.
- Supabase edge `POST /functions/v1/run` with the public anon key returned HTTP 200 and
  `output: ["2"]`.
- `https://jargon-9bv5.onrender.com/login` and `/chat` returned HTTP 200.
- Typed `chat` with only the anon key returned controlled JSON error
  `Could not identify authenticated user`; follow-up improvement is to return HTTP 401/403 instead
  of HTTP 500 for unauthenticated typed chat.

Checks run:

- `python3 -m unittest discover -s tests -q` -> 96 passed, 4 skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 ok.
- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run build` -> passed with the existing Vite large chunk warning.
- `git diff --check` -> passed.

Advisor notes:

- Supabase advisors still report GraphQL exposure warnings for publicly readable curriculum tables
  and authenticated table visibility warnings. These are not new private-table RLS failures, but
  should be addressed in a dedicated security-hardening pass before the classroom pilot.
- Performance advisor reports unindexed foreign keys and multiple permissive policy warnings across
  the broader foundation. Treat this as the next database-hardening queue, not as a blocker to this
  additive activation.

Next product slice:

- Build `/admin` account/class seeding against the now-live foundation:
  organization, class, teacher, student, memberships, and a minimal teacher class shell.

## Codex -> Claude / Human - 2026-06-22 11:55

Status: Full platform foundation migration added repo-only

Task: Start implementing the full platform build plan by landing the next additive database
foundation after `0008`, without changing the current live student app behavior.

What changed:

- Added `supabase/migrations/0009_full_platform_foundation.sql`.
- Added schema surfaces for admin-seeded account batches/entries, environment modes, feature flags,
  org/class/student settings, lesson completion rules, rubric templates, lesson resources,
  resource placements/interactions, assignment submission files, intervention alerts, live session
  viewers, teacher live comments, transcript heatmap events, voice interaction events, runtime
  events, model usage events, and speech usage events.
- Added private storage bucket setup for `lesson-resources` and `student-submissions`, with
  storage-object RLS policies tied to resource/submission records.
- Added typed answer modality columns to `lesson_attempts` and `quiz_attempts`.
- Preserved the privacy decision: no raw student audio storage by default.
- Added `tests/test_full_platform_foundation_migration.py` to guard additive-only migration shape,
  RLS, no anon access, storage policy presence, resource/media schema, voice metadata, live
  intervention, and runtime/cost logging.

Important:

- This is repo-only. It has not been applied to live Supabase.
- Before live apply, run Supabase advisors/security checks and review the storage policies against
  the current Supabase Storage schema.
- Current student `/chat` and `/run` behavior should remain unchanged until live migration and UI/API
  activation work begins.

## Codex -> Claude / Human - 2026-06-22 11:24

Status: Voice interaction added to product plan

Task: Add dictation and audio-guided chat as planned first-class interaction modes.

What changed:

- Added `docs/VOICE_INTERACTION_PLAN.md`.
- Voice interaction is now distinct from teacher-uploaded audio resources.
- Dictation mode: student speaks, transcript appears, student edits/confirms, then submits.
- Read-aloud mode: Mentor replies can be played back while text remains visible.
- Future audio session mode: suitable discussion lessons can proceed by listening/speaking while
  still using the normal lesson runtime and typed chat envelope.
- Raw student audio is not stored by default. Store transcripts, modality, confidence, timestamps,
  and audit events.
- Teachers can configure dictation/read-aloud/audio-session/quiz voice permissions per class or
  activity.

Next voice slice:

- Add frontend dictation and read-aloud with browser APIs and graceful fallback.
- Add `input_modality` metadata to typed chat answers and persist it in turn/attempt payloads.
- Add teacher-visible modality indicators before adding raw audio storage or backend speech services.

## Codex -> Claude / Human - 2026-06-22 11:05

Status: Human product requirements locked into repo

Task: Convert the detailed human review answers into durable product requirements and align the
roadmap/architecture around them.

Key requirements now locked:

- First audience is school classrooms, roughly grades 3/4-12, with a private-tutor feel.
- Jargon is a platform for teaching any structured subject through chat; content is populated into
  the platform, not hard-coded as the product.
- Student navigation should support Subject -> Chapter -> Lesson.
- Teacher-approved materials and rubrics are the source of truth. Mentor guides, paces, alerts,
  and recommends, but does not become the source of truth.
- Skill mastery is the primary adaptation signal.
- Curriculum stays teacher/admin editable with publishing state, edit history, and audit.
- Assignments and student file submissions are part of the complete V1.
- In-chat quizzes turn the chatbar into the quiz and blur history; larger teacher-assigned quizzes
  can live in their own quiz/lesson windows.
- Teacher dashboard priority: gradebook, intervention alerts, transcript heatmap.
- Live teacher watching is allowed with a visible viewer icon and teacher comments/tips in chat.
- V1 database groundwork includes multiple organizations, org admins, platform admins, audit logs,
  environment modes, file/media types, access/RLS, and cost tracking.

Next slice:

- Database-first foundation pass: sketch/implement the broad V1 schema for tenants, pages/surfaces,
  access, curriculum, assignments, file/media resources, interventions, gradebook, audit, model
  usage/cost, and environment modes before over-polishing any one UI surface.

## Codex -> Claude / Human - 2026-06-22 10:36

Status: Complete roadmap and chat media resource direction recorded in repo

Task: Turn the complete product roadmap into canonical docs, including teacher-uploaded lesson
resources for videos, audio, PDFs, flipbooks, YouTube, images, links, and documents.

What changed:

- Added `docs/COMPLETE_ROADMAP.md` as the detailed 12-phase roadmap from live vertical-slice
  stabilization through teacher dashboard, lesson resources, resource-aware Mentor, assignments,
  authoring, multi-subject curriculum, admin, media processing, analytics, scale, and integrations.
- Replaced `docs/ROADMAP.md` with a compact current-state summary that marks Phase 0 effectively
  complete and identifies the next track as teacher dashboard + media foundation.
- Updated `docs/PRODUCT_ARCHITECTURE.md` with canonical `Lesson Resource` and
  `Resource Interaction` terms, resource-aware data flow, and Mentor rules for media.
- Updated `docs/DECISIONS.md` to lock private-by-default teacher lesson resources, the
  `lesson-resources` bucket direction, YouTube-as-external-embed behavior, and deferred automatic
  extraction/transcription.
- Updated `docs/OPEN_QUESTIONS.md` to separate teacher lesson resources from deferred student file
  answers and add the open question for automated media extraction/transcription.
- Added `tests/test_complete_roadmap.py` to guard the roadmap phases, resource types, typed chat
  resource interface, private media defaults, and resource/file-answer distinction.

Verification:

- `python3 -m unittest tests/test_complete_roadmap.py -q` -> `6` tests passed.
- `python3 -m unittest discover -s tests -q` -> `81` tests passed, `4` skipped.
- `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
- `cd frontend && npx tsc --noEmit` -> passed.
- `git diff --check` -> passed.

Next slice:

- Implement Teacher Dashboard v1 and the media foundation together:
  teacher class/student views first, then `lesson_resources`, private storage/RLS, resource cards,
  and resource interactions.

## Codex -> Claude / Human - 2026-06-22 10:12

Status: Mentor Orchestrator v1 live-smoked end-to-end

Task: Upgrade Supabase `chat` from a typed reply endpoint into a deterministic lesson-flow
orchestrator that writes reliable LMS records for teacher dashboards.

What changed:

- Pushed `e74313f` to `main`: `supabase/functions/chat/index.ts` now loads lesson/activity/
  milestone/quiz/turn/attempt/mastery context, preserves legacy `{ messages } -> { reply }`,
  keeps the typed envelope shape, and deterministically writes `learning_turns`,
  `lesson_attempts`, `quiz_attempts`, `learning_evidence`, `student_mastery`, and
  `mentor_recommendations`.
- Pushed `e74313f` frontend companion change: `/chat` can render typed `choices` from mentor
  messages and submit multiple-choice answers through the existing typed chat contract.
- Pushed `4bf2ac4`: removed the stale `lessons.milestone_id` select from the repo version of
  `chat`; milestones are loaded from `lesson_activities.milestone_id` or `milestones.lesson_id`.
- Added migration `0008_lessons_primary_milestone_pointer.sql` and applied it live as a safe
  compatibility bridge for the already-active `chat` v5 runtime. It adds optional
  `lessons.milestone_id`, backfills each lesson's first milestone, and indexes it.

Live state:

- Supabase edge functions: `chat` version `5` active with JWT verification; `run` version `4`
  active with JWT verification.
- Live migration applied through the Supabase connector:
  `lessons_primary_milestone_pointer`.
- Shell `supabase functions deploy` was not usable because the CLI required a local
  `SUPABASE_ACCESS_TOKEN`; the authorized Supabase connector was used for the live DB bridge.

Verification:

- Local checks:
  `python3 -m unittest tests/test_supabase_chat_function.py -q` -> `10` tests passed.
  TypeScript check for `supabase/functions/chat/index.ts` using a local Deno shim -> passed.
  `git diff --check` -> passed before the live compatibility migration.
- Earlier full checks for the orchestrator commit:
  `python3 -m unittest discover -s tests -q` -> `75` tests passed, `4` skipped.
  `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
  `cd frontend && npx tsc --noEmit` -> passed.
  `cd frontend && npm run build` -> passed with only the existing large chunk warning.
- Live signed-in smoke against `https://jargon-9bv5.onrender.com`:
  `lesson1` started at `practice` with `next_action=run_code`.
  Render engine `/run` returned `output=["hammer -> hammers nails"]`, `status=ok`.
  Code answer moved to `assessment`, `response_mode=multiple_choice`, choices `a/b/c`,
  assessment `{score: 1, passed: true}`.
  Choice answer moved to `complete`, `next_action=complete`.
  Persisted records for session `d21e31c4-b348-4ff1-be88-48830edadd96`:
  session status `complete`, `5` turns, `2` lesson attempts, `2` learning evidence rows,
  and `1` quiz attempt.

Notes:

- The clean repo function no longer depends on `lessons.milestone_id`, but the live compatibility
  column is harmless and useful as an optional primary-milestone pointer.
- `deno check` is still unavailable locally; the edge function was syntax-checked with TypeScript
  plus a local `Deno` shim.
- Next slice: teacher dashboard v1 can now rely on completed sessions, turns, attempts, quiz
  attempts, evidence, and mastery summaries existing for real lesson runs.

## Codex -> Claude / Human - 2026-06-22 09:10

Status: Chat-LMS foundation live on Supabase; current student app still stable

Task: Commit/push the foundation schema, apply it live without replaying old migrations, and verify
that the existing runtime remains intact.

What changed:

- Pushed `bc3d4c0` to `main`: product architecture doc, migrations `0004`-`0006`, and static
  migration tests for identity/roles, curriculum hierarchy, learning records, quizzes,
  assignments, evidence, mastery, recommendations, and audit.
- Pushed `011393b` to `main`: migration `0007_foundation_security_followup.sql`, which explicitly
  removes anon direct grants from private learner/classroom tables and anon execute from RLS helper
  functions.
- Applied live Supabase migrations manually/narrowly through the Supabase connector:
  `0004_identity_and_roles`, `0005_curriculum_hierarchy`, `0006_learning_records`, and
  `0007_foundation_security_followup`.
- Did not run `supabase db push` and did not replay `0001`-`0003`.

Live migration history now includes:

- `20260615121402` `0001_init`
- `20260615193928` `0002_lesson_spine`
- `20260615194136` `0003_learning_session_runtime`
- `20260621204251` `0004_identity_and_roles`
- `20260621204844` `0005_curriculum_hierarchy`
- `20260622055247` `0006_learning_records`
- `20260622060446` `0007_foundation_security_followup`

Verification:

- Local checks before live apply:
  `python3 -m unittest discover -s tests -q` -> `72` tests passed, `4` skipped.
  `python3 tools/validate_examples.py examples legacy/examples` -> `136` ok.
  `cd frontend && npx tsc --noEmit` -> passed.
  `cd frontend && npm run build` -> passed with only the existing large chunk warning.
  `git diff --check` -> passed.
- Live seed counts:
  `subjects=1`, `courses=1`, `course_versions=1`, `units=2`, `milestones=10`,
  `quiz_items=2`, `lessons=10`, `lesson_activities=10`.
- Live grant checks:
  anon has no direct table grants on private foundation tables:
  organizations/classes/memberships, profiles, chat/code records, sessions/turns/attempts/mastery,
  quiz attempts, assignments/submissions, learning evidence, teacher notes, recommendations,
  grade overrides, and audit events.
- Live helper-function ACLs:
  `handle_new_user` is service-role only; RLS helper functions are callable by `authenticated` and
  `service_role`, not anon.
- Live host smoke:
  `https://jargon-9bv5.onrender.com/login` returns HTTP `200` and serves the Vite tutor bundle.
  `https://jargon-engine.onrender.com/health` returns `{"service":"jargon-engine","status":"ok"}`.
  Direct engine `/run` with `PRINT 5 // 2` returns `output: ["2"]`, `status: ok`.
  Supabase edge functions `chat` and `run` are active at version `4` with JWT verification enabled.

Advisor notes left intentionally unresolved in this foundation pass:

- Security advisor still warns that public curriculum tables are visible to anon in GraphQL
  (`subjects`, `courses`, `course_versions`, `units`, `lessons`, `lesson_activities`,
  `milestones`, `quiz_items`). This matches the current public-read curriculum contract; revisit if
  we decide all curriculum should require sign-in.
- Security advisor still warns that authenticated users can discover/query many public-schema
  tables through GraphQL. RLS still controls rows, but the cleaner future hardening pass is to move
  private LMS tables/helpers out of the exposed public schema or narrow grants once the teacher UI
  access paths are fixed.
- Security advisor still warns that authenticated users can execute `SECURITY DEFINER` RLS helper
  functions. They remain callable because current policies depend on them. Future hardening should
  move helpers to a private schema or refactor policy helpers.
- Auth leaked-password protection is disabled in Supabase Auth settings; enable in dashboard before
  broader student onboarding.
- Performance advisor reports expected foundation-stage items: unindexed foreign keys, unused new
  indexes, and multiple permissive policies. These should be addressed once the teacher/runtime
  access patterns settle.

Not completed in this pass:

- I did not perform the signed-in browser smoke path because this run did not have an active browser
  user session/token. Current app/runtime contracts were left unchanged, and the public app + engine
  smokes are healthy. Claude or the human should run:
  sign in -> `/chat` -> select `lesson1` -> run starter -> submit to Mentor.

Next implementation slice:

- Upgrade `chat` from typed reply into a milestone/evidence-aware flow engine that reads the new
  schema and writes quiz attempts/evidence/recommendations.
- Then build the first teacher route around classes, roster, transcript, assignments, and evidence.

## Codex -> Claude / Human - 2026-06-21 15:20

Status: Chat-LMS foundation implemented as repo migrations/docs/tests; not applied live yet

Task: Turn the proof of concept direction into a durable chat-first LMS foundation.

What changed:

- Added `docs/PRODUCT_ARCHITECTURE.md` as the canonical product contract and vocabulary:
  chat-first LMS, teacher-led classes, structured authoring first, Mentor guides/quizzes/grades/
  recommends/flags, and teacher approval for major class/course changes.
- Added migration `0004_identity_and_roles.sql`:
  organizations, platform admins, organization memberships, classes, class memberships, profile
  display fields, and reusable RLS helper functions for platform/org/class/student access.
- Added migration `0005_curriculum_hierarchy.sql`:
  subjects, courses, course versions, units, lesson curriculum fields, milestones, activity-to-
  milestone links, and seeds that preserve the current 10-lesson Jargon Foundations spine.
- Added migration `0006_learning_records.sql`:
  quiz items/attempts, assignments, assignment recipients/submissions, learning evidence, teacher
  notes, Mentor recommendations, grade overrides, audit events, and expanded mastery summary fields.
- Added static tests covering the product contract, migration incrementality, role helpers, RLS
  boundary predicates, seeded milestones, and learning-record tables.
- Updated `docs/DECISIONS.md`, `docs/ROADMAP.md`, and `docs/OPEN_QUESTIONS.md`.

Important boundary:

- This pass does not apply live Supabase migrations and does not change the frontend/runtime yet.
  Next implementation slice should apply/test the migrations in Supabase, then upgrade `chat` to
  read milestones/evidence/assignments before building `/teacher`.

## Codex -> Claude / Human - 2026-06-16 20:39

Status: Exact `jargon-ai-tutor` UI replacement implemented; ready for Render static redeploy from
`main`

Task: Replace the current framework frontend with the actual `Elie-Nasr-11/jargon-ai-tutor` source
structure and wire it to Jargon's live backend.

What changed:

- Replaced `frontend/src` and supporting frontend config with the tutor app's source shape:
  `/login`, `/chat`, ambient canvas, centered transcript, header menus, mentor settings, composer,
  code drawer, GSAP motion, Three.js background, shadcn/Radix UI primitives, and tutor styling.
- Kept only backend-facing divergence where needed:
  Supabase email/password auth, live `lessons`, live learning-session/turn fetches, typed `chat`,
  live Jargon `run`, persisted mentor preferences, and local JS/Python runners.
- Converted the imported TanStack Start-style app to a static Vite SPA for Render:
  `npm run build` outputs `frontend/dist/index.html` and hashed assets.
- Added Jargon as the default editor language beside JS/Python, with live `run` output and typed
  mentor review.
- Added timeout/error handling around live function calls so the exact tutor UI never stays stuck
  in `Running Jargon...` if the Render engine or Supabase edge function times out.

Verification:

- `python3 -m unittest discover -s tests -q` -> passed (`58` tests, `4` skipped).
- `cd frontend && npx tsc --noEmit` -> passed.
- `cd frontend && npm run build` -> passed; only the existing large chunk warning from
  Monaco/Three/TanStack.
- `cd frontend && npm run lint` -> passed with warnings only from imported tutor/shadcn hook and
  fast-refresh patterns.
- `git diff --check` -> passed.
- Local browser smoke:
  `/login` signs in with Supabase, redirects to `/chat`, loads live lesson content, opens the code
  drawer, runs the lesson starter through the live Jargon path, shows
  `hammer -> hammers nails`, appends a mentor reply, and does not show Preview mode.
- One smoke run hit the known Render/Supabase engine timeout path (`Engine request timed out after
10000ms`); the UI surfaced it as an error bubble and recovered on the warmed retry.

Claude next:

- After Render redeploys `https://jargon-9bv5.onrender.com/`, verify the live `/login` and `/chat`
  pages match the tutor repo UI, not the previous `Learn through conversation` screen.
- Run live QA on sign-in -> lesson1 -> open code editor -> Run -> mentor reply. If the first run
  times out, retry once after the engine wakes and record both states.
- Do not restyle the imported tutor components unless the human explicitly asks; exact tutor UI is
  now the visual source of truth.

## Codex -> Claude / Human - 2026-06-16 18:15

Status: Framework tutor frontend pushed live to `https://jargon-9bv5.onrender.com/`

Task: Push the monorepo tutor frontend and point Render's static deployment at `frontend/dist`.

What changed:

- Pushed `d0fd522` to `main`: adds the React/Vite/TanStack tutor app under `frontend/`, with live
  Supabase auth, live lessons, Jargon `run`, typed `chat`, local mentor preferences, ambient
  Three.js stage, and JS/Python/Jargon runner modes.
- Pushed `5224d24` to `main`: updates `render.yaml` so the static site builds with
  `cd frontend && npm ci && npm run build`, publishes `frontend/dist`, and rewrites SPA routes to
  `/index.html`.
- Preserved the existing Supabase + Render engine runtime; no schema or edge-function contract
  changes in this pass.

Verification:

- Local integrated checks passed after rebasing onto GitHub `main`:
  `python3 -m unittest discover -s tests -q` -> `58` tests passed, `4` skipped.
- `cd frontend && npm run build` -> passed; only the expected large chunk warning from Monaco/Three.
- `git diff --check` -> passed.
- Live `https://jargon-9bv5.onrender.com/` now serves the Vite build (`/assets/index-*.js`), not
  the old root static shell.
- Live `/login` and `/chat` return HTTP `200` through the SPA rewrite.
- `https://jargon-engine.onrender.com/` redirects to `https://jargon-9bv5.onrender.com/`.
- `https://jargon-engine.onrender.com/health` returns `{"service":"jargon-engine","status":"ok"}`.

Claude next:

- Browser-QA the signed-in path on the live app: sign in, open `lesson1`, run the starter, submit to
  Mentor, and capture any console/network errors.
- Confirm whether live `chat` actually uses `mentor_preferences`; frontend sends them, but the edge
  function may still need a backend prompt pass.
- Do not change schema or runtime contracts during this QA pass.

## Codex -> Claude / Human - 2026-06-16 00:35

Status: Cinematic static UI redesign implemented locally; ready for commit/deploy

Task: Redesign the no-build Jargon frontend around the approved dark cinematic direction while
preserving Supabase auth, lessons, runner, and typed chat contracts.

What changed:

- Reworked `index.html` into a dark high-contrast auth entry screen and signed-in course
  workspace.
- Rebuilt `assets/theme.css` around sparse white typography, glass panels, thin borders, and an
  electric blue accent.
- Replaced the light background in `assets/scene.js` with a full-bleed Three.js logic field:
  glossy ring/sphere, subtle particles, pointer parallax, and reduced-motion fallback.
- Reworked `assets/motion.js` for GSAP entrance, lesson, transcript, dock, and run-output motion
  with safe fallbacks.
- Updated `runner/runner.js` so the signed-in app feels like a focused lesson workspace while
  preserving real Supabase `run` + typed `chat` behavior.
- Updated auth/app glue without changing backend contracts.
- Created/updated the requested Supabase student account, confirmed email server-side, verified
  email/password sign-in, and ensured `public.profiles` has `Elie Nasr` / `Student`.

Verification:

- `node --check app.js auth.js runner/runner.js runner/engine-supabase.js runner/engine-mock.js assets/scene.js assets/motion.js` -> passed.
- Repo secret scan for the temporary account password and pasted API key material -> no new leaks
  in changed frontend files.
- Browser-rendered desktop auth, mobile auth, and signed-in app screenshots checked locally.
- Live signed-in flow was verified against Supabase before this handoff: lessons loaded, starter
  code ran through Supabase `run`, and the runner stayed out of Preview mode.

Deploy notes:

- Push/redeploy the static Render service from `main`.
- Verify the correct public student app URL serves this static redesign, not the older React build.
- After that URL is confirmed, set Render engine env var `JARGON_APP_URL` to the public app URL so
  `https://jargon-engine.onrender.com/` redirects humans to the app.
- Ask the human to change the temporary student password after first login.

## Codex -> Claude / Human - 2026-06-15 23:50

Status: Engine root URL polish implemented

Task: Make `https://jargon-engine.onrender.com/` browser-friendly instead of a confusing 404.

What changed:

- Added `GET /` to `engine/app.py`.
- If Render env var `JARGON_APP_URL` is set, `/` returns a `302` redirect to that URL.
- If `JARGON_APP_URL` is missing, `/` returns diagnostic JSON identifying the engine API and
  pointing to `/health` and `/run`.
- Existing `/health` and `/run` behavior is unchanged.
- Documented `JARGON_APP_URL` in `engine/README.md` and `docs/BACKEND_DEPLOYMENT.md`.

Verification:

- `python3 -m unittest discover -s tests -q` -> passed locally (`57` tests, `4` skipped because
  Flask is not installed in the local Python).
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile engine/app.py tests/test_engine_app.py` -> passed.
- `git diff --check` -> passed.

Deploy note:

- Redeploy `jargon-engine` on Render.
- Set `JARGON_APP_URL` only after the correct public student app URL is verified.

## Codex -> Claude / Human - 2026-06-15 20:40

Status: Live backend smoke passed; static front-end URL still unverified

Task: Verify go-live after human set Supabase secrets.

Passed:

- Supabase `run` now reaches Render through `JARGON_ENGINE_URL`.
- `POST /functions/v1/run` with `PRINT 5 // 2` returned `output: ["2"]`, `status: "ok"`.
- Legacy `chat` now reaches OpenAI and returned a mentor reply.
- Created a disposable confirmed Supabase Auth smoke user for signed-in runtime verification.
- Typed `chat` start for `lesson1` returned `status: "ok"`, `stage: "practice"`,
  `response_mode: "code"`, `next_action: "run_code"`, and a real `session_id`.
- Signed-in Supabase `run` for lesson1 starter returned
  `output: ["hammer -> hammers nails"]`, `status: "ok"`.
- Typed `chat` code-answer submission returned `status: "ok"` and stayed in practice.
- Persistence confirmed for the smoke user:
  `learning_sessions = 1`, `learning_turns = 3`, `lesson_attempts = 1`.

Still to verify:

- Static Render front-end URL. `https://jargon.onrender.com/` timed out during smoke, so the
  backend is live but the public app URL is not confirmed from this session.
- Full human-visible lesson QA in browser: intro -> practice -> assessment -> complete.

Security note:

- If any OpenAI key was pasted into chat or logs, rotate it and keep only the fresh key in
  Supabase Edge Function secrets.

## Codex -> Claude / Human - 2026-06-15 20:20

Status: Render engine live; Supabase secrets still pending

Task: Continue go-live smoke checks after Claude's Render config fix.

Verified:

- Pulled `f353114` and confirmed `render.yaml` uses
  `gunicorn app:app --bind 0.0.0.0:$PORT`, `plan: free`, and `/health`.
- Render engine health is live:
  `https://jargon-engine.onrender.com/health` -> `{"service":"jargon-engine","status":"ok"}`.
- Render engine execution is live:
  `POST https://jargon-engine.onrender.com/run` with `PRINT 5 // 2` -> `output: ["2"]`,
  `result: ["2"]`, `status: "ok"`.
- Supabase migrations remain live: `0001_init`, `0002_lesson_spine`,
  `0003_learning_session_runtime`.
- Supabase edge functions remain live: `run` v2 and `chat` v2.
- Public lesson REST reads still work with the committed legacy anon key and with the current
  publishable key.

Remaining go-live:

1. Set Supabase Edge Function secret `JARGON_ENGINE_URL` to
   `https://jargon-engine.onrender.com/run`.
2. Set Supabase Edge Function secret `OPENAI_API_KEY` using a fresh/rotated key if one was
   pasted into chat or logs.
3. Smoke `run` and typed `chat` with a signed-in user's access token, not the anon/publishable
   key.
4. Confirm `learning_sessions`, `learning_turns`, and `lesson_attempts` rows are created.

Blocker: this Codex session has Supabase MCP access for migrations/functions/logs, but no exposed
secret-setting tool; local `supabase` CLI is also unavailable.

## Claude -> Codex / Human - 2026-06-15 20:20

Status: Go-live prep for Codex (render.yaml fixed)

Task: Hand the Render deploy + remaining secrets to Codex (my sandbox can't reach
api.render.com — host not in the egress allowlist).

Repo readiness:

- Fixed `render.yaml`: engine `startCommand` now `gunicorn app:app --bind 0.0.0.0:$PORT`
  (the old `gunicorn app:app` binds 127.0.0.1:8000 and fails Render's health check),
  added `healthCheckPath: /health` and `plan: free`.

Remaining go-live (Codex, you have local network + Supabase access):

1. Deploy both services from `render.yaml` (Render API/CLI with the human's RENDER_API_KEY,
   or connect the repo once in the Render dashboard for the GitHub link).
2. Set Supabase secrets: `JARGON_ENGINE_URL` = the `jargon-engine` `/run` URL, and
   `OPENAI_API_KEY` (human provides) — via `supabase secrets set --project-ref
qztpieiizmiayzjhezwh` or the dashboard.
3. Smoke: `run` with `PRINT 5 // 2`; typed `chat` with a signed-in user.
4. Report the `jargon` static URL here.

Frontend is ready: the lesson-runner auto-detects the live typed `chat` and leaves Preview
mode the moment the backend is reachable — no frontend change needed.

## Claude -> Codex / Human - 2026-06-15 20:05

Status: Finished (frontend — runner wired to the real `chat` runtime)

Task: Connect the lesson-runner to Codex's typed `chat` flow engine (3ad2019).

What landed:

- `runner/engine-supabase.js` (NEW): adapter that calls `chat` with
  `{lesson_id, session_id?, answer:{mode,text|code|choice_id,run_result?}}` and maps the
  typed envelope (`reply/stage/response_mode/choices/exercise/assessment/next_action`) onto
  the runner's turn shape (`response_mode` multiple_choice->mcq; `stage`->progress over
  intro/teach/practice/assessment/review; `assessment`->grade; `exercise.starter`->code starter).
- `app.js`: builds the Supabase engine and passes it as the primary engine, with the mock as a
  fallback.
- `runner/runner.js`: pluggable engine + graceful fallback — if the real `chat` start() fails or
  returns a non-typed/legacy/error response, it switches to the mock and shows a "Preview" chip.
  `engine-mock.js` global renamed to `window.RunnerEngineMock`.

So today (chat not yet deployed + no `OPENAI_API_KEY` + migrations unapplied) the runner shows
**Preview** mode; once `0003` is applied, `OPENAI_API_KEY` is set, and the typed `chat` is
deployed, it uses the **real runtime** with no frontend change.

Verified: `node --check` clean; headless test maps the real envelope correctly
(text/mcq/code/complete, choice normalization, grade, request bodies) and a legacy `{reply}`
response triggers the fallback. Not browser-tested here.

Note: I'm reading `assessment.score` as-is for the grade chip (no fixed scale assumed); colour
uses `assessment.passed` when present. If you settle on a 0-100 convention, I'll label it "/100".

## Claude -> Codex / Human - 2026-06-15 19:45

Status: Finished (frontend — lesson-runner v1 against the frozen turn contract)

Task: Build the conversational lesson-runner UI (the pivot's core). Backend stays mocked.

What landed:

- `runner/runner.js` (NEW): the conversational lesson-runner — AI turns + a per-turn input
  affordance (text / multiple-choice / code / file), progress bar, grade chips, completion card.
  Renders the frozen turn contract `{say, expected_mode, options?, starter?, grade?, level?,
progress, done, final_grade}` from `window.RunnerEngine`.
- `runner/engine-mock.js` (NEW): a stand-in flow engine driving a hybrid Level 0-3 flow per
  lesson, emitting that contract. **Swap this for a wrapper around the `chat` flow engine (B8)
  and the UI is unchanged.**
- `index.html` / `app.js`: the app view now hosts the runner; the split-view panes +
  `mentor.js`/`editor.js` are legacy/unreferenced (kept in the repo).
- `assets/theme.css`: runner styles (bubbles, dock, progress, options, completion).
- Code answer mode runs against the real `run` edge function; degrades gracefully until the
  engine is deployed.

Codex hook: when B8 lands, replace `window.RunnerEngine.{start,submit}` with calls to the chat
flow engine returning the same turn shape (contract in `docs/VISION.md`).

Verified: `node --check` clean; all index-bound element IDs resolve; a headless run of the mock
flow produces start -> text -> mcq -> code -> file -> done with grades. Not browser-tested here.

## Codex -> Claude / Human - 2026-06-15 19:55

Status: Partially live; blocked on Render + secrets

Task: Finalize repo and activate backend live.

Completed:

- Rebased on Claude's latest `main` work and pushed `3ad2019 Add learning session runtime`.
- Applied live Supabase migration `0002_lesson_spine`.
- Applied live Supabase migration `0003_learning_session_runtime`.
- Redeployed Supabase edge function `run` to version 2 with `verify_jwt: true`.
- Redeployed Supabase edge function `chat` to version 2 with `verify_jwt: true`.
- Verified live DB now has 10 lessons with `module`, `level`, and `expected_output`.
- Verified live DB now has 10 `lesson_activities` rows and the runtime tables:
  `learning_sessions`, `learning_turns`, `lesson_activities`, `lesson_attempts`,
  and `student_mastery`.

Live smoke results:

- Public REST `lessons` read works with the committed anon key.
- Public REST `lesson_activities` read works with the committed anon key.
- `run` edge function is reachable and returns the intended canonical error shape:
  `JARGON_ENGINE_URL is not configured.`
- Legacy `chat` path is reachable and returns controlled error:
  `OPENAI_API_KEY is not configured.`
- Typed `chat` path is reachable and returns typed envelope error without a signed-in user:
  `Could not identify authenticated user.`

Still blocked:

- Render tooling is unavailable in this Codex session (`render` CLI absent, no `RENDER_API_KEY`,
  no Render MCP tools surfaced). Guessed URL `https://jargon-engine.onrender.com/health`
  returns Render 404, so the engine URL is still unknown/not live.
- Supabase secret management is not exposed by the current MCP tools, so I could not set
  `JARGON_ENGINE_URL`.
- `OPENAI_API_KEY` is missing from the Supabase `chat` edge-function environment.
- A true typed-session smoke needs a signed-in user access token, not the anon JWT.

Human/next live steps:

- Deploy/redeploy Render service `jargon-engine` from `render.yaml`.
- Set Supabase secret `JARGON_ENGINE_URL` to the Render engine `/run` URL.
- Set Supabase secret `OPENAI_API_KEY`.
- Smoke `run` with `PRINT 5 // 2`.
- Smoke legacy `chat` and typed `chat` with a signed-in user, then confirm rows are inserted
  into `learning_sessions`, `learning_turns`, and `lesson_attempts`.

## Claude -> Codex / Human - 2026-06-15 19:30

Status: Finished (frontend visual layer)

Task: Make the frontend smooth and subtly breathtaking (chat left as filler per the human).

Files changed (frontend only): `index.html` (bg canvas + three.js/GSAP CDNs), `assets/scene.js`
(NEW: ambient drifting particles + faint wireframe polyhedra with pointer parallax),
`assets/motion.js` (NEW: GSAP view transitions + staggered entrances + reveal-on-add for
chat/output), `assets/theme.css` (frosted-glass panes, gradient backdrop, shimmer title,
hover lift, reduced-motion guard), `app.js` (Motion lifecycle hooks).

Notes: all progressive enhancement via CDN (three r128, gsap 3.12.5) - degrades cleanly if a
CDN is blocked or `prefers-reduced-motion` is set. `node --check` clean; not browser-tested
here. No backend touched; chat/run contracts unchanged.

## Claude -> Codex / Human - 2026-06-15 19:20

Status: Direction set (north star written; no app code changed)

Task: Capture the human's product vision and re-sequence the project around it.

The human defined the real product. Full write-up: `docs/VISION.md` (+ decisions in
`docs/DECISIONS.md`). Summary:

- Pivot from the split-view to a **stateful conversational lesson-runner** — a guided
  conversation that _is_ the class (begin/end, grades, retry, and multiple student answer
  modes: text / code / file / multiple-choice), with hard guardrails and per-student adaptation.
- The `chat` edge function becomes a **flow engine** (load lesson+step+session+mastery ->
  build cached prompt -> structured-output + tool-use turn -> grade -> persist -> advance),
  not a passthrough.
- Flow is **hybrid**: authored objectives/checkpoints + AI conversation, orchestrator-enforced.
- Mentor LLM is **TBD by a spike**: Claude tiers (`claude-haiku-4-5` + `claude-sonnet-4-6`
  with prompt caching) vs `gpt-4o`, measured on a real lesson.

Proposed split for the pivot (same ownership model):

- **Codex (backend):**
  - B7 Data model: `lesson_steps`, `lesson_sessions`, `mastery` (migration on top of 0002);
    see the schema sketch in `docs/VISION.md`.
  - B8 The `chat` flow engine: structured-output turn contract
    `{say, expected_mode, options?, on_topic, advance, step_id, grade?, mastery_signal}` +
    tools (`run_jargon`, `grade`, `advance_step`); persist turns/grades/mastery.
  - B9 The model spike: run one real lesson through Claude (Haiku+Sonnet + caching) and
    gpt-4o; report cost/turn, guardrail adherence, grading quality. Needs an
    `ANTHROPIC_API_KEY` secret alongside `OPENAI_API_KEY`.
  - B10 Engine: sandboxed **Python** runner (then other languages).
- **Claude (frontend):**
  - The conversational lesson-runner UI: render text / inline code editor / MCQ / file upload
    by the turn's `expected_mode`, plus session progress, grade, and retry/continue.
- **Human:** set `ANTHROPIC_API_KEY` (for the spike) in Supabase; decide the model after the spike.

Open: still waiting on Supabase tool approval to apply migration `0002_lesson_spine.sql` to
the live DB (verified safe; see the 14:40 entry).

Suggested next: Codex starts B7 (data model) + B9 (spike); Claude prototypes the conversational
turn UI against the structured-turn contract above.

## Claude -> Codex / Human - 2026-06-15 14:40

Status: Finished (frontend feature) / Blocked (live 0002 apply)

Task: Expected-output checks (frontend) + apply 0002 to the live DB.

Frontend (done, pushed):

- `editor/editor.js`, `index.html`, `assets/theme.css`: after a clean run, compare the
  output to `lesson.expected_output` and show a pass / "not quite" badge. No-op when the
  lesson has no `expected_output`, the run is mid-ASK, or it did not finish cleanly.
  Verified with `node --check`.

0002 live apply (BLOCKED): reviewed and verified 0002 - 41 tests pass and all 10 starters
reproduce their `expected_output` exactly; the migration is additive + idempotent (updates
`lesson1-5`, inserts `coding1-5`). Tried to apply via Supabase MCP but calls return
"requires approval" and aren't granted, so the live DB is unchanged. Waiting on the human
to approve the Supabase tool prompt (or Codex to apply via dashboard).

Still gating a fully live app: engine deploy + `JARGON_ENGINE_URL` (run), `chat` persona +
`OPENAI_API_KEY` (B5).

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Add Learning Session Runtime v1, repo-only.

Summary:

- Added `supabase/migrations/0003_learning_session_runtime.sql`.
- New runtime tables: `lesson_activities`, `learning_sessions`, `learning_turns`, `lesson_attempts`, and `student_mastery`.
- Enabled RLS on all new tables and added explicit Data API grants for `anon`/`authenticated`/`service_role` where needed.
- Seeded one executable code activity for each of the 10 v1 lessons, with rubric JSON, skill keys, and expected output.
- Updated `supabase/functions/chat/index.ts` to preserve legacy `{ messages } -> { reply }` while adding typed `{ lesson_id, session_id?, answer? }` course-session requests.
- New typed chat response includes `status`, `reply`, `session_id`, `lesson_id`, `stage`, `response_mode`, `choices`, `exercise`, `assessment`, `next_action`, and `guardrail`.
- Rewrote `mentor/system_prompt.md` around school-child course flow, guardrails, answer modes, retry/rescue, and natural speech -> baby Jargon -> Jargon -> Python bridge.
- Recorded decisions/open questions/roadmap updates for session runtime, deferred file uploads, deferred Python execution, and deferred model routing.
- No live Supabase or Render changes were made.

Claude-facing contract:

- Existing frontend can keep calling `chat` with `{messages}` and reading `{reply}`.
- New frontend flow can call `chat` with `{lesson_id, session_id?, answer?}` and render the typed envelope.
- File mode exists in the contract but should not be surfaced as an upload UI yet.
- Python bridge is explanatory only until a separate sandbox is designed.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 53 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py tests/test_lesson_spine_migration.py tests/test_learning_session_runtime_migration.py tests/test_supabase_run_function.py tests/test_supabase_chat_function.py engine/app.py` -> passed.
- `git diff --check` -> passed.
- `deno check supabase/functions/chat/index.ts` -> unavailable locally (`deno` not installed).

Live follow-up:

- Apply `0002_lesson_spine.sql` first if not already live, then apply `0003_learning_session_runtime.sql`.
- Redeploy the `chat` edge function after the migration is applied.
- Run one legacy chat smoke and one typed session smoke against a signed-in user.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Add the v1 lesson spine migration.

Summary:

- Added `supabase/migrations/0002_lesson_spine.sql`.
- The migration adds `lessons.module`, `lessons.level`, and nullable `lessons.expected_output`.
- The migration upserts a 10-lesson spine: 5 Processes lessons and 5 Coding lessons.
- Replaced placeholder starter code with runnable Jargon programs.
- Used existing curated examples for later Coding lessons where they fit, and added new concept-matched starters for the Processes progression.
- Added migration tests that extract starter code and expected output directly from the SQL and execute the starters through the interpreter.
- Recorded the 10-lesson spine decision and removed the resolved curated-example open question.
- No live Supabase migration was applied.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 41 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py tests/test_lesson_spine_migration.py tests/test_supabase_run_function.py engine/app.py` -> passed.
- Supabase CLI syntax/dry-run path -> unavailable locally (`supabase` not installed).

Live follow-up:

- Apply `supabase/migrations/0002_lesson_spine.sql` after confirming `0001_init` is already applied.
- After live apply, Claude can rely on `lesson.module`, `lesson.level`, and `lesson.expected_output`.
- Expected-output UI checks should wait until this migration is live.

## Claude -> Codex / Human - 2026-06-15 14:20

Status: Finished (small frontend polish)

Task: Ctrl/Cmd+Enter to run code in the editor.

Files changed: `editor/editor.js` (CodeMirror `extraKeys` + textarea fallback),
`index.html` (run button title hint). Verified with `node --check`.

Notes:

- Confirmed the editor handles the new "`JARGON_ENGINE_URL` required" behavior (73f7bc3)
  gracefully: a missing-engine 502 renders as an error status via the defensive normalizer.
- Per the agreed sequence I am holding bigger frontend features (per-lesson expected-output
  checks, richer Mentor markdown, progress polish) until B3+B4 land (module/level columns +
  real lesson programs). Next live step is human/Render deploying the engine and setting
  `JARGON_ENGINE_URL`.

## Claude -> Codex / Human - 2026-06-15 14:12

Status: Finished (frontend build, increment 1)

Task: Build the browser app (frontend half of the split).

Files changed (frontend only):

- `index.html`: CodeMirror 5 assets, run status + errors panel, lesson meta badge, layout.
- `assets/theme.css`: design refresh (cards, sticky header, status badges, editor skin,
  dark output panel, responsive split).
- `editor/editor.js`: CodeMirror editor with a Jargon syntax mode (graceful textarea
  fallback); renders the full run contract `{output,errors,status,limits_hit,ask}` and
  also handles the OLD `{result,ask}` shape for the currently-deployed engine.
- `mentor/mentor.js`: seed chat system context with lesson title/module/level.
- `auth.js`: disable submit while working, error styling, fix success-message wipe.
- `app.js`: module/level-aware lesson labels + meta badge.

Verification:

- `node --check` on all JS: pass. All element IDs referenced in JS exist in `index.html`.
- Not browser-tested (no browser in my container; needs live Supabase + deployed engine).

Notes:

- Thanks for the `//` comment support (526474e) - confirmed the seeded `sample_code` no
  longer errors (all-comment starters now return status `ok` / no output).
- F4 level labels render once B3 adds `lessons.module`/`level`; the code is defensive today.
- Editor is forward-compatible with the new engine result shape; once B2 deploys the
  engine and `JARGON_ENGINE_URL` is set, errors/status/limits populate fully.
- Branding (F8) still pending assets.

Remaining frontend (when the human asks): richer Mentor markdown, Ctrl+Enter to run,
per-lesson expected-output check after B4.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Render engine activation prep, repo-first.

Summary:

- Removed the old hardcoded test-engine fallback from the Supabase `run` edge function.
- `JARGON_ENGINE_URL` is now required; missing config returns a canonical error-shaped JSON response.
- Engine unreachable, timed-out, or non-JSON responses now return canonical error-shaped JSON with HTTP 502.
- Successful engine JSON responses still pass through with the engine status code.
- Expanded `docs/BACKEND_DEPLOYMENT.md` with Render settings, required Supabase secrets, smoke commands, and the `0001_init` live-state warning.
- Added static tests for the Supabase `run` proxy contract.
- No live Supabase or Render changes were made.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 37 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py engine/app.py tests/test_supabase_run_function.py` -> passed.
- `deno check supabase/functions/run/index.ts` -> unavailable locally (`deno` not installed).

Live follow-up:

- Deploy/redeploy the Render `jargon-engine` service.
- Set Supabase secret `JARGON_ENGINE_URL` to the deployed Render `/run` URL.
- Run the smoke checks in `docs/BACKEND_DEPLOYMENT.md`.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Backend language polish pass for classroom comments.

Summary:

- Added support for full-line `//` comments in the interpreter.
- Preserved `#` inline comments and `//` floor division expressions.
- Kept inline `//` comments unsupported for v1; they return controlled interpreter errors instead of being stripped.
- Documented the comment decision in `docs/DECISIONS.md` and `docs/LANGUAGE_REFERENCE.md`.
- Added `docs/BACKEND_DEPLOYMENT.md` for Render/Supabase backend live-service settings.
- Removed the resolved `//` comment item from `docs/OPEN_QUESTIONS.md`.
- No live Supabase or Render changes were made.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 34 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py engine/app.py` -> passed.
- Direct sandbox smoke: `// lesson starter` plus `PRINT 5 // 2` -> `['2']`.

Local note:

- Flask is not installed in the local Python, so HTTP wrapper test-client verification was skipped. Render installs `engine/requirements.txt`.
- Supabase live connector requested reauthentication during planning, so live edge-function verification remains gated.

## Claude -> Codex / Human - 2026-06-15 13:42

Status: Planning (frontend/backend split agreed with the human; no app code changed)

Decision: clean frontend/backend split.

- Claude owns FRONTEND only: the browser app (`index.html`, `app.js`, `auth.js`,
  `mentor/mentor.js`, `editor/editor.js`, `assets/theme.css`, `config.js`) plus all
  client-side calls (supabase-js auth, `functions.invoke('chat'|'run')`, and
  `from(...)` reads/writes). Claude does NOT deploy server code.
- Codex owns BACKEND: the engine (`engine/*`), the FULL Supabase tier (edge
  functions `chat` + `run`, DB schema/migrations/RLS, lessons + seed content, auth
  settings), `mentor/system_prompt.md`, curriculum docs, examples, tests, and the
  Render engine config + deployed engine URL.
- Human owns: Render deploy + secrets (`OPENAI_API_KEY`, `JARGON_ENGINE_URL`).

Frozen contract (both sides code to this):

- run: `POST /run {code, answers, preset_answers?}` -> `{output[], result(=output),
errors[], status, ask, ask_var, memory, truncated, limits_hit}`.
- chat: client `{messages:[{role,content}]}` -> `{reply}`; persona =
  `mentor/system_prompt.md` + selected lesson `tutor_prompt` + level.
- lesson object the UI reads: `{id, position, title, module, level, tutor_prompt,
sample_code}`. NOTE: `module` + `level` columns do not exist yet (see B3).
- client tables: `lessons` (read), `profiles`/`chat_messages`/`code_submissions` (owner RLS).

IMPORTANT - current LIVE Supabase state (so you don't double-apply):

- Project `qztpieiizmiayzjhezwh` is ACTIVE. Claude already:
  - applied migration `0001_init` (4 tables + RLS + signup trigger + 5 seeded lessons),
  - deployed edge functions `chat` and `run` (verify_jwt: true),
  - set the anon key in `config.js`.
- So `0001_init` is ALREADY applied on the live project; add NEW migrations for schema
  changes (e.g. `module`/`level`), do not re-run `0001`. The deployed `chat` fn still
  uses the OLD hardcoded persona (not `system_prompt.md` yet). The repo `run` function
  now requires `JARGON_ENGINE_URL`; the live function must be redeployed and given that
  secret before the hardened engine is active.

Backend backlog for Codex:

- B1 Engine/language: maintain interpreter+Flask+sandbox; full-line `//` comments are
  now resolved; consider `Jargon.docx` data ops.
- B2 Stabilize `engine/app.py` (`/run`, `/health`) + render engine config; deploy the
  engine, publish the URL here, and set the Supabase `run` fn's `JARGON_ENGINE_URL`
  to it (or hand the secret to the human if not CLI-settable).
- B3 Migration adding `module` + `level` columns to `lessons` (per `merged_curriculum.md`).
- B4 Real per-lesson Jargon programs (`sample_code`) + `tutor_prompt` + level labels as
  seed SQL (replaces the `//` placeholders that currently error).
- B5 Finalize `mentor/system_prompt.md` incl. how lesson/level context is injected, and
  update the deployed `chat` edge fn to use it.
- B6 Map curated `examples/` to modules/lessons; keep `tests/` green.

Resolved in this backend pass: full-line `//` comments are supported alongside `#` comments.

Claude status: holding on all frontend code until the human says go. Frontend backlog is
ready (CodeMirror editor, error/status panel, ASK UX, level-labelled picker, Mentor chat
wiring, auth UX, responsive).

## Claude -> Codex / Human - 2026-06-15 13:10

Status: Finished (scoping pass; no code changed)

Task: Reconcile the already-deployed cloud platform with the Codex rebuild and set shared direction.

Key context Codex did not have:

- A platform is already deployed.
- Supabase project `qztpieiizmiayzjhezwh` is active with schema/RLS migration applied, 5 seeded lessons, and live edge functions `chat` (OpenAI `gpt-4o`) and `run` (proxy to `JARGON_ENGINE_URL`).
- Front-end and `render.yaml` are on branch `claude/happy-johnson-wseex8`.
- The web runner is partly built; do not build a competing auth/persistence backend.

Decisions made with the human:

- Backend: keep Supabase + Render. The hardened interpreter becomes the Render engine that the existing Supabase `run` edge function calls.
- Division of labor: Codex owns engine/interpreter/examples/curriculum extraction; Claude owns front-end/platform/Supabase/Render wiring.
- Repo: one repo, `jargon`. Interpreter lives in `engine/` with a thin Flask wrapper; platform lives at root; both branches merge to `main`.
- Result shape: standardize on `run()` dict `{output,memory,errors,ask,ask_var,status,truncated,limits_hit}`. Flask wrapper also exposes `result = output` for existing `editor.js` compatibility.
- Curriculum: merge the 5 deployed lessons (Purpose, Systems & Signals, Signal Processing, Memory, Exchanging Signals) into the Processes/Coding/Prompting modules. Audience is mixed, with level labels.
- Mentor: rebuild as "logic coach + Python bridge" (natural speech -> pseudocode -> Jargon -> Python), as a teaching layer over the runtime, not the runtime.

Requests for Codex:

1. Commit a thin Flask wrapper in `engine/` (`POST /run {code,answers}` -> result dict with `result=output` alias; `GET /health`) using `run_sandboxed()`.
2. Commit `examples/` plus the full 131-file corpus under `legacy/examples/`.
3. Commit the curriculum docs (`Jargon Modules Overview` + `Jargon.docx`) as text/Markdown in `docs/`.
4. Surface the archive Jargon Mentor system prompt into the repo so Claude can rebuild the chat layer around it.

Open/deferred:

- Comment syntax (`//` vs `#`) is deferred. The deployed lessons currently use `//`, which the interpreter rejects.

Suggested next task for Codex:

- Complete items 1-4 above, starting with the Flask wrapper.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Apply Claude's scoping handoff into the canonical repo.

Summary:

- Integrated the Supabase/Render platform files from `origin/claude/happy-johnson-wseex8`.
- Moved the hardened interpreter into `engine/` and left a top-level import shim for compatibility.
- Added a Flask engine wrapper at `engine/app.py` using `run_sandboxed()` with `result = output` alias and `/health`.
- Imported curated examples into `examples/` and the full 131-file corpus into `legacy/examples/`.
- Extracted curriculum docs into Markdown under `docs/curriculum/`.
- Surfaced the archived Jargon Mentor prompt at `mentor/system_prompt.md`.
- Updated decisions and open questions to match the agreed Supabase + Render direction.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 31 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py engine/app.py` -> passed.

Local note:

- Flask is not installed in the local system/bundled Python, so the HTTP wrapper was syntax-checked but not exercised through a local Flask test client. Render installs `engine/requirements.txt`.

Suggested next task:

- Claude can continue front-end/platform wiring against `engine/app.py` and `mentor/system_prompt.md`.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Set up cross-agent coordination.

Summary:

- Added shared agent protocol files: `AGENTS.md`, `CLAUDE.md`, and `CODEX.md`.
- Added coordination docs: `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, and `docs/OPEN_QUESTIONS.md`.
- The canonical repo currently has a hardened interpreter, example loader, docs, and validation tooling.

Tests run:

- `python3 -m unittest discover -s tests -q`
- `python3 tools/validate_examples.py /Users/elias/Desktop/jargon/02-examples /Users/elias/Desktop/jargon/03-web-runners/Jargonn/130`

Suggested next task:

- Rebuild the web runner/API around the stable `StructuredJargonInterpreter.run()` result shape.

## Archive

Earlier context:

- Desktop folder was organized into canonical, legacy Python, examples, web runners, docs, notebooks, branding, archives, and misc assets.
- Canonical repo was rebuilt and pushed at commit `85ab0db`.
- The legacy example corpus validated cleanly after adding example extraction, smart canned ASK answers, and bounded exponentiation.

## Codex -> Human - 2026-06-24

Status: In progress until live activation

Task: Pre-UI-cleanup platform completion sprint.

Summary:

- Added additive platform-completion schema for CSV imports, Google Classroom write-back mappings, data export/retention requests, guardian/report foundations, consent settings, and draft curriculum import suggestions.
- Extended `admin-ops` with CSV roster preview/apply, student archive export, retention request recording, consent settings, and progress report generation.
- Added `/admin` functional controls for CSV fallback import, student archive/report export, retention/anonymization request logging, and class/org feature controls.
- Added Google Classroom diagnostics and guarded write-sync stubs so missing OAuth secrets and future write-scope requirements are explicit.
- Added Voice v2 diagnostics and env-configurable realtime/STT/TTS model names while keeping raw student audio unstored by default.
- Added resource-processing draft curriculum import from teacher-approved chunks. Suggestions are draft-only and require teacher/admin review before any student-visible curriculum exists.

Verification:

- `python3 -m unittest discover -s tests -q` passed.
- `python3 tools/validate_examples.py examples legacy/examples` passed.
- `cd frontend && npx tsc --noEmit` passed.
- `cd frontend && npm run build` passed.
- `cd frontend && npm run lint` passed with the existing 11 warnings.
- `git diff --check` passed.
- `deno check` was not run because `deno` is not installed locally.

Live activation:

- Applied `supabase/migrations/20260624064345_platform_completion_sprint.sql` to live Supabase project `qztpieiizmiayzjhezwh`.
- Edge Function deploy is still needed for: `admin-ops`, `google-classroom`, `voice-session`, and `resource-processing`.
- Supabase CLI deploy was blocked locally because no `SUPABASE_ACCESS_TOKEN` is configured.
- Let Render deploy the frontend bundle from GitHub `main`.
- Smoke `/admin` CSV preview/apply, archive/report export, consent settings, Google diagnose, Voice diagnose, and draft curriculum import from approved media chunks.

## Claude -> Codex / Human - 2026-07-01 14:10

Status: Done — live-voice fix shipped (backend v5 + frontend on main)

Task: "Fix the audio chat" — the live voice (WebRTC ↔ OpenAI Realtime) feature had never
worked end to end.

Summary:

- Root cause chain (fixed layer by layer against OpenAI's exact errors):
  1. `voice-session` edge function was never deployed → wired it into `deploy-backend.yml`.
  2. SDP handshake to `/v1/realtime/calls` failed ("unmarshal SDP: EOF", then "field 'sdp'
     not found"): Deno `FormData` mangled the offer. Hand-built the multipart with `sdp` and
     `session` as plain fields, each with its own Content-Type (`application/sdp` /
     `application/json`) — matching OpenAI's documented curl and their codex WebRTC client.
     Validated by round-tripping the exact body through a standard WHATWG multipart parser.
- Adversarial multi-agent review of the whole path (backend session config, WebRTC lifecycle,
  submit_voice_turn governance loop, cross-layer contract) surfaced 8 distinct real defects;
  all fixed:
  - Backend: a telemetry/DB write failure after OpenAI's 201 discarded a working answer SDP and
    returned 500 → wrapped best-effort writes in try/catch; always return the SDP.
  - Frontend (iOS-critical): remote Mentor `<audio>` was detached from the DOM and never
    `.play()`'d → append to DOM, `playsInline`, play in the user gesture (iOS Safari was silent).
  - Frontend: no connection-state monitoring → drive "live" off `pc.connectionState`, recover on
    `failed`, add a STUN server + a 15s connect timeout.
  - Frontend: `maybeHandleFunctionCall` fired on streaming `.added/.delta` shapes (empty args) →
    only act on a completed call with non-empty args; don't reserve the callId until confirmed.
  - Frontend: stale-status closure in the data-channel `close` handler → mirror status via a ref.
  - Governance: firmed up the realtime instructions so the model must route every answer through
    `submit_voice_turn` and never self-grades.
  - API: realtime handshake fetch timeout 20s → 35s for slow mobile / edge cold start.

Files changed:

- `supabase/functions/voice-session/index.ts` (multipart + content-types + telemetry try/catch +
  instructions)
- `frontend/src/routes/chat.tsx` (RealtimeVoicePanel: audio playback, connection recovery,
  function-call guard, status ref)
- `frontend/src/lib/api.ts` (`createRealtimeVoiceSession` timeout)
- `.github/workflows/deploy-backend.yml` (voice-session added to triggers + deploy step)

Tests run:

- Frontend: `npx tsc --noEmit` 0 errors; `npm run lint` 0 errors (12 pre-existing warnings, none
  in chat.tsx); `npm run build` green.
- Multipart round-trip validation via a standard parser (sdp non-empty field; session parses JSON).
- `deno check` not available locally (deno not installed) → covered by the adversarial review.

Live activation:

- `voice-session` deployed to `qztpieiizmiayzjhezwh` at **version 5** via the Supabase Management
  API (the CLI path hit a transient Supabase "Failed to set function store" 500 twice; the direct
  Management-API deploy succeeded). The `deploy-backend.yml` run for 5cf56d8 shows red only because
  of that CLI blip — the function is deployed correctly.
- Frontend fast-forwarded to `main` (5cf56d8) → Render auto-build.

Remaining concerns:

- The realtime model default is `gpt-realtime-2` (env `OPENAI_REALTIME_MODEL`). If a live retry
  fails, the backend now records OpenAI's exact error to `voice_interaction_events`
  (`voice_session_failed`) — check there first; a wrong model name would surface as a clear 4xx.
- Live mic behavior can only be verified on a real device (sandbox has no mic / egress).

Suggested next task:

- User re-tests live voice on device; if it still errors, pull the latest `voice_session_failed`
  row's `payload.error` and fix the next layer (most likely the model name or a session-config
  field). Optional follow-ups the user floated: ElevenLabs read-aloud TTS; set an explicit
  `OPENAI_REALTIME_MODEL` secret.

## Claude -> Codex / Human - 2026-07-02 00:30

Status: Starting
Task: Tutor v2.0 Phase A — correctness quick fixes (stale quiz choices, unified send gate,
completion state, scroll, realtime auth refresh, voice dedup, client_msg_id; backend model
routing fix, runTimedOut status-keying, rate-limit role filter, pedagogy-block try coverage).
Full plan in the session plan file; phases B-D follow (flow core w/ step_state, instruction
layer consolidation, latency).
Files I expect to touch: frontend/src/routes/chat.tsx, frontend/src/lib/api.ts,
frontend/src/lib/types.ts, supabase/functions/chat/index.ts
Notes: each phase independently deployable; wire envelope stays compatible in Phase A.
