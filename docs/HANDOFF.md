# Handoff Log

Use this file for async communication between the human, Codex, and Claude Code.

Newest entries should go at the top under `Active Handoff`.

## Active Handoff

## Claude -> Codex / Human - 2026-06-15 13:42

Status: Planning (frontend/backend split agreed with the human; no app code changed)

Decision: clean frontend/backend split.

- Claude owns FRONTEND only: the browser app (`index.html`, `app.js`, `auth.js`,
  `mentor/mentor.js`, `editor/editor.js`, `assets/theme.css`, `config.js`) plus all
  client-side calls (supabase-js auth, `functions.invoke('chat'|'run')`, and
  `from(...)` reads/writes). Claude does NOT deploy server code.
- Codex owns BACKEND: the engine (`engine/*`), the FULL Supabase tier (edge
  functions `chat` + `run`, DB schema/migrations/RLS, lessons + seed content, auth
  settings), `mentor/system_prompt.md`, curriculum docs, examples, tests, and the
  Render engine config + deployed engine URL.
- Human owns: Render deploy + secrets (`OPENAI_API_KEY`, `JARGON_ENGINE_URL`).

Frozen contract (both sides code to this):

- run: `POST /run {code, answers, preset_answers?}` -> `{output[], result(=output),
  errors[], status, ask, ask_var, memory, truncated, limits_hit}`.
- chat: client `{messages:[{role,content}]}` -> `{reply}`; persona =
  `mentor/system_prompt.md` + selected lesson `tutor_prompt` + level.
- lesson object the UI reads: `{id, position, title, module, level, tutor_prompt,
  sample_code}`. NOTE: `module` + `level` columns do not exist yet (see B3).
- client tables: `lessons` (read), `profiles`/`chat_messages`/`code_submissions` (owner RLS).

IMPORTANT - current LIVE Supabase state (so you don't double-apply):

- Project `qztpieiizmiayzjhezwh` is ACTIVE. Claude already:
  - applied migration `0001_init` (4 tables + RLS + signup trigger + 5 seeded lessons),
  - deployed edge functions `chat` and `run` (verify_jwt: true),
  - set the anon key in `config.js`.
- So `0001_init` is ALREADY applied on the live project; add NEW migrations for schema
  changes (e.g. `module`/`level`), do not re-run `0001`. The deployed `chat` fn still
  uses the OLD hardcoded persona (not `system_prompt.md` yet); the `run` fn still
  defaults to the old engine until `JARGON_ENGINE_URL` is set.

Backend backlog for Codex:

- B1 Engine/language: maintain interpreter+Flask+sandbox; resolve `//` comments when
  un-deferred; consider `Jargon.docx` data ops.
- B2 Stabilize `engine/app.py` (`/run`, `/health`) + render engine config; deploy the
  engine, publish the URL here, and set the Supabase `run` fn's `JARGON_ENGINE_URL`
  to it (or hand the secret to the human if not CLI-settable).
- B3 Migration adding `module` + `level` columns to `lessons` (per `merged_curriculum.md`).
- B4 Real per-lesson Jargon programs (`sample_code`) + `tutor_prompt` + level labels as
  seed SQL (replaces the `//` placeholders that currently error).
- B5 Finalize `mentor/system_prompt.md` incl. how lesson/level context is injected, and
  update the deployed `chat` edge fn to use it.
- B6 Map curated `examples/` to modules/lessons; keep `tests/` green.

Deferred: `//` vs `#` comment syntax (affects B4 and a working demo).

Claude status: holding on all frontend code until the human says go. Frontend backlog is
ready (CodeMirror editor, error/status panel, ASK UX, level-labelled picker, Mentor chat
wiring, auth UX, responsive).

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
