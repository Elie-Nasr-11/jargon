# Product Architecture

Status: canonical product contract for the chat-first LMS buildout.

## Product Definition

Jargon is a chat-first LMS. The student learns inside one guided conversation. The LMS is the structure underneath that conversation: curriculum, permissions, assignments, quizzes, mastery, progress, teacher oversight, and audit records.

The chat is not a loose chatbot. It is the classroom runtime. Each Mentor turn is grounded in the current course, lesson, milestone, student evidence, active assignments, teacher notes, and allowed answer modes.

## Locked V1 Direction

- First real deployment model: teacher-led classes.
- Primary student interface: guided lesson chat.
- Primary teacher interface: class oversight, assignments, progress, chat review, evidence, and intervention.
- Mentor authority: guide, quiz, grade, recommend, and flag. Teachers approve major assignment/course changes.
- Curriculum input: structured authoring first. Document/PDF import is deferred.
- Teacher-uploaded lesson resources are first-class curriculum support: videos, audio, PDFs, flipbooks, YouTube links, images, links, and documents can be attached to lessons, milestones, activities, assignments, or quizzes.
- Current Supabase + Render architecture remains the deployment base.

## Canonical Terms

### Organization

A school, tutoring group, district, or internal workspace. Organizations own classes, memberships, and optionally private curriculum. Platform-level global curriculum can exist without an organization.

### User Roles

- `student`: learns through chat, completes assignments, answers quizzes, submits code/files when enabled, and views personal progress.
- `teacher`: manages assigned classes, reviews students, assigns work, inspects chat logs/evidence, and gives feedback.
- `org_admin`: manages users, classes, and organization-owned content inside one organization.
- `platform_admin`: manages global organizations, content, access, feature flags, and platform audit/debug workflows.

Authorization must come from database-controlled membership tables or server-owned auth metadata, never from user-editable metadata.

### Class

A teacher-led cohort inside an organization. Classes connect teachers, students, course assignments, lesson sessions, grades, and teacher dashboards.

### Subject

A broad curriculum area, such as Logic and Coding Foundations, Mathematics, Writing, or Science.

### Course

A structured learning sequence within a subject. Courses can be global platform content or organization-owned content. Courses are versioned so live classes can stay stable while curriculum evolves.

### Unit

A course section that groups related lessons.

### Lesson

A teachable conversation arc. A lesson has objectives, level, sample/starter code when relevant, milestones, and activities. The learner experiences it through chat.

### Milestone

A specific target inside a lesson. Milestones define what the student should understand or do, allowed answer modes, skill keys, expected evidence, and completion rules.

### Activity

The smallest authored checkpoint in a lesson. Activities can be discussion, code, multiple choice, reflection, or file. Activities attach to milestones.

### Lesson Resource

A teacher, org, or platform-authored learning resource attached to curriculum. Resources can be uploaded media or external links. Supported roadmap types are video, audio, PDF, flipbook, YouTube, image, link, and document. Resources are private by default and appear inside the chat lesson flow.

### Turn

One message or structured event in a learning session. Turns can come from the student, Mentor, or system.

### Attempt

A student response to a lesson activity. Attempts capture answer mode, response content/code/choice, run result, score, pass/fail, and feedback.

### Evidence

A durable learning signal. Evidence can come from chat, code, quiz, file, assignment, or teacher note. Mastery is computed from evidence, not from hidden intuition.

### Mastery

A per-student, per-skill summary derived from evidence. Mastery tracks attempts, latest score, confidence, common errors, and last practiced date.

### Assignment

Teacher-created or Mentor-recommended work assigned to students or a class. Mentor recommendations require teacher approval before becoming authoritative class work.

### Quiz

A structured checkpoint that can appear in the chat as a popup or inline choice. Quiz attempts are recorded and can produce evidence, grades, and mastery updates.

### Recommendation

A Mentor-generated suggestion, such as retry, rescue, intervention, or assignment. Recommendations are records for teacher review unless the action is explicitly safe for the Mentor to apply.

### Resource Interaction

A record that a student was shown, opened, played, paused, completed, or downloaded a lesson resource. Mentor may not claim a student watched or read a resource unless these interaction records support it.

## Core Data Flow

1. A teacher creates or joins a class.
2. Students join the class.
3. A teacher assigns a course, unit, lesson, or specific assignment.
4. A teacher may attach lesson resources, such as videos, audio, PDFs, flipbooks, YouTube links, images, links, or documents.
5. A student opens the chat lesson.
6. The runtime loads the student profile, class context, session, lesson, milestone, resources, recent turns, assignments, mastery, and notes.
7. The Mentor returns structured output: reply, next action, expected answer mode, resource payloads, quiz/exercise payload, grade/evidence when applicable, and guardrail state.
8. The orchestrator persists turns, attempts, quiz attempts, resource interactions, assignment updates, evidence, recommendations, and mastery summaries.
9. The teacher dashboard reads the records and shows what happened, why it matters, and where intervention is needed.

## Mentor Runtime Rules

- One learning goal at a time.
- No full solution before a clear student attempt.
- Redirect drift back to the current milestone.
- Code execution is deterministic and comes from the runtime, not Mentor imagination.
- Lesson resources are surfaced one at a time inside the chat flow.
- Mentor can reference teacher-authored resource descriptions/instructions/transcripts, but automatic extraction/transcription is a later phase.
- Mentor may not claim resource completion unless resource interaction records exist.
- File uploads remain disabled until storage, RLS, and limits are designed.
- Python is a teaching bridge in v1, not a trusted backend execution path.
- Major assignment or course changes become teacher-review recommendations.

## First Real Milestone

The first complete product milestone is:

- Teacher can manage a class.
- Student can join that class.
- Teacher assigns a Jargon Foundations lesson.
- Student completes the lesson through chat.
- Mentor asks at least one quiz/checkpoint.
- Student runs Jargon code when requested.
- Platform records turns, attempts, quiz score, mastery evidence, and final status.
- Teacher can inspect transcript, score, assignment/progress, and evidence.
- RLS blocks unauthorized cross-student, cross-class, and cross-organization access.

The second complete product milestone adds lesson resources:

- Teacher uploads or links a lesson resource.
- Resource is private by default and scoped to the class/content the teacher manages.
- Mentor surfaces the resource in chat at the right lesson moment.
- Student interacts with the resource.
- Platform records the interaction.
- Teacher can see resource engagement alongside transcript, attempts, quiz score, and evidence.

## Deferred Capabilities

- Document/PDF curriculum import that automatically creates draft curriculum.
- Real file answer uploads.
- Backend Python sandboxing.
- Graph/math visual generation.
- Autonomous Mentor-created assignments without teacher approval.
- Automatic media extraction/transcription and embeddings.
