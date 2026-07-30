# Jargon

Jargon is a chat-first learning platform: students learn inside one guided mentor
conversation, with the LMS (classes, curriculum, assignments, assessments, mastery,
teacher oversight) underneath it. It combines a deterministic Jargon runtime, a
Supabase-backed lesson/session system, and a tutor-style frontend.

**MVP branch note:** `claude/project-scope-mvp-o7ox0y` carries the stripped MVP —
student experience first (a 7-mode chat: open / lesson / practice / discuss / quiz /
assessment / resources, plus mentor memory), a class-centric teacher core with
studio-lite authoring, and a 3-tab admin. `main` archives the full pre-strip platform.
See `docs/MVP_SCOPE.md` for the authoritative inventory.

## Architecture

```text
Render Static Site -> frontend/ React tutor app
        |
        | supabase-js
        v
Supabase
  - Auth
  - Postgres: lessons, profiles, learning sessions, turns, attempts
  - Edge Functions
      - chat -> structured mentor runtime
      - run  -> proxy to JARGON_ENGINE_URL
                    |
                    v
            Render Python service: engine/app.py
```

## Structure

```text
jargon/
  frontend/              React/Vite tutor frontend
  engine/                Flask wrapper and canonical interpreter
  supabase/              migrations and edge functions
  mentor/                mentor prompt assets
  examples/              curated Jargon examples
  legacy/examples/       imported full example corpus
  docs/                  handoff, roadmap, language, deployment docs
  tests/                 interpreter and contract tests
  tools/                 example validation utilities
```

The root `jargon_interpreter.py` is a compatibility import shim. The canonical engine lives in `engine/jargon_interpreter.py`.

## Working With Agents

Codex and Claude coordinate through repo files. Start with:

- `AGENTS.md`
- `CLAUDE.md`
- `CODEX.md`
- `docs/HANDOFF.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`
- `docs/OPEN_QUESTIONS.md`

## Engine Quick Start

```python
from jargon_interpreter import StructuredJargonInterpreter

code = """
SET nums ([1, 2, 3])
SET total (0)
REPEAT_FOR_EACH num in nums
    SET total (total + num)
END
PRINT total
"""

result = StructuredJargonInterpreter().run(code)
print(result["output"])
```

For untrusted code, prefer the subprocess sandbox:

```python
from jargon_interpreter import run_sandboxed

result = run_sandboxed("PRINT 2 + 3", timeout_seconds=2, memory_mb=128)
print(result["status"], result["output"])
```

## Engine HTTP API

Run locally:

```bash
cd engine
python3 -m pip install -r requirements.txt
python3 app.py
```

`GET /health` returns service health.

`POST /run` accepts:

```json
{"code": "PRINT 2 + 3", "answers": []}
```

It returns the full interpreter result dict plus a back-compatible `result` alias equal to `output`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Build:

```bash
cd frontend
npm run build
```

Deploy the student app on Render as a static site with:

- Build Command: `cd frontend && npm ci && npm run build`
- Publish Directory: `frontend/dist`
- SPA rewrite: `/*` to `/index.html`

See `docs/FRONTEND_MONOREPO.md` for the frontend/runtime split.

## Result Shape

`run()` and `run_sandboxed()` return dictionaries with:

- `output`: printed output and bounded error lines
- `memory`: final safe variable snapshot
- `errors`: bounded interpreter errors
- `ask` and `ask_var`: pending input request, if the program reached `ASK`
- `status`: `ok`, `error`, `limit_exceeded`, `waiting_for_input`, or `sandbox_error`
- `truncated`: whether logs or values were truncated
- `limits_hit`: limit names that were reached

## Examples

- `examples/` contains curated examples for product/curriculum use.
- `legacy/examples/` contains the full imported corpus.

Older Jargon examples often include wrappers like `Code:`, `Jargon Code:`, `Expected Output:`, and `Explanation:`. Use `jargon_examples.py` to extract the runnable part:

```python
from jargon_examples import load_example, run_example

example = load_example("examples/003_selection_sort.txt")
result = run_example(example)
```

Validate examples:

```bash
python3 tools/validate_examples.py examples legacy/examples
```

The validator infers simple canned answers for common classroom `ASK` prompts. Add `--no-smart-answers` to disable that behavior, or pass `--answer` values as extra fallbacks.

## Tests

```bash
python3 -m unittest discover -s tests -q
python3 tools/validate_examples.py examples legacy/examples
```

The suite covers normal language behavior, malformed programs, hostile expressions, resource limits, sandbox handling, deterministic fuzz input, and legacy example extraction.
