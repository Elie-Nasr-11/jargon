# Open Questions

Add new questions at the top. Close resolved questions by moving them to `docs/DECISIONS.md` if they become durable choices.

## v4.0 "The Platform" — the live unknowns after the completion pass (2026-07-05)

v4.0 is shipped and live (see `docs/ROADMAP.md`), but four items were deferred WITH CAUSE and remain
genuinely open. Recording them here per CLAUDE.md (ambiguities live in OPEN_QUESTIONS, not just HANDOFF
prose):

- **When (if ever) do we tighten `lessons` RLS into a class-scoping boundary?** Today class scoping is a
  fail-open UX filter (`class_courses` → `fetchStudentCatalog`; an unlinked class ⇒ full catalog), NOT a
  security boundary — decided deliberately because tightening `lessons` read-RLS risks cutting off the
  live student mid-lesson. Open: the trigger/criteria for making it a boundary, and the migration path
  that can't strand an in-progress student.
- **Should the platform generate ad-hoc revision sessions?** Revision MODE is live, but
  platform-GENERATED ad-hoc revision sessions need `learning_sessions.lesson_id` relaxed from NOT NULL —
  a runtime-wide change and the highest risk to the live tutor. Open: whether to do it, and how to gate
  it so a null-lesson session can't break the turn loop / gate / mastery writes.
- **The spaced-repetition due-queue behind the "review-due" chip** — SHIPPED, loop closes (post-v4.0 P4 + P4b).
  The SM-2-lite due-queue is live: `computeReviewDue` derives due skills client-side from
  `student_mastery.last_practiced_at` vs a per-tier interval (emerging 1d < developing 3d < secure 7d),
  surfaced by a self-contained `ReviewDueChip` in the chat header + a "Due for review" section in the
  profile popup + a one-tap GUIDED review (P4b). The guided review is a dedicated, ISOLATED chat-fn path
  (`handleReviewRequest`, fires only on `body.review === true`, so the normal turn loop is untouched):
  it maps the skill to a lesson it was taught in for a real objective, runs retrieval practice, grades
  the recall with the understanding grader, and — closing the loop — stamps `mode='revision'` evidence +
  refreshes `last_practiced_at` (via `writeEvidenceAndMastery`, which now accepts a null lesson/session).
  A reviewed skill therefore leaves the due queue; a miss lowers the tier → shorter interval → resurfaces
  sooner (emergent SM-2 lapse). Guarded: skill must be in the student's own mastery (no model call for an
  arbitrary skill) + a per-user model_usage rate limit. Residual (accepted for v1): the rate limit is a
  sequential guard (recorded usage is async), so a parallel burst can slip a few calls before it engages.
  STILL OPEN (P5): making an ad-hoc review a FIRST-CLASS `learning_sessions` row (needs the
  `learning_sessions.lesson_id` NOT-NULL relaxation) so reviews are resumable + teacher-visible; today the
  review turn is stateless (evidence-only, no session row).
- **How do we complete the HotlistFeed → `notifications` MERGE?** The table + teacher bell shipped as an
  additive surface (`assessment_to_review` is the only live writer). The full merge needs a server-side
  `submission_to_grade` writer (submission is client-side today), an `intervention_alerts` insert writer
  (that kind has no insert site anywhere), recipient fan-out, and a MERGE (not swap) in `HotlistFeed`.
  Open: build the missing writers, then merge — see `docs/PLATFORM.md` §5 as-built note.

One pre-v4.0 question below remains load-bearing: "how student file submissions work" (assignment mode
leans on it; file answer steps were left legacy in the P1 backfill; Phase 2a/2b hardened the storage +
scan/retention posture). The "exact live teacher intervention UX" question is now largely answered —
post-v4.0 Phase 3 shipped teacher Pause/Resume (a fail-open server hold) and interventions-as-record
(a learning_evidence teacher_note per tip/hold); see its section below for the small remaining bits.

## How should backend speech services work after the browser demo slice?

Current decision so far:

- Voice interaction is first-class: dictation, Mentor read-aloud, and future audio session mode.
- Browser speech recognition/synthesis can power the first demo slice if it degrades gracefully.
- Raw student audio is not stored by default.
- The grading/evidence artifact is the transcript plus modality metadata.

Deferred details:

- Which speech-to-text/text-to-speech provider and model should be used for reliable cross-browser support.
- Whether any org/class can opt into raw audio storage, and under what retention/consent policy.
- How to handle accents, multiple languages, noisy classrooms, and headphone/classroom modes.
- How to track speech cost per student/session/class/organization.
- Whether audio session mode should ever send raw audio to an LLM, or always transcribe first.

## What is the exact live teacher intervention UX?

Current decision so far:

- Live teacher watching is allowed.
- Students should see a viewer icon when a teacher is actively watching.
- Teachers may send live comments or tips into chat to steer a conversation.

As-built (2026-07-05, post-v4.0 Phase 3 — SHIPPED): teacher live tips appear as normal transcript
messages (a "teacher" bubble). Teachers CAN now pause the Mentor flow — a fail-open server hold
(`session_holds`) makes the chat fn return a benign "paused" turn instead of running the mentor, with
a student banner + locked composer; the teacher toggles Pause/Resume from the live-watch view. Live
interventions (tips + holds) now create a durable record: a `teacher_live_comments` row + a
`transcript_heatmap_events` marker (as before) PLUS a session-linked `learning_evidence` teacher_note
row so the intervention shows in the reviewable student record.

Still deferred:

- Whether a live tip should ALSO be offered as a side comment / pinned tip (today: transcript bubble only).
- A dedicated audit-event stream for interventions beyond the evidence/heatmap trail (probably unneeded).
- Auto-release of a stale hold (today a teacher must Resume; a hold left on simply keeps the student
  paused until released — considered acceptable since the fn is fail-open on read errors, not on an
  intentional active hold).

## How should student file submissions work?

Current decision so far:

- Student file submissions are required for the complete V1.
- Most assignment file submissions likely live in lesson/LMS assignment windows, not directly inside the chat composer.
- Teacher-uploaded lesson resources are a separate feature track.

As-built (2026-07-05, post-v4.0 Phase 2a + 2b — SHIPPED): submissions upload to a PRIVATE
`student-submissions` bucket (50 MB/file server ceiling), mirrored by `assignment_submission_files`
rows; reads are signed-URL only, gated by the DB row (owner or the assigning teacher). Phase 2a added
client + app-layer validation (≤10 files, ≤25 MB each, an `accept` hint) and a path-bound INSERT RLS
(the object's user path segment must equal auth.uid()). Phase 2b added a scan dimension + retention:
- Scanning: a dedicated `scan_status` column (pending/clean/quarantined/skipped, separate from the
  lifecycle `status`) + a `submission-maintenance` system-only edge fn (`scan` action) invoked daily
  by `.github/workflows/submission-maintenance.yml`. A provider is optional and plugged in via env
  (`SCAN_API_URL` [+ `SCAN_API_KEY`]); with NO provider, pending files are marked `skipped`
  (unscanned, still readable), so this ships provider-READY without a key. The storage SELECT policy
  now also blocks `quarantined` (and purged) files — a flagged file can't produce a signed URL.
- Retention: the same fn's `retention` action purges the object BYTES of files older than
  `SUBMISSION_RETENTION_DAYS` (default 365 = ~12 months) and stamps `purged_at` on the DB row (kept
  as a tombstone). Nothing is old enough to purge for ~a year (the table is empty today).
Deliberately NOT done: a hard bucket MIME allowlist (regression risk on a private, non-served bucket
for little gain) and dropping the dead `assignment_submissions.file_path` column (additive-only).

Deferred details (still open):

- Which scan provider (and its exact response contract) — the pipeline treats `clean:false` /
  `infected:true` / `malicious:true` / a truthy `threat` as quarantine; a concrete provider + key is
  a config task, not a code change. A retroactive re-scan of already-`skipped` files is a manual op.
- Per-org retention overrides (today a single global window via env). `organization_settings.
  privacy_settings` is the natural home when per-tenant windows are needed.
- Whether the chat composer `file` answer-mode becomes real (upload + reference) or stays LMS-window-
  only. Today `answerContent()` returns a `[file answer placeholder]` and file answers grade as text.
- How returned files and teacher annotations appear to students.

## What is the model/cost/billing strategy?

Current decision so far:

- OpenAI is acceptable for V1.
- Model routing by task is DECIDED (2026-07-02): gpt-4o conversation / gpt-4o-mini graders —
  see "What model and routing strategy should the Mentor use at scale?" below.
- Product quality is the initial priority, but cost-to-quality must be measured.
- Track cost per student/user/session/class/organization.
- Still open: billing exposure/pricing to schools, and cost ceilings per tenant.

Deferred details:

- Which models handle routine guidance, grading, rescue, authoring, and summarization.
- How to expose cost per student/user and dynamic billing later.
- What usage limits apply to schools/classes during pilots.

## When should parent accounts exist?

Current decision so far:

- Parent accounts are possible later.
- V1 focuses on students, teachers, org admins, and platform admins.

Deferred options:

- Read-only parent reports.
- Parent messaging/notifications.
- Parent consent/account linking workflows.

## How should automated media extraction and transcription run?

Current decision so far:

- Teacher-uploaded lesson resources are first-class chat media.
- V1 renders resources and uses teacher-authored descriptions, instructions, and optional transcripts.
- Automatic PDF/audio/video extraction is deferred until resource upload/display works.

Deferred options:

- Supabase Edge Function starts lightweight processing jobs and stores metadata.
- Dedicated Render worker handles heavier PDF/video/audio jobs.
- Use a third-party transcription/extraction service for media processing.
- Keep extraction platform-admin-only until teacher workflows are safe.

## How should document/PDF curriculum import work?

Current decision so far:

- Structured authoring comes first: subjects, courses, course versions, units, lessons, milestones, and activities.
- Teacher-uploaded PDFs can be lesson resources before PDF import becomes curriculum generation.
- Document/PDF import that auto-creates draft curriculum is deferred until the structured model is stable.

Deferred options:

- Import a syllabus and generate draft course/unit/lesson/milestone records for teacher review.
- Import lesson materials as supporting context only, without auto-creating curriculum.
- Keep document import platform-admin-only until teacher authoring is safe.

## How should graphs and math visuals work?

Current decision so far:

- Chat, code, multiple choice, and future file modes are the core answer modes.
- Graph/math visuals are deferred until quizzes, evidence, and milestones are stable.

Deferred options:

- Add generated graph payloads to the typed chat envelope.
- Add a deterministic graph-rendering activity type.
- Restrict visual generation to teacher-authored lessons first.

## How should file answers work?

Current decision so far:

- The typed chat contract includes `response_mode: "file"` for future compatibility.
- Student file submissions are required for complete V1, mainly through assignment/lesson windows.
- Teacher-uploaded lesson resources are a separate, decided feature track and should not be blocked by student file answers.

Deferred options:

- Add a Supabase Storage bucket with per-user RLS and file size/type limits.
- Restrict chatbar file answers until assignment-window submissions are safe.
- Decide whether small in-chat file responses are useful after classroom testing.

## How should Python execution work?

Current decision so far:

- Python is a teaching bridge in v1, not an executed language.
- The Mentor may compare Jargon to Python syntax but must not claim to run Python.

Deferred options:

- Add a separate sandboxed Python runner.
- Keep Python examples explanation-only.
- Support Python only for teacher-created demonstrations.

## What model and routing strategy should the Mentor use at scale?

ANSWERED (2026-07-02, Tutor v2.0 Phase C — see DECISIONS "Tutor v2.0 Instruction Layer"):

- Two routes only. The student-facing conversation runs on a STRONG model
  (`TUTOR_MODEL_CONVERSATION` -> gpt-4o, temp 0.6) because it writes every word the student
  reads; the high-volume understanding/code graders are pinned to a cheap literal
  (`TUTOR_MODEL_UNDERSTANDING` -> gpt-4o-mini, temp 0.2) so flipping the conversation model can
  never silently make grading expensive. Grading itself is deterministic-only.
- Caching is handled structurally: the static SYSTEM_PROMPT plus a stable->volatile user-JSON
  key order gives ~1k cached tokens per turn (verified live). Prompt size dropped ~55%
  (5.5k -> ~2.4k input tokens per mentor turn).
- The model-agnostic gateway (`TUTOR_PROVIDER`, OpenAI default with an Anthropic adapter)
  keeps the provider swappable; the moat is the governance layer, not the model.

Still open at larger scale: per-tenant routing overrides and a periodic cost-to-quality re-check
as models change.

## How should interactive ASK work in the web UI?

Current decision so far:

- Start with stateless rerun using `answers`.

Options:

- Continue stateless `answers`.
- Use `preset_answers` keyed by variable.
- Add a resumable execution/session model later.
