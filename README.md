# Jargon

Jargon is a small teaching-oriented pseudocode language for learning structured logic before moving into Python. It is designed for clear classroom programs: variables, lists, conditions, loops, input prompts, and printed output.

This repository contains the hardened interpreter, sandbox runner, tests, and compatibility tools for the older example corpus.

## Current Shape

- `AGENTS.md`, `CLAUDE.md`, and `CODEX.md` define cross-agent coordination rules.
- `jargon_interpreter.py` contains the engine and `run_sandboxed()` entrypoint.
- `jargon_examples.py` loads older lesson/example `.txt` files and extracts runnable Jargon code.
- `tools/validate_examples.py` runs a folder of examples as a smoke-test corpus.
- `tests/` contains regression, hardening, fuzz, sandbox, and example-loader tests.
- `docs/` explains the language and the project history.

## Working With Agents

Codex and Claude Code coordinate through repo files. Start with:

- `AGENTS.md`
- `docs/HANDOFF.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`
- `docs/OPEN_QUESTIONS.md`

## Quick Start

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

## Result Shape

`run()` and `run_sandboxed()` return dictionaries with:

- `output`: printed output and bounded error lines
- `memory`: final safe variable snapshot
- `errors`: bounded interpreter errors
- `ask` and `ask_var`: pending input request, if the program reached `ASK`
- `status`: `ok`, `error`, `limit_exceeded`, `waiting_for_input`, or `sandbox_error`
- `truncated`: whether logs or values were truncated
- `limits_hit`: limit names that were reached

## Example Files

Older Jargon examples often include wrappers like `Code:`, `Jargon Code:`, `Expected Output:`, and `Explanation:`. Use `jargon_examples.py` to extract the runnable part:

```python
from jargon_examples import load_example, run_example

example = load_example("examples/071_Selection_Sort.txt")
result = run_example(example)
```

Validate a folder:

```bash
python3 tools/validate_examples.py /path/to/examples
```

The validator infers simple canned answers for common classroom `ASK` prompts. Add `--no-smart-answers` to disable that behavior, or pass `--answer` values as extra fallbacks.

## Tests

```bash
python3 -m unittest discover -s tests -q
```

The current suite covers normal language behavior, malformed programs, hostile expressions, resource limits, sandbox handling, deterministic fuzz input, and legacy example extraction.
