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

Status: Started as a repo-only backend pass.

- Rebuild the mentor as a structured course-session layer, not an open-ended chat box.
- Separate AI coaching from code execution.
- Add durable sessions, turns, attempts, activity seeds, and mastery evidence.
- Return typed chat envelopes with stage, response mode, next action, assessment, and guardrail fields.
- Add lesson modes from the curriculum: Processes, Coding, Prompting.
- Keep prompts and examples versioned in the repo.
- Bridge natural speech -> pseudocode -> Jargon -> Python.

## Phase 5: Curriculum And Package

Status: Curriculum archive imported; curation remains.

- Curate examples into levels/modules.
- Add expected-output tests for selected canonical examples.
- Package docs for teachers/students.
- Decide how much of the full corpus appears in the learner UI.
