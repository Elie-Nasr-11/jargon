# Roadmap

Status: current roadmap summary. See `docs/COMPLETE_ROADMAP.md` for the full detailed plan.

## Current State

Phase 0 is effectively complete. Phases 1 through 6 and Voice v1 are complete enough for the live pilot path. Voice v2 is in progress to replace browser-quality audio with OpenAI-backed realtime voice and cached Mentor playback.

- The tutor frontend is live at `https://jargon-9bv5.onrender.com/`.
- Supabase Auth, lessons, sessions, turns, attempts, quiz attempts, evidence, and mastery are live.
- The Render Jargon engine runs code through the Supabase `run` edge function.
- The `chat` edge function is a Mentor orchestrator that can complete `lesson1` from practice to assessment to complete.
- The teacher dashboard shows class progress, transcripts, attempts, quizzes, evidence, mastery, notes, resources, and assignments.
- Resource-backed lessons, assignment review, curriculum authoring, and browser voice support are live enough to support the next multi-subject slice.
- Voice v2 adds OpenAI Realtime live sessions while preserving the existing Mentor orchestrator as the grading/session source of truth.
- Active implementation slice: Phase 7 Multi-Subject Chat-LMS.

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

- Add one non-coding curriculum: logic foundations, basic math reasoning, writing structure, or science process skills.
- First non-coding test can be computer science before coding is introduced.
- Use text, multiple choice, media resources, milestones, and evidence.
- No Jargon code dependency.

Exit criteria: student completes one non-coding lesson with media, quiz, evidence, and teacher-visible progress.

## Phase 8: Admin And Organization Management

Goal: support real schools/classes.

- Add `/admin`.
- Let org admins manage organizations, teachers, students, classes, roles, and audit.
- Let platform admins manage all tenants, global content, feature flags, and support/debug workflows.
- Keep authorization DB/RLS-enforced.
- Multiple organizations and org admins are V1 requirements.

Exit criteria: two organizations can exist side by side, and RLS prevents cross-org reads.

## Phase 9: Media Processing And AI Context Extraction

Goal: make uploaded resources deeply useful to Mentor.

- Add PDF text extraction and page thumbnails.
- Add audio/video transcription.
- Add YouTube transcript import where available and permitted.
- Store reviewed chunks for Mentor retrieval.
- Let teachers approve extracted text before Mentor relies on it.

Exit criteria: teacher uploads a PDF, extraction creates reviewed chunks, and Mentor references specific pages during chat.

## Phase 10: Analytics, Mastery, And Adaptation

Goal: personalization becomes explainable.

- Add dashboards for mastery, attempts, quiz trends, code-run success, resource engagement, common errors, rescue/retry frequency, assignments, and teacher interventions.
- Let Mentor adapt pace, hint level, rescue choice, resource recommendation, quiz timing, and assignment recommendation.

Exit criteria: teacher can answer why a student is weak on a skill and see linked evidence.

## Phase 11: Scale, Cost, And Model Routing

Goal: make the product economically viable.

- Add model routing by turn type.
- Track token/cost per student, user, session, class, and organization.
- Run a cost-to-quality spike before locking model routing.
- Add rate limits, abuse limits, timeout handling, background jobs, and runner scaling.

Exit criteria: platform reports cost per active student/session and routes expensive work intentionally.

## Phase 12: Integrations And School Readiness

Goal: fit into real school workflows.

- Add Google/Microsoft SSO, Clever/ClassLink, CSV roster import, LTI 1.3, Google Classroom, Canvas, grade passback, exports, retention/delete workflows, and parent/student reports.

Exit criteria: one school-style roster can be imported, classes created, and grades exported.
