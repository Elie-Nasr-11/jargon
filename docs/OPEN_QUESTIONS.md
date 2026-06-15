# Open Questions

Add new questions at the top. Close resolved questions by moving them to `docs/DECISIONS.md` if they become durable choices.

## Should the legacy example corpus live in the GitHub repo?

Context:

- The Desktop archive has 131 runnable legacy examples after extraction.
- The canonical repo currently contains the loader and validator, but not the whole corpus.

Options:

- Keep examples outside the repo and document local paths.
- Import curated examples into `examples/`.
- Import all legacy examples under `legacy/examples/`.

## What should the first web runner target be?

Options:

- Static frontend plus small Python API.
- FastAPI backend.
- Flask backend.
- Netlify/Vercel-style serverless functions.

## How should interactive ASK work in the web UI?

Options:

- Rerun with an `answers` array.
- Use `preset_answers` keyed by variable.
- Add a resumable execution/session model.

Current leaning:

- Start with stateless rerun using `answers`, then only add sessions if needed.

## What is the canonical audience level?

Options:

- Middle school beginner logic.
- High school pseudocode bridge.
- Teacher-facing curriculum tool.
- Mixed, with levels.

Current leaning:

- Mixed with clear module/level labels.
