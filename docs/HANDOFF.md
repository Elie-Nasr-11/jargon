# Handoff Log

Use this file for async communication between the human, Codex, and Claude Code.

Newest entries should go at the top under `Active Handoff`.

## Active Handoff

## Claude -> Codex / Human - 2026-06-15 13:10

Status: Finished (scoping pass; no code changed)

Task: Reconcile the already-deployed cloud platform with the Codex rebuild and set shared direction.

Key context Codex did not have:

- A platform is already deployed.
- Supabase project `qztpieiizmiayzjhezwh` is active with schema/RLS migration applied, 5 seeded lessons, and live edge functions `chat` (OpenAI `gpt-4o`) and `run` (proxy to `JARGON_ENGINE_URL`).
- Front-end and `render.yaml` are on branch `claude/happy-johnson-wseex8`.
- The web runner is partly built; do not build a competing auth/persistence backend.

Decisions made with the human:

- Backend: keep Supabase + Render. The hardened interpreter becomes the Render engine that the existing Supabase `run` edge function calls.
- Division of labor: Codex owns engine/interpreter/examples/curriculum extraction; Claude owns front-end/platform/Supabase/Render wiring.
- Repo: one repo, `jargon`. Interpreter lives in `engine/` with a thin Flask wrapper; platform lives at root; both branches merge to `main`.
- Result shape: standardize on `run()` dict `{output,memory,errors,ask,ask_var,status,truncated,limits_hit}`. Flask wrapper also exposes `result = output` for existing `editor.js` compatibility.
- Curriculum: merge the 5 deployed lessons (Purpose, Systems & Signals, Signal Processing, Memory, Exchanging Signals) into the Processes/Coding/Prompting modules. Audience is mixed, with level labels.
- Mentor: rebuild as "logic coach + Python bridge" (natural speech -> pseudocode -> Jargon -> Python), as a teaching layer over the runtime, not the runtime.

Requests for Codex:

1. Commit a thin Flask wrapper in `engine/` (`POST /run {code,answers}` -> result dict with `result=output` alias; `GET /health`) using `run_sandboxed()`.
2. Commit `examples/` plus the full 131-file corpus under `legacy/examples/`.
3. Commit the curriculum docs (`Jargon Modules Overview` + `Jargon.docx`) as text/Markdown in `docs/`.
4. Surface the archive Jargon Mentor system prompt into the repo so Claude can rebuild the chat layer around it.

Open/deferred:

- Comment syntax (`//` vs `#`) is deferred. The deployed lessons currently use `//`, which the interpreter rejects.

Suggested next task for Codex:

- Complete items 1-4 above, starting with the Flask wrapper.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Apply Claude's scoping handoff into the canonical repo.

Summary:

- Integrated the Supabase/Render platform files from `origin/claude/happy-johnson-wseex8`.
- Moved the hardened interpreter into `engine/` and left a top-level import shim for compatibility.
- Added a Flask engine wrapper at `engine/app.py` using `run_sandboxed()` with `result = output` alias and `/health`.
- Imported curated examples into `examples/` and the full 131-file corpus into `legacy/examples/`.
- Extracted curriculum docs into Markdown under `docs/curriculum/`.
- Surfaced the archived Jargon Mentor prompt at `mentor/system_prompt.md`.
- Updated decisions and open questions to match the agreed Supabase + Render direction.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 31 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py engine/app.py` -> passed.

Local note:

- Flask is not installed in the local system/bundled Python, so the HTTP wrapper was syntax-checked but not exercised through a local Flask test client. Render installs `engine/requirements.txt`.

Suggested next task:

- Claude can continue front-end/platform wiring against `engine/app.py` and `mentor/system_prompt.md`.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Set up cross-agent coordination.

Summary:

- Added shared agent protocol files: `AGENTS.md`, `CLAUDE.md`, and `CODEX.md`.
- Added coordination docs: `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, and `docs/OPEN_QUESTIONS.md`.
- The canonical repo currently has a hardened interpreter, example loader, docs, and validation tooling.

Tests run:

- `python3 -m unittest discover -s tests -q`
- `python3 tools/validate_examples.py /Users/elias/Desktop/jargon/02-examples /Users/elias/Desktop/jargon/03-web-runners/Jargonn/130`

Suggested next task:

- Rebuild the web runner/API around the stable `StructuredJargonInterpreter.run()` result shape.

## Archive

Earlier context:

- Desktop folder was organized into canonical, legacy Python, examples, web runners, docs, notebooks, branding, archives, and misc assets.
- Canonical repo was rebuilt and pushed at commit `85ab0db`.
- The legacy example corpus validated cleanly after adding example extraction, smart canned ASK answers, and bounded exponentiation.
