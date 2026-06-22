# Product Requirements

Status: canonical product requirements from the 2026-06-22 human review.

## North Star

Jargon is a platform for teaching any structured curriculum through chat. It should feel most like a private tutor, while the LMS machinery underneath handles classes, curriculum, resources, assignments, quizzes, progress, grades, permissions, and audit.

The first market is primary and secondary school, starting around grades 3/4 through 12. The architecture should remain general enough for other audiences later, but product decisions should optimize for real classroom use first.

The demo target is a complete classroom-ready demo for a real school test run, not another proof of concept.

## Student Experience

- The student learns primarily through a guided chat with Mentor.
- The chat should feel like a private tutor: focused, adaptive, clear, and personal.
- Students can browse lessons freely, but navigation is organized like a school LMS: Subject -> Chapter -> Lesson.
- The database may keep the canonical `unit` term internally, but student-facing navigation should support the Chapter label.
- Lessons have a clear beginning and a clear end.
- After lesson completion, the student can keep chatting in review mode for deeper understanding, question answering, and quiz prep.
- Students should be able to use text by default, dictate answers by voice, hear Mentor replies read aloud, and eventually move through suitable lesson conversations in audio session mode.
- Tone, playfulness, directness, hint level, and pacing should be driven by student settings and teacher/class settings.
- The Mentor should be strict about staying on the lesson path. Off-topic drift should be redirected.
- Adaptation is primarily based on skill mastery, not vibes.

## Voice Interaction

- Voice is a first-class interaction mode, not a separate product path.
- Dictation lets students speak an answer, inspect the transcript, edit it if needed, and submit the transcript.
- Read-aloud lets students hear Mentor replies while keeping all text visible.
- Audio session mode should eventually let students proceed through discussion-style lessons by listening and speaking.
- Voice must follow the same lesson stages, guardrails, rubrics, quiz rules, evidence records, and teacher visibility as typed chat.
- Raw student audio should not be stored by default.
- Store transcripts, input modality, timestamps, optional transcription confidence, and audit events.
- Teachers can allow/disable dictation, read-aloud, audio session mode, and voice during quizzes per class/activity.
- The composer should still work fully by typing when speech support is unavailable.

## Mentor Authority

- Mentor may guide, explain, quiz, grade deterministic checks, recommend, flag, and alert.
- Teacher-approved curriculum and resources are the source of truth.
- Teacher rubrics are the source of truth for quiz pass, milestone pass, lesson completion, and assignment grading.
- Mentor judgement mediates pace along the teacher-approved track; it does not replace teacher material or rubrics.
- Mentor can suggest assignments or interventions to teachers, but should not autonomously create authoritative assignments.
- Mentor should alert a teacher when a student really needs help.
- Mentor may reference only teacher-approved material when giving curriculum-specific examples or resource-backed explanations.
- Mentor must not provide full solutions before a clear student effort.

## Curriculum And Authoring

- The platform is built to host curriculum, not to hard-code one curriculum.
- Teachers are primary authors, supported by AI-assisted authoring.
- Admins can also create and manage curriculum.
- Structured authoring comes first: subjects, courses, chapters/units, lessons, milestones, activities, quizzes, rubrics, assignments, and resources.
- Document/PDF import is later support, not the first authoring model.
- Curriculum should always be editable by a teacher or admin.
- Edits need history, publishing state, and audit trails; do not rely on hard immutability as the main safety model.
- Discussion lessons are a first-class lesson type.
- Non-coding subjects should be supported soon; the first non-coding test can be computer science before coding is introduced.
- The product is the platform. Content is populated into it.

## Resources And Media

- Teacher lesson resources can attach at any level: subject, course, chapter/unit, lesson, milestone, activity, quiz, or assignment.
- Resources are private by default and publishable by toggle.
- YouTube and external media must be teacher-approved.
- Teacher-uploaded resources may contain PII, so access control and signed URLs matter from day one.
- Mentor should use only teacher-approved descriptions, instructions, transcripts, or reviewed extracted text when discussing resources.
- In chat, PDFs and files should appear as file/resource cards with an open button.
- Opening a file should use a popup viewer where possible or a download/open action where needed.
- PDFs are sufficient for flipbook-style needs in v1.
- Automatic PDF/audio/video extraction and transcription can come later.

## Quizzes And Assessment

- In-chat mini assessments should give immediate feedback.
- In-chat mini quizzes should transform the chat bar into the quiz surface and blur the chat history while the quiz is active.
- Voice can be allowed during quizzes only when the teacher/rubric permits it.
- Larger lesson quizzes assigned by a teacher can live on their own page or lesson window.
- Teacher-assigned quizzes should be reviewed by the teacher unless answers are objective, such as MCQ or another absolute check.
- Quiz timing can be both Mentor-triggered and authored/scheduled, adjustable by teacher.
- Open-ended AI grading is not a v1 source of truth.
- Code correctness should come from the execution engine.
- Teacher rubrics define pass/fail and completion.

## Assignments

- Assignments are required in v1.
- Mentor may recommend assignments to teachers; teachers approve and assign.
- Students should submit assignments.
- Assignment submissions can include files.
- File submissions most likely happen in lesson/LMS windows, not necessarily directly inside chat.
- Assignments should connect to lessons, milestones, resources, rubrics, due dates, submissions, teacher feedback, gradebook, and evidence.

## Teacher Experience

- Teacher dashboard priorities: gradebook first, intervention alerts second, transcript heatmap third.
- Teachers need full chat logs for their students.
- Teachers should see whether an answer was typed, dictated, spoken in audio session mode, code, file, or multiple choice.
- Teachers can edit Mentor behavior per class.
- Teachers can inspect evidence behind grades/mastery.
- Teachers can add notes, review recommendations, grade submissions, override grades with reason, and assign material.
- Live teacher watching is allowed: when a teacher is watching, students should see a viewer icon in chat.
- Teachers can send live comments or tips into a student chat to steer the conversation.
- Teacher accounts are the primary account-management route for classes/students in v1.

## Roles, Tenancy, And Admin

- V1 should include multiple organizations.
- Org admins are included in v1.
- Platform admins are included in v1.
- Roles include student, teacher, org admin, and platform admin.
- Authorization must be enforced by database/RLS/server checks, not frontend-only filtering.
- Student data is scoped to the student.
- Teacher access is scoped to assigned classes/students.
- Org admin access is scoped to the organization.
- Platform admin access is global.
- Parent accounts are possible later and should be left as a deferred track.

## Data, Privacy, And AI

- Learning records should be stored indefinitely by default unless a later retention policy changes that.
- Audit logs are required from day one.
- Teacher-uploaded resources may contain PII.
- LLM calls should always receive anonymized student data where possible.
- LLM calls should receive voice transcripts rather than raw identifiable audio unless a later approved speech-to-speech mode requires otherwise.
- Personalized placeholders should be resolved on the frontend or in a controlled server layer. Example: Mentor can produce `Hey %firstname%, how is it going?`, and the chat UI can render `Hey Elie, how is it going?`.
- OpenAI is acceptable for v1.
- Model routing by task is allowed, but the cost-to-quality ratio needs a deliberate spike before locking model strategy.
- Track cost per student/user and per session. A dynamic billing scheme is possible later.

## Demo Acceptance Bar

The demo should feel like a complete platform, not a prototype:

- Multi-organization groundwork exists.
- Students and teachers can sign in.
- Teacher can manage a class.
- Teacher can assign lesson material.
- Student can complete a lesson in chat.
- Mentor can guide, quiz, run code when relevant, and complete the lesson clearly.
- Teacher can see gradebook, intervention alerts, transcript, attempts, quiz results, evidence, mastery, and notes.
- Teacher can upload or attach resources.
- Assignments and file submissions are represented in the system.
- Admin/account-management groundwork exists.
- Audit and privacy decisions are visible in the data model.

## Database Groundwork Priority

The next platform work should sketch and implement the full database structure broadly enough that V1 can grow without re-platforming:

- tenants/organizations
- users/profiles/roles
- classes/memberships
- subject/chapter/lesson curriculum hierarchy
- milestones/activities/rubrics
- quizzes/quiz attempts
- assignments/submissions/gradebook
- teacher notes/interventions/live comments
- voice preferences/dictation metadata/audio-session events
- resources/files/media types/storage visibility
- resource interactions
- sessions/turns/attempts/evidence/mastery
- audit logs
- model/cost usage
- environment modes and feature flags
- access policies and RLS helpers
