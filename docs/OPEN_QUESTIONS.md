# Open Questions

Add new questions at the top. Close resolved questions by moving them to `docs/DECISIONS.md` if they become durable choices.

## How should document/PDF curriculum import work?

Current decision so far:

- Structured authoring comes first: subjects, courses, course versions, units, lessons, milestones, and activities.
- Document/PDF import is deferred until the structured model is stable.

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
- v1 does not ask students to upload files.

Deferred options:

- Add a Supabase Storage bucket with per-user RLS and file size/type limits.
- Restrict file answers to teacher/admin workflows first.
- Keep file answers out of the learner UI until classroom needs are clearer.

## How should Python execution work?

Current decision so far:

- Python is a teaching bridge in v1, not an executed language.
- The Mentor may compare Jargon to Python syntax but must not claim to run Python.

Deferred options:

- Add a separate sandboxed Python runner.
- Keep Python examples explanation-only.
- Support Python only for teacher-created demonstrations.

## What model and routing strategy should the Mentor use at scale?

Current decision so far:

- Keep the existing OpenAI chat-completions path and current model setting for this repo pass.
- Verify current model/pricing docs before changing model choices.

Deferred options:

- Use one affordable default model for routine turns.
- Route assessment/rescue turns to a stronger model.
- Add caching or scripted first turns for very common lesson openings.

## How should interactive ASK work in the web UI?

Current decision so far:

- Start with stateless rerun using `answers`.

Options:

- Continue stateless `answers`.
- Use `preset_answers` keyed by variable.
- Add a resumable execution/session model later.
