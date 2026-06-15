# Jargon

Jargon is a unified learning platform for structured thinking and pseudocode. It combines:

- Mentor: a logic coach and Python bridge.
- Interpreter: a deterministic runtime for the custom Jargon language.
- Curriculum: Processes, Coding, and Prompting lessons with mixed-audience level labels.

The platform uses Supabase for auth/data/edge functions and Render for hosting the static site plus the Python engine.

## Architecture

```text
Render Static Site -> front-end (HTML/CSS/JS)
        |
        | supabase-js
        v
Supabase
  - Auth
  - Postgres: lessons, profiles, chat_messages, code_submissions
  - Edge Functions
      - chat -> OpenAI gpt-4o
      - run  -> proxy to JARGON_ENGINE_URL
                    |
                    v
            Render Python service: engine/app.py
```

## Structure

```text
jargon/
  index.html
  app.js
  auth.js
  config.js
  assets/theme.css
  mentor/
    mentor.js
    system_prompt.md
  editor/editor.js
  engine/
    app.py
    jargon_interpreter.py
    requirements.txt
  examples/
  legacy/examples/
  docs/
  supabase/
  tests/
  tools/
```

## Working With Agents

Codex and Claude Code coordinate through repo files. Start with:

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

Backend live-service wiring notes are in `docs/BACKEND_DEPLOYMENT.md`.

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
- `legacy/examples/` contains the full imported 131-file corpus.

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
