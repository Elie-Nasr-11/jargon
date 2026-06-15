# Project Map

This map summarizes what was found in `/Users/elias/Desktop/jargon` during the cleanup and rebuild pass.

## Canonical Repo

`00-canonical/heres-the-jargon-interpreter-code-this`

This is the clean Git repo that was pushed to GitHub. It originally contained:

- `jargon_interpreter.py`
- `tests/test_jargon_interpreter.py`
- `tests/__init__.py`
- a stub `README.md`

The interpreter is the hardened descendant of the late Colab/runtime versions.

Current repo layout:

- Platform lives at the repo root (`index.html`, `app.js`, `auth.js`, `editor/`, `mentor/`, `assets/`).
- Supabase assets live under `supabase/`.
- Render deployment is described by `render.yaml`.
- The runtime engine lives under `engine/`.
- The root `jargon_interpreter.py` is now only a compatibility import shim.

## Python Lineage

`01-legacy-python`

- `jargon.py`: earliest Colab export. Supports `SET`, `PRINT`, `ADD`, `REMOVE`, `IF`, and `REPEAT_UNTIL`.
- `jargon_with_tests.py`: same engine plus inline algorithm demos such as sums, Dijkstra, quick-sort partition, selection sort, evens, and search.
- `StructuredJargonInterpreter copy 2.py`: later Colab export. Adds `ASK`, `BREAK`, `REPEAT n times`, `REPEAT_FOR_EACH`, indexed assignment, logical `AND`/`OR`, `is even`, `is odd`, and `is in`.
- `StructuredJargonInterpreter copy.py`: web-oriented ASK continuation attempt. Adds `awaiting_input`, `ask_prompt`, `ask_variable`, and `provide_answer()`.
- `StructuredJargonInterpreter.py`: placeholder only.

The current hardened interpreter keeps compatibility with the useful late language features, but replaces `eval()` with bounded AST evaluation and adds resource controls.

## Examples

`02-examples` and `03-web-runners/Jargonn/130`

These contain 131 `.txt` example files. They are mixed-format:

- Pure runnable Jargon files
- Lesson-wrapped files with `Code:`, `Jargon Code:`, `Expected Output:`, and `Explanation:`
- Comment-based teaching files
- ASK examples that need canned answers
- A few examples that originally exposed missing support, such as safe exponentiation

`jargon_examples.py` now extracts runnable code from the common wrapper formats, and `tools/validate_examples.py` can run the full legacy corpus.

Current repo imports:

- Curated examples: `examples/`
- Full corpus: `legacy/examples/`

## Web Runners

`03-web-runners`

There are three related experiments:

- Simple runner pages that POST code to `https://petersaba.pythonanywhere.com/run`.
- A Flask/FastAPI backend runner that executes the old interpreter.
- Netlify/OpenAI "Jargon Mentor" chat apps.

The web API contracts drifted over time:

- Some clients send `input`; others send `code`.
- Some backends return `result`; others return `output`.
- ASK handling differs between versions.
- One backend references `ask_state`, which is not present in the matching interpreter.

The current rebuild uses one stable run result shape from `StructuredJargonInterpreter.run()` and `run_sandboxed()`. The Flask wrapper in `engine/app.py` also exposes `result = output` for existing `editor.js` compatibility.

## Mentor App

`03-web-runners/Jargon_Mentor-main`

This is the richest teaching UI. It contains a long "Jargon Mentor" system prompt that frames the project as a logic coach:

- Natural speech to pseudocode
- Pseudocode to Jargon syntax
- Jargon to Python bridge
- Short, reflective teaching style

The legacy prompt has been surfaced at `mentor/system_prompt.md`. The current platform mentor pane lives at `mentor/mentor.js` and should be rebuilt around that prompt and the Supabase `chat` edge function.

## Curriculum And Docs

`04-docs`

- `Jargon Modules Overview.pdf.pdf`: directly relevant curriculum outline. Main modules are Processes, Coding, and Prompting.
- `Jargon.docx`: alternate/richer language-design notes for arrays, datasets, insert/remove/update operations, and structured data tasks.
- `Jargon.pdf`: likely visual or scan-heavy; text extraction did not return useful content.
- AI-teacher PDFs and Borges PDF: supporting/reference material, not core runtime assets.

Current repo imports:

- `docs/curriculum/modules_overview.md`
- `docs/curriculum/jargon_data_operations.md`
- `docs/curriculum/merged_curriculum.md`

## Branding

`06-branding-assets`

Contains packaged Illustrator/PDF branding, fonts, and a mockup image. The report lists:

- Poppins Regular/Bold
- Roboto Regular/Medium
- RGB/sRGB color setup

The old web UI commonly used blue `#0077cc`, magenta `#c42d88`, and greens such as `#81be79` or `#27c147`.

## Rebuild Direction

The clean direction is:

- Keep the hardened interpreter in `engine/` as the runtime core.
- Add a stable example/document loader around the old corpus.
- Add a real language reference and test corpus.
- Continue platform work around Supabase + Render and one result shape.
- Treat the mentor as a teaching layer, not as the runtime.
- Keep branding assets separate from executable code.
