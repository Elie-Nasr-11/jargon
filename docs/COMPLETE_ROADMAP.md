# Complete Product Roadmap

Status: canonical roadmap for Jargon as a chat-first LMS with teacher-uploaded lesson resources.

## Summary

Jargon is a chat-first LMS built around three durable pillars:

- Student runtime: the chat is the classroom. Mentor guides, quizzes, runs code, records evidence, and completes lessons.
- Teacher control: teachers manage classes, assign lessons, upload resources, inspect transcripts, and intervene.
- Curriculum and media layer: any structured curriculum can include text, code, quizzes, assignments, videos, audio, PDFs, flipbooks, YouTube links, and teacher-authored context.

The current live system has crossed the proof-of-concept bridge: a signed-in student can run `lesson1`, move from practice to assessment to complete, and write sessions, turns, attempts, quiz attempts, evidence, and mastery. The roadmap starts from that live vertical slice.

The product target is broader than one curriculum: teach any structured subject through a private-tutor-style chat interface for grades 3/4-12 first, with room to serve other audiences later. Students should browse school-like structure as Subject -> Chapter -> Lesson, while the database can still use `unit` internally.

## Database Groundwork Spine

The next foundation work must sketch and implement the full database structure broadly enough for the complete V1 demo. This groundwork cuts across all phases:

- tenants/organizations
- teacher, student, org admin, and platform admin access
- classes and memberships
- subject/chapter/lesson curriculum hierarchy
- milestones, activities, rubrics, quizzes, assignments, submissions, and gradebook
- teacher notes, interventions, live comments, and live viewer state
- lesson resources, file/media types, storage visibility, resource interactions, and signed access
- voice preferences, dictation metadata, audio session events, and speech usage/cost tracking
- sessions, turns, attempts, evidence, mastery, completion, and review mode
- audit logs from day one
- model/cost usage per student, user, session, class, and organization
- environment modes, feature flags, and deployment/runtime settings
- DB/RLS helper policies for every private learner and tenant path

## Cross-Cutting Track: Voice Interaction

Goal: let students use the chat by speaking and listening while preserving the same lesson runtime.

- Dictation mode: student speaks, transcript appears in the composer, student edits if needed, then submits.
- Read-aloud mode: Mentor replies can be played, paused, replayed, and slowed down or sped up.
- Audio session mode: for suitable discussion lessons, Mentor speaks a short turn, student responds by voice, transcript is confirmed, then the normal typed chat envelope advances the lesson.
- Voice is another input/output modality for the same Mentor orchestrator, not a separate curriculum path.
- Raw student audio is not stored by default.
- Store transcript text, input modality, optional confidence score, timestamps, and audit events.
- Teachers can enable/disable dictation, read-aloud, audio session mode, and voice during quizzes per class/activity.
- If browser speech support is unavailable, the app remains fully usable by typing.

Suggested first slice:

- Frontend dictation using browser speech recognition where available.
- Frontend read-aloud using browser speech synthesis.
- Extend typed chat answers with optional `input_modality`, initially `typed`, `dictated`, or `audio_session`.
- Persist modality metadata in turns/attempt payloads.

Acceptance: a student can dictate a text answer, confirm/edit the transcript, submit it, hear Mentor read-aloud, and teachers can see that the answer was dictated.

## Phase 1: Stabilize The Live Vertical Slice

Goal: make the existing student lesson path reliable enough to support teacher and admin surfaces.

- Keep `/chat` as the main student surface.
- Harden the Mentor orchestrator around the current flow: start session, load lesson/activity/milestone/quiz/mastery, guide one next action, record turns/attempts/evidence/quiz attempts/mastery, and complete the lesson deterministically.
- Add runtime observability for edge-function errors, session completions, failed run/chat calls, model latency, and model cost.
- Add an internal QA checklist: sign in, open `lesson1`, run code, answer quiz, complete lesson, verify database records.
- Update docs so Phase 0 is marked complete and the live system of record is Supabase + Render.
- Make lesson completion explicit. After completion, keep the chat available in review mode for deeper understanding and quiz prep.
- Keep Mentor strict about lesson focus while honoring student/class settings for tone, pace, directness, and hint level.
- Keep text chat as the baseline while preparing the composer for dictation and read-aloud controls.

Acceptance: a signed-in student can complete `lesson1` three times in a row without manual intervention, and every run writes the expected records.

## Phase 2: Teacher Dashboard v1

Goal: prove Jargon is an LMS, not just a tutor.

- Add `/teacher` with teacher home, class detail, student detail, transcript viewer, and teacher actions.
- Teacher home shows classes, roster count, active lessons, recent student activity, and retry/rescue/intervention flags.
- Class detail shows roster, assigned lessons, completion status, average score, and recent sessions.
- Student detail shows transcript, current lesson status, attempts, quiz results, evidence, mastery by skill key, and teacher notes.
- Transcript viewer shows mentor/student turns, code runs, quiz answers, and assessment/result cards.
- Teacher actions include private note, student-visible note, assign Jargon Foundations lesson, review Mentor recommendations, and override grade with reason.
- Teacher dashboard priority is gradebook first, intervention alerts second, and transcript heatmap third.
- Teachers can inspect full chat logs for students in their classes.
- Teachers can edit Mentor behavior per class.
- Teachers can configure voice permissions per class/activity: dictation, read-aloud, audio session mode, and voice during quizzes.
- Live teacher watching is allowed: when a teacher is watching, the student sees a viewer icon in chat.
- Teachers can send live comments or tips into chat to steer a conversation.
- Use existing tables first: `classes`, `class_memberships`, `learning_sessions`, `learning_turns`, `lesson_attempts`, `quiz_attempts`, `learning_evidence`, `student_mastery`, `teacher_notes`, `grade_overrides`, and `mentor_recommendations`.

Acceptance: a teacher can inspect one student's completed `lesson1` session, see transcript + score + evidence, and leave a note.

## Phase 3: Lesson Resources And Chat Media

Goal: teachers can attach learning media to lessons, and Mentor can surface it inside chat.

Add a first-class resource model:

- `lesson_resources`: stores resource metadata, ownership, placement hints, storage/external URL fields, teacher notes, student instructions, optional transcript text, status, visibility, and timestamps.
- `lesson_resource_placements`: connects resources to lessons, milestones, activities, assignments, or quiz items with position, display mode, and show-before-stage metadata.
- `resource_interactions`: records student views, plays, opens, downloads, completion percentage, and timestamps.

Resources can attach at any level: subject, course, chapter/unit, lesson, milestone, activity, quiz, or assignment.

Resource types:

- `video`
- `audio`
- `pdf`
- `flipbook`
- `youtube`
- `image`
- `link`
- `document`

Storage decisions:

- Use a private Supabase Storage bucket named `lesson-resources`.
- Default visibility is `class_private`.
- Resources are private by default and publishable by toggle.
- Teachers, org admins, and platform admins can upload resources for classes/content they manage.
- Students can read only resources attached to lessons/classes they are allowed to access.
- Use signed URLs for uploaded files.
- Do not expose uploaded classroom media as public URLs by default.
- Uploaded classroom resources may contain PII, so privacy and RLS are product requirements, not cleanup work.

Media behavior in chat:

- Video upload renders as an inline player in a chat resource card.
- Audio upload renders as an inline audio player.
- PDF upload renders as a file/resource card with an open button. Opening uses a popup viewer where browser support allows or a download/open action where needed.
- Flipbook v1 can just use PDFs. A page-flip presentation is optional later.
- External flipbook links embed only from allowlisted providers.
- YouTube stores `external_url`, validates `youtube.com` / `youtu.be`, renders with a privacy-conscious embed, and is never downloaded or rehosted.
- Link/document resources render as cards with title, description, and open action.

Mentor behavior:

- V1 can reference teacher-provided `title`, `description`, `student_instructions`, and optional `transcript_text`.
- Mentor references only teacher-approved materials or reviewed extracted text.
- V1 does not automatically extract video/audio/PDF text.
- Extraction and transcription are later roadmap work.

Acceptance: a teacher uploads a PDF or video to `lesson1`, publishes it, and Mentor can show it in student chat as the next learning resource.

## Phase 4: Resource-Aware Mentor Orchestrator

Goal: media becomes part of the lesson flow, not a side attachment.

Add a backward-compatible optional field to the typed chat envelope:

```ts
resources?: LessonChatResource[];
```

Resource payload shape:

```ts
type LessonChatResource = {
  id: string;
  title: string;
  description?: string;
  resource_type: "video" | "audio" | "pdf" | "flipbook" | "youtube" | "image" | "link" | "document";
  display_mode: "inline" | "modal" | "card";
  signed_url?: string;
  external_url?: string;
  thumbnail_url?: string;
  student_instructions?: string;
};
```

Orchestrator changes:

- Load resources attached to the current lesson, milestone, or activity.
- Decide when to surface a resource: before explanation, during practice, before quiz, as rescue support, or as review material.
- Write `resource_interactions` when the frontend reports view/play/open events.
- Let resources contribute evidence only when paired with a quiz, reflection, code task, or teacher rubric.
- Prevent Mentor from claiming a student watched/read a resource unless interaction records exist.
- Teacher-approved resource descriptions/instructions/transcripts are Mentor context; raw unreviewed media is not.

Frontend changes:

- Chat renders resource cards.
- Resource cards support open, play, view, mark done, and ask Mentor about this.
- Resource interaction events are sent back to Supabase.
- Chat remains centered and conversational; media appears inside the lesson flow, not as a separate library page.

Acceptance: Mentor tells the student to watch/read/open a teacher resource, the student interacts with it, and the system records that interaction.

## Phase 5: Assignments End-To-End

Goal: teachers and Mentor recommendations can create work that students complete inside chat.

- Teacher creates assignments with title, instructions, lesson/milestone/resource links, due date, recipients, and rubric.
- Student sees assignments inside chat and the progress drawer.
- Student submits text, code, files, or resource-linked responses depending on assignment type.
- File submissions usually live in the lesson/LMS assignment window, not necessarily inside the chat composer.
- Teacher grades and returns submissions.
- Mentor can recommend assignments, but teacher approval is required before class-level assignment.
- Add `/teacher` assignment builder, student assignment drawer, assignment status cards, submission review panel, and grade override/audit trail.

Acceptance: teacher assigns a lesson/resource-backed assignment, student submits, teacher grades, student sees feedback, and grade/evidence update.

## Phase 6: Curriculum Authoring Studio

Goal: move from seeded lessons to teacher-authored structured curriculum.

Build `/teacher/curriculum`:

- Create subject, course, course version, chapters/units, lessons, milestones, and activities.
- Attach resources.
- Create quizzes.
- Add rubrics.
- Preview as student.
- Publish version.

Authoring rules:

- Structured authoring comes first.
- PDF/document import remains secondary.
- AI may help draft lesson content, but teacher reviews before publish.
- Curriculum is editable by teachers/admins with publishing state, edit history, and audit trails. Avoid hard immutability as the main safety model.
- Discussion lessons are a first-class lesson type.

Acceptance: a teacher creates a small non-coding lesson with a video/PDF resource and quiz, assigns it to a class, and a student completes it through chat.

## Phase 7: Multi-Subject Chat-LMS

Goal: prove Jargon can teach beyond coding.

Add one non-coding curriculum, preferably one of:

- Computer science before coding is introduced
- Logic foundations
- Basic math reasoning
- Writing structure
- Science process skills

Requirements:

- No Jargon code dependency.
- Uses text, multiple choice, and media resources.
- Has milestones and evidence.
- Has at least one quiz and one teacher-uploaded resource.
- Mentor adapts based on mastery.

Acceptance: student completes one non-coding lesson through chat, with media, quiz, evidence, and teacher-visible progress.

## Phase 8: Admin And Organization Management

Goal: support real schools/classes.

- Add `/admin` and org-admin surfaces.
- Org admins can create/manage organization, invite teachers, invite/import students, create classes, assign teachers to classes, manage roles, disable users, view org-level usage, and view audit events.
- Platform admins can manage all organizations, global content, access, feature flags, and platform audit/debug workflows.
- Authorization remains DB/RLS-enforced, not frontend-only.
- V1 includes multiple organizations.
- Teacher accounts are the primary classroom account-management route for V1.

Acceptance: two organizations can exist side by side, and RLS prevents cross-org reads.

## Phase 9: Media Processing And AI Context Extraction

Goal: make uploaded resources deeply useful to Mentor.

Status: Media Processing v2 is implemented repo-side. Uploaded PDFs can be extracted in the
teacher browser; uploaded audio/video can be transcribed server-side through OpenAI
speech-to-text; all chunks are saved as draft chunks through a JWT-protected Edge Function,
approved by teachers, and loaded by Mentor only after approval.

Add processing jobs for teacher-uploaded resources:

- PDF text extraction
- PDF page thumbnails
- Audio transcription for uploaded files under 25 MB
- Video transcription for uploaded files under 25 MB
- YouTube transcript import where available and permitted
- Generated summaries
- Chunked searchable resource text
- Resource-to-skill tagging
- Teacher review before resource text is trusted by Mentor

Store:

- `resource_text_chunks`
- `resource_processing_jobs`
- `resource_processing_errors`
- `resource_embeddings` later if needed

Mentor usage:

- Retrieve only relevant chunks for the current lesson/milestone.
- Cite resource titles, pages, or timestamps.
- Do not over-rely on unreviewed extraction.
- Let teachers mark extracted text as approved.

Acceptance: teacher uploads a PDF or small audio/video file, processing creates reviewed chunks, and Mentor can reference approved pages or time ranges during chat.

## Phase 10: Analytics, Mastery, And Adaptation

Goal: personalization becomes explainable.

Build dashboards around:

- mastery by skill
- attempts over time
- quiz trends
- code-run success
- resource engagement
- common errors
- rescue/retry frequency
- assignment completion
- teacher interventions

Mentor adaptation:

- pacing
- hint level
- rescue choice
- resource recommendation
- quiz timing
- assignment recommendation

Acceptance: teacher can answer "why is this student marked weak on this skill?" and see linked evidence.

## Phase 11: Scale, Cost, And Model Routing

Goal: make the product economically and operationally viable.

- Add model routing by turn type.
- Use a cheaper model for routine guidance and stronger model for grading/rescue/authoring.
- Add prompt caching where supported.
- Track token/cost per student, user, session, class, and organization.
- Treat quality as the initial priority while running a deliberate cost-to-quality spike.
- Keep dynamic billing as a later business/modeling track.
- Add rate limits, abuse limits, edge-function timeout handling, background jobs for heavy media processing, and a better Render/runner scaling plan.

Acceptance: platform reports cost per active student/session and can route expensive work intentionally.

## Phase 12: Integrations And School Readiness

Goal: fit into real school workflows.

Status: Google Classroom roster import v1 is implemented repo-side as the first integration
spike. It is read-only: connect via teacher/org-admin OAuth, list courses, preview rosters,
import a course as a Jargon class, map existing users by email, and record sync runs. Google
assignment creation and grade passback remain deferred until roster import is accepted live.

Add later:

- Google/Microsoft SSO
- Clever/ClassLink
- CSV roster import
- LTI 1.3
- Canvas
- grade passback
- data export
- retention/delete workflows
- parent/student reports
- parent accounts are deferred but should remain possible

Acceptance: one school-style roster can be imported, classes created, and grades exported.

## Public Interfaces

Current typed chat fields remain unchanged:

```ts
status;
reply;
session_id;
lesson_id;
stage;
response_mode;
choices;
exercise;
assessment;
next_action;
guardrail;
```

Add optional resources:

```ts
resources?: LessonChatResource[];
```

Add optional answer modality metadata:

```ts
answer?: {
  input_modality?: "typed" | "dictated" | "audio_session";
  transcript_confidence?: number;
};
```

Add resource interaction event:

```ts
type ResourceInteractionEvent = {
  resource_id: string;
  session_id?: string;
  lesson_id?: string;
  event_type: "shown" | "opened" | "played" | "paused" | "completed" | "downloaded";
  progress_seconds?: number;
  progress_percent?: number;
};
```

Add voice interaction event:

```ts
type VoiceInteractionEvent = {
  session_id?: string;
  lesson_id?: string;
  turn_id?: string;
  event_type:
    | "dictation_started"
    | "dictation_transcribed"
    | "dictation_submitted"
    | "read_aloud_started"
    | "read_aloud_finished";
  input_modality?: "dictated" | "audio_session";
  transcript_confidence?: number;
  duration_seconds?: number;
};
```

Teacher upload flow:

1. Upload storage object in private `lesson-resources` bucket.
2. Create `lesson_resources` row.
3. Create `lesson_resource_placements` row.
4. Add optional thumbnail/transcript metadata.
5. Write audit event.

## Test Plan

- Student runtime: complete `lesson1`, complete resource-backed lesson, complete quiz, retry/rescue path, and resource interaction records.
- Voice runtime: dictate an answer, edit the transcript, submit it, play Mentor read-aloud, and verify turn/attempt modality metadata.
- Teacher dashboard: teacher sees own class, cannot see another class, sees transcript/evidence/attempts, creates note, and uploads resource.
- Storage/RLS: unauthenticated cannot read private media, assigned student can read class resource, other students cannot, teacher can upload to own class/course, and teacher cannot upload to another org.
- Media rendering: video upload plays, audio upload plays, PDF opens, YouTube embeds, flipbook/PDF fallback works, and expired signed URL refreshes.
- Orchestrator: resources load into context, Mentor surfaces one resource at a time, Mentor does not claim completion without interaction event, and resource-backed quiz creates evidence.
- Regression: existing Jargon run works, existing typed chat works without resources, existing lessons load, and build/test suite passes.

## Assumptions And Defaults

- Next implementation track is teacher dashboard + media foundation.
- Lesson resources are private by default and served through Supabase Storage RLS/signed URLs.
- YouTube is treated as an external embed, not uploaded or rehosted.
- V1 media is rendered and teacher-described; automatic extraction/transcription comes later.
- Student file submissions are required for the complete V1, but their exact chat-vs-lesson-window UX can be phased.
- Student experience remains chat-first; resources appear inside the conversation rather than a separate LMS content page.
- Current Supabase + Render architecture remains the base until scale/cost evidence says otherwise.
- Voice interaction is part of the chat runtime; teacher-uploaded audio resources remain a separate media-resource feature.
