# Decisions

Record durable project decisions here. Add new entries at the top.

## 2026-08-15: Flow is a first-class object — the five-pillar rebuild begins

Owner asked how to make the flow logic bulletproof after live testing showed mode
hopping, phantom sections, and mislabelled checkpoints. Diagnosis (agreed): flow was
never an object — the client re-derived it every render from per-turn stamps, the
register had five independent writers, and the directive ladder is an unenumerable
if-chain. The rebuild lands in five slices; each ships alone.

- **Pillar 1 (this slice): the server-written flow event log.** Every mentor turn's
  envelope + persisted payload carries `flow: FlowEvent[]` — mode_changed / revisit_opened
  / revisit_resumed / checkpoint_opened / step_advanced — written where each fact is
  decided. The transcript renders section boundaries from the record; inference remains
  only as the fallback for pre-log turns. Spec: PLATFORM §12.
- **The register-shift invariant** (server-enforced from now on): the mentor stamp may
  differ from the previous student register only when a persisted student turn declared
  the new one. An empty-body turn can never shift the recorded register again.
- **`session_resumed` deferred deliberately.** It was in the plan, but with no renderer
  it would be a dead contract — the exact disease Pillar 5 removes. It ships with the
  divider that consumes it.
- **Revisit dividers say so.** "Revisit · Step N/M · title" on the recorded jump —
  before, the step eyebrow silently pointed backwards, which read as "hopping around".
- Pillars 2–5 queued: one client register reducer (invariant: no register change
  without a student-visible action), the directive decision table + completeness test,
  property/simulation tests over the turn machine, and dead-contract retirement.

## 2026-08-16 (evening): Pillar 5 — dead flow contracts retired

- **continue_offer left the platform end-to-end** (emission, envelope field, replay
  passthrough, client model + restore, the caller-less sendContinue). It had no
  renderer since R31b removed the button; typed readiness (CONTINUE_SIGNAL_RE /
  CONTINUE_PHRASE_RE, R34) is the advance verb. The `continue` CONTROL is still
  parsed server-side for tabs open since before R31b. e2e fixtures now assert the
  gate (advanced true/false + turn_kind), not the dead pill.
- **Control turns ride the live register.** The hardcoded "lesson" on resume/
  navigate/control-retry made the server's REGISTER SHIFT nod fire on a stepper
  click and stamped the live message differently from its replay; controls now
  declare the current register (the ceiling exemption is untouched — controls are
  deliberate button presses either way). sendModeOffer alone declares offer.mode:
  it IS the register change.
- Remaining from the original five-pillar plan: only Pillar 3's ladder-to-table
  rewrite, deliberately parked (see the Pillar-4 entry) — the executable witnesses
  already provide the enumerability it was for.

## 2026-08-16 (later): Pillar 4 lands BEFORE Pillar 3 — the flow core runs under test

Re-sequenced deliberately. Mapping turnDirective for the planned table conversion
showed a ~30-rung ladder over ~15 predicates — forcing that into a (phase, register,
kind, gate) matrix would be a fake table or an explosion, and it is the single most
regression-prone rewrite in the codebase. So the harness came first:

- **The chat fn is importable under test.** `Deno.serve` sits behind
  `!Deno.env.get("JARGON_FLOW_TEST")` (never set in the edge runtime → production
  byte-identical), and the pure core (applyTurn, deriveTurn, applyModeCeiling,
  stepDone, requirementsFor, turnDirective, the readiness regexes) is exported.
- **tests/flow_core.test.ts executes the spine** — gate monotonicity over random
  sequences, the acknowledge doors, complete-iff-done, the ceiling's full mapping,
  per-rung reachability witnesses for the ladder, precedence + purity fuzz, and
  recognizer closure — driven from the Python harness via a jsr-stripped scratch copy
  (skips cleanly when deno is absent).
- **Fuzz respects reality**: requirement vectors derive through the real
  requirementsFor coupling. The first unconstrained run minted phantom
  `practice_concluded`-style keys — unreachable in production precisely because of
  that coupling — which also surfaced a latent key ambiguity: the
  `${stepMode}_concluded` template can collide with the hand-written
  assessment_concluded / revision_concluded keys if those modes ever gain an
  acknowledge gate. Noted for the Pillar 3/5 cleanup.
- **Pillar 3's scope question is now honest**: with every rung reachable, keyed, and
  precedence-fuzzed, the physical rules-array rewrite buys less than planned. Decide
  after living with the harness; the witnesses already ARE the completeness test.

## 2026-08-16: Pillar 2 — the client register has one owner

The register moved from a bare useState in StudentApp (four scattered writers; every
send call site threading turnMode by hand) into `useConversation` behind ONE
`setRegister(mode, cause)` seam. Causes are the closed set of student-visible actions:
picker | offer | suggestion | lesson_open. Sends take no mode parameter — they read
the register at the owner — so the R33c wrong-mode class is structurally unwritable.
Retry keeps a one-shot override (re-send in the failed turn's register) and never
moves the sticky register. Accepting a hand-off pill flips the register inside
sendModeOffer itself, so the picker move and the control send cannot come apart.
Deliberately unchanged: control turns (Continue/resume/navigate) still declare
"lesson" on the wire — the server's Pillar-1 stamp rule makes the declared mode inert
for the record when no student row persists; aligning the live-message stamp with the
replay stamp is queued for Pillar 5. Spec: PLATFORM §12.4.

## 2026-08-12 (evening): My Jargon, publish-time knowledge drafting, Wael loop closed

Executing the rest of the Wael-feedback map (owner: "plan it all out, go for it"):

- **"My Jargon" is the student vocab surface** — Wael's name, adopted verbatim. A Home
  section listing every word the student has collected (student_vocab x vocab_terms:
  term, child-readable definition, home subject), with a "bridges subjects" marker once
  a word has traveled into a second subject. Cache-invalidated by vocab_events so a
  word met mid-lesson appears on the next Home visit.
- **Publishing a lesson auto-drafts its knowledge.** publish_lesson now schedules
  extract_knowledge in the background for lessons with no knowledge rows yet — Wael's
  "objectives and vocab happen automatically with uploading content". The existing hard
  rules hold unchanged: drafts only, teacher review in the studio Knowledge tab gates
  everything, re-publish never duplicates, a failed extraction never fails the publish.
- **Vocab extraction binding was already correct** (R31 bound sighting to the MENTOR's
  teaching text — Wael's exact complaint, fixed before his comment surfaced) — verified
  and left alone; the gap was telling him.
- **The Claude workspace actor replies on feedback threads.** Posted the catch-up reply
  on Wael's Jargon thread in chapters-co-workspace (same agent_request_id shape as its
  existing status updates). Whether the feed gets a ROUTINE sweep stays open
  (OPEN_QUESTIONS).

## 2026-08-12 (later): North-star prompt philosophy; artifacts are downloadable

Prompted by wael.nasr's workspace feedback ("guardrails need to be minimal with primary
restriction to the lesson's learning objectives... achieve learning objectives by any
means necessary") and the owner's framing ("an AI north star — skiing a path rather
than avoiding trees"):

- **The mentor prompt LEADS with a destination, not prohibitions.** A NORTH STAR
  preamble now opens SYSTEM_PROMPT: carry this student to the lesson's objectives by
  whatever honest teaching serves — examples from anywhere, bridges to other subjects —
  with the integrity rails (no handed-over answers, no unearned credit, teacher policy)
  restated inside the preamble as what the rails protect. Existing rules are unchanged
  this pass (they are the tuned edges of the run); subsequent passes convert prohibition
  clusters into positive direction one at a time, each validated against live
  transcripts via the e2e script. The reframe is additive first so teaching-quality
  regressions can never hide inside a big rewrite.
- **Artifacts are downloadable.** Decks export as a self-contained print-ready HTML
  handout (client-built from the validated DeckSpec, everything escaped, print CSS for
  PDF); html_sims download as their .html behind the SAME safety lint that gates
  running them — a document the sandbox refuses to run is a document we refuse to hand
  out. Telemetry rides the existing `downloaded` resource-interaction event. This
  answers Wael's Aug 9 workspace question directly.
- Remaining Wael items (vocab extraction binding, authoring-time vocab/objectives,
  "My Jargon" surface, project-assist path, workspace reply loop) are recorded in
  OPEN_QUESTIONS (2026-08-12) pending decisions.

## 2026-08-12: Claude is the tutor's default provider; conversation-flow R33 pass

Owner asked for the switch to the Claude API and a model ramp-up for higher-quality
teaching with a simpler, less breakable runtime:

- **`TUTOR_PROVIDER` defaults to `anthropic`.** The mentor conversation runs on
  `claude-opus-5` (the current Opus tier: strongest sustained-conversation quality at
  $5/$25 per MTok); the understanding/grading route stays pinned cheap on
  `claude-haiku-4-5`, preserving the strong-conversation/cheap-grader split.
  `claude-fable-5` was considered and deliberately NOT defaulted: it is 2x the price,
  requires 30-day data retention, and its edge is deepest long-horizon agentic work —
  not per-turn tutoring. It remains one env var away (`TUTOR_MODEL_CONVERSATION`).
- **The OpenAI path is kept, not removed** — `TUTOR_PROVIDER=openai` runs it unchanged,
  and a missing-key deploy falls back to whichever provider has a key instead of
  failing every turn.
- **Claude effort defaults: conversation `medium`, graders `low`** — interactive
  tutoring is latency-sensitive and Claude Opus 5 stays strong at medium; env-tunable.
- **Prompt caching is part of the contract now**: the static system prompt and the
  step-stable half of the mentor payload ride `cache_control` breakpoints (the payload
  is partitioned into a stable block + a live block — same key paths, two JSON parts).
  Cache-hostile keys (recent_questions, materials.opened, mastery) live in the live block.
- **Variety comes from data, not temperature** (Claude models reject sampling params):
  the mentor now sees its own recent openers (`student.recent_openers`) and a widened
  window of its recent questions, making the anti-repetition rules checkable instead of
  aspirational.
- **R33 conversation-flow pass** (client): the send lock holds until the paced reply
  settles; raw `[[material/figure/action]]` markers never stream as visible text; the
  settle swap no longer re-animates the reply; stream failures keep the partial prose
  with Retry (in the original register); the composer stays typeable while a reply paces
  out (busy gates Send/Run only); autoscroll stops fighting the stream and a Jump-to-
  latest pill returns a scrolled-up student; the Resources pill reports the accumulated
  tray and survives reloads. Server: malformed mentor JSON degrades to the streamed
  prose instead of erroring the turn; refusal/truncation surface as calm student-safe
  errors; transient 429/5xx get bounded retries.

## 2026-07-30 (late): Trunk unification — v6 /learn wins, main becomes the single trunk

Owner decisions after discovering the parallel v6 rebuild on claude/happy-johnson-wseex8:

- **The v6 /learn surface is THE student surface.** The old /chat (and my same-day refinement
  of it) is retired; frontend/src/student/** + routes/learn.tsx carry the product. roleHome
  sends students to /learn.
- **Codex's TurnMode design supersedes my chat_mode implementation.** One vocabulary:
  TurnMode (message) / StepKind (authored step) / InputSurface (text-vs-code). The server
  ceiling (applyModeCeiling) restricts what a turn may discharge and never relabels it;
  discuss/open can never close a progression gate. Four always-modes in the dropdown
  (Lesson/Practice/Discuss/Open) + conditional inline pills (Quiz/Homework/Resources) driven
  by envelope.available.
- **Memory v1 rides the v6 chat fn** (grafted; tests/test_memory_v1.py pins it).
- **The v7 review removal stands.** Spaced-review UI stays retired; review backend stays
  inert; my same-day ReviewDueChip reconnection was dropped.
- **main is the single trunk.** Both long-lived agent branches collapse into main; deploy
  workflow, tests workflow, render.yaml, and the Render services all point at main. The
  two-agent two-branch split (each agent believing its branch was canonical) caused a full
  day of divergent work on the same feature — never again.
- **docs/DESIGN_V6.md is canonical for the premium pass** (three-role design language,
  three.js ambient system, motion rules, inline-media contract).

## 2026-07-30: MVP strip-down — this branch keeps only surviving code

Product-owner decisions (no live users at decision time):

- `claude/project-scope-mvp-o7ox0y` is the MVP branch: cut code is REMOVED from it,
  `main` remains the full archive. Nothing is hidden behind flags.
- The student experience is the product's center. It gains seven student-facing chat
  modes — open, lesson, practice, discuss, quiz, assessment, resources — replacing the
  never-surfaced `MentorMode` stance vocabulary.
- Memory v1 ships light and high-yield: per-session summaries + a rolling per-student
  narrative profile, both prompt-fed and student-visible, layered over the existing
  per-skill mastery/misconception memory. The "never reference past sessions" mentor
  guardrail relaxes to "only what student.memory provides".
- Teacher keeps a class-centric core (class cards, hotlist, overview, roster, gradebook,
  assignment + assessment builders/grading, slim resource upload, student transcript
  with watch-live/pause/tips) plus studio-lite authoring with the AI drafter. The media
  extraction pipeline, reports/CSV, analytics/risk duplicates, comms UI, and all
  integration UIs are cut from this branch.
- Admin is three tabs: Seeding (demo logins are the MVP entry story), Live, Cost.
- DB migrations and edge functions are never deleted (applied/live, additive-only);
  out-of-scope backend stays deployed but dormant (canvas, google-classroom,
  resource-processing pipeline, comms tables).
- Voice is in the MVP with the best available server voices — verified already true
  as-built: dictation/read-aloud/live-voice are always-on by design, `voice-session`
  defaults to the newest models (`gpt-realtime-2`, `gpt-4o-mini-tts`, marin default
  voice), and read-aloud prefers server TTS with browser fallback. No change needed.
- A small multi-subject demo catalog is seeded alongside Book F.
- The full inventory lives in `docs/MVP_SCOPE.md` (canonical for this pass).

## 2026-07-17: Artifacts P8 — live mentor artifacts are student-private, consent-first, and service-role-isolated

Three coupled decisions for live mentor-generated artifacts (product owner chose "student-private
but shareable" scoping and "offer + tap" triggering):

- **Student-private scoping via first-class columns, not metadata.** `lesson_resources.student_id`
  + visibility `'student_private'` + a scope CHECK, enforced in `can_view_lesson_resource` — a
  metadata-only scope would have been advisory (RLS, the chat loader, and teacher lists never read
  metadata for authorization). CRITICAL detail: the function's legacy class-null org fallback
  branch (0009) was never visibility-gated, so the P8 migration fences it with
  `visibility <> 'student_private'`; without the fence a student-private row carrying an
  organization_id would be readable by every org member. The storage read policy needed no change
  (the exact-name policy delegates to the function). Teachers keep oversight via can_manage and
  promote with "Share with class" (visibility → class_private, student_id cleared).
- **Consent-first offer over mentor auto-build.** A chat turn is one blocking POST with a 30s
  client budget; generation takes 30–90s — it cannot run inside a turn, and hiding it there would
  need streaming/queue infrastructure that doesn't exist. So chat emits `artifact_offer`
  (continue_offer's tri-state contract, decided pre-model so prose and pill agree), the client
  calls artifact-live directly (150s timeout, its own "building…" bubble), and an
  `artifact_ready` control turn re-enters the normal loop so the card persists in
  learning_turns.payload like every other resource. Offers never fire on
  assessment/revision/open-ended/quiz-gated steps (answer leak) and at most once per step.
- **Service-role isolation.** chat/index.ts stays student-JWT-only forever (now pinned by
  `assertNotIn("SERVICE_ROLE", CHAT)`); the privileged writes live in the dedicated artifact-live
  function following voice-session's posture (caller JWT proves identity, service key writes).
  Every gate — session ownership, lesson opt-in, step-kind exclusions, duplicate reuse, hard caps
  counted from model_usage_events with failures included — runs BEFORE the first model call (a
  tested string-offset invariant). The FORBIDDEN lint table is now triplicated
  (frontend / curriculum-admin / artifact-live); the parity test pins all three byte-identical.

## 2026-07-06: Post-v4.0 Phase 5 — ad-hoc review sessions via a GREENFIELD table (not the lesson_id relaxation)

The roadmap framed P5 as "relax `learning_sessions.lesson_id` NOT NULL" so an ad-hoc review could be a
learning_sessions row with no lesson. An exhaustive blast-radius map (workflow, 4 parallel readers over
backend/frontend/DB/requirements) rejected that path and chose a **dedicated `review_sessions` table**:

- Relaxing the NOT NULL modifies the single table the live turn loop, the completion gate, and the entire
  teacher/admin join surface all read from. It **breaks the exact resume query** it is meant to add
  (`chat` loadOrCreateSession filters `lesson_id=eq.{lessonId}` — a NULL can never match `=eq`), and to
  persist a review transcript it would force NOT NULL relaxation on **`learning_turns` + `lesson_attempts`
  too** (both `lesson_id`/`session_id` NOT NULL) — three hot-path tables. The "1216/1216 rows are non-null"
  invariant every defensive guard was written under would be quietly retired.
- `review_sessions` is greenfield: the live tutor **never reads or writes it**, so it carries ZERO
  regression risk to the turn loop, the gate, the resume path, and every existing teacher join. Resume is a
  clean id-only lookup with none of the lesson-binding hazard. RLS mirrors the established boundaries
  (owner `user_id=auth.uid()` FOR ALL; teacher SELECT via `can_view_student`).
- The spaced-repetition ANALYTICS need no new storage — they already ship from the P4b review handler
  (`learning_evidence` mode='revision' + `student_mastery.last_practiced_at`). The table only adds a
  durable, teacher-visible SESSION record on top. Deliberately did NOT touch learning_sessions /
  learning_turns / lesson_attempts. This is the "highest-risk" roadmap item made low-risk by picking the
  isolated object over the shared one.

## 2026-07-05: Post-v4.0 Phase 3 — teacher hold + interventions-as-record

- **A teacher can PAUSE the live Mentor, and the pause is a fail-open SERVER gate — not a client-only
  visual.** A `session_holds` table (one toggleable row per session) is the signal; the chat edge fn
  reads an active hold right after loading the session (before any pedagogy/model work) and, if held,
  returns a benign "your teacher paused" envelope instead of running the mentor — no grading, no
  writes. The read happens under the STUDENT's own JWT (RLS lets a student read their own hold; the
  chat fn holds no service-role key), and the whole gate is wrapped so ANY error falls through to the
  normal turn. This is the deliberate safety posture: a paused session must never become a stuck
  session, so a hiccup fails toward "let the student keep going," never toward "locked out." The
  student sees a paused banner + a locked composer via realtime; the teacher toggles Pause/Resume from
  the live-watch view.
- **Interventions become durable, reviewable evidence.** Both a live tip and a hold now also write a
  session-linked `learning_evidence` row (`source_type='teacher_note'`, `created_by`=teacher,
  `teaching_move='teacher_intervention'`), on top of the pre-existing `teacher_live_comments` row +
  `transcript_heatmap_events` marker. These evidence rows carry no `mode`/`score`, so they show in the
  student's evidence/transcript review and teacher analytics WITHOUT polluting mastery tiers or the
  by-mode proficiency surfaces. The evidence write is best-effort — a failure never breaks the tip or
  the pause.

## 2026-07-05: Post-v4.0 Phase 2b — submission scanning + retention posture

- **Scanning is a provider-READY scaffold, not a bundled provider.** `assignment_submission_files`
  gets its own `scan_status` (pending/clean/quarantined/skipped) — separate from the lifecycle
  `status` enum — and a system-only `submission-maintenance` edge fn drains the pending queue. With no
  `SCAN_API_URL` configured, pending files become `skipped` (unscanned but readable); enabling a
  provider later scans only NEW uploads (a retroactive re-scan is a manual op). The security win that
  ships today regardless of a provider: the storage SELECT policy blocks `quarantined` (and purged)
  files, so a flagged file can never yield a signed URL — the quarantine gate is real the moment a
  provider flips a row. We rejected self-hosted ClamAV (no worker infra in a Supabase-serverless +
  Render-static stack) and rejected doing nothing (the scaffold is cheap and future-proofs the gate).
- **Retention purges BYTES, keeps the row as a tombstone.** The same fn's `retention` action removes
  the storage object of files older than `SUBMISSION_RETENTION_DAYS` (default 365 ≈ 12 months) and
  stamps `purged_at`; the DB metadata row persists so the record (who submitted, when) survives. The
  clock is the file's `created_at` (≈ assignment close, within days) to avoid a fragile join. Only the
  service role can delete bucket objects (no DELETE RLS policy exists), so the sweep runs as the
  trusted system caller from a daily GitHub Actions cron — the same pattern as canvas-sync.

## 2026-07-05: v4.0 Completion Pass — durable choices from the polish/finish tiers

After P0-P5 shipped, a four-tier polish pass (T1-T4) landed with these durable decisions:

- **The `notifications` table is an ADDITIVE persistent surface, not the hotlist swap.** The teacher
  bell (unread badge + dropdown) carries the one kind with a clean service-role writer
  (`assessment_to_review`); `HotlistFeed` still derives all seven kinds client-side. The chat-side
  `mentor_recommendation` writer was REMOVED — chat runs under the student JWT with no service-role
  key, so its insert was denied-and-swallowed (dead on arrival), and adding a service-role key to the
  live tutor to fix it was rejected as a privilege-surface increase. The full data-source merge is
  deferred (see `docs/OPEN_QUESTIONS.md`).
- **Grade integrity on self-attested checkpoints is enforced by a trigger, not RLS.** Assignments are
  self-attested (a student marks status from the dock), but the whole-row update grant let a student
  self-set their own `score`/`final_score`/`feedback` via a raw PostgREST PATCH. RLS cannot
  column-scope an UPDATE (both students and teachers are the `authenticated` role, and `WITH CHECK`
  can't see the OLD row), so a `BEFORE UPDATE` trigger on `assignment_recipients` +
  `checkpoint_recipients` pins the graded columns to their prior values when `auth.uid() = new.user_id`.
  Teacher grading (different uid) and service-role writes (null uid) pass through; the dual-write's
  `SECURITY DEFINER` keeps `auth.uid()` = the teacher so the mirror carries the real grade.
- **Teacher access to admin-ops is a class-membership tier, dispatched before the admin gate.** The
  teacher report + class-CSV actions authorize via `class_memberships` (role=teacher, status=active),
  routed BEFORE `fetchActorAccess` (which throws for non-admins), and strictly validate the actor
  teaches the class / the target is an active student in it — the service-role query literals mirror
  the `is_class_teacher` / `can_view_student` RLS predicates exactly.
- **The "Live" surfaces poll (no realtime).** Teacher dashboard + admin Live tab refresh every 30s
  (foreground only); a realtime channel is a later option, not a v4.0 requirement.
- **The Python test suite is a CI gate.** `.github/workflows/tests.yml` runs
  `python3 -m unittest discover -s tests` on push (branch + main) and PR; drift between the
  string-fingerprint tests and the source is a failing build, not silent rot.
- **`px-3 py-1.5 text-[12px]` is a valid console action-button size.** It's the dominant size in the
  teacher console (7 uses vs 4 of `px-4 py-2`); the two v4.0 buttons were deliberately NOT enlarged.

## 2026-07-05: v4.0 Phase 3 — Class→Course Scoping is a Fail-Open UX Filter, Not an Access Boundary

Decision:

- A new `class_courses` link table (unique class_id+course_id) records which courses a class's
  students should see. The student's browse catalog (`fetchStudentCatalog`) is derived from it,
  but scoping is a UX filter over data the student can ALREADY read — lesson read-RLS stays open;
  the scoped set is always a SUBSET of the full published catalog, so scoping can never expose a
  lesson a student couldn't otherwise reach. Tightening lesson RLS to enforce scoping as a real
  boundary is explicitly deferred (it risks cutting off the live student).
- Fail-OPEN everywhere, so the live student is never worse off than today:
  - An unlinked class contributes the FULL catalog. The visible catalog is the UNION across the
    student's active classes, so a student is only narrowed when EVERY one of their classes is
    scoped; being in any unlinked class shows everything. (A brand-new empty table = every class
    unlinked = byte-identical catalog for the current live student.)
  - An empty scoped result (links point only at courses with no published lessons) falls back to
    the full catalog rather than a blank screen.
  - The student's currently-open lesson is pinned into the catalog even if scoped out, so scoping
    can never strand a student mid-lesson with no path back to their in-progress work.
- The teacher write (`set_class_courses` in curriculum-admin) is a fail-safe replace: UPSERT the
  desired links, THEN delete the ones no longer wanted (insert-before-delete). The two PostgREST
  calls are not one transaction, so on a transient failure the worst case is a stale extra link
  (fail-open) — never an accidentally-cleared scope. Course ids are org-validated against the
  class's own organization (global/null-org courses allowed), mirroring the other authoring
  actions' org discipline. The action is auth-gated by `assertCanAuthor` on the class's org.
- RLS: `class_courses` SELECT = `is_class_member` (a student reads only their own classes' links);
  write = `is_class_teacher` with `created_by = auth.uid()` (audit column can't be spoofed on a
  direct write). anon revoked.

Reason:

- The overriding constraint is that a real student is live in production. Every scoping decision
  is chosen so the live student's experience is identical until a teacher deliberately links
  courses, and so that no teacher action can hide a student's in-progress or accidentally blank
  their catalog. An adversarial review (12 confirmed findings) drove the union semantics, the
  pinned-lesson rule, the insert-before-delete replace, the org-scoped validation, the non-capped
  course list, and the spoof-proof audit column — all before the first deploy.
- Keeping scoping as UX-only (not an RLS boundary) lets the enabler ship safely now; the harder
  RLS-tightening question is separable and deferred to a later phase.

## 2026-07-02: Tutor v2.0 Instruction Layer — One Directive Ladder, Orchestrator-Only Grading

Decision:

- The mentor model receives ONE composed per-turn instruction (`turnDirective()` priority
  ladder: post_completion › runtime_timeout › understanding_demonstrated › code_objective_met
  › step_concluding_stuck › quiz_first_presentation › quiz_passed › quiz_wrong ›
  quiz_active_chat › run_failed › explanation_pending › present_step › converse) placed as
  the LAST key of the user JSON. The teaching method (lightest-help ladder, hint rungs,
  ceilings) lives once in the static SYSTEM_PROMPT — there is no per-turn "recommended
  teaching move" selector anymore.
- Grading is deterministic-only: the mentor's output contract is reduced to
  {reply, understanding, misconception}. Its free-form `assessment` no longer merges into
  grades, records, or teacher counters; `assessment = effectiveOrchestratorAssessment`
  (assessAnswer + the capped semantic code judge). checkUnderstanding remains the hard gate
  for text-step completion, with the mentor's `understanding` only as fallback telemetry.
- The user JSON is ordered STABLE → VOLATILE (lesson/activity/milestone/arc/resources/policy
  first, step_contract/quiz/history/turn last, directive very last) so the static system
  prompt + session-stable prefix stays cacheable while the directive sits closest to
  generation.
- `learning_evidence.teaching_move` now records the directive key (e.g. "quiz_wrong",
  "present_step") — the honest label of what the turn was about.

Reason:

- Three overlapping decision engines (flowFor, selectTeachingMove+MOVE_GUIDANCE, six ad-hoc
  directive strings) emitted contradictions the prompt then had to un-say, in a 5-9k-token
  payload. One authoritative directive plus one static method section is coherent, auditable,
  and roughly halves the prompt.
- Mentor-sourced grades were never trustworthy (the v1.x loop bugs all traced to the model
  contradicting the deterministic layer); making the orchestrator the only grader makes every
  teacher-facing number deterministic.

## 2026-06-27: Teacher/Admin URL Spine Mirrors The Domain

Decision:

- The teacher and admin consoles are organized to mirror the real entity hierarchy:
  Organization -> Class -> Student, with the curriculum Lesson as a cross-section and
  "work" (assignments/assessments/resources) as the bridge between a class and a lesson.
- Drill-down state lives in the URL, not component state, so views are deep-linkable and
  the browser back/forward button traverses the hierarchy.
- Teacher uses **path params**: `/teacher`, `/teacher/class/$classId`,
  `/teacher/class/$classId/student/$studentId`; active tab via `?tab=`. The shared page body
  lives in `features/teacher/TeacherConsole.tsx` and the routes are thin shells reusing it.
  The heavy `fetchTeacherDashboard` is cached with React Query (`["teacherDashboard", userId]`)
  so drill-down across these routes does not refetch.
- Admin uses **search params**: `/admin?org=<id>&tab=<section>`. Admin is a single console
  where org is a context filter and its data loading is state-based across many handlers;
  search params keep it on one route (no remount, no refetch) while staying deep-linkable.
  `selectedOrgId`/`adminTab` are thin shims over `useSearch` + navigate.
- `routeTree.gen.ts` is **hand-maintained** (no `@tanstack/router-plugin` in
  `vite.config.ts`). Adding a route means writing the route file AND mirroring an existing
  block in `routeTree.gen.ts`.

Reason:

- The consoles were organized by feature, but the domain is organized by entity. Matching the
  UI to the data makes navigation predictable and makes the URL a faithful, shareable address
  for "the thing you are looking at."
- Path vs search params is chosen per console by data-loading shape: path params for teacher
  (with a React Query cache to avoid refetch on remount), search params for admin (to get URL
  state without a risky data-layer rewrite).
- Delivered as a phased, build-verified rollout on branch `claude/happy-johnson-wseex8`; see
  `docs/HANDOFF.md` for the Phase 1-4 entries.

## 2026-06-22: Voice Interaction Is First-Class

Decision:

- Students should be able to use dictation for chat answers and hear Mentor replies through read-aloud.
- Future audio session mode should let suitable lessons run by listening and speaking while preserving the same lesson stages, guardrails, rubrics, evidence, and teacher visibility.
- Voice interaction is separate from teacher-uploaded audio resources.
- Dictation submits a transcript, not raw audio, in the first implementation.
- Raw student audio is not stored by default.
- Store transcript text, input modality, optional confidence, timestamps, and audit events.
- Teachers can enable or disable dictation, read-aloud, audio session mode, and voice during quizzes per class/activity.
- Browser speech APIs are acceptable for a first demo slice if they degrade gracefully; backend speech services can come later after cost/privacy review.

Reason:

- Voice makes the product feel more like a private tutor and supports younger students or students who struggle with typing.
- Keeping transcripts as the grading/evidence artifact preserves teacher review, privacy, and LMS consistency.

## 2026-06-22: Product Requirements From Human Review

Decision:

- First audience is school classrooms, roughly grades 3/4-12, while keeping the platform extensible.
- The student experience should feel most like a private tutor.
- Jargon should teach any structured subject through chat, not only coding.
- Student navigation should support Subject -> Chapter -> Lesson.
- Teacher-approved material and teacher rubrics are the source of truth.
- Mentor is strict about the lesson path, adapts to student/class settings, mediates pace, alerts teachers, and recommends assignments/interventions without becoming the source of truth.
- Skill mastery is the primary adaptation signal.
- Curriculum remains teacher/admin editable with publish state, edit history, and audit; hard immutability is not the main safety model.
- Assignments and student file submissions are required for the complete V1.
- In-chat quizzes transform the chatbar into the quiz and blur history; larger teacher-assigned quizzes can live in dedicated quiz/lesson windows.
- Teacher dashboard priority is gradebook, then intervention alerts, then transcript heatmap.
- Live teacher watching is allowed with a visible student-side viewer icon and optional teacher comments/tips in chat.
- V1 requires multiple organizations, org admins, platform admins, audit logs, and DB/RLS-enforced access.
- Learning records are stored indefinitely by default unless a later retention policy changes that.
- LLM calls should use anonymized student data where possible; safe placeholders such as `%firstname%` can be rendered for the student outside the model.
- The next foundation priority is the full database structure: tenants, roles, access, pages, curriculum, resources/files, environment modes, audit, and cost tracking.
- The demo bar is a complete classroom-ready platform slice for a real school test run.

Reason:

- The product is not a content pack or coding toy. It is a platform that gets populated with curriculum.
- Capturing these requirements prevents future implementation drift toward either a simple chatbot or a traditional dashboard-first LMS.

## 2026-06-22: Lesson Resources Are First-Class Chat Media

Decision:

- Teacher-uploaded lesson resources are first-class curriculum support, not the same thing as student file answers.
- Supported roadmap resource types are video, audio, PDF, flipbook, YouTube, image, link, and document.
- Uploaded lesson resources are private by default and should use a private Supabase Storage bucket named `lesson-resources`.
- Default visibility is `class_private`.
- Uploaded resources are served through RLS/signed access.
- YouTube is stored as an external URL, rendered as an embed, and never downloaded or rehosted.
- V1 media is rendered and teacher-described; automatic extraction/transcription comes later.
- Lesson resources should appear inside the chat lesson flow, not as a separate LMS content page.

Reason:

- The product goal is to teach through chat while letting teachers bring real lesson materials.
- Private-by-default media is safer for classroom/student resources.
- Keeping media display separate from automatic extraction lets the product ship useful teacher uploads before building heavier processing jobs.

## 2026-06-22: Complete Roadmap Starts From The Live Vertical Slice

Decision:

- The proof-of-concept bridge is considered crossed: the live app can sign in, run `lesson1`, move through practice -> assessment -> complete, and write session/turn/attempt/quiz/evidence/mastery records.
- The next implementation track is teacher dashboard + media foundation.
- `docs/COMPLETE_ROADMAP.md` is the detailed roadmap; `docs/ROADMAP.md` is the compact current-state summary.

Reason:

- Teacher surfaces need trustworthy runtime records, which now exist.
- Lesson media should be designed alongside teacher workflows so uploads immediately support classroom teaching.

## 2026-06-21: Jargon Is A Chat-First LMS

Decision:

- The product is a chat-first LMS: the student learns in one guided conversation, while curriculum, permissions, assignments, quizzes, mastery, progress, and teacher oversight sit underneath.
- The first real deployment model is teacher-led classes.
- The Mentor may guide, quiz, grade, recommend, and flag, but teacher approval is required for major assignment/course changes.
- Curriculum authoring starts as structured subjects/courses/units/lessons/milestones. Document/PDF import is deferred.
- Authorization lives in database-controlled role/membership tables or server-owned metadata, never user-editable metadata.

Reason:

- The proof of concept proved the chat/runtime loop. The durable product needs classroom structure, accountability, teacher visibility, and safe access control without making the student experience feel like a dashboard.
- See `docs/PRODUCT_ARCHITECTURE.md` for the canonical vocabulary and first milestone.

## 2026-06-15: Pivot To A Conversational Lesson-Runner

Decision:

- The product's primary interface is a stateful, guided conversation that *is* the class
  (begin/end, grades, retry/continue, multiple answer modes: text/code/file/multiple-choice),
  not a free-form chatbot or the split-view. The split-view becomes a legacy stepping stone.
- The `chat` edge function becomes a stateful flow engine (load state -> build cached prompt
  -> structured-output + tool-use turn -> grade -> persist -> advance), not a passthrough.
- Lesson flow is hybrid: authored objectives/checkpoints per lesson + AI conversation,
  enforced by the orchestrator.
- Mentor LLM is decided by a spike comparing Claude tiers (`claude-haiku-4-5` bulk +
  `claude-sonnet-4-6` grading, with prompt caching) vs OpenAI `gpt-4o`, measured on real
  lessons (cost/turn, guardrail adherence, grading quality).
- Audience is school students; the Level 0-3 ladder (Natural logic -> Baby Jargon -> Jargon
  -> Python bridge) is the per-student adaptivity axis.

Reason:

- Matches the human's stated product vision; see `docs/VISION.md` for the full architecture.

## 2026-06-15: Learning Session Runtime Comes Before More Chat Polish

Decision:

- The next backend spine is a durable learning-session runtime, not a looser Mentor prompt.
- AI-led lessons use course-flow stages: intro, teach, practice, assessment, review, and complete.
- Student responses are typed as text, code, multiple choice, or file.
- The chat edge function adds a typed JSON response envelope while preserving the legacy `{ messages } -> { reply }` path.
- The primary learner audience is school children.

Reason:

- Jargon is meant to teach logical thought through structured course conversations.
- Claude's frontend needs a stable contract for stages, answer modes, retries, rescue paths, and completion.
- Keeping legacy chat compatibility lets the current UI continue working while the richer experience is built.

## 2026-06-15: Seed A 10-Lesson V1 Spine

Decision:

- Use a 10-lesson v1 spine: five Processes lessons plus five Coding lessons.
- Add `module`, `level`, and nullable `expected_output` fields to `lessons`.
- Replace placeholder starter code with runnable Jargon programs.
- Draw from existing curated examples where they fit, and add new concept-matched starters where needed.

Reason:

- Claude's frontend is already prepared to show `module`, `level`, and expected-output-driven polish later.
- A 10-lesson spine is enough to make the product feel real without seeding the full curriculum before it is curated.

## 2026-06-15: `run` Requires `JARGON_ENGINE_URL`

Decision:

- The Supabase `run` edge function requires the `JARGON_ENGINE_URL` secret.
- It must return a canonical error-shaped response when the secret is missing.
- It must not silently fall back to an old or test engine URL.

Reason:

- Running the wrong interpreter is worse than a clear configuration error.
- The front-end can already display canonical runtime errors.

## 2026-06-15: Support Full-Line `//` Comments

Decision:

- Jargon supports `#` inline comments outside strings.
- Jargon also supports full-line `//` comments when the first non-whitespace characters are `//`.
- Jargon does not support inline `//` comments in v1 because `//` remains floor division inside expressions.

Reason:

- The deployed lesson seed code uses full-line `//` starter comments.
- Preserving `//` floor division avoids a breaking expression-language change.

## 2026-06-15: Backend Is Supabase + Render

Decision:

- Keep Supabase for auth, database, RLS, and edge functions.
- Keep Render for the static platform and the Python Jargon engine service.
- The Supabase `run` edge function proxies to the Render engine via `JARGON_ENGINE_URL`.

Reason:

- The platform is already deployed and partly wired.
- Codex should not create a competing auth or persistence backend.

## 2026-06-15: Ownership Split Between Agents

Decision:

- Codex owns the engine/interpreter, examples, and curriculum extraction.
- Claude owns the front-end/platform, Supabase, and Render wiring.

Reason:

- This keeps runtime semantics and platform wiring from colliding.

## 2026-06-15: One Repo With Engine Subfolder

Decision:

- Use one repo: `jargon`.
- Platform files live at the repo root.
- The hardened interpreter lives in `engine/`.
- A thin Flask wrapper in `engine/app.py` exposes the runtime to Render.

Reason:

- One repo keeps product/platform/runtime evolution visible.
- `engine/` gives the runtime a deployable boundary.

## 2026-06-15: Engine HTTP Response Includes `result = output`

Decision:

- Preserve the canonical runtime result shape: `output`, `memory`, `errors`, `ask`, `ask_var`, `status`, `truncated`, and `limits_hit`.
- The Flask wrapper also returns `result` as an alias of `output`.

Reason:

- Existing `editor.js` reads `result`.
- New runtime/platform code should use the richer canonical shape.

## 2026-06-15: Curriculum Is Merged With Level Labels

Decision:

- Merge the five deployed lessons into the Processes/Coding/Prompting curriculum model.
- Use mixed-audience level labels.

Reason:

- The product serves beginners, bridge learners, and teacher-facing curriculum users.

## 2026-06-15: Mentor Is Logic Coach + Python Bridge

Decision:

- The Mentor teaches natural speech -> pseudocode -> Jargon -> Python.
- It remains a teaching layer over deterministic runtime execution.

Reason:

- The runtime should remain deterministic and testable.
- The Mentor should coach reasoning and transfer, not execute code by inference.

## 2026-06-15: Use Repo Files For Agent Communication

Decision:

- Codex and Claude Code communicate through versioned repo files, especially `docs/HANDOFF.md`.

Reason:

- Agents cannot directly DM each other.
- Repo-based communication is auditable, persistent, and works across tools.

## 2026-06-15: Treat Hardened Interpreter As Runtime Core

Decision:

- The canonical runtime is `engine/jargon_interpreter.py`.
- The root `jargon_interpreter.py` is a compatibility import shim.
- Legacy Colab/web interpreter files remain reference material, not active runtime code.

Reason:

- The hardened interpreter has resource limits, bounded AST evaluation, tests, and sandbox support.

## 2026-06-15: Keep Mentor Separate From Runtime

Decision:

- The AI mentor/chat layer should call or explain the runtime, not replace it.

Reason:

- Execution must be deterministic and testable.
- Teaching behavior can evolve without changing core language semantics.

## 2026-06-15: Preserve Stable Result Shape

Decision:

- Runtime calls return the same core fields: `output`, `memory`, `errors`, `ask`, `ask_var`, `status`, `truncated`, and `limits_hit`.

Reason:

- Older web experiments drifted between `input`/`code` and `result`/`output`; the rebuild needs one contract.

## 2026-07-04: Lessons Are Composed From Eight Conversational Modes

Decision:

- The platform's core vocabulary is a closed set of eight learning modes — Explanation, Media,
  Reflection, Practice, Assignment, Inquiry, Assessment, Revision — stored as
  `lesson_activities.mode` (+ `mode_type`), delivered inside the conversational runtime, and
  stamped onto every `learning_evidence` row as the dimension for proficiency and
  strengths/weaknesses tracking.
- A step with `mode = null` behaves byte-identically to the pre-v4.0 derivation
  (`response_mode` + quiz-row presence); backfill is requirement-equivalent by construction.
  `activity_type` is kept but deprecated (derived from mode on write).
- Teacher lesson templates are org-shared, versioned jsonb snapshots of a mode flow; the AI
  drafter can scaffold from a template.
- Teacher attention flows through a fixed hotlist vocabulary of seven item kinds, derived from
  existing tables first and persisted as a `notifications` table with the same kinds later.
- Student catalogs become class-scoped via a `class_courses` link table with a hard fallback to
  the global published list when no links exist — scoping is UX, not a security boundary, in
  v4.0.

Reason:

- The v3.0 ten-block experiment (reverted) showed fine-grained pedagogical patterns outrun both
  the authoring UI and the student surface. Eight coarse modes are enough to compose real
  lessons, cheap to track, and every existing step maps onto one without behavior change.
- The platform's promise is mediation: teachers build simply, students live in one
  conversation, and the mode dimension is what lets the platform adapt and report honestly.
- docs/PLATFORM.md is the canonical spec; code follows it.

## 2026-07-15 — Step→resource binding uses lesson_resources.activity_id; placements stay legacy

Decision:

- A lesson resource binds to a specific step via the existing `lesson_resources.activity_id`
  column (single-step binding). The chat runtime selects it and attaches a step's bound
  resources on that step's presentation turn (all bound, cap 3); step-bound resources rank
  first for mid-step "show me the…" requests. Lessons with no bindings behave exactly as
  before (first-resource on boot + request-regex attach).
- `lesson_resource_placements` is NOT dual-written or read: it is legacy, written only by the
  single-activity `save_lesson_blueprint` path and consumed by nothing. If per-step ordering,
  display_mode authoring, or multi-step placement is ever needed, revive placements as the
  richer model then.

Reason:

- The column already exists with teacher-writable RLS and rides the runtime's existing select —
  one binding surface, no migration, no second source of truth to drift.

## 2026-07-27 — v5.0: student-selected conversation modes; progression moves to a requirement ledger

Supersedes three v4.0 positions, deliberately (PLATFORM.md is canonical and says change the doc
first — that rewrite lands with P2; this entry records the decision).

1. **Modes become student-selected, not only teacher-authored.** v4.0 §2 fixed "each step is
   exactly one mode," teacher-authored. v5.0 lets the student pick the conversational mode from the
   chatbox at any time (practice, discuss, checkpoints, quiz, assignment, open, plus a default
   lesson spine).
2. **"Deterministic gates own progression" survives in substance; its one-mode-per-step corollary
   does not.** Naive student-driven modes would let a student discuss past an assessment. The fix
   is to split the two ideas that v4.0 conflated: MODE is the current conversational contract
   (student-chosen, free, drives directive + UI skin); PROGRESSION is a separate requirement
   ledger, and a requirement is discharged ONLY by a turn in the matching mode whose deterministic
   gate passes. `discuss`/`open` therefore discharge nothing, by construction rather than by
   prohibition. The LLM still never grades its own completion.
3. **§9's "visual redesign — deferred" is lifted.** The shell becomes a Home (LMS) / Learn (chat)
   split with a ChatGPT-shaped sidebar.

Consequence for the eight-mode vocabulary: it is rebuilt, not extended. `revision` folds into
Routines rather than being a chat mode; `explanation` + `media` become the default Lesson spine.
The DB check constraint gains the new values BEFORE anything stops writing the old ones, and
`mode = null` keeps meaning legacy exactly as it does today — no live curriculum changes behavior
on the migration.

Also decided: a linear stepper is a lie once mode is student-chosen, so the lesson header becomes
"N of M requirements met" with the outstanding ones tappable (tapping switches to the mode that can
discharge it). Phasing is shell → runtime → theming, each behind a flag, because a real student is
live on the platform.

## 2026-07-27 (amended) — v5.0 P2 as built: two mode axes, no requirement-ledger rebuild

Amends the entry above. That entry described building a new "requirement ledger" to make
student-driven modes safe. Research before implementing showed **the ledger already exists** and the
rebuild was unnecessary:

- `StepState` (chat/index.ts) is already a monotonic per-step ledger; `stepRequirements()` already
  derives what a step needs from its authored mode; `stepDone()` already decides completion.
- Flow v3 already enforces "conversation never closes a gate": the router classifies each turn and
  `applyTurn` discards grader verdicts for conversation kinds.

So P2 shipped the smaller, safer change: the student's declared mode is an authoritative input to
the EXISTING routing/masking layer — declaring what the LLM previously inferred — rather than a
parallel progression system.

The correction that mattered most: the earlier entry conflated two different axes. The authored
`lesson_activities.mode` describes a STEP; the new selector describes a MESSAGE. They coexist, so
"rebuild the vocabulary" applies only to the student-facing selector. The eight authored step types
are untouched in P2, no migration was needed, and no live curriculum changed behavior.

Unchanged from the original entry: the Home/Learn shell (shipped in P1), and that §9's "visual
redesign — deferred" is lifted.

## 2026-07-31 — The design system lands (docs/design-system)

The Claude Design handoff bundle (`docs/design-system/`, boards 5a/5b/5c + chats/chat1.md) is
now the design source of truth, superseding DESIGN_V6's visual language and the interim
Claude-adjacent ivory pass. Its rules, as implemented:

- **Ladders**: dark page #26262A → card #303035 → nested #37373D → hover #47474D with hairline
  LIGHT borders; light page pure #FFFFFF, cards separate by hairline + soft shadow, nested
  #F5F5F7, hover #ECECF0. Hover = one surface step, 180ms; press = instant.
- **Ink, never white/black**: dark headings #E6E6E6; light headings graphite #2F2F33. The
  Ink 90/70/54/37 scale is tokenized as --ink-92/62/45/30.
- **Type**: Manrope everywhere (body 13–14px/500, lh 1.7; micro-labels 10px/600 tracked
  .16em); Geist Mono for code, counters, timestamps. Serif retired — .font-serif remaps to
  bold tight-tracked Manrope so legacy heading markup keeps rendering.
- **Controls**: everything a pill or a circle (999 pills, 18 cards, 12 rows). Primary set
  (Continue, send, Run) inverts per theme — light-filled on dark, near-black on light. Soft
  controls wear the inset top-highlight. Red is destructive only, never a mode.
- **TurnMode tags**: solid one-hue pills with dark on-tag ink — Lesson #4F6BFD, Practice
  #2FBF71, Discuss #FFD83D, Open #FF8C3A, Quiz #F585BB, Homework #B9A4FA. The current mode
  wears the cursor-tip. The off-spine desaturation rule is RETIRED (modeAccentValue no longer
  mixes toward neutral); progression honesty lives in canProgress affordances + the server
  ceiling.
- **Transcript**: mentor prose sits directly on the page (no bubble); student replies get the
  soft pill (14/14/4/14); the divider is a hairline with a mono micro-label in the section's
  hue, mixed toward ink so yellow/orange hold on both ladders.
- **Aurora, rationed**: the #7B3FF2→#E05D38→#F585BB glow appears once per view, on the live
  thing (the current lesson row). The three.js AmbientCanvas is retired from teacher/admin
  shells (login keeps its entry moment); --grad-* now speak the aurora family.
- **Texture**: the faint 110px dot grid on the page surface, both themes.

## 2026-08-01 — Memory v2: relevance + decay + sweep + reset, WITHOUT embeddings

Memory v1 (session_summaries + student_memory) was recency-only, completion-only,
never-forgetting, and student-erasable by nobody. v2 fixes all four while keeping the
per-turn token budget FLAT (still ≤3 summaries + capped lists, ≈400 tokens):

- **Relevance over recency, lexically.** The prompt's 3 summary slots are picked from a
  pool of the newest 40 by tiered score: same lesson (+6) > same unit (+3, via one
  sibling-lessons read) > lesson-title keyword hits (≤+3) > recency tiebreak (≤+2); the
  single newest summary always rides for "last time we..." continuity. We deliberately
  did NOT add vector retrieval: per-student corpora are tiny (tens of rows), the
  candidates are already structured (lesson_id + short topic phrases), and embeddings
  would add a per-write embedding call, a pgvector migration, and a query-time
  embedding round-trip for marginal gain at this scale. Revisit only if summaries per
  student outgrow the pool (≈40+) AND cross-course topical recall demonstrably matters.
- **Decay.** Profile list entries carry last-affirmed stamps (profile.affirmed,
  "kind:text" → ISO date). Struggles expire 45 days unaffirmed (a mastered struggle
  must stop following the student around — the stale-label/self-fulfilling-profile
  risk); strengths/preferences at 120 days. Enforced at write (pruned from the stored
  row) AND read (a returning student's first turn is already clean). Mastery-flip-based
  removal (drop a struggle when its skill turns secure) is noted in OPEN_QUESTIONS —
  free-text struggles don't map cleanly onto skill keys.
- **Abandonment sweep.** On each FRESH session open, a background task summarizes up to
  2 of the student's idle (>30 min), non-complete, ≥6-turn, not-yet-summarized
  sessions through the same writer. Completion-only writes skewed memory toward
  finishers; kids abandon sessions constantly.
- **Student-owned reset.** "Reset" on the memory card wholesale-deletes the profile and
  ALL summaries under the student's own JWT (owner delete policies in
  20260910000000_memory_v2.sql). This is the ONE exception to v1's append-only stance:
  full-history erasure is a privacy affordance, not history forking — per-row edits
  remain impossible.

## 2026-08-02 — Chat-flow Phase 1: the flow stops lying (CHAT_FLOW_SCOPE.md is the inventory)

Owner picks (recorded from the scope round): phases run 1→2→3→4; checkpoints get the
promised composer DOCK (not a copy reroute); the isolated spaced-review path is DELETED on
this branch (archive on main; review_sessions stays applied, inert); grading gates stay
prose-only for the MVP (attachments reach only the mentor).

Decisions shipped in Phase 1:

- **The declared TurnMode is model-visible.** turn.student_mode rides every prompt payload
  and a mode CHANGE appends a REGISTER SHIFT nod to the directive. applyModeCeiling stays
  the sole authority on gates — this is voice, not grading. Previously the mode silently
  rewrote the routed kind while the model was never told the register changed.
- **Reload restores the flow's live affordances.** continue_offer rehydrates from the
  persisted envelope (latest-bot-only rendering keeps accepted offers retired) and quiz
  messages re-stamp `chosen` from the following student turn's choice_id
  (withRestoredQuizChoices). artifact_offer stays live-turn-only by design.
- **The spine is real.** LessonSpine renders one chip per arc step above the transcript;
  done steps (steps_done ledger) fire the existing navigate control turn — sendNavigate
  finally has its caller, and the server's "clickable progress bar" copy is now true. The
  label counts DISCHARGED steps per the v5.0 requirement-ledger decision, not the cursor.
- **The checkpoint dock exists.** Due/in-progress assessment rows for the class in scope
  dock above the composer (max 2, assignment-lavender chrome) and open the assessment
  surface — making the prompt's "docked above the message box" line honest. The R17
  sidebar cleanup stands: no sidebar re-entry for CheckpointsPanel.
- Also: turnMode resets to the spine on lesson switch; the transcript autoscrolls
  (bottom-anchored, never yanking a reader who scrolled up); a conversation idle >30 min
  shows re-entry rows (pick up / recap / check me).

## 2026-08-02 — Chat-flow Phase 2: the mentor streams (SSE in place, JSON contract kept)

- **Transport**: the same `chat` function serves both shapes. `stream: true` opts a turn
  into `text/event-stream`; deterministic early returns (control turns, replays, refusals,
  auth/validation errors) still answer as plain JSON — they are instant and have no prose
  to stream — and the client handles both by Content-Type. No second endpoint.
- **The JSON output contract survives streaming.** The mentor still emits
  {reply, understanding, misconception, inquiry} (misconception rows and the
  confusion/curiosity split depend on it). Streaming works by a stateful extractor
  (makeReplyExtractor) that eats the raw JSON as it arrives and emits just the `reply`
  string's contents — "reply" is the contract's first key, so prose flows from the first
  tokens. If a model ever deviates, extraction silently stops and the terminal envelope
  still carries everything: the failure mode is "no live paint", never a wrong reply.
- **Envelope-as-terminal-event**: the SSE stream ends with one `envelope` event carrying
  {status, envelope} — byte-equivalent to the JSON path's response, so applyEnvelope,
  persistence, dedup replay, and every downstream consumer are untouched. finishTurn
  (the whole post-grader pipeline) runs inside the stream; the turn completes server-side
  even if the client disconnects mid-stream.
- **Routers/graders stay blocking** — small, parallel, and their output is never shown.
- **Timeouts are phase-aware**: streams are guarded by INACTIVITY (60s without bytes),
  not total duration; the JSON path's flat budget rises 30s → 120s (the old generic cap
  aborted client-side while the server finished and persisted the reply anyway).
- **The rate limiter lost its serial round trip**: the windowed student-send count rides
  loadContext's wave-1 Promise.all (recentStudentSends); the 429 contract is unchanged.

## 2026-08-02 — Chat-flow Phases 3+4: continuity + hygiene (the scope is fully built)

Phase 3 (continuity):
- **Rolling mid-session summary.** learning_sessions gains running_summary +
  summarized_turns (migration 20260920, additive, in the deploy list). A background
  cheap-model task (refreshRunningSummary) refreshes the summary whenever the student-turn
  count pulls ≥6 ahead of what's folded in; the payload feeds it as conversation_so_far
  AHEAD of the verbatim 8-turn window. Long sessions stop forgetting their own beginning;
  cost is one cheap call per ~6 student turns, recorded as task_type "summarization".
- **The envelope's session snapshot finally has its consumer.** useConversation keeps a
  sessionSnapshot (seeded from the resumed row, updated by every envelope); StudentApp
  updates the progress map LOCALLY from the live arc + snapshot — the every-send refetch
  of the whole progress table is gone.
- **Progress is a real fraction.** fetchStudentLessonProgress computes discharged-step
  ratio (steps_done / lesson activity count), floored 0.1 / capped 0.95, complete = 1 —
  the binary 0.5 dies; tree rings and the brain map inherit gradation for free.
- **Completion hand-off.** A success-toned row above the composer celebrates a completed
  session and offers the next lesson in the scoped catalog order; the conversation stays
  open beneath it (a finished lesson is still a place to ask questions).

Phase 4 (hygiene):
- **estimated_cost_usd is real** in all three model-calling functions, from one small
  prefix-matched price table (USD/1M tokens, cached input at the provider discount;
  unknown model → null, never a guess). artifact-live additionally now TALLIES tokens
  across its whole build (outline + build + repair) onto its reservation row — its usage
  rows were 0-token before, so artifact spend was invisible.
- **components/Composer.tsx (1,095 lines) is deleted**; every consumer imported only the
  ComposerLanguage type, which now lives in lib/composerLanguage.ts.
- **Transcript fetch capped** at the newest 400 turns (order restored client-side) —
  insurance, not policy; real sessions sit far below it.
- Deferred by owner decision (CHAT_FLOW_SCOPE §5): attachments stay out of the graders.

## 2026-08-02 — The learning framework ships (F1-F4, docs/LEARNING_FRAMEWORK.md)

Built in one pass per owner direction ("build the whole thing"):

- **Schema (migration 20260925)**: ideas (authored + student-scoped emergent, key-unique
  per scope), vocab_terms (variants for matching), curriculum_links (possible),
  student_links (earned, unique per student-pair, never unmade), student_vocab
  (encounter state incl. subjects_seen), and the lesson_subjects view (subject = course
  title, one query per turn). RLS: published knowledge readable by authenticated;
  student rows owner + can_view_student; writes owner-scoped (the chat fn writes under
  the caller's JWT). Demo seed: 4 authored ideas, 8 vocab terms, 4 cross-course links —
  existence-guarded, idempotent.
- **Detection (chat fn, processKnowledge)**: deterministic word-boundary vocab sighting
  over reply+student text; subjects_seen travel tracking; a word crossing subjects mints
  a vocab_bridge student link between its home idea and the lesson's primary idea. The
  mentor contract gained `link` and `new_idea` — both validated against the known idea
  set, deduped (normalized title for ideas, pair-set for links), capped (≤1 display
  event of each kind per turn), written under RLS, and NEVER able to fail the turn.
  Payload gained `knowledge` (subject, lesson idea, citable keys, emergent list, link
  count); SYSTEM_PROMPT documents both fields with "never invent keys".
- **Chat UX**: subject-hued underline-dot highlights on final mentor prose only (first
  occurrence per message; tap re-shows the card), the definition dropdown from the top
  center, growth toasts (link/idea) top right with "See it in your brain" jumping to
  Home. All display waits for the stream to settle (events ride the envelope, which
  resolves post-stream — the timing decision holds by construction).
- **Brain map v4**: authored idea stars ride their lesson; pool + EMERGENT ideas orbit
  their subject's hub, emergent wearing the aurora ("Your idea: …"); curriculum links
  render faint (possible) vs student links bright (earned, permanent), a link made in
  the last 10 minutes draws itself with the flow animation. The round-12e lexical topic
  links are RETIRED — the map now shows real, earned structure.
- Progress spine note: mastery-by-idea rides the existing skill_key bridge (idea.key
  adopts that vocabulary); step-based fractions remain the lesson-level display.

## 2026-08-18 - R42: Teacher IA is class-first — one single hierarchy (owner decision)

Owner's directive, verbatim intent: "I want things separated by classes Only there
should be one single hierarchy for the whole thing … classes, you enter, then you can
see the list of students in their activity, and then per lesson, you'll be able to
build the curriculum within each class. I don't think there should be a single builder
space for everything." Sections mean sibling classes (7A/7B); the preview button IS the
teacher's testing affordance (owner correction — do not describe testing as missing).

- **Hierarchy**: Teacher home = classes, nothing else. A class opens on **Students**
  (roster + live activity + grading; absorbed the old Overview strips) with
  **Curriculum** as its backend section (the authoring studio scoped to the class,
  Linked courses, and the class builders). The old Overview/Structure sections and the
  sidebar's global Curriculum destination are retired; `/teacher/curriculum` remains
  only as a redirect into the first class (selection params forwarded).
- **Mechanics**: the studio component (still living in routes/teacher.curriculum.tsx —
  six pin suites read that path) exports `CurriculumStudio({ classId })`, mounted
  lazily by TeacherConsole; its subject/course/unit/lesson selection rides the class
  route URL (`?tab=curriculum&lesson=…`), so lesson editing is deep-linkable per class.
  Curriculum-admin writes already carried class_id as the authorization scope — the UI
  now matches the server model.
- **Agreed follow-ups** (owner choices, next slices): (1) courses shared across classes
  stay shared with visible "also used by" badges and **fork-on-demand** ("duplicate for
  this class") — no always-fork; (2) the empty-scope default flips to "students see
  exactly the class's linked courses", behavior-preservingly (backfill links for
  currently-unscoped classes first); (3) class-scoped outline with "add existing
  course" + auto-link on create.

## 2026-08-18 - R45: The consolidated class (owner directive)

Owner: "There shouldn't be multiple organisations for one teacher. … Why do we have
classes and then courses? Let's consolidate the whole thing. You create a class, and in
the class, I have a curriculum — you wrote the curriculum for the class, not for a
course. And then if you have another section of the class, you just go into your
students section and you input all of your students as multiple sections."
Owner-confirmed scope: sections assign EXISTING registered accounts (creation stays with
the admin); classes stay admin-created; existing class content is preserved, flattened.

- **One school per teacher**: org grouping and org names are gone from teacher chrome
  (flat class lists; the org-grouping helpers are retired).
- **The class IS the course (presentation)**: the studio outline is a flat Units →
  Lessons list; subject/course stay as invisible data-model plumbing. "+ Unit" targets
  the class's backing course — the first linked org-owned course, else it auto-creates a
  subject + course titled after the class and links it. The breadcrumb shows only
  Curriculum → unit → lesson. The link-management panel is demoted to a collapsed
  "Books & shared content" drawer (still the only way to trim what students see).
  Shared units carry a compact "shared" chip (full class list in the tooltip) and the
  R44 honesty strip + fork-on-demand still cover cross-class edits.
- **Sections in Students**: `class_memberships.section` (free text, migration
  20261010000000, also applied directly to prod so the deploy can't race). The roster
  groups by section; per-student section select; "Add students" enrolls existing org
  students (curriculum-admin: list_enrollable_students / enroll_students /
  set_member_section — all class-teacher-authorized, enroll validates the org pool and
  upserts on the unique (class_id,user_id) pair so re-enrolls reactivate).
- Unit drag-reorder is off in the flat outline for now (adjacent units can belong to
  different backing courses); lessons still reorder within their unit.

## 2026-08-19 - R46: The sketchboard is the teacher-console spec (owner: "go for it")

Owner: "It's still very convoluted. Let's go back to the drawing board and clearly
layout each page and function" — we sketched the whole console together on a shared
canvas ("Teacher Console Sketchboard", 8 wireframe boards), the owner corrected two
things ("in the editor I can only see and edit that class I'm in"; "give a dedicated
section to uploading resources and editing them"), then approved the boards: the
sketchboard is now the living spec for the teacher console, and R46 rebuilt the UI
to match it.

- **Home = your classes, nothing else.** No hero, no activity feed. Each class card
  carries its own signals: students · sections, a live-now badge, a to-review badge.
  (Sketch default stood for open Q1: badges only, no feed on Home.)
- **A class has two tabs** — Students (landing) and Curriculum — as header pills and
  sidebar sub-rows. **Review is a reachable section, not a tab**: the "N to review"
  strip at the top of Students is its door (sketch default for Q2/Q3).
- **Students = the roster.** Rows carry the signal inline (live now — lesson /
  assignment·quiz waiting for your review / last active · N lessons done), live rows
  get a Watch shortcut straight into the session, sections keep their R45 grouping
  and controls. Grading no longer lives on this page.
- **Review = everything gradeable in one place**: assignment + quiz queues first;
  the gradebook table and the assign-work builders (assignments/quizzes) sit one
  click behind in collapsed drawers. Interim for Q4: assigning still uses the
  existing builders relocated here; "assignment/quiz as a lesson STEP" is a future
  modeling slice, not part of R46.
- **Curriculum = the studio owns the whole surface** (the old "builders" card is
  retired). The studio still edits only the class it's in (R43 scope). **Resources
  get a dedicated library view** (Curriculum › Resources, `?view=resources`),
  opened from a Resources button in the outline header — per the owner's second
  correction. Interim: the library is the existing ResourceManager relocated;
  upload-into-steps attachment stays as-is until the step-attachment slice.
- **The student page names the student, their section chip, and the class** in the
  header (board 7).

## 2026-08-19 - R47: The four-tab console (owner-approved synthesis "Steal These Flows")

After R46 the owner still found the console hard to navigate. We tore down SchoolAI and
Google Classroom, synthesized the takeaways into an artifact the owner approved ("I love
it. Lay out a solid plan and go for it") — the artifact is the spec:
claude.ai/code/artifact/134b04b4-4594-4c79-8709-a55f9e22c556.

The recipe: **Classroom's skeleton + SchoolAI's live layer.** A class is exactly four
fixed rooms, each answering one teacher question; tabs render FROM CLASS_SECTIONS so the
pills and sidebar can never disagree, and nothing appears or disappears with state.

- **Live** (landing) — who's on right now; Watch deep-links the session. Quiet state
  lists recent activity. (The SchoolAI Mission Control layer, per class.)
- **Classwork** — ONE list: units as topic headings; lessons, assignments, quizzes,
  materials beneath (work items group under their lesson's unit; strays land in "Other
  classwork"). ONE + Create menu. A lesson click opens the editor full-width
  ("← Classwork" back); a work-item click opens its student-work view where grading
  happens ON the work (Classroom's model). The outline tree/aside is gone.
- **People** — roster, sections, enrolment. Admin only; no activity context.
- **Grades** — the gradebook matrix as a visible tab (a rollup, not a workplace).
- **Home** — class cards + a global cross-class **To review** queue; rows deep-link to
  the item's student-work view. Notifications now use the item ids their writers always
  stamped into `ref` and deep-link the same way.
- Legacy `?tab=` map: students→live; curriculum/structure/lessons/resources/assignments/
  assessments→classwork; review/gradebook→grades; unknown→live. `?view=` retired.
- Principles adopted as standing rules (see the artifact): four fixed tabs; no hidden
  rooms; one + Create; grading lives on the work; hierarchy is metadata, not navigation;
  kill a noun before adding one.

## 2026-08-20 - R48: Quiz/assignment as lesson STEPS (sketchboard Q4; owner: "Both, steps first")

The last big noun consolidation from the approved synthesis (P8): an assignment- or
assessment-mode lesson step no longer merely *frames* work — it IS the work.

- **Linkage is one nullable column**: `activity_id` (TEXT, FK `lesson_activities` ON
  DELETE SET NULL) on `assignments` and `assessments`, mirrored loosely onto
  `checkpoints` by the sync triggers. Deleting a step orphans its work item back to
  standalone classwork — history and grades outlive lesson editing. Partial indexes
  keep the loader's per-turn lookup off the (majority) unlinked rows.
- **Authoring**: the step editor gets a "Step work" strip — a linked step shows the
  real item (status, to-review badge, "Open in Classwork"); an unlinked
  assignment/assessment step offers "Create the assignment/quiz for this step", which
  opens the ordinary console builders pre-bound (lesson locked, activityId carried).
  Gated on the SAVED mode and on the temp-id swap, same rule as material binding.
  The console's `onCreate`/`createOpen` seams are untouched (R47 pins) — the step path
  is additive: `onCreateForStep(kind, {lessonId, activityId})` + `createContext`.
- **The chat runtime holds the step until the submission exists.** The gate rides the
  requirements spine — `requirementsFor(activity, quiz, stepWork)` returns
  `work: satisfied !== true`, and `stepDone` refuses while it's true; NO post-hoc
  clamping (activitiesDoneThisTurn re-derives independently and would disagree;
  applyTurn untouched). A linked step overrides its in-chat gates (no quiz/code/
  understanding demands in chat — the real item is the assessment now). Failure split:
  the LINK read fails open (null = unlinked; an outage must not brick unlinked steps),
  the SATISFACTION read on a confirmed link fails closed (steps_done is monotonic — a
  wrong skip is permanent, a wrong hold retries next turn). A linked assessment with no
  recipient row for this student reads as unlinked (late enrollee; RLS would brick
  start_assessment). Revisits never pass stepWork. Status filters (assignment
  `assigned`, assessment `published`, newest wins) make archiving un-gate gracefully.
- **The hand-off is a work card** (`work_offer` on the envelope, tri-state: value while
  pending, null once satisfied, absent when unlinked) rendered under the mentor's
  reply on the latest message only. It REPLAYS from the persisted turn payload
  (mode_offer pattern, NOT artifact_offer's live-only rule) — the step is held, so a
  reload without the card would strand the student. A new directive rung
  (`await_step_work`, ranked above content_discuss) keeps the mentor from collecting
  the work in chat.
- **The card opens a real surface**: assessments reuse AssessmentSurface; assignments
  get the NEW AssignmentSurface — the first caller of the shipped-but-unused
  submitAssignment api (text + files, client limits enforced). Submitting fires ONE
  deterministic continue control turn ("I've submitted it." + `{type:"continue"}`,
  `sendWorkDone`) — the server re-reads satisfaction there, so a phantom "done"
  without a submission keeps holding. The handshake arms ONLY when the surface was
  opened from the card (dock/panel opens finish silently).
- **The dock dead-end is closed**: checkpoint rows carry a `kind` discriminator and
  `assignmentRows()` merges assignments into the dock, Checkpoints panel, Home due
  strip, and class summaries; rows dispatch to the matching surface. (Previously a
  required assignment could hold the lesson-end gate with NO student surface anywhere.)
- **R47 debts paid**: assessment return-feedback is an inline per-attempt field (the
  window.prompt is gone; "Return result" contract unchanged), and the studio's
  authoring read is cached 60s (`authoring:` surface key, invalidated by every
  curriculum-admin write) so back-from-work-item re-entry stops refetching the world.
- **Double-gating is deliberate**: the step gates on SUBMISSION (any status); the
  lesson-END checkpoints gate still waits for the recipient to be COMPLETE when the
  teacher marked the work required. Submitting un-holds the step; grading closes the
  lesson. Form default `required:false` stays.
- Debt carried: `result_release_policy` stored but never enforced; work items created
  from steps notify students only through the existing assignment/assessment writers.

## 2026-08-20 - R49: Field-feedback triage (sign-in → Home; dead videos; the chat outage)

Tester feedback (owner-forwarded screenshot, 8:22 AM Beirut) surfaced three issues.

- **"Starting a lesson is glitching" was a FOUR-DAY total chat outage, not a glitch.**
  Every chat POST since Aug 16 14:19 UTC answered a bare runtime 500 in under a second —
  no function logs, no telemetry row, no persisted turn (last successful turn: Aug 16
  14:13; the tester's 21 attempts on Aug 20 05:19–05:32 were the first traffic since).
  The R36 note in api.ts observed this exact signature live on Aug 16 and mitigated with
  client retries, believing it transient worker churn; it was actually a broken deployed
  function build. The R48 redeploy (Aug 20 06:56 UTC) replaced it; verified healthy
  end-to-end afterwards with a throwaway student via pg_net (created and torn down in
  the DB): JSON turn + SSE turn both 200 on the tester's own lesson, telemetry writing
  again. Guards shipped: the deploy workflow now SMOKE-CHECKS freshly deployed functions
  (a garbage POST must return the function's typed JSON refusal; a bare 5xx fails the
  run), and the chat function's catch paths console.error synchronously so the next
  post-mortem has evidence in function_logs even when background telemetry can't flush.
  The Anthropic key was probed and is healthy (both chat models answer).
- **The Unit-circle video was a case-garbled YouTube id** (`1m9p9iubmLU` vs the real
  `1m9p9iubMLU`) from the Aug-4 campus seeding; a sweep of all nine YouTube resources
  found ONE more dead id (camp-math-l5, "transforming trig graphs"). Both replaced in
  prod with oEmbed-VERIFIED Khan Academy videos ("Introduction to the unit circle";
  "Midline, amplitude and period"). Rule going forward: never write a YouTube id
  without an oEmbed 200 + title check — ids are case-sensitive and hallucination-prone.
- **Sign-in lands on Home.** Every role-home redirect rides the new roleHomeNav helper,
  which stamps `?section=home` for students (the sidebar's "Overview" row). Bare /learn
  deep links keep meaning the conversation — only sign-in/role redirects opt into Home;
  the R42 "conversation is the default" decision stands inside the app.

## 2026-08-20 - R50: Shared books refuse edits gracefully (the + Lesson uuid crash)

The owner's next click after R49: "+ Lesson" on a unit of the GLOBAL anatomy book blew
up with the raw banner 'invalid input syntax for type uuid: ""'. Root cause (prod
postgres + edge logs): shared books have no owning organization, unitScope resolves
organizationId to "", and assertCanAuthor fed that straight into a uuid filter —
every curriculum-admin WRITE on shared content crashed this way, not just + Lesson.

- assertCanAuthor now refuses an empty organizationId with the designed message
  (platform admins still pass — they author global books directly): shared books
  can't be edited in place; duplicate for the class first. The guard sits before any
  uuid filter, covering all twenty authoring actions at one seam.
- The studio's shared-course notice (with "Duplicate for this class") now ALSO renders
  for a global book with no peer classes — previously peers-gated, which would have
  left the refusal pointing at a button that never rendered. The R43 peers copy and
  R44 fork action are unchanged.
- Related: the deploy smoke check earned its keep on its FIRST run — it caught
  curriculum-admin answering 500 to an anon probe ("Forbidden" fell through the status
  ladder), fixed forward as PR #33 (Forbidden → 403).

## 2026-08-20 — R51: the admin window grows management tabs (over dormant admin-ops)

- The admin-ops edge function has shipped a full management suite since the pilot
  rounds — reset_user_password, update_membership_status/role,
  add_existing_user_to_class, create_class/update_class, list_pilot_readiness,
  export_class_snapshot — but the 2026-07-30 MVP strip cut the portal down to
  Seeding + Live + Cost, leaving those actions with zero UI. R51 adds the UI only:
  Overview (headline stats, per-class readiness, audit feed), People (org roster
  with search/filters; reset password, org role, disable/enable, class membership),
  Classes (create/rename/archive, readiness badges, roster, CSV snapshot export).
  No backend or migration changes; nothing to deploy but the frontend.
- Scope updates ride the mutation responses: every admin-ops write already answers
  with the refreshed scope, so panels apply it via one callback instead of
  re-fetching list_admin_scope after each action.
- Guards mirror the backend instead of discovering it: org admins see no org-role
  editor (the backend forbids it), you cannot disable or re-role your own account,
  class removal is a status flip to "removed", archive is a status flip to
  "archived" with a Restore path. Destructive-ish actions use the two-click inline
  ConfirmButton — no window.confirm (R47 rule).
- Fixed with it: org admins used to get a BLANK Seeding tab (the tab rendered for
  both levels, the panel body was platform-gated). The panel now renders for both;
  the demo-logins section inside stays platform-only.
- Default landing tab changed live -> overview; stale ?tab= deep links fall back to
  Overview. The Live fleet poll now also runs while Overview is open (it shows the
  same live count).
- Select widths inside admin panels use the !w-[..] important modifier: the
  .jargon-input component class (width:100%) is declared after Tailwind's
  utilities in the compiled CSS, so plain w-[..] loses the cascade to it.

## 2026-08-20 — R52: the control vocabulary (UI consolidation)

- One button hierarchy (.btn + primary/secondary/ghost/danger, .btn-sm/.btn-icon)
  and one table idiom (.table-scroll) now live in styles.css; 106 hand-rolled
  button/field chrome strings across the teacher + admin portals were swept onto
  them. Secondary buttons gained a real raised surface (bg + border + shadow) —
  the pre-R52 transparent pills read as chips, which is why nothing looked
  clickable.
- Structure rules: cards keep ONE inset level (hairline groups below that — the
  lesson editor's Tutor behavior box-in-box-in-box is flattened); list rows must
  contain their controls (the Live row's Watch button and the People row's section
  select moved inside their rows); class tabs use the dark active pill, matching
  the admin WorkspaceTabs read.
- The narrow-width table bug had a one-line root cause: the class card is a grid
  item, and grid items refuse to shrink below content (min-width:auto), so the
  920px gradebook table stretched the card past the viewport and CLIPPED the
  Action column instead of scrolling. Fixed with min-w-0 on the card + the
  .table-scroll wrapper; pinned with the reason in test_r52.
- Verified: 867 pins OK; tsc/eslint clean; R48 teacher harness 18/18 and R51 admin
  harness 19/19 on the consolidated build; before/after screenshots at 1440px and
  820px (r52audit/) show the gradebook scrolling inside its card with all four
  tabs reachable.

## R53 — light-mode revision: blue primary chrome, brain hues, login, table clip (2026-08-20)

Owner: "revise the light mode color palette because the colors are too dark and its
just not right all in all… revamp the colors of the brain in light mode and the design
of the login based on the rest of the platform… revise the table scroll thing because
they dont clip cleanly on horizontal scroll."

Diagnosis: the light SURFACES were already the white daylight ladder — what read as
dark was the interactive chrome: active tabs, primary buttons, the voice orb, count
badges, and the brain's course hubs all painted near-black `--foreground`.

Decisions:
1. **Primary chrome = platform blue on both ladders.** New `--primary/--primary-ink/
   --primary-hover` tokens; `.btn-primary` + shadcn `--color-primary` remapped; ~38
   call sites swept from `bg-foreground text-background` to `bg-primary
   text-primary-foreground` (tabs, class-header pills, sidebar badge, mentor pace
   thumb, assessment/assignment/voice/media primary actions, selected chips in chat +
   studio). Graphite stays for text ink. Dark mode adopts the same blue (one product).
2. **Brain (light)**: hubs fill with their subject hue `hsl(hue 52% 47%)` (dark keeps
   ink92 coins); touched/untouched lesson tiers each step one ink lighter in light.
3. **Login**: rainbow ambient (0.5) + gradient-ring card retired → page ladder + dot
   grid, hairline card, boxed `jargon-input` fields, blue Continue, aurora rationed to
   one dot in the brand pill, ambient 0.16 neutral. Demo-access disclosure unchanged.
4. **Table clip**: gradebook row-cards → hairline rows (`border-collapse`, no rounded
   row strips); `.table-scroll` gains pure-CSS scroll fades; `.table-sticky-cell`
   pins the Student column opaque with a hairline+shadow lip (hover tint mixed in CSS
   so the pinned cell tracks its row).

Verified: 880 pins OK (one R52 pin re-anchored to the blue pill by design), tsc +
eslint clean, light+dark screenshots across login/student home+brain/chat/teacher
tabs/gradebook narrow-scrolled/admin.

## R55 — incident: mentor turns failing; gateway rejects ES256 JWTs (2026-08-21)

Owner report: every lesson turn answered the "Something went wrong on our side"
bubble (reproduced on camp-bio-l1 "A factory with compartments"). Zero successful
model calls since Aug 20 07:44Z — the entire day after the DB outage.

Two stacked causes, found with in-database pg_net probes (throwaway student
created and fully torn down, 0 rows left):

1. **Edge-functions gateway rejected user JWTs.** GoTrue signs user access tokens
   with the project's asymmetric ES256 key (kid IS in the published JWKS), but the
   functions gateway intermittently answered `401 UNAUTHORIZED_ASYMMETRIC_JWT` (4 of
   5 attempts) — a stale JWKS cache on their side dating from the Aug 20
   outage/restart. GoTrue/PostgREST accepted the same token. FIX SHIPPED: all
   user-token functions deploy with `--no-verify-jwt` (PR #39) — the gateway check
   was a redundant outer layer; every function resolves the actor internally
   (GoTrue/PostgREST + RLS) and refuses junk with a typed 4xx (smoke-checked each
   deploy). submission-maintenance keeps gateway verification (service-role only).
   REVERT the flags when Supabase confirms reliable ES256 validation.

2. **Intermittent DB statement timeouts** ("canceling statement due to statement
   timeout", stage intro) — three consecutive failures at 15:15Z, healthy at 16:22Z
   with the identical request. Individual context queries measure in milliseconds
   under RLS; the t4g.micro instance simply stalls in bursts (post-incident CPU
   credit exhaustion pattern). Not a code defect. Mitigation is infrastructure:
   upgrade compute (micro → small) before the demo — owner's call (costs money).

Verified end-to-end after the fix: two consecutive full mentor replies on
camp-bio-l1 (session advanced intro → practice). Note for future forensics: the
project's log analytics backend ("Backend error! Retry") was down throughout —
pg_net probes + direct table reads were the only working instruments.

## R54 — brain polish: curated palette, quiet dark glow, whispering labels, smooth zoom (2026-08-21)

Owner: brain "colours are a bit dead" both modes; "the glow on the dark mode is not
it"; "the labels are sometimes a bit too much"; zoom/drag "very choppy".

1. **Curated subject palette.** SUBJECT_COLORS — eight of the platform's own tag
   hues (each with a lifted dark-ladder variant), cycled by course rank — replaces
   the computed accent-hue-rotation (which landed on muddy in-between angles). Hubs
   fill with their subject hue on BOTH ladders now (the dark ink coins read dead
   next to the colored washes); withAlpha derives washes/rings from the same hex.
2. **Dark glow**: tighter (reach × 0.82) and dimmer with a faster falloff — a faint
   colored aura instead of the wide low-sat fog.
3. **Labels whisper**: sans + sentence case everywhere (ALL-CAPS mono hub names
   retired); ellipsized (hubs 24, others 28 chars; hover shows the full name);
   zoom gates raised one step per tier (lessons 0.9, ideas 1.25, words 1.7) so the
   rest state names only anchors + the current lesson.
4. **Smoothness**: subject washes pre-rasterized once per bind/theme into a
   world-space bitmap and blitted per frame (was N radial-gradient rasterizations
   per repaint — the dominant pan/zoom cost); DPR capped at 1.5 (AmbientCanvas
   convention); wheel zoom proportional to deltaY via exp scaling (the fixed ±10%
   per event made trackpad gestures a staircase), deltaMode-aware.

Verified: 889 pins OK (one R53 brain pin re-anchored to the curated-palette
contract by design); tsc + eslint clean; light/dark screenshots at rest + zoomed
(label reveal ladder intact, occupancy grid uncontested).

## R56 — build from material: a teacher's upload becomes a whole draft lesson (2026-08-21)

Owner (post-meeting): make the teacher end "more of a one-stop job for education —
create the curriculum, entire lessons, slide decks, quizzes, and assignments from the
material that the teacher uploads… rather than manual upload and input of everything,
our platform builds it out for them."

Survey first: ~60% already existed — material ingestion (PDF extract, OCR, A/V
transcription, teacher-approved chunks), single-lesson step generation, knowledge
extraction grounded in approved chunks, and deck/sim generation. The gaps were
SCALE (nothing drafts a curriculum), COMPLETENESS (quiz/assignment/deck still manual
per lesson), and ONE FLOW. Owner picked "full lesson from material" as slice 1; the
curriculum-outline builder loops this engine next.

Decisions:
1. **One call, one package.** New generate mode `lesson_package` drafts lesson meta +
   steps + wrap-up quiz + assignment brief + a deck brief, from a 24k-char material
   window (3x the step generator's — a chapter is the normal input). Deck generation
   stays the existing `artifact` mode (separate budget, separate refine).
2. **Review-first is absolute.** Generation writes NOTHING (pinned). Apply runs
   through the same create_lesson_stub / upsert_step actions manual authoring uses —
   no privileged bulk path, so every guard, gate and audit trail still applies — and
   the lesson lands as a DRAFT.
3. **Quiz + assignment land as STEPS, not classwork rows.** The studio has no roster
   (create_assessment/createAssignment need recipients), and R48 already made
   assignment/assessment steps first-class: students meet them inside the lesson, and
   R48's step-work strip turns any of them into graded classwork in one click.
4. **Degrade, don't break.** An MCQ whose choices/answer fail validation becomes an
   open-ended question rather than a broken auto-scored one; an ungrounded package
   (brief only, no material) is flagged in the review panel, not silently passed off.
5. **Ingestion widened to what teachers actually have** (owner's list): PDFs, pasted
   notes, .docx, .pptx, images, and URLs — on top of the existing A/V transcription.
   Office formats are unzipped and parsed IN THE BROWSER via DecompressionStream (no
   new dependency); only images (vision OCR) and URLs (SSRF-guarded server fetch,
   blocking private ranges/credentials/non-http schemes) touch the server, and both
   return text only, storing nothing.

Verified: 907 pins OK (24 new); tsc + eslint clean; offline deno check 0 errors on
both edge functions; 13/13 browser walkthrough — unit → paste material → Build lesson
→ review steps/quiz/assignment → Apply creates the lesson.

## R57 — a whole course, built from the teacher's material (2026-08-21)

Owner (meeting): the platform should BUILD curriculum from what a teacher uploads —
lessons, decks, quizzes, assignments — instead of making them type it in. R56 made
one lesson generatable; R57 wraps the curriculum around it.

Shape: **outline the material, then loop the R56 engine over every lesson it names.**

1. **Outline from material.** `course_outline` accepts material ALONE (a chapter
   upload IS the brief), reads a book-sized window (24k, was the shared 8k clamp),
   and is told to follow the material's own order and cover it end to end — one
   lesson per teachable chunk, not a summary. Each lesson comes back with a
   `source_hint`: a SHORT VERBATIM PHRASE copied out of the text.
2. **Per-lesson slicing** (`sliceMaterialForLesson`, client, pure). Handing a whole
   book to every lesson generation makes them all drift to the loudest chapter. Each
   build reads only its window, located by the verbatim hint (exact hit outranks any
   word overlap) and widened over neighbouring paragraphs toward the higher-scoring
   side. Short material passes through whole; no match falls back to the head.
3. **The runner.** Units are created up front; lessons are NOT stubbed — each package
   write creates its own lesson, so a stopped run leaves real lessons and no empty
   shells. Sequential (a generation is a ~40s model call; parallel would hit the rate
   limit and there'd be nothing honest to show), cancellable between lessons,
   resumable, and per-lesson retryable — the loop skips anything not `queued`, which
   is what makes retry/resume safe. Per-lesson failures are captured in the run's own
   ledger (`quiet` on generatePackage) instead of stomping the studio banner.
4. **One write path.** The R56 apply body became `writeLessonPackage`, shared by the
   runner and the single-lesson panel: ordinary authoring actions, every guard and
   audit trail intact, everything a DRAFT until the teacher publishes.
5. **The teacher keeps the choice**: "Build N lessons" or "Outline only".

Verified: 921 pins OK (two R56 pins re-anchored to writeLessonPackage — same
contract, new home); tsc + eslint clean; offline deno check 0 new errors; harness
verify_r57 10/10 (material-only generation → outline → build → three distinct
lessons land) plus light/dark panel shots.

Next: auto-deck per generated lesson (deck_brief already rides in the package), and
grounding each generated lesson's resources in the uploaded file it came from.

## R58 — curriculum import: a whole book lands as drafts (2026-08-22)

Owner: two full textbooks, as two classes, with real figures — and the question
"do we build a system or hand it to an agent?" Answer: **both, with a seam between
them.** R56/R57 generate curriculum inside the app, which is right for a teacher
working from a handout and wrong for a book: a book is long, worth doing carefully,
and worth being able to redo. A file contract separates the AUTHORING (an agent
reading chapter by chapter, or the in-app generator) from the LANDING (this
importer), so either side can be redone without the other.

Decisions:
1. **One chapter = one JSON document** (docs/CURRICULUM_IMPORT.md is the contract
   an author writes against). A book is a directory of them, imported in order.
2. **Idempotent by the source's own stable ids** (`ict-f-ch3-l2`). Re-importing a
   chapter updates those rows in place — never duplicates.
3. **Never eat a teacher's work.** Imported rows are stamped `import_key`; a row
   that exists but belongs to someone else is skipped and reported, never
   overwritten. The importer NEVER deletes — dropping a lesson from the JSON leaves
   the old one for a human to archive. An importer that deletes is an importer that
   eats edits.
4. **Same guard as every other write**: assertCanAuthor, so an import can never
   reach an org the operator couldn't author in (R50's shared-book refusal included).
   The CLI signs in with ordinary credentials — deliberately no service-role path.
5. **Figures move to private storage.** The 11 legacy figures are static repo assets
   (/figures/*.png); a textbook's are not. Imported figures upload to the private
   lesson-resources bucket under figures/<book>/, store `storage_path`, and the
   client signs them at render (the same createSignedUrl path every private resource
   uses). Legacy image_url still wins when there's no storage_path. Images travel
   BESIDE the document, never inside it — base64 at book scale would blow the edge
   body limit and re-upload every image on every re-run.
6. **One derivation for a step's stored shape** (`stepRowFrom`), shared by upsertStep
   (a teacher editing one step) and the importer (a book landing hundreds). Parallel
   copies would drift.

Verified: 939 pins OK (three older pins re-anchored — they sliced fixed character
windows that new code pushed past, now slice to the next top-level function);
tsc + eslint clean; deno check 0 new errors; migration applied to prod and columns
confirmed.

Next: the books themselves — an agent pass per chapter emitting these documents.

### R58a — the verification gate that wasn't (2026-08-22)

The first real import round-trip against production returned
`{"status":"error","error":"audit is not defined"}` — the importer called an `audit()`
helper that exists in admin-ops but not in curriculum-admin. Everything else worked
(unit, lesson, 4 steps, quiz item all landed); only the trailing audit line threw.

The interesting part is why nothing caught it. The offline deno gate counted output
lines matching `^TS`, but deno COLORIZES diagnostics, so every error line really
starts with an ANSI escape. The gate had been printing "0 errors" for every function
in every round — it was a no-op, and an undefined function walked through it into
production. Fixed: strip ANSI, then count `TS#### [ERROR]`, and print the errors
instead of just a number. Current baselines with the working gate: chat 8,
admin-ops 2 (both type-inference noise on untyped row reads), everything else 0.
The class that matters is TS2304 "Cannot find name" — that is the one that means a
runtime crash, and it is now visible.

Lesson kept: a green gate proves nothing until you have watched it go red.

### R58b — the importer, verified against production (2026-08-22)

Not "the tests pass" — an actual import, run twice, against the deployed function:

- **First run** wrote the unit, the lesson, 4 steps (2 content + the quiz as an
  assessment step + the assignment step) and the quiz_item — and surfaced the audit
  bug above.
- **Second run, same document**: `created: 0` across the board, `updated: 4 steps,
  1 lesson, 1 unit`. Row counts identical, content changed in place. Idempotency is
  real, not aspirational.
- **Guard run**: a lesson claiming an id a teacher owns, a figure with
  `storage_path: "../secrets/key.png"`, and a lesson with no steps. All three were
  refused with named warnings; the teacher's published lesson came out with its
  title, its status and its (zero) steps untouched.

Test data fully removed afterwards — 0 rows left.

## R59 — make the PRODUCT path good enough for a chapter PDF (2026-08-24)

Owner: "cut up the 2 PDFs into individual PDFs for each chapter and I'll plug in each
chapter on its own… have the platform do the work it's supposed to do rather than
just feeding it in through the back end."

Right call, and the reason is important: hand-authored JSON through the importer
proves the IMPORTER works, not the FEATURE. If a teacher uploads a chapter and gets
mush, the product is broken no matter how good the back-end path looks. So the
importer stays as the bulk/repeatable route, and the product path becomes primary.

Two things stood between that plan and a good result:

1. **The platform could not see the answers.** Teacher editions mark the key by
   COLOUR — IT Frontiers prints every correct option and every written model answer
   in red. `getTextContent()` drops colour, so a teacher uploading a teacher edition
   handed us the questions and hid the answers, and the generator guessed a key the
   book was already stating. Extraction now walks the operator list alongside the
   text and appends the marked runs to their own page as a labelled line, so a
   question and its key stay together however the material is later sliced.

   **Which colour is the key is a document-level question, and the first two
   answers were wrong.** "Not the dominant ink on this page" marked 965 runs over
   100 pages — every heading and every running title. "Not the dominant ink in the
   document" also failed, because the book sets body copy in TWO inks (`40%` and
   `19%` of the characters), so one of them slipped through and half the chapter came
   back marked. What separates them is measurable: page furniture is on nearly every
   page in SHORT runs, body ink carries the bulk of the WORDS, and a key is a sliver
   of text on a minority of pages in long runs. So a stats pass runs first and a
   colour is a mark only if it carries ≤15% of the document's characters, appears on
   ≤85% of pages and on ≥3 of them, and averages ≥12 characters per run. On the real
   chapter that picks exactly the red key (255 runs over 37 pages) plus the Notes
   sidebar, and the Activity pages carry precisely their four correct answers.

   **One case no colour rule can crack.** Run over all four chapter PDFs rather than
   one, chapter 2 of A1 came back with 83 marked pages: it sets its running title in
   the same colour it uses for section names, so the colour is genuinely ambiguous.
   The text is not — "computers & beyond" repeats on 43 of 105 pages and an answer
   never does. So a second test runs on the RUNS, not the colours: a run whose exact
   text recurs on more than 10% of the pages is a running head and is dropped. That
   chapter fell from 83 marked pages to 34 and the other three were untouched. Order
   matters and is pinned: the colours are judged on the raw runs (stripping first
   shrinks a running head's page count and walks it back in through the page-share
   test), and the furniture-free runs are what gets written onto the page.

   Deliberately generic — the executable lines carry no colour literal at all, so any
   book that colours its key or its terms benefits and a book that colours nothing
   loses nothing. Failures are swallowed: colour is a bonus on top of text and must
   never fail an extraction.

   Spot-checked against the printed book: A1 Activity 1.2 yields exactly its five
   correct options, A1 Activity 1.3 exactly its five, and A2 Activity 1.3 captures
   the model answers for the OPEN-ENDED items too — so the generator now sees written
   model answers, not just multiple-choice keys.

2. **The platform only read the start of a chapter.** A real chapter is 111 pages
   ≈ 140k characters. The client truncated uploads at 40k and the outline window was
   24k, so a chapter upload produced an outline for its first lesson and a half.
   Raised: client 40k → 400k, outline 24k → 180k, package 24k → 48k, per-lesson
   slice 6k → 24k (a book lesson is 20–35 pages; 6k cut one off at its first
   section). The pin now asserts the CONTRACT — a window bigger than any single
   lesson — rather than a magic number.

Also produced: both books cut into 4 chapter PDFs and 17 lesson PDFs
(tools/book-import/split.mjs), cut on the extractor's own lesson map so the
boundaries follow the book rather than a guess.

Verified: 953 pins OK (one R57 pin re-anchored from a number to the contract, and
three R59 pins re-anchored to the measured algorithm — including the
publisher-specific pin, which now reads the file with comments stripped so the
measured colour table can stay as the record of the measurement while the rule stays
hue-free); tsc, eslint, deno gate all clean. The mark thresholds were verified by
running the shipped extractor over all four real chapter PDFs — 111, 105, 149 and 99
pages — not by inspection, and a check confirms the harness reads the same constants
the app ships.

## R60 — the three-room teacher console (2026-08-25)

Owner, annoyed: "why is the old curriculum builder back?? … lets just have the teachers
view have students, activity, and content … we keep things super simple. remember, the
users are lazy and not tech savvy."

**What was actually back.** Nothing had returned — the pre-R47 `StructureDetail`
node-editor pane (SUBJECT/COURSE/UNIT overline, title/description/Save changes,
Lifecycle) had survived inside the studio as the DetailPane for non-lesson selections,
and R56/R57 hung their AI panels on it. So the moment a teacher clicked a unit — which
was the ONLY way to reach "Build from material" — the clean R47 list swapped out for
the old builder chrome. Worse: "Duplicate for this class" auto-selected the course
node, so the old builder appeared unbidden; and the R57 whole-course build lived on a
course pane with NO in-app link at all — it shipped unreachable.

**The cure: three rooms, and the panes die.**

- `ClassSection` = `students | activity | content` (teacherNav.ts), Students the
  default landing. Legacy ?tab= values fold in (live/assignments/assessments/review →
  activity; classwork/curriculum/structure/lessons/resources → content; the rest →
  students), and an open `?assignment/?assessment` OVERRIDES a stale ?tab so old
  notification links still land on their work view (grading never hides).
- **Students** = People + Grades. Roster rows grow a live-now dot, "Grade 7 · last
  active 2h ago · N lessons done", and a grade chip from `gradeSummariesForClass` —
  which mirrors `fetchStudentGrades` exactly (released statuses, `final_score ??
  score`) so teacher chip and student list can never disagree. The full GradebookTable
  is one Roster|Gradebook toggle away, markup untouched.
- **Activity** = Live + the work items. Live strip with Watch, the class's slice of
  the review queue, every quiz/assignment in one list (needs-review first), New
  assignment / New quiz buttons, and the R47 precedence contract scoped to the tab:
  an open work item takes the room full-width.
- **Content** = the studio, re-scoped to units + lessons + materials. Only a LESSON
  opens an editor. `StructureDetail` is deleted; stale ?unit/?course/?subject URLs
  replace-navigate to plain Content. Units are managed inline: click the name (or the
  row's ⋯ menu) to rename in place — commit on Enter/blur, no-op when unchanged —
  and Delete keeps the lessons-empty gate. "New unit" arms the inline rename so
  create→type→Enter is the whole flow. Per-unit "+ Lesson" is a two-item menu:
  **Build from material** (leads) / Start blank. The R57 course build finally has a
  door — "Build a course from material" on the toolbar — resolving the class's
  backing course through `ensureBackingCourse`, the SAME helper "New unit" uses
  (extracted, R45's auto-link contract preserved), so there is one course-creation
  path, not two. The R50 fork banner now renders at the outline root too, so the
  server's "duplicate first" refusal always points at a button that exists; the fork
  lands back on the outline, not a pane.
- `fetchClassCourseLinks` joins the surfaceCache (it ran uncached on every studio
  mount); any curriculum-admin write invalidates it alongside the authoring snapshot.

Deliberately NOT done here: the lesson editor simplification is R60b (next PR), so
this diff stays reviewable.

Verified: 973 pins green (test_r47 rewritten as the three-room spine; r42/r43/
authoring-studio/r56 re-anchored; 13 new pins in test_r60_three_room_console; r45/
r48/r50/r52/r53/r57 untouched and passing). tsc + eslint clean. Offline harness:
screenshots of all three rooms; `?tab=classwork&unit=…` observed normalizing to
`?tab=content`; `?tab=live` observed landing on Activity.

## R60b — the lesson editor a lazy teacher can use (2026-08-25)

Second half of R60 ("we should also simplify the lesson building view"). Before: ~90
controls on one scrolling page — a 14-field basics form, 8 add-step chips, ~25
controls per expanded step, five generative entry points, and THREE independent Save
buttons whose unsaved state was invisible.

**Quiet by default.** Lesson basics shows Title + Objective; the other twelve fields
(level, type, mentor prompt, skill keys, answer modes, the whole tutor-behavior
group) fold under one "Advanced settings" collapsible — folded, not removed, so
nothing is lost, and the R52 hairline-group structure inside survives byte-for-byte.
The 8 add-step chips became ONE "+ Add step" grouped menu (Teach / Practice /
Assess), still driven by MODE_META so the mode vocabulary stays single-sourced. An
expanded step reads as title + prompt (+ choices) + the R48 Step-work strip; the
mode selects, code fields, attached materials, mentor-built activities, the artifact
generator and Delete step all fold under a per-step "Advanced". The strip stays OUT
of Advanced deliberately — linked work is the step's contract, not a setting.
KnowledgeCard collapses to its header (the eager load survives: the "N to review"
badge IS the summary). Publish/Archive/Move/Delete consolidate into the lesson
header (status chip + Publish + an overflow menu); the footer blocks are gone.

**One save.** A dirty registry in LessonDetail: each child registers
(id, dirty, flush) — no child state moves, each keeps its fields and its save body
(flush = the old save() minus the setOpen(false) that would slam N cards shut on a
batch save). A sticky bottom bar shows "N unsaved changes" and saves everything;
steps flush before meta; Publish calls saveAll() first so a teacher never publishes
stale text. Two structural guards against the flush race: saveLessonMeta goes
OPTIMISTIC when the milestone row already exists (no refetch to clobber the
optimistic step writes landing in the same tick; only the first save, needing the
server-assigned milestone id, still reloads), and the temp-id → server-id step swap
unregisters the old id so it can never linger dirty. Deliberate trade, documented:
no auto-flush on unmount (teardown writes misfire) — the always-visible unsaved
count is the mitigation.

Verified: 985 pins green (12 new in test_r60b_lesson_editor; one r48 literal
re-anchored "Open in Classwork" → "Open in Activity"; the r48 strip slice and the
r52 nesting pin pass untouched). tsc + eslint clean. Offline harness: the full
dirty cycle observed live — edit title → "1 unsaved change" → Save changes → "All
changes saved".

## R61 — both IT Frontiers books, built book-faithfully into production (2026-08-25)

Owner: "Can you build A1 and A2 fully please?" Chose (AskUserQuestion): the
**book-faithful build** — a mechanical composer over the extracted book text, no AI
generation — with **page-image fallbacks** for diagrams (the books' art is mostly
vector line work with no captions; whole-page renders bound to the right steps beat
nothing, and true figure-cropping stays a follow-up).

**Extractor v2** (tools/book-import/extract.mjs). The R58 extractor read ONE answer
red; the books use THREE (#ff5739, #ff4227, #ff7657) and the AI chapter is set
almost entirely in the second — 8 of 17 lessons were near-answerless until this.
Red is now marked at the text-ITEM level: answers never enter student-facing text
(leak-strip by construction) and each answer attaches to the question it follows in
reading order, which makes the books' two-column scramble harmless — the answers
ride WITH their questions, and questions are never re-sorted. Activities come out
structured (tf | mcq | match | open | project) with options and answers attached;
an MCQ's red run IS the correct option's text (letter recorded, option kept, text
restored when trailing prose polluted it); T/F grid letters come from the op-level
runs (item joins can merge two letters and shift the whole grid — caught when
statement 4 of the very first grid came back F for T). The Appendix/glossary
splits off each book's final lesson into books/itf-*/glossary.json (139 + 111
terms, committed for future vocab work, not imported). The AI chapter's broken
display font leaks "artifi ia al li i t t" shrapnel — filtered by token shape, and
the filter learned the hard way that digit tokens and acronyms are not shrapnel
(it ate "Activity 4.4 - Exploring AI" and with it the book's second project).

**Composer** (compose.mjs). Sections become explanation steps carrying the book's
own words (callout definitions verbatim); activities become inquiry/reflection/
applied-practice steps with the teacher edition's model answers embedded as MENTOR
guidance ("never read them out"); the graded quiz walks mcq activities in reverse
book order taking ONLY red-backed questions (merged question buckets — a lost
number glyph fuses two questions and the second red overwrites the first's letter —
are recovered via the option-id-sequence restart or skipped, NEVER guessed); the
two named projects (Activities 3.6, 4.4) become their lessons' assignments and the
other 15 synthesize from the last open activity, the way lesson 1 was
hand-authored. A1 ch1 lesson 1 splices in the authored exemplar verbatim
(books/itf-a1/lesson-1-authored.json) — it is live in prod with those exact 18
step ids, so re-import is a pure in-place update with zero orphan risk.

**The quiz trap, pinned**: only lesson.quiz[] creates graded quiz_items rows; the
composer never emits an assessment step; a bare practice step would silently
become a CODE step, so applied practice always carries mode_type:"applied".

**Importer materials branch** (curriculum-admin). lessons[].materials binds page
images to steps as lesson_resources rows {resource_type image, source_type
external_url, activity_id = <lessonId>-s<step>}: relative /books/<slug>/p<N>.jpg
URLs resolve against the app's own origin (campus-wiring precedent), files live in
frontend/public/books/ (62 pages, 8.6MB). lesson_resources.id is a generated uuid,
so import idempotency keys on metadata.material_id + metadata.import_key —
insert-or-patch, never delete, foreign rows left alone with a warning. Materials
land as drafts; publish_lesson flips them. The same pages also land as
lesson_figures with image_url for mentor [[figure:id]] recall.

**Validator** (validate.mjs) refuses what the book does not back: every graded
answer must trace to a red run, no assessment steps, applied practice explicit,
no glossary text in prompts, materials in step range with files present, the
spliced lesson byte-identical to the exemplar. It caught six polluted option
texts, a fused two-question quiz item with the WRONG letter, and a one-choice
"question" before any of them could reach production.

Corpus landed in the four committed envelopes: 17 lessons, 187 teaching steps,
126 graded red-backed quiz questions, 17 assignments (2 book projects), 35 bound
page images, 2 glossaries. Verified: 1014 pins (29 new in test_r61_book_build —
string pins on the pipeline plus DATA pins over the committed envelopes), deno
gate 0 errors on curriculum-admin, r58 import pins untouched.

## R63/R64 — context-first conversation: the model decides meaning, the machine decides law (2026-08-26)

Decision (owner, after reviewing Elissar's live session 689bd990, where three plain
skip requests and a shouted YESYES never moved the lesson while the mentor verbally
agreed each time): "I don't want to create just a list of things to watch out for.
We should create a system that understands the flow of the conversation and can
adapt to it… since it's an API, we have to find a smart way to give context in the
conversation as well as keep context up to date with the flow of the lesson."

The architecture that shipped, in three slices on top of R63's mentor movement:

- **One brain per turn, fully briefed.** The mentor model is the only interpreter of
  what a student message MEANS. Its structured verdicts — `movement` (R63),
  `student_action` (the turn's kind, authoritative for the persisted state fold),
  `flow_summary` — are validated and executed by the state machine, which keeps
  exclusive authority over what the rules ALLOW: gates, ceilings, integrity
  (quiz/code/submission can never be talked open), grades.
- **The world brief.** A `flow` payload key (absorbing the old `step_contract`)
  rides the live block just ahead of the directive every turn: step identity + type,
  presented, `owed` (the single headline of what stands between the student and the
  next step), per-gate statuses, attempts, quiz screen state, pace (briskPace),
  register + ceiling honesty, and `room` — turn-specific facts (R31e/R32c ceiling
  honesty, pre-emption credit, mastery compression, recall openers, the approved
  figure, spoken integrity refusals) that used to be whole directive rungs.
- **The ladder dissolved into standing law.** `turnDirective` keeps only mechanical
  rungs — navigation frames, deterministic grades (quiz/code/work), stuck-cap
  conclusions, attached UI — plus an EMPTY "brief" default for every conversational
  shape. The scripts those rungs carried moved verbatim-ish into the SYSTEM prompt
  as STEP TYPES (per-type presentation/mid/close contracts), CONVERSATION FLOW
  (readiness, questions-first, tangents, dwell escalation), CLOSING A STEP (the
  close ritual + R63's skip exception), and BRISK — cached once instead of
  recomposed per turn. `teaching_move` now records "brief" on dissolved shapes (no
  runtime consumers; the key remains the audit label).
- **The classify task is deleted.** assessTurn is grade-only and runs ONLY when a
  hard understanding gate needs a verdict before the mentor speaks
  (isTextExplanation); most turns reach the mentor with zero pre-model calls.
  heuristicKind (incl. R63's skip recognizers) drafts the pre-model kind;
  `turn_kind` persists what actually drove the fold, `student_action` beside it
  raw; `router_disagreement` telemetry retired.
- **The summary writes itself.** The mentor rewrites the session's running summary
  every turn (`flow_summary`, 3-6 sentences: taught/attempted, struggles, PROMISES
  made, UNRESOLVED asks, pace/mood) → learning_sessions.running_summary, read back
  as conversation_so_far. The cheap-model refresher stays as a dormant fallback
  (its ≥6-turn early-exit only fires when the mentor stops maintaining it). Zero
  schema change.

Reason: the ladder scripted ~40 conversational shapes from thin per-turn state and
had to be patched shape by shape (R31e, R32c, R63…) every time a real student's
words fell between rungs. Giving the full-context model the interpretation job and
the machine the law job removes the class of bug instead of the instances — and
drops a pre-model model call from most turns while shrinking the per-turn payload.

Verified: 19 deno flow tests run live (kept-rung witnesses, a dissolved-shapes-
fall-to-brief net that fails if any rung grows back, Elissar's four verbatim
messages, movement/integrity properties, 2500-vector fuzz); 1055 python pins;
deno-check signature parity with HEAD (the 8 pre-existing errors, none new).

## R64.1 — revision pass: the record follows the mentor, and no rule waits for a ghost label (2026-08-26)

Owner: "please revise", straight after R64 shipped. A fresh audit of the live prompt
and code found four coherence gaps between the new regime's promises and leftover
text/machinery; all fixed, no architecture change:

- The CONVERSATION CRAFT shape rule still said "the directive names these" — a label
  the dissolved ladder never sends. Both shape lines now key off the mentor's own
  student_action verdict.
- Brief-turn closes triggered on "flow.owed nothing AND the directive carries no
  other event" — mushy when a close coincided with a resource clause or the
  no-button note (the R34 voice-behind-record family). The close is now ANNOUNCED:
  a flow.room fact ("This reply ENDS the step…", with the skip-shaped one-liner
  variant) fires exactly when a pacing gate newly stamped on a brief turn with no
  live quiz; CLOSING A STEP keys off the announcement.
- In Practice, the R31e way-back room fact and the practice_register rung stacked
  two asks; the fact now overrides the next exercise for that turn (EXACTLY ONE ASK).
- missOverridden: the pre-model open-ended miss (heuristic answer_attempt + grader
  not-passed) was the one surface where a keyword heuristic could still MARK a
  student. When the mentor's student_action says the message was not an attempt,
  the miss is dropped from everything that persists (fold, graded_fails, attempt
  row, needs_retry, envelope grade) — completing "the mentor is authoritative";
  deterministic quiz/code grades can never match the gate (reference equality).
- Legacy "text" steps are now named in the STEP TYPES reflection bullet.

Verified: suite 1058 green (3 new pins), deno flow 19/19, deno-check parity.

Second round (adversarial diff review, same day): the presented_at stamp now
matches what the reply is TOLD to do — Discuss and artifact_ready turns never
present, so neither stamps (the Round 22i hole the brief default had quietly
reopened), and the presentation room facts ride the same guard; artifact turns
carry an honest directive key ("artifact_ready"); flow.owed names only an
ELIGIBLE quiz (an acknowledge-gated quiz step owed "an acknowledgement" first —
the old wording deadlocked movement against options not yet on screen);
flow.step.kind restores the response-mode axis so a code-mode practice step
reads the code contract, not reflection; the no-button denial moved off the
directive tail into flow.room, making a brief directive genuinely EMPTY; the
summary refresher re-checks summarized_turns before patching (no clobbering a
fresher mentor summary) and the mentor's rewrite is stored even on the
completing turn; the dead router_disagreement wire field is deleted end-to-end;
a page of router-era comments now tell the truth about heuristicKind being the
only pre-model draft. Two pre-existing bugs fixed on the way: the R31e
way-back pill's accept turn fell into the DISCUSS script (lesson now has its
own branch), and a correct quiz tap on a quiz-bearing revision step was
narrated as a stuck cap (now falls through to quiz_passed).

Verified after round two: suite 1062 green, deno flow 21/21, parity exact.

## R65 — the recurring bubble had two stacked causes: a fatal stale pointer, and RLS-silenced evidence (2026-08-26)

Owner hit "Something went wrong on our side" again after v110 and pasted gateway
logs — the first time this failure has ever arrived with its evidence attached.
Diagnosis, confirmed line-by-line: the client re-sends a pinned session_id the
account cannot see under RLS (learning_sessions is own-rows-only; the row was
deleted, another account's, or paired to the wrong lesson) → loadOrCreateSession
threw "Learning session was not found." → typedError masked it with the student-
safe bubble → "Try again" replays the identical dead pointer forever. And the R32
setup-failure recorder — built to make exactly this diagnosable — inserted its
evidence with user_id NULL under the caller's JWT, which the runtime_events
insert policy (user_id = auth.uid() or staff) rejects: every setup failure since
R32 left a 403 where its reason should have been. One mask, invisible causes —
which is why "the old error" kept "coming back": each recurrence was a different
bug wearing the same bubble.

Fixes (chat only, no schema):
- Self-healing resume: a CONFIRMED-EMPTY session lookup falls through to the
  user's newest session for the lesson, or creates a fresh one — recorded as a
  stale_session_pointer controlled_error. Transport failures still throw
  (loadFirst returns null only on an empty 200), so healing never masks an
  outage. Fresh-open semantics unchanged.
- Identity, not privilege: the setup recorder now carries the authenticated
  user's id (authedUserId), so post-auth failures satisfy the existing insert
  policy. The P8 posture stands — chat still never holds the service key; the
  reverted alternative (service-role telemetry) was rejected against the pinned
  posture. Pre-auth failures remain gateway-log-only by design.

Verified: suite 1068 green (new test_r65_session_selfheal pins: no fatal branch,
heal scoped to empty reads, recorded recurrence, no null-identity recorder
calls, posture intact); deno flow 21/21; deno-check parity.

## R66 — launch hardening: degrade, don't die; verify the LIVE path, not just the source (2026-08-26)

Owner: schools launch in days — "why does it keep breaking? we can't have this
happen at all later." The honest answer, recorded: every recent breakage lived
in the seams the static suite is blind to by construction (RLS policies, live
auth, session state, client caches, the model API), because everything ships
straight to the production function with no live verification — and until R65
the one generic student-safe bubble plus a broken failure recorder made every
distinct failure look like the same recurring bug. Three layers close this:

- scheduleBackground now defensively catches every task (an unhandled rejection
  inside waitUntil can kill the isolate — one background hiccup must never cost
  a student turn). Self-catching callers were a convention; now a guarantee.
- Optional context reads are fail-soft (mastery, resources, interactions,
  profile, milestone, misconceptions, chunks): a transient read costs that
  garnish, never the turn. Integrity/correctness reads stay hard on purpose —
  lesson, activities, recentTurns (idempotent replay), quiz rows (a transiently
  "missing" quiz must never silently drop a quiz gate), stepWork (fail-closed).
- A LIVE smoke test (scripts/smoke-live-turn.mjs + .github/workflows/
  smoke-live.yml) signs in as a dedicated smoke STUDENT and drives real turns
  against the DEPLOYED function after every deploy and on a 2-hour heartbeat:
  password auth, the R65 stale-pointer self-heal, and a resume turn with a
  non-empty mentor reply. A broken student path turns the workflow red (GitHub
  emails the owner) instead of surfacing in a classroom. Needs SMOKE_EMAIL /
  SMOKE_PASSWORD repo secrets (skips green with a loud warning until set).

Standing recommendation, adopted: FEATURE FREEZE on the conversation engine
until launch — R64 completed the architecture; remaining days are hardening
and bug fixes only. The achievable launch standard (zero failures is not a
real thing on networks and model APIs): failures are rare, invisible to
students when they happen (self-heal or a retryable calm line), and visible
to us with reasons (runtime_events now receives evidence — R65).

Verified: suite 1073 green (new test_r66_launch_hardening), deno flow 21/21,
deno-check parity.

## R67 — students speak in intent, not register names: auto shift + flow-driven suggestions (2026-08-27)

Owner: "lets also add auto mode shift and shift suggestions based on conversation
flow" — and the live case arrived the same morning. Carl, in Discuss, typed "Can
you give me a few questions to try?"; the mentor obliged with an ungraded
shadow-drill in the wrong register (no mastery targeting, no teacher banks, no
grading), and Carl had to discover the mode picker himself and re-send the same
words in Practice. The register system worked exactly as built — and still made
the student do the machine's job.

The context-first split extends one field further:
- The MENTOR decides meaning: a new output field `register_shift` ({to, reason}),
  set only when the student's own words asked for what another register IS
  ("give me exercises / quiz me" → practice; "can we just talk about this" →
  discuss; "back to the lesson" / a move-on demand from Practice/Discuss →
  lesson). The reply announces the switch in a natural clause and acts in the
  new register immediately.
- The MACHINE decides law: a shift is visible and reversible (the client picker
  follows after the stream settles and stays live); it changes only what the
  client sends NEXT turn — this turn folded under the register it arrived in,
  so gates/ceilings are byte-untouched (applyModeCeiling count still 4); never
  in a revisit, never over live quiz options, never OUT of Lesson while graded
  work is owed (flow.owed integrity items), never twice within the anti-flap
  window (derived from persisted mentor payloads, like briskPace — no schema).
- The R31e dead-end closes for good: an advance-demand in a ceilinged register
  now emits the lesson-ward shift DETERMINISTICALLY even when the model omits
  the field; the way-back pill still attaches for older clients, and a client
  that applied the shift suppresses the now-redundant pill (both mapping paths).
- Suggestions widen: mode_offer may now ride mid-step when the conversation's
  own flow shows the register no longer fits — behind a cooldown (no offer or
  shift in the recent window), never over live options/revisits, and a
  flow.room fact tells the model when the cooldown is active so prose and
  chrome never disagree.

Also this session: reviewed every chat from today + yesterday (Carl ×2, Elie
×3; Elissar previously). R63 movement verified live ("Yes go on to that" → a
one-line handoff), the practice drills are strong (varied shapes, honest
escalation), and R65's self-heal fired 4× including minutes before Carl's
morning session — zero chat_failures in 48h of runtime_events.

Verified: suite 1086 green (new test_r67_register_shift; pillar-2 cause union
and R35 pill pins consciously widened), frontend tsc clean, deno flow 21/21,
deno-check parity.

## R68 — honest cost accounting + Sonnet 5 pricing (2026-08-27)

Found while building the launch price sheet from model_usage_events: the
Anthropic adapters reported inputTokens WITHOUT the cache-read share, while
estimatedCostUsd assumes the OpenAI shape (prompt total INCLUDES the cached
share) and subtracts cachedTokens. On steady cached turns the ~16.4k read
block exceeded the ~4k fresh input, the subtraction clamped fresh to zero,
and the fresh prompt was billed at the 10% cache rate — the ledger understated
real Anthropic spend ~2x (Carl's completed ch1-l1 recorded $0.25; true ~$0.54).

- Both Anthropic usage sites now report inputTokens as the TOTAL prompt
  (fresh + cache writes + cache reads); cachedTokens stays the read lane. The
  estimator's one contract is stated at the definition. Historical rows are
  left as written — the raw token columns were always correct.
- Deliberately unmodeled: the 1.25x cache-write premium (~2%/turn undercount).
  Adding a creation column is not worth the schema churn at this spend.
- Sonnet 5 priced explicitly ($2/$10 launch price made permanent per the
  official pricing docs, 2026-08-27; the scheduled Sept rise was cancelled);
  the longest-prefix sort lets it beat the generic $3/$15 sonnet row.
- Pinned in tests/test_r68_cost_accounting.py.

Also this session: the owner's price sheet itself (30 students, 3 lessons/day,
A1+A2) was delivered as an artifact — measured baseline 16.4k cached block /
~3.8k fresh / ~525 out per turn, 14-28 turns per lesson, 17 published lessons;
tiers Haiku/Sonnet 5/Opus 5/Fable 5 plus two auto-tier blends; per-turn model
routing designed on existing pre-model signals (mechanical ~40% of turns →
cheap tier) but NOT built — env-flagged R-task for after launch if wanted.

## R69 — a figure is the figure, not the page (2026-08-27)

Under the curriculum-delivery framing the book's own visuals ARE the product,
and a lesson figure was a full-page scan: tap a diagram, get a picture of page
34 with headers and page number. The mentor prompt tells the model to point at
what is IN the figure ("the stacked layers labelled B") — nonsense against a
whole page.

- The books are VECTOR-drawn (zero embedded raster images), so a figure is a
  cluster of drawing operations. scripts/extract-figures.py clusters them,
  keeps the ones that are art, attaches the caption below (and a short label
  above), and renders a tight crop as p<page>-fig.jpg.
- Crops never replace scans: a page with no confident figure keeps its scan, so
  a bad detection degrades to yesterday's behaviour, never to a blank. Scans
  also remain the lesson's reading MATERIALS; crops are its FIGURES.
- Three rules earned by the books themselves: (a) a lone bordered text box is
  one of the key-fact banners, never a figure — but a text panel standing
  BESIDE art belongs to it (the wheat/steps/bread illustration); (b)
  zero-thickness strokes are real drawings, and treating their empty bounding
  rect as "nothing" hid every grid line in A2's drawn data tables (34 figures);
  (c) the activity worksheets are big ruled tables of sentences, separated from
  illustrations by DENSITY — measured across both books they sit at 9-10 ops
  per unit area against 21 for the thinnest real figure, so the cut is 15.
- Yield: 52 crops (A1 19/37, A2 33/77); the rest keep page scans. Chapter docs
  and the pinned exemplar point at crops where they exist, and the live
  lesson_figures rows are updated to match after the frontend deploys.
- Pinned in tests/test_r69_figure_extraction.py (incl. real detection against
  the committed PDFs) plus the R61 orphan-image pins, now split scan/crop.

## Pricing benchmark: Opus 5 (2026-08-27)

Owner: "make sure all numbers take the opus 5 as the benchmark to be
calculated." Every cost and quote figure is now computed against Opus 5 — the
model this codebase actually runs (ANTHROPIC_MODEL_DEFAULTS.default) and the
quality behind the transcripts we judged good. Cheaper engines are expressed as
a measured percentage OFF that benchmark, never as the basis of a quote, so a
price can never be defended on quality we do not ship.

Benchmark figures (context diet assumed; production token shape): Opus 5 on
every turn = $1.09 per mentor-hour, $2.50 per well-studied ~20-step lesson,
$42.45 for the whole A1+A2 catalog, $195/$391 per student-year at the Core
(180 h) / Intensive (360 h) bands. Indexed against it: Opus+Haiku 60/40 = 66%,
50/50 = 58%, Sonnet 5 = 40%, Haiku 4.5 = 15%.

Consequence for R72: routing is not a nice-to-have. Opus on literally every
turn costs $195-391/student/yr to serve, so a 2x quote ($391-781) exceeds a
school's entire textbook budget for 6-8 subjects. The blends keep Opus on every
JUDGMENT turn (teaching, prose grading, practice, discuss; ambiguity routes up)
and pay Haiku prices only for turns whose replies the machine already scripts —
which is what makes benchmark quality sellable at $189/$299.

## R70 — the review gate over AI-built courses (2026-08-27)

Build priority 1 under the curriculum-delivery framing: a course built from a
book lands as twenty-odd draft lessons, and the only way to know what the
machine wrote was to open each one and publish them individually — so in
practice nobody checked and the first reader of an AI-written lesson was a
student. Under this framing a badly built course does not disappoint a feature,
it breaks the core promise, so the gate is the safety valve.

- review_unit (read-only) reports what is THERE per draft lesson — steps,
  teaching steps, checking steps, figures — plus flags. It deliberately
  computes no quality score: a machine cannot tell a teacher whether a lesson
  teaches well, only what it contains.
- BLOCKING flags are reserved for broken-as-data: no steps at all, or a
  multiple-choice step with nothing to choose. Thin, unillustrated,
  nothing-checked and placeholder-prompt lessons are NOTES the teacher can
  publish straight past. Blocking holds back that one lesson, never the batch.
- publish_lessons publishes the ticked set; a failure is reported per lesson
  and the rest still land, because a half-built course must never block the
  twelve lessons that are fine. Author checks are cached per organization+class
  so a twenty-lesson publish is not twenty membership round trips.
- Single and bulk publish now share ONE write path (applyLessonPublish), so a
  lesson published from the gate is byte-identical in outcome to one published
  from the editor. Background knowledge extraction is scheduled by the
  dispatcher for both (autoExtractKnowledgeAfterPublish is scoped there).
- The panel pre-ticks everything publishable — the common case is "this all
  looks right" — and never pre-ticks a blocked lesson.
- Pinned in tests/test_r70_review_gate.py.

## R71 — the weekly evidence digest (2026-08-27)

Jargon is sold on one line: "the book never told you who's stuck — this one
does." That is only true if the teacher is TOLD, on a rhythm, without going
looking. The hotlist answers "who needs me right now"; the progress report
answers "how is this child doing, for their parents". Neither answers the
question a teacher carries into Monday: what did my class learn last week, and
what must I teach again? This is the renewal engine.

- New teacher-scoped admin-ops action teacher_class_digest, authorized through
  class_memberships (NOT admin access), read-only and computed on demand over a
  1-60 day window (default 7). No new table, no scheduled job, nothing to
  migrate. Rendered as ClassDigestCard at the top of the Activity room.
- Honest reporting is the whole design. A skill only reaches "worth teaching
  again" when TWO OR MORE students missed it, so one child's bad afternoon is
  never shown as a class-wide gap. Study minutes count only gaps under ten
  minutes between a student's own turns, so the number under-states rather than
  flatters. Resolved misconceptions are excluded; only evidence scoring under
  half marks counts as a miss.
- Silence is reported: every enrolled student with zero turns in the window is
  named. That is the signal no live dashboard shows and the one teachers most
  need.

Bug found against production data while building it (and pinned): counting a
student's turns WITHOUT scoping to this class's own lessons showed every class
the same 111 turns, because students here are enrolled in six classes each.
Biology 10 would have reported 111 turns of activity when the true answer was
ZERO. The digest now resolves the class's lessons through
class_courses -> course_versions -> units -> lessons and filters every turn,
session and evidence row through it; a class with no course linked reports
no_curriculum rather than a misleading zero.

Pinned in tests/test_r71_class_digest.py.

## R72 — the margin levers: auto-tiering + the context diet (2026-08-27)

The Opus 5 pricing benchmark settled that per-turn routing is not an
optimization but a PRECONDITION of the price sheet: Opus on literally every
turn costs $195-391 per student-year to serve, so a defensible 2x quote
($391-781) exceeds a school's entire textbook budget for 6-8 subjects.
Together these two levers take Intensive-band serve cost from $504 to $225.

- AUTO-TIERING (worth ~34-42%). A new "mechanical" ModelRoute, defaulting to
  Haiku 4.5 (TUTOR_MODEL_MECHANICAL), sits beside the benchmark lane. The
  routing is one-directional and computed from signals the engine ALREADY has
  before the model call — no extra call, no new classifier. Cheap only for:
  a quiz tap the server already graded (and only once the quiz is settled), an
  explicit control press, or a bare move-on in prose. Benchmark for everything
  else, and specifically for: presenting new material, grading prose, revisits,
  help requests, questions, attempts, and anything unrecognised. Unsure routes
  UP. The asymmetry is deliberate — being wrong toward the benchmark costs
  money, being wrong toward the cheap lane costs a student their lesson.
- CONTEXT DIET (worth ~22%, no quality trade). The replayed history is about
  half of every turn's fresh input and is re-sent turn after turn. The diet
  tapers turns 7-16 from 1200 to 400 chars, and ONLY when a running summary
  exists to carry that ground (R64). The most recent 6 turns keep their full
  length, so the R30 fix this could have regressed — the mentor forgetting what
  it just said — is untouched. The window itself stays 16; the diet shortens
  text, never drops turns.
- BOTH ARE ENV-FLAGGED, DEFAULT OFF (TUTOR_AUTOTIER, TUTOR_CONTEXT_DIET). This
  ships dark: with the flags unset the function behaves exactly as before.
  Turn on and A/B on our own accounts before any school sees it.

Pinned in tests/test_r72_margin_levers.py (wiring + defaults) and executably in
tests/flow_core.test.ts (the real autoTierRoute over every guard shape, 22/22).

## R73 — realigning the teacher console on the frame (2026-08-27)

The console was built as a general-purpose LMS: subjects -> courses -> units ->
lessons, "build from material" tucked inside a "+ Lesson" menu, and NOTHING
anywhere naming which book a lesson came from. But the claim this product is
sold on — and the only thing a competitor cannot copy without content deals —
is that the school's OWN book becomes a taught course, and that the medium
reports back who is learning what. The console did not say either.

Owner chose to realign INSIDE the existing three rooms rather than restructure
them days before a school launch: same rooms, same URLs, same deep links and
legacy ?tab= mappings — reframed around the book.

- SOURCE IDENTITY. lessons.import_key (already fetched, never typed or shown)
  now marks a lesson as a BOOK lesson, and lesson_figures.source_page gives the
  page range. Both the outline row and the lesson header name the book and its
  pages, so a teacher can check a lesson against the copy on their desk. A
  hand-authored lesson claims no source — the console must never imply one that
  does not exist — and pages are omitted rather than guessed when no figure
  carried a page number. Draft status still leads the outline meta: that is the
  thing a teacher must act on.
- THE BOOK LEADS. Content opens with a books panel above the generic tree: per
  book, chapters and lessons loaded and how many drafts are awaiting review. It
  reports what is THERE and never a completion percentage — we have only seen
  the part of the book that was imported.
- THE REVIEW GATE IS STANDING. R70 was reachable only from a just-finished
  build; a book with drafts now offers "Review & publish" at any time.
- THE LANDING REPORTS BACK. The R71 digest moves from inside Activity to the
  top of Students, the room a teacher lands in, so the first thing they see is
  what the class learned. Activity keeps answering "who needs me right now".

Deliberately NOT done: no new rooms, no nav changes, no URL changes. The
curriculum studio keeps every generic authoring path it had.

Pinned in tests/test_r73_teacher_realignment.py.

## R74 — making the authoring surface legible (2026-08-27)

Owner, about the console he built himself: "it's not clear where to create a
lesson, it's not clear how to edit an existing lesson, it's not clear how to
create an assignment in a specific place and assign it to specific people...
there's just one button that creates everything."

The root cause is NOT missing capability. Assignments already bind to a
lesson_id and carry per-student recipients; every resource already has a lesson.
The cause is that build-from-material makes steps, a quiz, an assignment and
materials in ONE action — so the teacher never watched the pieces appear and had
no reason to believe they were separate, editable things — and the only door in
was a generic "+ Create" that asked which lesson AFTERWARDS.

- INVENTORY. A lesson now states what is inside it (steps, quiz steps,
  assignments, materials) on the lesson itself, each count a place rather than a
  statistic, and an empty count says what is missing instead of "0". A lesson
  with no steps admits "empty" in the outline tree, because an empty lesson is
  invisible in a list of titles and is exactly the one to open.
- CREATION NAMES ITS TARGET. Work is created FROM the lesson it belongs to:
  createContext.activityId = null is now a first-class case meaning "this belongs
  to the LESSON", alongside R48's step-linked case which is untouched. The place
  is never a question, and the dialog's existing student picker answers "for
  whom" — capability that was always there and never reachable from the lesson.
- RESOURCES ARE RANKED, NOT RE-PARENTED. The book import staples the chapter PDF
  and every page image to each lesson (measured: ~11 images and ~8 PDFs per
  lesson, 211 rows live, ZERO orphans). The attachment is correct and the
  ranking was missing, so the attach list is grouped — lesson materials above
  "From the book" — and no row is moved. Book material is recognised by the
  importer's own metadata.import_key stamp, not by title matching.

Deliberately NOT done: no new rooms, no schema change, no re-parenting of any
resource, and the generic create menu still exists for teachers who think
top-down. Pinned in tests/test_r74_authoring_clarity.py.

## R75 — subtracting the authoring surface (2026-08-27)

Owner, after R73/R74 added yet more panels: "why is there the build course from
material? why is there books and shared content? why are the page links in two
places? ... why is building from material different from building from scratch?
nothing seems to live where it should."

Every one of those has the same answer: since R43 each release ADDED a surface
and none removed the one it superseded, so the room is eight releases of
sediment seen at once. R73/R74 contributed three of those panels — including a
books panel added to a room that already had a books drawer. The fix for
accretion is not more organising. It is deletion.

- ONE NAV. CLASS_SECTIONS was rendered twice — sidebar sub-rows AND console
  pills. The pills won (they sit beside the content they switch); the sidebar
  keeps classes only, still preserving the active tab when switching class.
- ONE BUILD DOOR. The "+ Lesson" menu forked Build-from-material vs Start blank
  — the same act, forked before the teacher had decided anything. Gone: adding a
  lesson opens the one builder, and whether to work from reference material is a
  choice INSIDE it. Owner's rule: "building from material should not be a
  separate thing ever."
- LINKED CONTENT IS NOT A PAGE FIXTURE. The always-open "Books & shared content"
  drawer is gone; the panel opens from a Linked content button. It is kept, not
  deleted, because it remains the only surface that can trim what students see.
- KNOWLEDGE IS A BY-PRODUCT, NOT A STEP. Measured before deciding: 56 published
  lessons, 39 carry ideas/vocab, and 2,351 student_mastery rows lean on them —
  it feeds the brain map, My Jargon and the mentor's sense of what is fading, so
  it is load-bearing. But it is auto-drafted at publish and needs only occasional
  review, so the card is collapsed rather than competing with Steps.
- A RATCHET, not a target: tests pin the count of always-on section headings in
  the authoring room at its current 21 and allow it only to FALL. A release that
  wants a new always-on section has to retire one first — the discipline whose
  absence caused this.

Kept deliberately: resource upload to class/unit/lesson stays its own
first-class surface (owner: "a very important part of building any content").
Still owed: an AI assist at every building point (titles, summaries, steps), not
only the two places that have one today.

Pinned in tests/test_r75_subtraction.py; R42/R45/R56/R60 pins re-stated against
the new law rather than dropped.

## R76 — an assistant at every building point, and one kind of building (2026-08-28)

Owner: "at every building point there should be an ai assistant to help draft
content (steps, titles, summaries, ...)" and "building from material should not
be a separate thing ever."

- SHORT-FIELD DRAFTING. New generate mode "text_field": one path that drafts a
  lesson title, objective, unit title, mentor prompt, assignment instructions or
  a summary. Before this, drafting existed only for a whole lesson and a whole
  step list — the big, rare acts — while the small writing that is most of
  authoring had no help. Fields are an ALLOW-LIST, each with its own guidance and
  length cap; an unknown field is refused rather than free-form prompted.
  Authorization rides whatever the field is attached to, like every other
  authoring action, and lesson context is read once and reused for both the check
  and the prompt.
- THE ASSIST NEVER SAVES. It returns one string and writes nothing: the field is
  filled, the teacher's own Save still commits, so a draft can always be edited
  away or ignored. It passes the field's CURRENT value, so on a filled field it
  reads "Improve" and refines rather than replacing.
- ONE KIND OF BUILDING. The lesson builder is now "New lesson": it asks what the
  lesson should teach FIRST, with reference material as an optional input beneath
  it. Material was already optional in the gate (a prompt alone always worked) —
  what was wrong was the framing, which opened by demanding an upload and made
  working-from-material look like a different act instead of the same act with a
  source attached.

Note on the R75 ratchet: this pass first added a "Reference material" section
heading and the ratchet failed the build at 22 > 21. The rule held — the heading
was downgraded to a field label rather than raising the ceiling. That is the
discipline working on the release immediately after it was introduced.

Pinned in tests/test_r76_assist_everywhere.py.

## R77 — step 1 of the rebuild brief: three defects, named and fixed (2026-08-28)

The owner walked the console after R76 and found it worse than before the four
releases that were meant to clarify it. Three of his findings were defects I
introduced. Fixed here, individually pinned, because each is a distinct failure
mode the rebuild brief names.

- RENAMING INSTEAD OF RESOLVING. R75 renamed "Books & shared content" to
  "Linked content". The panel picks which COURSES a class teaches; it has never
  had anything to do with resources, and "content" already means the room, the
  resources and the materials. Now "Courses in this class" — the name says what
  it manages.
- PARTIAL DELETION. R75 removed the lesson-level Build-from-material/Start-blank
  fork and reported the build path unified, while the course-level entry still
  stood. On inspection it is NOT a duplicate: AiOutlinePanel drafts the course's
  units and lesson titles, BuildFromMaterialPanel drafts one lesson's steps.
  Deleting it would have removed the "get my book in" job, so it got the fix
  lessons already had — renamed "Add units & lessons", with the ask leading and
  reference material an optional input inside it. (The brief's own verdict of
  "cut, duplicate" was wrong and is corrected here.)
- STALE STRINGS SURVIVING THEIR FEATURE. The outline's empty state still told
  teachers to open a drawer deleted in the same release, and two comments still
  described the removed fork. Copy is part of a feature.

Also corrected: two older pins (R60, R75) asserted the old names. Re-stated
against the new ones rather than dropped.

The AI-button critique from the same review is NOT addressed here — it needs the
engineered answer in Part 5 of the brief (the assistant as empty state and
default, not a button), which is rebuild work, not a patch.

## R78 — step 2 of the rebuild brief: the teacher surface is readable (2026-08-29)

Two files held the whole teacher product: teacher.curriculum.tsx at 6,301 lines
and TeacherConsole.tsx at 4,501. The brief's step 2 is "split the mega-files —
nothing can be designed while it's unreadable". No behaviour change; this is
movement only, and it was verified as movement rather than asserted: every
non-import line of both originals appears exactly once across the new files,
same multiplicity, zero added and zero dropped.

The shape. Two entry points keep what an entry point should own — state, and the
write paths the surfaces call back into:

- `routes/teacher.curriculum.tsx` (1,756 lines): the bookmark redirect, and
  CurriculumStudio holding the authoring data and its writes.
- `features/teacher/TeacherConsole.tsx` (969): which class, which student, which
  section, and the console's writes.

Twelve modules under `features/teacher/authoring/` and nine under
`features/teacher/console/` hold everything they render, split by job rather
than by size: the pure algebra (localState, derive) separated from the surfaces,
the shared primitives (fields, dragList, chrome) separated from the screens, and
one module per screen.

PINS READ THE SURFACE, NOT THE FILE. 50 test files read the route as text and 36
read the console, asserting substrings — which pinned each line's ADDRESS along
with its content, so moving a component would have broken dozens of tests that
have no opinion about where it lives. That is failure mode 9 in the brief: pins
that add drag to removal and none to addition. `tests/teacher_sources.py` now
exposes `authoring_source()` / `console_source()` — the route plus its modules,
the shell plus its rooms — and every pin reads those. Counting pins keep their
meaning: moving code preserves a count, duplicating it does not.

One pin turned out to be lying. test_assessment_expansion asserted the console
"shows assessment status chips" by matching `AssessmentStatusChip` in
TeacherConsole.tsx — where the name appeared ONLY in an import list and rendered
nothing. Removing the dead import as part of the split failed the pin, which is
the pin working as designed one release too late. It now asserts `<AssessmentStatusChip`
in AssessmentGrading.tsx, where the chip actually renders.

A ceiling, written down (tests/test_r78_module_split.py). No teacher module may
exceed 1,100 lines; the two entry points carry a stated allowance (1,800 and
1,100) recorded as DEBT, since steps 3-7 of the brief replace them. The console
reached 16k lines because nothing ever said stop; now something does.

## R79 — step 3 of the rebuild brief: the Lesson screen, built new (2026-08-29)

Step 0 first, because the brief blocks UI work behind it: `docs/LEXICON.md` is
the word list Law 3 demands — Course, Unit, Lesson, Step, Work, Material,
Evidence, each with what it does NOT mean, plus the retired words (Content as a
noun, Resource in the UI, Linked content, Classwork, Seeding, Reference
material). It is enforceable: R79's pins check this screen's copy against it.

Then the screen. A lesson is what a teacher lives in daily, so it stops being a
pane inside the outline and becomes its own address —
`/teacher/class/$classId/lesson/$lessonId` — with four sections and nothing else:

- HEADER — title, objective, where it came from (Book A1 · pp. 31–45), whether
  students can see it, and the one Save on the screen. It sticks, so Save is
  reachable from the bottom of a long steps list.
- STEPS — the ordered list, dragged and edited in place. Eighty per cent of the
  page, by design.
- WORK — every assignment and quiz on this lesson, each row saying the three
  things job 3 is about: who it is for, when it is due, what is owed. Both Add
  buttons live here, on the lesson, so the dialog never asks which lesson.
- MATERIAL — ranked closest-first: on a step, on the lesson, then from the book
  (collapsed, and loaded only when opened).

Everything rarer moved into the header's menu: settings, preview as a student,
ideas & vocabulary, draft steps from a written brief, move, archive, delete.

THE EMPTY STATE DOES THE WORK (brief mechanism B, brought forward from step 8
because a section cannot be built without deciding what its empty state says).
An empty lesson does not show "No steps yet" beside a Draft button. It says
"Nothing here yet — Jargon can draft the steps from [the book pages this lesson
follows]" and offers them in one press, with no brief to write. The proposal is
shown before anything is written: keep them, or discard. The always-on "Draft
steps with AI" panel is gone; the written-brief version lives in the menu.

THE ASSIST IS NOT CHROME. R76 put a Draft button beside every field and the
owner was right that it was instruction-following, not design. It now appears
for a field that is EMPTY (nothing to lose, everything to offer) or one the
teacher is actively writing in, and is invisible otherwise.

DELETED, not deprecated (Law 6): the old lesson editor (LessonDetail, 992
lines), the pane that hosted it (DetailPane), the R74 inventory bar and its
module, and the studio's selection state — the outline is now the only surface
in the Content room. An old `?lesson=` link forwards to the lesson's screen.

A LIVE DEFECT FOUND ON THE WAY OUT: R74 rendered `<LessonClasswork>` TWICE on
every lesson — the same section, duplicated, shipped 2026-08-27 and live since.
The rebuild removes it by construction. It is named here because it is exactly
what failure mode 8 predicts: three releases of green tests over a page nobody
opened.

WALKED, NOT ONLY TESTED. The brief's acceptance rule is that static pins cannot
measure whether a screen makes sense, which is why everything shipped green and
confusing. This one was driven in a real browser against the offline fixture
backend before shipping, and the walk found three defects the 1,215 pins did
not: the header repeated the back link, content ghosted through the gap under
the sticky band, and the two assist buttons read as standing AI chrome. All
three are fixed above.

## R80 — step 4 of the rebuild brief: the Course screen, built new (2026-08-29)

Jobs 1 and 2: get the book in, check what was written. The brief's step 4 is
"outline only, one Add per level, review banner" — and it retires the books
panel, the builder panels and the drawer.

THE OUTLINE IS THE SCREEN. Units → lessons, and nothing standing beside them.
Every lesson row says what it is in the words a teacher would use — "6 steps",
"draft · empty", "pp. 31–45" — and both levels drag to reorder. One Add per
level, naming its target: "Add a unit" on the course, "Add a lesson" on the
unit. The outline no longer carries material rows: material belongs to the
lesson that shows it, which is where R79 put it.

A REVIEW BANNER, in the consequence rather than a count: "1 lesson is waiting
for your review — students cannot see it yet." It opens the R70 gate across
EVERY unit that has drafts, not just the one a build happened to finish in,
which is what made the gate reachable only right after a build before.

NO PANELS. Building a course from a book, drafting a lesson inside a unit,
reviewing, and choosing which courses the class teaches all open over the
outline and close again. A build in flight still reports itself lesson by
lesson, because that IS the work in progress.

THE EMPTY STATES CARRY THE PRODUCT CLAIM. A class with no course says so and
offers the book: "Build the course from a book" or "add a unit yourself". A unit
with no lessons offers "Draft one from your material" or "add an empty one".
That is the R57/R56 build path — the same code, no longer a panel sitting open.

DELETED (Law 6): CurriculumStudio (1,538 lines) and with it the studio route,
which is now a 72-line redirect; the books panel; the old ClassworkList/
OutlineRow outline; the R60 selection state. R79 had already left the studio's
lesson-editing half dead — ~350 lines of it — and this release removes that too.

TWO REGRESSIONS THE OLD PINS CAUGHT WHILE THIS WAS BUILT, both real and both
fixed rather than pinned away:
- THE LINK BASELINE (R43). My first draft of ensureBackingCourse saved the
  class's course links from `classLinks || []` — so if the link read had failed,
  creating a course would have silently dropped every other course the class
  teaches. Restored to the original guard: link only from a known baseline.
- STEP-LINKED WORK (R48). R79's lesson screen dropped the step id on the way
  into the create dialog, so a quiz made on step 4 came back attached to the
  lesson but not the step. The context now rides through.

Both screens now share one payload and one write discipline
(authoring/useAuthoringData.ts): one React Query entry, optimistic for edits we
can reconstruct locally, refetch for the ones we cannot. Walking from the
outline into a lesson and back is 2.1s / 1.5s in the fixture environment.

WALKED, and it found four things the 1,233 pins did not: the course menu floated
in dead space above the outline; row state SHOUTED in uppercase; lesson rows gave
no sign they could be dragged; and the review panel still said "in this chapter"
while also drawing its own title and Close inside a dialog that already had both.

ONE HONEST NUMBER: the Content room takes ~15s to first paint against the
offline fixture backend (62 requests, none slower than 110ms). That is NOT a
regression — the old studio measured 14.4s on the same fixtures — but it says
the authoring payload is over-fetched. Worth its own release.

[CORRECTED BY R82. The over-fetch reading was wrong, and the evidence for it was
never there: "62 requests, none slower than 110ms" is a description of requests
that are all FAST. The paragraph blamed the one part of the system it had just
measured and found innocent. The 15s was a render-blocking Google Fonts <link>
in index.html; the browser was idle, waiting on a host it could not reach. See
the R82 entry.]

## R81 — step 5 of the rebuild brief: Today, and the class landing (2026-08-29)

Jobs 4 and 5: see who's learning, act on what needs me. The brief's step 5 is
"Build Today. Digest + needs-me. Becomes the landing", and it retires the
hotlist duplication.

TODAY IS THREE THINGS, IN ORDER. The weekly digest — what the class actually
learned this week (R71, unchanged) — then who is in a lesson right now, then
what is waiting to be marked. Nothing else. A teacher who opens Jargon and does
nothing else still learns something, which is the whole point of a landing.

TODAY CREATES NOTHING. Work is set on the lesson it belongs to (Law 2); this
screen only reports and opens. A live row opens the student, its Watch opens
their session; a waiting row opens the grading view, which still takes the room
whatever the URL's ?tab says.

THE ROOM IT REPLACED. R60's Activity held the same two live surfaces one tab
away, plus a class-level list of every quiz and assignment and a class-level
Create. The surfaces lead the landing now. The list belonged to each lesson from
R79 and is gone from class scope rather than kept in two places. The Create is
gone too: it asked "which lesson?" after the fact, which is exactly the generic
+ Create the brief kills. So Activity is deleted, not kept beside Today — the
spine is Today / Students / Content, and step 6 turns Students into People and
Settings.

THE HOTLIST IS DELETED. HotlistFeed.tsx was 280 lines that nothing had rendered
since R46 and that duplicated the review queue. Only the NumberFlip odometer
survived, into the console's own chrome. That is the step's named deletion, and
it had been dead in the tree for eight releases.

A DEFECT FIXED ON THE WAY, FOUND BY WALKING: "in a lesson now" listed a student
who was in ANOTHER class's lesson. A student can be in two of a teacher's
classes, so class membership alone is not enough — the row must also be a lesson
this class teaches. This is R71's cross-class counting bug in a second place; it
was live in the Activity room and would have been worse on the landing. Scoped
through the class's course links, with R43's discipline kept: an unreadable link
set falls back to unscoped rather than hiding a live student from the teacher
who could help them.

## R82 — the app starts fast (2026-08-30)

THE DIAGNOSIS I SHIPPED TWICE WAS WRONG. R80 and R81 both recorded that the
class needs ~13-15s to first paint because "the authoring payload is
over-fetched". It is not, and I should have caught it from my own numbers: the
same sentence noted that all 62 requests were fast. Fetching was never the
suspect.

WHAT IT ACTUALLY WAS. A CPU profile of the load says the renderer's main thread
is IDLE for 13.6 seconds — total JavaScript work across the whole load is about
200ms. Every script finishes downloading 45ms in. Then nothing happens until
domInteractive at 12,526ms. The browser was not computing and was not fetching;
it was BLOCKED, and index.html said on what:

    <link href="https://fonts.googleapis.com/css2?family=Manrope..." rel="stylesheet" />

A render-blocking stylesheet from a third-party origin. The container has no
route to fonts.googleapis.com, so the browser held the first paint until the
request timed out. Blocking that one request in the harness and changing nothing
else: first contentful paint 12,536ms -> 116ms.

THIS WAS NOT ONLY A HARNESS ARTIFACT, WHICH IS THE POINT. On a network that can
reach Google the link resolves quickly and the page looks fine — which is why it
survived 80 releases. But the failure mode it encodes is real and it is aimed
squarely at our users: a school or ministry network that blocks or throttles
Google shows a BLANK WHITE PAGE for the length of a DNS timeout, and no amount
of backend speed changes that. First paint must not depend on a host we do not
run. Manrope and Geist Mono are now dependencies, served from our own origin,
with font-display:swap so text paints in the fallback face immediately.

THE MEASUREMENT THAT CAUGHT MY OWN REGRESSION. Self-hosting made the
render-blocking stylesheet BIGGER: Vite inlines any asset under 4kB, which swept
eleven small font subsets into index.css as base64 — +67kB raw, +43kB gzip that
every visitor downloads before first paint, for Cyrillic and Greek glyphs almost
none of them will ever render. Fonts are now excluded from inlining, and the
blocking stylesheet came out 26.4kB gzip — 3.3kB LIGHTER than before this
release, because the KaTeX faces were being inlined the same way.

THE SECOND HALF IS REAL EVEN THOUGH IT WAS NOT THE BUG. The entry chunk held
three.js, the student app, the teacher console, the lesson editor and the admin
window — 2,563kB, 716kB gzip, downloaded by every visitor before anything
rendered, most of it for a screen they were not opening. Splitting it did not
move the harness number (the browser was idle, not busy) and I have not claimed
otherwise. It moves the number that matters on a school connection: the entry
payload is 352kB / 114.7kB gzip, a 6.3x cut, with the ambient canvas, both
consoles, the lesson editor and the admin window loaded on demand.

WALKED, and it found one thing the 1,246 pins did not: the Lesson screen's
account row was blank, because R79 shipped `email=""` hardcoded into its shell
call. The session was already loaded two hooks away; it is threaded through now.

THE PIN LESSON, AGAIN. Moving the admin screen out of its route broke 37 pins
that had no opinion about where it lives — the same failure mode R78 fixed for
the teacher console. tests/admin_sources.py now reads the admin SURFACE, not the
file. A publish-order pin also broke on a reformat because it pinned the column
its two statements sat in; it asserts the order now.

## R83 — step 6 of the rebuild brief: People, and the class's Settings (2026-08-30)

THE BRIEF'S WORDS, WHICH ARE ALSO THE TEST. "Class · People: who's in the class,
in what section, how each is doing. Add from the school directory · remove from
this class. Never account creation." And "Class · Settings: which courses this
class teaches (today's mis-named 'Linked content'). Class name, sections,
archive." The step retires "the Students room as-is", which is what Law 6 asks of
every release that adds a screen.

NO BACKEND. Every write step 6 needs was already permitted, and I checked before
designing rather than after: class_memberships has 'removed' in its own check
constraint and a "Class teachers can manage class memberships" FOR ALL policy;
classes has 'archived' and a class-teacher update policy. So removing a student,
renaming a section, renaming a class and archiving one are four direct table
writes under RLS — no edge function, no deploy, and no admin token in a teacher's
hands. A pin asserts these screens never reach for admin-ops, because the moment
one does, a teacher needs an admin to run their own class.

REMOVAL IS A STATUS, NOT A DELETE. The membership is marked 'removed'; the
account, the evidence and the person's other classes are untouched, and the
confirm says so by name before it happens. Archiving a class is the same shape.
Nothing on either screen destroys a row — the one place accounts are created or
destroyed is the school directory in admin, and People says that out loud where
a teacher might otherwise assume the "Add" button makes one.

SETTINGS IS A SCREEN, NOT A PILL. The brief lists four class screens; it does not
say all four get equal chrome. A teacher renames a class about once a term, so a
fourth pill would sit beside the three daily rooms all year claiming to be their
peer — Law 4, nothing always-on that isn't always needed. It gets the gear beside
the class name: one click, no daily noise. This is the only section the console
renders that is not a CLASS_SECTIONS value, and the pins say so deliberately
rather than leaving it looking like an oversight.

THE COURSE-LINK PANEL FINALLY HAS ONE HOME. "Courses in this class" is the only
control in the product that changes what a student can SEE, and it has been a
drawer under the curriculum (R45), then an overflow-menu dialog on the Course
screen (R80, with a note in its own copy saying it moves to settings when that
screen is built). It is now the first card in Settings, and the file moved with
it. R80's promise, kept.

CONTENT BECAME COURSE. The lexicon retired "Content" as a noun in step 0 and the
brief's screen list has always called it "Class · Course"; the pill went on
saying Content for three releases after that. Renamed, with every legacy ?tab=
value still resolving through normalizeClassSection so bookmarks and notification
links keep landing.

DEAD COMPUTE, FOUND WHILE READING. reviewRows, liveStudents and workItems were
still being derived on every render of every class — workItems doing a full pass
over every submission and every attempt to build maps — with nothing having read
them since R81 deleted the Activity room. Deleted. ClassDetail went 835 → 470
lines and is now a router and a grading face rather than a screen.

WALKED, and it found three things the 1,256 pins did not: the gear was lucide's
Settings2, which is a sliders icon and reads as "filters"; the course panel's
blurb still said "the outline above shows the same set" from when it lived under
the outline; and removing a section — one click that relabels every student in it
— asked for no confirmation while removing a single student asked by name. All
three fixed. The three new writes were then exercised for real against the
fixture backend rather than assumed: PATCH /classes 200 with the new name in the
sidebar, PATCH /class_memberships 200 with the roster going 4 → 3, and a section
rename moving both of its students at once.

## R84 — step 7 of the rebuild brief: the admin window (2026-08-30)

THE CHECKLIST WAS ALREADY THERE. The brief asks for "an ordered, stateful
checklist driven by list_pilot_readiness, which already returns
teacher/student/published-lesson counts per class and is barely used." It
understates the case: admin-ops has been emitting a six-item ReadinessChecklistItem
array per class since R51 — Active teacher · Active students · Published lessons ·
Work/resources prepared · Recent completion · No open alerts — plus a per-class
`issues` list, and the frontend rendered NEITHER. R51's Overview showed the status
CHIP and threw the reasons away, so an admin could read "Needs setup" and still
not know what to do about it. Setup renders the checklist, worst class first, and
every missing item names the screen that fixes it.

SIX TABS BECAME FOUR. Overview and Seeding dissolved into Setup; Live and Cost &
runtime became Health, because "is anything wrong right now?" was one question
split across two tabs. Cost also stopped being a platform-admin-only TAB: the
window's SHAPE no longer depends on who you are. admin-ops already withholds
dollar totals from org admins server-side, so Health renders what it is given —
a section with fewer numbers is easier to explain than a tab that exists for some
people and not others.

ONE DOOR EACH, WHICH WAS THE BRIEF'S ACTUAL COMPLAINT. "A class can be created in
two of them. Students arrive through three different doors that do subtly
different things (one creates accounts, two only link existing ones)." Classes is
now the only caller of adminCreateClass and the roster importer is the only caller
of invokeAdminSeed — both pinned by COUNT, so a second door fails the suite rather
than shipping. The importer also changed on the way: it targets a class that
already EXISTS, chosen from a list, instead of asking for an organization name and
a class name. Typing a name that did not match silently created a second class,
which is how a pilot ended up with the same class twice.

SEEDING DIED, AND ITS THREE JOBS WENT HOME. Class creation was a duplicate and is
simply gone. Roster import stands in People, which is what makes "the only place
accounts are created" true rather than aspirational. Demo logins are fenced three
ways — platform admins only, folded shut, and labelled as a demo tool that creates
real accounts on a shared password. It stays because demoing the product is a real
job; it is not a tab because running a school is not that job.

WHAT I REFUSED TO DELETE. Overview held two things the brief's one-line summary of
Health does not enumerate: a "never signed in" count and the admin audit trail.
Dropping them because a summary did not list them would be scope-narrowing by
accident. Never-signed-in is a setup signal (accounts exist, nobody has used them)
and now sits in Setup's header; the audit trail is read-only observation and sits
in Health. Both kept their adminData derivations, so R51's pins re-pointed instead
of dying.

AdminPage went 1,534 → 497 lines, and every module in features/admin is now under
460. tsc --noUnusedLocals reports nothing left behind.

WALKED, and it found three things the 1,271 pins did not — two of them stale copy
that had been lying to admins since the tabs changed under it. The page header
still said "seed pilot rosters, watch live sessions, and track AI/runtime cost",
and the organization picker still said "manage its people, classes, seeding, live
sessions, and cost": both described the six-tab window, so they named jobs an admin
could no longer find. The third was older and real: People's search field put the
magnifier glyph on top of the placeholder's first letter, because jargon-input's
own padding (12.8px) beat the pl-9 utility against a 28px icon. Measured, not
guessed, and fixed with !pl-9.

A GUARD THE WALK ALSO EARNED: a class whose checklist comes back empty — an older
admin-ops, or a class the checker could not read — used to render "0/0" above an
empty bordered strip. It says what happened and offers Recheck.

## R85 — step 8: the assistant stops being a button (2026-08-30)

THE FAILURE MODE BEING FIXED IS MINE, AND THE BRIEF NAMES IT. "'AI assist at every
building point' became a literal button at every building point. The ask was for
capability; I delivered chrome. When an instruction implies a quality ('subtle',
'helpful', 'clear'), rendering it as a widget is almost always wrong." So this
release is measured by what it REMOVED, and the four mechanisms are what is left
once the widgets are gone.

A AND B ARE THE SAME MECHANISM AT TWO GRAINS: things arrive already drafted. An
empty steps list drafts on arrival and shows four proposed steps; an empty
objective on a lesson that has a title or a book arrives proposed under the field,
in italics, saying where it came from. R79 got most of the way here and left a
press on it — "Draft the steps" — which is still a button asking whether you want
help. The brief's wording has no press in it.

THE GUARDS MATTER MORE THAN THE FEATURE. An assistant that drafts on arrival can
become a nag and a bill, so: it asks once per lesson (a ref, not a state flag,
because state re-renders); a dismissal is remembered and it does not re-offer; and
it refuses to draft when there is nothing to draft FROM — no title, no objective,
no book pages — because proposing from thin air is how an assistant produces
confident nonsense. Walking a filled lesson issues one generation call, for the
one empty field, and none for anything already written.

D IS THE ONLY VISIBLE AI CONTROL LEFT, and the brief says exactly why: "the
selection already declared the target". Select three or more characters in a title
or objective and shorter · simpler · more concrete appear. It replaces the
selection and nothing else, and one Undo returns the whole field. The affordance
fires on mousedown rather than click, because clicking blurs the field and the
selection would be gone before the handler ran.

C IS WHAT MAKES THE DELETIONS HONEST. Removing twelve buttons removes capability
unless it lands somewhere, so ⌘K / "Ask Jargon" is the one place it lands. Commands
come FROM the screen, not from a switch inside the bar, so it scales without this
file learning about every screen in the product. Every command lands as a field
value or a proposal — the bar runs nothing that writes, which is the first
non-negotiable and the reason a command surface is safe to make this reachable.

ONE PROVIDER, which was the fifth non-negotiable and the one with product weight:
"Lesson quality is what a school judges." Authoring ran on OPENAI_API_KEY and
gpt-4o-mini while the mentor ran Opus 5. callModelJson is the single choke point
for every authoring generation in curriculum-admin, so the switch is one function:
prefer Anthropic, fall back to whichever key exists, AUTHORING_PROVIDER=openai pins
the old behaviour. A deployment holding only OPENAI_API_KEY is unchanged. The JSON
contract OpenAI enforced with response_format is carried by a system instruction
plus an assistant prefill, which is how Anthropic is asked for strict JSON.

DERIVED THINGS LOST THEIR BUTTON TOO (Law 5). The knowledge card's "Draft
knowledge" was a Draft button on content that is produced by authoring, not asked
for. An empty card now reads the lesson when it is opened; the control that remains
says "Read the lesson again" and only appears once there is something to re-read.
The per-row review gate is untouched, which is what makes reading-on-arrival safe.

WALKED, and it found two things the pins did not, both of them mine from this same
hour: the Ask Jargon bar is fixed bottom-right and was sitting on top of the last
card's controls, and one command promised "opens the step editor with a check ready
to write" while actually opening the brief dialog. The bar got the page a bottom
margin; the mislabelled command was deleted rather than shipped with a description
that was not true.

Buttons removed: DraftFieldButton (deleted, three call sites), "Draft the steps",
"Draft knowledge". Renamed away from the machinery: "Draft steps with AI" → "Draft
steps from a brief". Teacher-surface prettier errors went 41 → 0 on the way.
