# Roadmap

## Phase 1: Runtime Foundation

Status: Complete for the current platform pass.

- Harden interpreter against malformed/hostile code.
- Add subprocess sandbox.
- Preserve backward-compatible result shape.
- Add test coverage for abuse cases.
- Add example loader for legacy lesson files.
- Validate the legacy example corpus.
- Move runtime into `engine/`.
- Add Flask `/run` and `/health` wrapper for Render.

## Phase 2: Supabase + Render Integration

Status: Next.

- Point Supabase `JARGON_ENGINE_URL` to the Render `jargon-engine` service.
- Keep the root platform wired to Supabase Auth, lessons, chat, and code submissions.
- Preserve `result = output` for existing `editor.js`.
- Add deployment smoke tests or documented manual checks.

## Phase 3: Web Runner Polish

Status: Started by Claude branch.

- Replace placeholder lesson sample code with curated examples.
- Show memory, status, errors, and pending ASK prompts.
- Make ASK interactions feel intentional and clear.
- Keep the UI quiet, focused, and classroom-friendly.

## Phase 4: Learning Session Runtime + Mentor

Status: Superseded by the chat-first LMS foundation.

- Rebuild the mentor as a structured course-session layer, not an open-ended chat box.
- Separate AI coaching from code execution.
- Add durable sessions, turns, attempts, activity seeds, and mastery evidence.
- Return typed chat envelopes with stage, response mode, next action, assessment, and guardrail fields.
- Add lesson modes from the curriculum: Processes, Coding, Prompting.
- Keep prompts and examples versioned in the repo.
- Bridge natural speech -> pseudocode -> Jargon -> Python.

## Phase 5: Chat-LMS Foundation

Status: Started.

- Define the product contract in `docs/PRODUCT_ARCHITECTURE.md`.
- Add multi-role identity: organizations, memberships, classes, class memberships, and platform admins.
- Add reusable RLS helper functions for teacher/class/org/platform permissions.
- Add curriculum hierarchy: subjects, courses, versions, units, lessons, milestones, and activities.
- Add learning records: quizzes, assignments, submissions, evidence, teacher notes, Mentor recommendations, grade overrides, and audit events.
- Keep the student chat as the primary classroom surface.

## Phase 6: Teacher-Led Class Workflow

Status: Next after schema verification.

- Let a teacher create or join a class.
- Let a student join that class.
- Let the teacher assign a Jargon Foundations lesson.
- Upgrade the Mentor orchestrator to read class, assignment, milestone, evidence, and teacher-note context.
- Add a teacher dashboard for classes, rosters, progress, chat logs, quiz scores, assignments, recommendations, and intervention flags.
- Add tests for teacher RLS and UI filtering.

## Phase 7: Curriculum And Package

Status: Curriculum archive imported; curation remains.

- Curate examples into levels/modules.
- Add expected-output tests for selected canonical examples.
- Package docs for teachers/students.
- Decide how much of the full corpus appears in the learner UI.
