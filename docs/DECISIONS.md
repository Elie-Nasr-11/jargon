# Decisions

Record durable project decisions here. Add new entries at the top.

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
