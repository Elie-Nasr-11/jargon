# Decisions

Record durable project decisions here. Add new entries at the top.

## 2026-06-21: Jargon Is A Chat-First LMS

Decision:

- The product is a chat-first LMS: the student learns in one guided conversation, while curriculum, permissions, assignments, quizzes, mastery, progress, and teacher oversight sit underneath.
- The first real deployment model is teacher-led classes.
- The Mentor may guide, quiz, grade, recommend, and flag, but teacher approval is required for major assignment/course changes.
- Curriculum authoring starts as structured subjects/courses/units/lessons/milestones. Document/PDF import is deferred.
- Authorization lives in database-controlled role/membership tables or server-owned metadata, never user-editable metadata.

Reason:

- The proof of concept proved the chat/runtime loop. The durable product needs classroom structure, accountability, teacher visibility, and safe access control without making the student experience feel like a dashboard.
- See `docs/PRODUCT_ARCHITECTURE.md` for the canonical vocabulary and first milestone.

## 2026-06-15: Pivot To A Conversational Lesson-Runner

Decision:

- The product's primary interface is a stateful, guided conversation that *is* the class
  (begin/end, grades, retry/continue, multiple answer modes: text/code/file/multiple-choice),
  not a free-form chatbot or the split-view. The split-view becomes a legacy stepping stone.
- The `chat` edge function becomes a stateful flow engine (load state -> build cached prompt
  -> structured-output + tool-use turn -> grade -> persist -> advance), not a passthrough.
- Lesson flow is hybrid: authored objectives/checkpoints per lesson + AI conversation,
  enforced by the orchestrator.
- Mentor LLM is decided by a spike comparing Claude tiers (`claude-haiku-4-5` bulk +
  `claude-sonnet-4-6` grading, with prompt caching) vs OpenAI `gpt-4o`, measured on real
  lessons (cost/turn, guardrail adherence, grading quality).
- Audience is school students; the Level 0-3 ladder (Natural logic -> Baby Jargon -> Jargon
  -> Python bridge) is the per-student adaptivity axis.

Reason:

- Matches the human's stated product vision; see `docs/VISION.md` for the full architecture.

## 2026-06-15: Learning Session Runtime Comes Before More Chat Polish

Decision:

- The next backend spine is a durable learning-session runtime, not a looser Mentor prompt.
- AI-led lessons use course-flow stages: intro, teach, practice, assessment, review, and complete.
- Student responses are typed as text, code, multiple choice, or file.
- The chat edge function adds a typed JSON response envelope while preserving the legacy `{ messages } -> { reply }` path.
- The primary learner audience is school children.

Reason:

- Jargon is meant to teach logical thought through structured course conversations.
- Claude's frontend needs a stable contract for stages, answer modes, retries, rescue paths, and completion.
- Keeping legacy chat compatibility lets the current UI continue working while the richer experience is built.

## 2026-06-15: Seed A 10-Lesson V1 Spine

Decision:

- Use a 10-lesson v1 spine: five Processes lessons plus five Coding lessons.
- Add `module`, `level`, and nullable `expected_output` fields to `lessons`.
- Replace placeholder starter code with runnable Jargon programs.
- Draw from existing curated examples where they fit, and add new concept-matched starters where needed.

Reason:

- Claude's frontend is already prepared to show `module`, `level`, and expected-output-driven polish later.
- A 10-lesson spine is enough to make the product feel real without seeding the full curriculum before it is curated.

## 2026-06-15: `run` Requires `JARGON_ENGINE_URL`

Decision:

- The Supabase `run` edge function requires the `JARGON_ENGINE_URL` secret.
- It must return a canonical error-shaped response when the secret is missing.
- It must not silently fall back to an old or test engine URL.

Reason:

- Running the wrong interpreter is worse than a clear configuration error.
- The front-end can already display canonical runtime errors.

## 2026-06-15: Support Full-Line `//` Comments

Decision:

- Jargon supports `#` inline comments outside strings.
- Jargon also supports full-line `//` comments when the first non-whitespace characters are `//`.
- Jargon does not support inline `//` comments in v1 because `//` remains floor division inside expressions.

Reason:

- The deployed lesson seed code uses full-line `//` starter comments.
- Preserving `//` floor division avoids a breaking expression-language change.

## 2026-06-15: Backend Is Supabase + Render

Decision:

- Keep Supabase for auth, database, RLS, and edge functions.
- Keep Render for the static platform and the Python Jargon engine service.
- The Supabase `run` edge function proxies to the Render engine via `JARGON_ENGINE_URL`.

Reason:

- The platform is already deployed and partly wired.
- Codex should not create a competing auth or persistence backend.

## 2026-06-15: Ownership Split Between Agents

Decision:

- Codex owns the engine/interpreter, examples, and curriculum extraction.
- Claude owns the front-end/platform, Supabase, and Render wiring.

Reason:

- This keeps runtime semantics and platform wiring from colliding.

## 2026-06-15: One Repo With Engine Subfolder

Decision:

- Use one repo: `jargon`.
- Platform files live at the repo root.
- The hardened interpreter lives in `engine/`.
- A thin Flask wrapper in `engine/app.py` exposes the runtime to Render.

Reason:

- One repo keeps product/platform/runtime evolution visible.
- `engine/` gives the runtime a deployable boundary.

## 2026-06-15: Engine HTTP Response Includes `result = output`

Decision:

- Preserve the canonical runtime result shape: `output`, `memory`, `errors`, `ask`, `ask_var`, `status`, `truncated`, and `limits_hit`.
- The Flask wrapper also returns `result` as an alias of `output`.

Reason:

- Existing `editor.js` reads `result`.
- New runtime/platform code should use the richer canonical shape.

## 2026-06-15: Curriculum Is Merged With Level Labels

Decision:

- Merge the five deployed lessons into the Processes/Coding/Prompting curriculum model.
- Use mixed-audience level labels.

Reason:

- The product serves beginners, bridge learners, and teacher-facing curriculum users.

## 2026-06-15: Mentor Is Logic Coach + Python Bridge

Decision:

- The Mentor teaches natural speech -> pseudocode -> Jargon -> Python.
- It remains a teaching layer over deterministic runtime execution.

Reason:

- The runtime should remain deterministic and testable.
- The Mentor should coach reasoning and transfer, not execute code by inference.

## 2026-06-15: Use Repo Files For Agent Communication

Decision:

- Codex and Claude Code communicate through versioned repo files, especially `docs/HANDOFF.md`.

Reason:

- Agents cannot directly DM each other.
- Repo-based communication is auditable, persistent, and works across tools.

## 2026-06-15: Treat Hardened Interpreter As Runtime Core

Decision:

- The canonical runtime is `engine/jargon_interpreter.py`.
- The root `jargon_interpreter.py` is a compatibility import shim.
- Legacy Colab/web interpreter files remain reference material, not active runtime code.

Reason:

- The hardened interpreter has resource limits, bounded AST evaluation, tests, and sandbox support.

## 2026-06-15: Keep Mentor Separate From Runtime

Decision:

- The AI mentor/chat layer should call or explain the runtime, not replace it.

Reason:

- Execution must be deterministic and testable.
- Teaching behavior can evolve without changing core language semantics.

## 2026-06-15: Preserve Stable Result Shape

Decision:

- Runtime calls return the same core fields: `output`, `memory`, `errors`, `ask`, `ask_var`, `status`, `truncated`, and `limits_hit`.

Reason:

- Older web experiments drifted between `input`/`code` and `result`/`output`; the rebuild needs one contract.
