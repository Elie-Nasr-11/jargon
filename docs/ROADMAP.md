# Roadmap

## Phase 1: Runtime Foundation

Status: Mostly complete.

- Harden interpreter against malformed/hostile code.
- Add subprocess sandbox.
- Preserve backward-compatible result shape.
- Add test coverage for abuse cases.
- Add example loader for legacy lesson files.
- Validate the legacy example corpus.

## Phase 2: Clean API Surface

Status: Next.

- Define one HTTP request/response contract for running Jargon.
- Use `run_sandboxed()` for untrusted execution.
- Support interactive `ASK` by accepting `answers` or `preset_answers`.
- Return the interpreter result dict without ad hoc `output`/`result` drift.
- Add API tests.

## Phase 3: Web Runner

Status: Not started in canonical repo.

- Build a simple code editor and output panel.
- Show memory, status, errors, and pending ASK prompts.
- Let users provide ASK answers without modifying source code.
- Include sample programs from the example loader.
- Keep the UI quiet, focused, and classroom-friendly.

## Phase 4: Jargon Mentor

Status: Concept exists in legacy web folders.

- Rebuild the mentor as a teaching layer, not the runtime.
- Separate AI coaching from code execution.
- Add lesson modes from the curriculum: Processes, Coding, Prompting.
- Keep prompts and examples versioned in the repo.

## Phase 5: Curriculum And Package

Status: Planned.

- Curate examples into levels/modules.
- Add expected-output tests for selected canonical examples.
- Package docs for teachers/students.
- Decide deployment target.
