# Decisions

Record durable project decisions here. Add new entries at the top.

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
