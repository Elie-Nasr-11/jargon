# Roadmap

Status: current roadmap summary. See `docs/COMPLETE_ROADMAP.md` for the full detailed plan.

## Current State

(Refreshed 2026-07-05.) **v4.0 "The Platform" is shipped and live** — all six phases (P0-P5) plus a
four-tier polish/completion pass are on `main` (branch `claude/happy-johnson-wseex8` == `origin/main`,
zero divergence). See the "v4.0 — The Platform" section below for the phase-by-phase status and the
`docs/HANDOFF.md` Active Handoff entries for the per-slice detail. The rest of this Current State note
(below) predates v4.0 and is kept as the v2.x/v3.0-era baseline.

(Refreshed 2026-07-03.) Phase 0 is effectively complete. Phases 1 through 7, Voice v1+v2 (realtime), the
assessment expansion, checkpoint unification, and the Tutor v2.0 rebuild are live. The Canvas
(C1-C4) and Campus Live/OneRoster integrations are built alongside Google Classroom v1. Voice
raw-audio storage remains off by default.

- The tutor frontend is live at `https://jargon-9bv5.onrender.com/`.
- Supabase Auth, lessons, sessions, turns, attempts, quiz attempts, evidence, and mastery are live.
- The Render Jargon engine runs code through the Supabase `run` edge function (engine timeouts
  now carry an explicit `timeout` flag end-to-end).
- **Tutor v2.0 (2026-07-02, live):** the `chat` edge function was rebuilt — control lives in
  persisted per-step `learning_sessions.step_state` (presentation/code/quiz/understanding gates,
  reset on advance) instead of a stage machine; ONE composed `turnDirective()` priority ladder +
  a static SYSTEM_PROMPT replace the old teaching-move selector and ad-hoc directives; grading
  is deterministic-only (code match + capped semantic judge + dedicated understanding grader);
  conversation runs on gpt-4o with graders pinned to gpt-4o-mini; reads run in two parallel
  waves and writes as mentor-insert -> parallel record batch -> session patch, with telemetry
  off the critical path. First live traffic verified: mentor prompts ~2.4k tokens (was ~5.5k)
  with 1k cached/turn, turn p50 12.7s -> 6.6s, zero errors.
- **Checkpoint unification (2026-07-01, live):** assignments/assessments are mirrored into
  unified `checkpoints`/`checkpoint_recipients` tables by dual-write triggers; lesson completion
  is gated on required checkpoints (fail-closed) in both the runtime and the gradebook. The
  physical contract (dropping the legacy tables) is deliberately deferred.
- The teacher dashboard shows class progress, transcripts, attempts, quizzes, evidence, mastery, notes, resources, and assignments.
- Resource-backed lessons, assignment review, curriculum authoring, and browser voice support are live enough to support the next multi-subject slice.
- The first Phase 7 non-coding lesson path is live and accepted:
  `Logic Foundations -> Clear Thinking -> Claims, Reasons, Evidence -> What Makes a Good Reason?`.
- Teacher Analytics & Intervention Intelligence v1 is implemented repo-side: class metrics,
  mastery heatmaps, deterministic Needs Attention signals, student drilldowns, and lightweight
  runtime/model telemetry hooks.
- Live teacher watching/comments is implemented and data/realtime-smoked.
- Admin Operations v1 and org-admin scoped operations are implemented repo-side: `/admin` can
  inspect scoped org/class/user data, create/update/archive classes, add existing users to
  classes, reset temporary passwords, change class roles/statuses, and inspect recent seed/audit
  events through privileged `admin-ops`.
- School-readiness / Pilot Ops v1 is implemented repo-side: `/admin` now has Pilot Readiness,
  scoped class snapshot CSV export, roster/account health, support/error panels, and copyable
  password-free login instructions; `/teacher` has a compact class readiness strip.
- Cost/Model Dashboard v1 is implemented repo-side: `/admin` now has AI/runtime operations metrics,
  model/task/class breakdowns, platform-admin estimated cost visibility, and org-admin scoped
  usage/reliability without dollar totals.
- Google Classroom roster import v1 is implemented repo-side as the first Phase 12
  integration spike: OAuth connection, read-only course list, roster preview, email-based
  mapping to existing Jargon users, class import, and sync-run logging.
- Assessment Expansion v1 is implemented repo-side: teacher-assigned multi-question lesson
  quizzes now have grouped assessment tables, `/quiz/$assessmentId`, MCQ auto-grading,
  text/code teacher review, rubric-backed evidence/mastery writes, and teacher/student
  visibility while preserving existing in-chat checkpoint quizzes.
- Assessment expansion is deployed live (`assessment-admin` + migration applied 2026-07-01);
  the checkpoint unification was built on top of it.
- Known debt: the Python test suite under `tests/` has ~65 stale static-fingerprint failures
  accumulated across the teacher-console and tutor rebuilds (the chat/run function tests are
  current; the teacher-UI/routing ones assert superseded code). Needs a dedicated refresh pass.

## Product Direction Locked

- Jargon is a private-tutor-feeling chat-first LMS for grades 3/4-12 first, extensible to other audiences later.
- The platform should teach any structured subject, not only coding.
- Student navigation should support Subject -> Chapter -> Lesson.
- Teacher-approved curriculum, resources, and rubrics are the source of truth.
- Skill mastery is the primary adaptation signal.
- Voice interaction is a first-class path: dictation, Mentor read-aloud, and future audio session mode.
- The database groundwork must include tenants, pages/surfaces, roles, access, file/media types, environment modes, audit, and cost tracking from V1.
- The demo bar is a complete classroom-ready platform slice, not another proof of concept.

## Phase 1: Stabilize The Live Vertical Slice

Goal: make the current student lesson path boringly reliable.

- Harden the Mentor orchestrator around current lesson flow.
- Add runtime observability for edge-function errors, completions, failed run/chat calls, model latency, and model cost.
- Add a repeatable internal QA checklist for signed-in lesson completion.
- Keep `/chat` as the student surface.
- Make lesson completion clear, then continue in review mode for deeper understanding and quiz prep.
- Prepare the composer for dictation and Mentor read-aloud without changing the baseline typed flow.

Exit criteria: a signed-in student completes `lesson1` three times in a row, and each completion writes session, turns, attempts, quiz attempt, evidence, and mastery records.

## Phase 2: Teacher Dashboard v1

Goal: prove Jargon is an LMS, not just a tutor.

- Add `/teacher`.
- Show classes, rosters, active lessons, recent activity, and intervention flags.
- Show per-student transcript, attempts, quizzes, evidence, mastery, and teacher notes.
- Let teachers add notes, assign a Jargon Foundations lesson, review Mentor recommendations, and override grades with reasons.
- Prioritize gradebook, intervention alerts, and transcript heatmap.
- Support live teacher watching with a viewer icon and teacher comments/tips in chat.
- Let teachers configure voice permissions per class/activity.

Exit criteria: a teacher inspects one student's completed `lesson1` session, sees transcript + score + evidence, and leaves a note.

## Phase 3: Lesson Resources And Chat Media

Goal: teachers attach learning media to lessons, and Mentor surfaces it inside chat.

- Add first-class lesson resources for video, audio, PDF, flipbook, YouTube, image, link, and document resources.
- Store uploaded media in a private Supabase Storage bucket named `lesson-resources`.
- Keep default visibility `class_private`.
- Resources are private by default and publishable by toggle.
- Resources can attach at any level: subject, chapter/unit, lesson, milestone, activity, quiz, or assignment.
- Use signed URLs for uploaded resources.
- Render media as chat resource cards with open buttons; PDFs open in a popup/viewer or download/open action.
- V1 uses teacher-authored descriptions/instructions/transcripts; automatic extraction comes later.

Exit criteria: a teacher uploads a PDF or video to `lesson1`, publishes it, and Mentor can show it in student chat.

## Phase 4: Resource-Aware Mentor Orchestrator

Goal: media becomes part of the lesson flow.

- Add optional `resources?: LessonChatResource[]` to the typed chat envelope.
- Load resources attached to the current lesson/milestone/activity.
- Surface one resource at a time before explanation, during practice, before quiz, as rescue support, or as review.
- Record resource interactions such as shown, opened, played, paused, completed, and downloaded.
- Do not let Mentor claim resource completion unless interaction records exist.

Exit criteria: Mentor asks a student to open a teacher resource, the student interacts with it, and the system records the interaction.

## Cross-Cutting: Voice Interaction

Goal: students can dictate answers and hear Mentor replies while the same lesson runtime records transcripts, modality, evidence, and teacher visibility.

- Dictation: speech to editable transcript in the composer.
- Read-aloud: Mentor replies can be played, paused, replayed, and sped up/slowed down.
- Audio session mode: discussion lessons can run mainly by listening and speaking through a realtime voice bridge.
- Better audio: Mentor message playback uses server-generated audio with private caching instead of browser speech where available.
- Do not store raw student audio by default.
- Store input modality, transcript, optional confidence, timestamps, and audit events.

Exit criteria: a student dictates an answer, edits/submits it, hears Mentor read-aloud, and the teacher can see it was dictated.

## Phase 5: Assignments End-To-End

Goal: teachers and Mentor recommendations can create work students complete inside chat.

- Status: implemented and accepted for the pilot path.
- Add teacher assignment builder.
- Link assignments to lessons, milestones, resources, and rubrics.
- Show assignments inside student chat/progress.
- Support student text/code/file submissions, with most file submissions likely in lesson/LMS assignment windows.
- Let teachers grade, return, and override with audit records.

Exit criteria: teacher assigns a resource-backed assignment, student submits, teacher grades, and feedback/evidence update.

## Phase 6: Curriculum Authoring Studio

Goal: move from seeded lessons to teacher-authored structured curriculum.

- Add `/teacher/curriculum`.
- Author subjects, courses, versions, units, lessons, milestones, activities, quizzes, rubrics, and resources.
- Preview as student.
- Publish course versions while keeping teacher/admin edits possible through history and audit.
- Support discussion lessons.
- Keep document import secondary until structured authoring is solid.

Exit criteria: teacher creates a small non-coding lesson with a resource and quiz, assigns it to a class, and a student completes it through chat.

## Phase 7: Multi-Subject Chat-LMS

Goal: prove Jargon can teach beyond coding.

- Status: accepted live with the Logic Foundations lesson path.
- Add one non-coding curriculum: logic foundations, basic math reasoning, writing structure, or science process skills.
- First non-coding test can be computer science before coding is introduced.
- Use text, multiple choice, media resources, milestones, and evidence.
- No Jargon code dependency.

Exit criteria: student completes one non-coding lesson with media, quiz, evidence, and teacher-visible progress.

## Assessment Expansion: Lesson Quizzes

Goal: support larger teacher-assigned assessments without replacing in-chat mini quizzes.

- Status: v1 implemented repo-side; live migration/function deploy/smoke remains.
- Keep existing in-chat checkpoint quizzes on `quiz_attempts`.
- Add class/lesson-scoped assessments, assessment items, recipients, full-attempt records, and per-item answer/review records.
- Add `/quiz/$assessmentId` for student completion.
- Auto-grade MCQ items immediately.
- Route text/code items to teacher review.
- Let teachers create/publish/archive quizzes from `/teacher`, assign recipients, review subjective items, and return final results.
- Finalized assessments write rubric-backed `learning_evidence` and update `student_mastery`.

Exit criteria: teacher assigns a 2-MCQ + 1-text lesson quiz, student submits it, teacher reviews the text response, final score appears to student/teacher, and evidence/mastery update.

## Phase 8: Admin And Organization Management

Goal: support real schools/classes.

- Status: Admin Operations v1, org-admin scoped operations, Pilot Ops v1, CSV roster fallback,
  student archive/progress exports, retention request logging, and consent/feature controls are
  implemented repo-side; latest platform-completion migration/function deploy/smoke remains.
- Add `/admin`.
- Let org admins manage their own organization scope: classes, existing org users, class roles,
  class membership status, password resets, and org audit visibility.
- Let platform admins manage all tenants, global content, feature flags, and support/debug workflows.
- Keep authorization DB/RLS-enforced.
- Multiple organizations and org admins are V1 requirements.
- Add school-readiness controls before external integrations: class launch checklist, roster/account
  health, scoped progress exports, recent runtime errors, open interventions, and support/audit
  visibility.

Exit criteria: two organizations can exist side by side, and RLS prevents cross-org reads.

## Phase 9: Media Processing And AI Context Extraction

Goal: make uploaded resources deeply useful to Mentor.

- Status: Media Processing v2 implemented repo-side. Teachers can extract PDF text
  in-browser, transcribe uploaded audio/video server-side through OpenAI speech-to-text,
  store draft chunks through `resource-processing`, review/edit/approve/reject/delete
  chunks, and `chat` can load approved chunks as bounded Mentor context.
- Add PDF page thumbnails.
- Add YouTube transcript import where available and permitted.
- Store reviewed chunks for Mentor retrieval.
- Let teachers approve extracted text before Mentor relies on it.

Exit criteria: teacher uploads a PDF or small audio/video file, processing creates reviewed chunks, and Mentor references approved pages or time ranges during chat.

## Phase 10: Analytics, Mastery, And Adaptation

Goal: personalization becomes explainable.

- Status: v1 implemented repo-side for teacher-demo analytics; live QA/deploy remains.
- Add dashboards for mastery, attempts, quiz trends, code-run success, resource engagement, common errors, rescue/retry frequency, assignments, and teacher interventions.
- Let Mentor adapt pace, hint level, rescue choice, resource recommendation, quiz timing, and assignment recommendation.

Exit criteria: teacher can answer why a student is weak on a skill and see linked evidence.

## Phase 11: Scale, Cost, And Model Routing

Goal: make the product economically viable.

- Status: Cost/Model Dashboard v1 is implemented. Pilot Reliability + Model Routing v1 adds
  env-configured Mentor model routes, Jargon engine wake/retry telemetry, media-processing usage
  telemetry, soft rate limits, and an admin runtime-health summary.
- Track token/cost per student, user, session, class, and organization.
- Run a cost-to-quality spike before locking model routing.
- Add rate limits, abuse limits, timeout handling, background jobs, and runner scaling.

Exit criteria: platform reports cost per active student/session and routes expensive work intentionally.

## Phase 12: Integrations And School Readiness

Goal: fit into real school workflows.

- Status: Google Classroom roster import v1 is implemented repo-side as the first integration
  spike. Diagnostics now report missing OAuth secrets; write-sync tables and guarded stubs exist
  for later coursework/grade passback, but assignment and grade export remain disabled until
  explicit Google write scopes are accepted.
- Status (2026-06-28): Canvas is implemented through C4 — OAuth connect + roster import (C1),
  account provisioning on import (C2), grade passback (C3), and scheduled sync via
  `canvas-sync.yml` + manual "Sync now" (C4). Campus Live has no public API, so it ships as the
  OneRoster/CSV roster-import fallback plus a per-org link-out. As of 2026-07-03 the `canvas`,
  `google-classroom`, `resource-processing`, and `run` functions (and the Canvas migration) are
  in the CI deploy workflow.
- Add Google/Microsoft SSO, Clever/ClassLink, CSV roster import, LTI 1.3, Canvas, grade passback, exports, retention/delete workflows, and parent/student reports.

Exit criteria: one school-style roster can be imported, classes created, and grades exported.

## Pre-UI-Cleanup Completion Sprint

Goal: build remaining platform breadth before a dedicated visual cleanup pass.

- Status: repo-side implementation in progress/completed for:
  - CSV roster import preview/apply for existing users;
  - data export, progress report, retention request, guardian/report foundation tables;
  - org/class/student consent and feature settings;
  - Google Classroom diagnostics and future write-back mapping tables;
  - Voice v2 diagnostics and env-configurable model names;
  - draft curriculum import suggestions from teacher-approved resource chunks.
- Live acceptance requires applying the new migration and deploying updated Edge Functions.

Exit criteria: admins can run the CSV/governance fallback flows live, external gates diagnose their
missing secrets clearly, and draft curriculum import produces teacher-reviewable suggestions without
publishing anything automatically.

## v4.0 — The Platform (2026-07-05, SHIPPED & live on main)

The arc specced in `docs/PLATFORM.md` (canonical): lessons composed from eight conversational modes
with a null-mode legacy fallback (P1), the teacher build system — derived hotlist, org-shared lesson
templates, live-now strip, unified work overview (P2), student class scoping + the LMS shell — profile
popup with real stats, class dashboards, unit views (P3), revision mode + per-mode proficiency
surfaces (P4), and the platform layer — persisted notifications, student calendar, admin live
monitoring, teacher reports/export (P5).

Status (2026-07-05): **all of P0-P5 are shipped, deployed, and live on `main`**, followed by a
four-tier polish/completion pass:
- **T1** — live-surface auto-refresh (teacher dashboard + admin Live tab poll every 30s), an
  assignment-grade-integrity guard (BEFORE UPDATE triggers pin student-set score/feedback), and a
  repaired test safety net (Python suite green + a new `tests.yml` CI job running it on push/PR).
- **T2** — notification-bell coherence (live title matches the backfill; the notification deep-links
  to the class Assessments review tab).
- **T3** — the promised-but-partial surfaces: teacher "list past reports", the student class
  dashboard's recent/upcoming-work strip + grades summary, and the unit view's assessment reviews.
- **T4** — a cosmetic/correctness batch (shared EmptyState on two surfaces, quiz `<Link>` + unmasked
  submit error in the docks, download toasts, a11y labels, dead-code + a NUL-byte fix).

Deferred WITH CAUSE (not completion gaps — see `docs/PLATFORM.md` §9 + `docs/OPEN_QUESTIONS.md`): the
review-due chip (content-blocked — no published revision lesson), platform-generated ad-hoc revision
sessions (`learning_sessions.lesson_id` NOT-NULL relaxation, highest live-tutor risk), and the full
HotlistFeed-on-`notifications` merge (5 of 7 hotlist kinds still lack server-side writers).

## Post-v4.0 — the remaining arc (2026-07-05, planned)

Everything after v4.0 is either buildable-with-a-blocker or deliberate out-of-scope. Sequenced by
value then risk. Grounded by two exploration passes (notifications/hotlist surface; file-submissions +
live-intervention plumbing). Recommended order P1 → P5; C and D are strategic side-decisions.

**KEY FINDING:** the missing notification writers are all best done as `SECURITY DEFINER` DB TRIGGERS —
every producer that lacks a writer (client-side `submitAssignment`; the student-JWT chat runtime with
no service-role key) cannot itself insert a `notifications` row, but a trigger can. So the "multi-fn
backend slice" is really one migration of triggers: additive, best-effort, off the live-tutor path.

- **Phase 1 — Notifications become a real feed (A + E). HIGH value / LOW risk / no blocking decision.**
  - 1a (migration + 1 edge-fn hook): SECURITY DEFINER triggers fanning out to a class's active teachers:
    `submission_to_grade` (AFTER INSERT on `assignment_submissions` status=submitted), `mentor_recommendation`
    (on `mentor_recommendations` insert — row-writer already exists in chat, only the notification is
    missing), `alert_open` (on `learning_sessions` status→`needs_rescue`, ALSO writing the currently-dead
    `intervention_alerts` row). Plus a partial-unique dedup index (`(user_id, kind, ref->>… ) where
    read_at is null`) + upsert, and an auto-clear hook in assessment-admin `returnAssessment` (mark the
    matching `assessment_to_review` read when the teacher finishes). All best-effort: a failed notify must
    not break the submission/turn.
  - 1b (frontend): `HotlistFeed` becomes a MERGE of persisted notification rows (the 4 event kinds) + the
    3 genuinely-derived kinds kept client-side (`live_now`, `due_soon`, `session_risk` — ephemeral/
    projected, not events). The bell then carries all event kinds, not just assessments.
- **Phase 2 — Submission safety (B1). MED value / LOW-MED risk / 1 decision (scanning).** Files already
  work (real `student-submissions` bucket, 50 MB, no MIME limit, no scan, no retention; INSERT RLS only
  checks owner, not the path's assignment/user binding). 2a: client `accept`+size guard, bucket MIME
  allowlist + app-layer size check, path-bound INSERT RLS, drop the dead `assignment_submissions.file_path`
  column. 2b: malware scanning (none today) + a retention policy (no DELETE path today).
- **Phase 3 — Live-intervention completion (B2). MED value / MED runtime risk / 2 decisions.** Watch +
  student-visible comments already work. 3a: a teacher HOLD flag on `learning_sessions`/`step_state` that
  the chat turn loop checks before answering (+ API + teacher UI) — the one piece touching the live tutor
  runtime. 3b: decide whether an intervention also writes `learning_evidence`/`teacher_notes`/audit
  (anchor to `teacher_live_comments.turn_id`, which exists but is never set).
- **Phase 4 — Revision & spacing (the review-due chip). MED value / LOW risk / content+design decision.**
  Author a published revision lesson to route into + design a spaced-repetition due-queue over
  `student_mastery.last_practiced_at` (+ tier). Then the "Review due · N" chip lights up.
- **Phase 5 — Ad-hoc revision sessions. MED value / HIGH runtime risk / explicit go-ahead only.** Relax
  `learning_sessions.lesson_id` from NOT NULL so the platform can generate lesson-less revision sessions;
  runtime-wide, gated + heavily reviewed.

Strategic side-decisions (not sequenced): **C** = PLATFORM §9 arcs (visual redesign · mini-chat ·
per-material comments · real-time push · `lessons` RLS-as-boundary · builder merge · LLM inquiry tagging ·
dropping `activity_type`/legacy · student-editable system prompt). **D** = reviving the reverted v3.0
"Learning Engine" (pedagogy spec · learning blocks · spacing engine · mastery-v2 skill map) — overlaps
Phase 4's spacing work, so fold any revival there rather than resurrect wholesale.
