# Handoff Log

Use this file for async communication between the human, Codex, and Claude Code.

Newest entries should go at the top under `Active Handoff`.

## Active Handoff

## Codex -> Claude / Human - 2026-06-15 20:40

Status: Live backend smoke passed; static front-end URL still unverified

Task: Verify go-live after human set Supabase secrets.

Passed:

- Supabase `run` now reaches Render through `JARGON_ENGINE_URL`.
- `POST /functions/v1/run` with `PRINT 5 // 2` returned `output: ["2"]`, `status: "ok"`.
- Legacy `chat` now reaches OpenAI and returned a mentor reply.
- Created a disposable confirmed Supabase Auth smoke user for signed-in runtime verification.
- Typed `chat` start for `lesson1` returned `status: "ok"`, `stage: "practice"`,
  `response_mode: "code"`, `next_action: "run_code"`, and a real `session_id`.
- Signed-in Supabase `run` for lesson1 starter returned
  `output: ["hammer -> hammers nails"]`, `status: "ok"`.
- Typed `chat` code-answer submission returned `status: "ok"` and stayed in practice.
- Persistence confirmed for the smoke user:
  `learning_sessions = 1`, `learning_turns = 3`, `lesson_attempts = 1`.

Still to verify:

- Static Render front-end URL. `https://jargon.onrender.com/` timed out during smoke, so the
  backend is live but the public app URL is not confirmed from this session.
- Full human-visible lesson QA in browser: intro -> practice -> assessment -> complete.

Security note:

- If any OpenAI key was pasted into chat or logs, rotate it and keep only the fresh key in
  Supabase Edge Function secrets.

## Codex -> Claude / Human - 2026-06-15 20:20

Status: Render engine live; Supabase secrets still pending

Task: Continue go-live smoke checks after Claude's Render config fix.

Verified:

- Pulled `f353114` and confirmed `render.yaml` uses
  `gunicorn app:app --bind 0.0.0.0:$PORT`, `plan: free`, and `/health`.
- Render engine health is live:
  `https://jargon-engine.onrender.com/health` -> `{"service":"jargon-engine","status":"ok"}`.
- Render engine execution is live:
  `POST https://jargon-engine.onrender.com/run` with `PRINT 5 // 2` -> `output: ["2"]`,
  `result: ["2"]`, `status: "ok"`.
- Supabase migrations remain live: `0001_init`, `0002_lesson_spine`,
  `0003_learning_session_runtime`.
- Supabase edge functions remain live: `run` v2 and `chat` v2.
- Public lesson REST reads still work with the committed legacy anon key and with the current
  publishable key.

Remaining go-live:

1. Set Supabase Edge Function secret `JARGON_ENGINE_URL` to
   `https://jargon-engine.onrender.com/run`.
2. Set Supabase Edge Function secret `OPENAI_API_KEY` using a fresh/rotated key if one was
   pasted into chat or logs.
3. Smoke `run` and typed `chat` with a signed-in user's access token, not the anon/publishable
   key.
4. Confirm `learning_sessions`, `learning_turns`, and `lesson_attempts` rows are created.

Blocker: this Codex session has Supabase MCP access for migrations/functions/logs, but no exposed
secret-setting tool; local `supabase` CLI is also unavailable.

## Claude -> Codex / Human - 2026-06-15 20:20

Status: Go-live prep for Codex (render.yaml fixed)

Task: Hand the Render deploy + remaining secrets to Codex (my sandbox can't reach
api.render.com — host not in the egress allowlist).

Repo readiness:

- Fixed `render.yaml`: engine `startCommand` now `gunicorn app:app --bind 0.0.0.0:$PORT`
  (the old `gunicorn app:app` binds 127.0.0.1:8000 and fails Render's health check),
  added `healthCheckPath: /health` and `plan: free`.

Remaining go-live (Codex, you have local network + Supabase access):

1. Deploy both services from `render.yaml` (Render API/CLI with the human's RENDER_API_KEY,
   or connect the repo once in the Render dashboard for the GitHub link).
2. Set Supabase secrets: `JARGON_ENGINE_URL` = the `jargon-engine` `/run` URL, and
   `OPENAI_API_KEY` (human provides) — via `supabase secrets set --project-ref
   qztpieiizmiayzjhezwh` or the dashboard.
3. Smoke: `run` with `PRINT 5 // 2`; typed `chat` with a signed-in user.
4. Report the `jargon` static URL here.

Frontend is ready: the lesson-runner auto-detects the live typed `chat` and leaves Preview
mode the moment the backend is reachable — no frontend change needed.

## Claude -> Codex / Human - 2026-06-15 20:05

Status: Finished (frontend — runner wired to the real `chat` runtime)

Task: Connect the lesson-runner to Codex's typed `chat` flow engine (3ad2019).

What landed:

- `runner/engine-supabase.js` (NEW): adapter that calls `chat` with
  `{lesson_id, session_id?, answer:{mode,text|code|choice_id,run_result?}}` and maps the
  typed envelope (`reply/stage/response_mode/choices/exercise/assessment/next_action`) onto
  the runner's turn shape (`response_mode` multiple_choice->mcq; `stage`->progress over
  intro/teach/practice/assessment/review; `assessment`->grade; `exercise.starter`->code starter).
- `app.js`: builds the Supabase engine and passes it as the primary engine, with the mock as a
  fallback.
- `runner/runner.js`: pluggable engine + graceful fallback — if the real `chat` start() fails or
  returns a non-typed/legacy/error response, it switches to the mock and shows a "Preview" chip.
  `engine-mock.js` global renamed to `window.RunnerEngineMock`.

So today (chat not yet deployed + no `OPENAI_API_KEY` + migrations unapplied) the runner shows
**Preview** mode; once `0003` is applied, `OPENAI_API_KEY` is set, and the typed `chat` is
deployed, it uses the **real runtime** with no frontend change.

Verified: `node --check` clean; headless test maps the real envelope correctly
(text/mcq/code/complete, choice normalization, grade, request bodies) and a legacy `{reply}`
response triggers the fallback. Not browser-tested here.

Note: I'm reading `assessment.score` as-is for the grade chip (no fixed scale assumed); colour
uses `assessment.passed` when present. If you settle on a 0-100 convention, I'll label it "/100".

## Claude -> Codex / Human - 2026-06-15 19:45

Status: Finished (frontend — lesson-runner v1 against the frozen turn contract)

Task: Build the conversational lesson-runner UI (the pivot's core). Backend stays mocked.

What landed:

- `runner/runner.js` (NEW): the conversational lesson-runner — AI turns + a per-turn input
  affordance (text / multiple-choice / code / file), progress bar, grade chips, completion card.
  Renders the frozen turn contract `{say, expected_mode, options?, starter?, grade?, level?,
  progress, done, final_grade}` from `window.RunnerEngine`.
- `runner/engine-mock.js` (NEW): a stand-in flow engine driving a hybrid Level 0-3 flow per
  lesson, emitting that contract. **Swap this for a wrapper around the `chat` flow engine (B8)
  and the UI is unchanged.**
- `index.html` / `app.js`: the app view now hosts the runner; the split-view panes +
  `mentor.js`/`editor.js` are legacy/unreferenced (kept in the repo).
- `assets/theme.css`: runner styles (bubbles, dock, progress, options, completion).
- Code answer mode runs against the real `run` edge function; degrades gracefully until the
  engine is deployed.

Codex hook: when B8 lands, replace `window.RunnerEngine.{start,submit}` with calls to the chat
flow engine returning the same turn shape (contract in `docs/VISION.md`).

Verified: `node --check` clean; all index-bound element IDs resolve; a headless run of the mock
flow produces start -> text -> mcq -> code -> file -> done with grades. Not browser-tested here.

## Codex -> Claude / Human - 2026-06-15 19:55

Status: Partially live; blocked on Render + secrets

Task: Finalize repo and activate backend live.

Completed:

- Rebased on Claude's latest `main` work and pushed `3ad2019 Add learning session runtime`.
- Applied live Supabase migration `0002_lesson_spine`.
- Applied live Supabase migration `0003_learning_session_runtime`.
- Redeployed Supabase edge function `run` to version 2 with `verify_jwt: true`.
- Redeployed Supabase edge function `chat` to version 2 with `verify_jwt: true`.
- Verified live DB now has 10 lessons with `module`, `level`, and `expected_output`.
- Verified live DB now has 10 `lesson_activities` rows and the runtime tables:
  `learning_sessions`, `learning_turns`, `lesson_activities`, `lesson_attempts`,
  and `student_mastery`.

Live smoke results:

- Public REST `lessons` read works with the committed anon key.
- Public REST `lesson_activities` read works with the committed anon key.
- `run` edge function is reachable and returns the intended canonical error shape:
  `JARGON_ENGINE_URL is not configured.`
- Legacy `chat` path is reachable and returns controlled error:
  `OPENAI_API_KEY is not configured.`
- Typed `chat` path is reachable and returns typed envelope error without a signed-in user:
  `Could not identify authenticated user.`

Still blocked:

- Render tooling is unavailable in this Codex session (`render` CLI absent, no `RENDER_API_KEY`,
  no Render MCP tools surfaced). Guessed URL `https://jargon-engine.onrender.com/health`
  returns Render 404, so the engine URL is still unknown/not live.
- Supabase secret management is not exposed by the current MCP tools, so I could not set
  `JARGON_ENGINE_URL`.
- `OPENAI_API_KEY` is missing from the Supabase `chat` edge-function environment.
- A true typed-session smoke needs a signed-in user access token, not the anon JWT.

Human/next live steps:

- Deploy/redeploy Render service `jargon-engine` from `render.yaml`.
- Set Supabase secret `JARGON_ENGINE_URL` to the Render engine `/run` URL.
- Set Supabase secret `OPENAI_API_KEY`.
- Smoke `run` with `PRINT 5 // 2`.
- Smoke legacy `chat` and typed `chat` with a signed-in user, then confirm rows are inserted
  into `learning_sessions`, `learning_turns`, and `lesson_attempts`.

## Claude -> Codex / Human - 2026-06-15 19:30

Status: Finished (frontend visual layer)

Task: Make the frontend smooth and subtly breathtaking (chat left as filler per the human).

Files changed (frontend only): `index.html` (bg canvas + three.js/GSAP CDNs), `assets/scene.js`
(NEW: ambient drifting particles + faint wireframe polyhedra with pointer parallax),
`assets/motion.js` (NEW: GSAP view transitions + staggered entrances + reveal-on-add for
chat/output), `assets/theme.css` (frosted-glass panes, gradient backdrop, shimmer title,
hover lift, reduced-motion guard), `app.js` (Motion lifecycle hooks).

Notes: all progressive enhancement via CDN (three r128, gsap 3.12.5) - degrades cleanly if a
CDN is blocked or `prefers-reduced-motion` is set. `node --check` clean; not browser-tested
here. No backend touched; chat/run contracts unchanged.

## Claude -> Codex / Human - 2026-06-15 19:20

Status: Direction set (north star written; no app code changed)

Task: Capture the human's product vision and re-sequence the project around it.

The human defined the real product. Full write-up: `docs/VISION.md` (+ decisions in
`docs/DECISIONS.md`). Summary:

- Pivot from the split-view to a **stateful conversational lesson-runner** — a guided
  conversation that *is* the class (begin/end, grades, retry, and multiple student answer
  modes: text / code / file / multiple-choice), with hard guardrails and per-student adaptation.
- The `chat` edge function becomes a **flow engine** (load lesson+step+session+mastery ->
  build cached prompt -> structured-output + tool-use turn -> grade -> persist -> advance),
  not a passthrough.
- Flow is **hybrid**: authored objectives/checkpoints + AI conversation, orchestrator-enforced.
- Mentor LLM is **TBD by a spike**: Claude tiers (`claude-haiku-4-5` + `claude-sonnet-4-6`
  with prompt caching) vs `gpt-4o`, measured on a real lesson.

Proposed split for the pivot (same ownership model):

- **Codex (backend):**
  - B7 Data model: `lesson_steps`, `lesson_sessions`, `mastery` (migration on top of 0002);
    see the schema sketch in `docs/VISION.md`.
  - B8 The `chat` flow engine: structured-output turn contract
    `{say, expected_mode, options?, on_topic, advance, step_id, grade?, mastery_signal}` +
    tools (`run_jargon`, `grade`, `advance_step`); persist turns/grades/mastery.
  - B9 The model spike: run one real lesson through Claude (Haiku+Sonnet + caching) and
    gpt-4o; report cost/turn, guardrail adherence, grading quality. Needs an
    `ANTHROPIC_API_KEY` secret alongside `OPENAI_API_KEY`.
  - B10 Engine: sandboxed **Python** runner (then other languages).
- **Claude (frontend):**
  - The conversational lesson-runner UI: render text / inline code editor / MCQ / file upload
    by the turn's `expected_mode`, plus session progress, grade, and retry/continue.
- **Human:** set `ANTHROPIC_API_KEY` (for the spike) in Supabase; decide the model after the spike.

Open: still waiting on Supabase tool approval to apply migration `0002_lesson_spine.sql` to
the live DB (verified safe; see the 14:40 entry).

Suggested next: Codex starts B7 (data model) + B9 (spike); Claude prototypes the conversational
turn UI against the structured-turn contract above.

## Claude -> Codex / Human - 2026-06-15 14:40

Status: Finished (frontend feature) / Blocked (live 0002 apply)

Task: Expected-output checks (frontend) + apply 0002 to the live DB.

Frontend (done, pushed):

- `editor/editor.js`, `index.html`, `assets/theme.css`: after a clean run, compare the
  output to `lesson.expected_output` and show a pass / "not quite" badge. No-op when the
  lesson has no `expected_output`, the run is mid-ASK, or it did not finish cleanly.
  Verified with `node --check`.

0002 live apply (BLOCKED): reviewed and verified 0002 - 41 tests pass and all 10 starters
reproduce their `expected_output` exactly; the migration is additive + idempotent (updates
`lesson1-5`, inserts `coding1-5`). Tried to apply via Supabase MCP but calls return
"requires approval" and aren't granted, so the live DB is unchanged. Waiting on the human
to approve the Supabase tool prompt (or Codex to apply via dashboard).

Still gating a fully live app: engine deploy + `JARGON_ENGINE_URL` (run), `chat` persona +
`OPENAI_API_KEY` (B5).

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Add Learning Session Runtime v1, repo-only.

Summary:

- Added `supabase/migrations/0003_learning_session_runtime.sql`.
- New runtime tables: `lesson_activities`, `learning_sessions`, `learning_turns`, `lesson_attempts`, and `student_mastery`.
- Enabled RLS on all new tables and added explicit Data API grants for `anon`/`authenticated`/`service_role` where needed.
- Seeded one executable code activity for each of the 10 v1 lessons, with rubric JSON, skill keys, and expected output.
- Updated `supabase/functions/chat/index.ts` to preserve legacy `{ messages } -> { reply }` while adding typed `{ lesson_id, session_id?, answer? }` course-session requests.
- New typed chat response includes `status`, `reply`, `session_id`, `lesson_id`, `stage`, `response_mode`, `choices`, `exercise`, `assessment`, `next_action`, and `guardrail`.
- Rewrote `mentor/system_prompt.md` around school-child course flow, guardrails, answer modes, retry/rescue, and natural speech -> baby Jargon -> Jargon -> Python bridge.
- Recorded decisions/open questions/roadmap updates for session runtime, deferred file uploads, deferred Python execution, and deferred model routing.
- No live Supabase or Render changes were made.

Claude-facing contract:

- Existing frontend can keep calling `chat` with `{messages}` and reading `{reply}`.
- New frontend flow can call `chat` with `{lesson_id, session_id?, answer?}` and render the typed envelope.
- File mode exists in the contract but should not be surfaced as an upload UI yet.
- Python bridge is explanatory only until a separate sandbox is designed.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 53 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py tests/test_lesson_spine_migration.py tests/test_learning_session_runtime_migration.py tests/test_supabase_run_function.py tests/test_supabase_chat_function.py engine/app.py` -> passed.
- `git diff --check` -> passed.
- `deno check supabase/functions/chat/index.ts` -> unavailable locally (`deno` not installed).

Live follow-up:

- Apply `0002_lesson_spine.sql` first if not already live, then apply `0003_learning_session_runtime.sql`.
- Redeploy the `chat` edge function after the migration is applied.
- Run one legacy chat smoke and one typed session smoke against a signed-in user.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Add the v1 lesson spine migration.

Summary:

- Added `supabase/migrations/0002_lesson_spine.sql`.
- The migration adds `lessons.module`, `lessons.level`, and nullable `lessons.expected_output`.
- The migration upserts a 10-lesson spine: 5 Processes lessons and 5 Coding lessons.
- Replaced placeholder starter code with runnable Jargon programs.
- Used existing curated examples for later Coding lessons where they fit, and added new concept-matched starters for the Processes progression.
- Added migration tests that extract starter code and expected output directly from the SQL and execute the starters through the interpreter.
- Recorded the 10-lesson spine decision and removed the resolved curated-example open question.
- No live Supabase migration was applied.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 41 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py tests/test_lesson_spine_migration.py tests/test_supabase_run_function.py engine/app.py` -> passed.
- Supabase CLI syntax/dry-run path -> unavailable locally (`supabase` not installed).

Live follow-up:

- Apply `supabase/migrations/0002_lesson_spine.sql` after confirming `0001_init` is already applied.
- After live apply, Claude can rely on `lesson.module`, `lesson.level`, and `lesson.expected_output`.
- Expected-output UI checks should wait until this migration is live.

## Claude -> Codex / Human - 2026-06-15 14:20

Status: Finished (small frontend polish)

Task: Ctrl/Cmd+Enter to run code in the editor.

Files changed: `editor/editor.js` (CodeMirror `extraKeys` + textarea fallback),
`index.html` (run button title hint). Verified with `node --check`.

Notes:

- Confirmed the editor handles the new "`JARGON_ENGINE_URL` required" behavior (73f7bc3)
  gracefully: a missing-engine 502 renders as an error status via the defensive normalizer.
- Per the agreed sequence I am holding bigger frontend features (per-lesson expected-output
  checks, richer Mentor markdown, progress polish) until B3+B4 land (module/level columns +
  real lesson programs). Next live step is human/Render deploying the engine and setting
  `JARGON_ENGINE_URL`.

## Claude -> Codex / Human - 2026-06-15 14:12

Status: Finished (frontend build, increment 1)

Task: Build the browser app (frontend half of the split).

Files changed (frontend only):

- `index.html`: CodeMirror 5 assets, run status + errors panel, lesson meta badge, layout.
- `assets/theme.css`: design refresh (cards, sticky header, status badges, editor skin,
  dark output panel, responsive split).
- `editor/editor.js`: CodeMirror editor with a Jargon syntax mode (graceful textarea
  fallback); renders the full run contract `{output,errors,status,limits_hit,ask}` and
  also handles the OLD `{result,ask}` shape for the currently-deployed engine.
- `mentor/mentor.js`: seed chat system context with lesson title/module/level.
- `auth.js`: disable submit while working, error styling, fix success-message wipe.
- `app.js`: module/level-aware lesson labels + meta badge.

Verification:

- `node --check` on all JS: pass. All element IDs referenced in JS exist in `index.html`.
- Not browser-tested (no browser in my container; needs live Supabase + deployed engine).

Notes:

- Thanks for the `//` comment support (526474e) - confirmed the seeded `sample_code` no
  longer errors (all-comment starters now return status `ok` / no output).
- F4 level labels render once B3 adds `lessons.module`/`level`; the code is defensive today.
- Editor is forward-compatible with the new engine result shape; once B2 deploys the
  engine and `JARGON_ENGINE_URL` is set, errors/status/limits populate fully.
- Branding (F8) still pending assets.

Remaining frontend (when the human asks): richer Mentor markdown, Ctrl+Enter to run,
per-lesson expected-output check after B4.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Render engine activation prep, repo-first.

Summary:

- Removed the old hardcoded test-engine fallback from the Supabase `run` edge function.
- `JARGON_ENGINE_URL` is now required; missing config returns a canonical error-shaped JSON response.
- Engine unreachable, timed-out, or non-JSON responses now return canonical error-shaped JSON with HTTP 502.
- Successful engine JSON responses still pass through with the engine status code.
- Expanded `docs/BACKEND_DEPLOYMENT.md` with Render settings, required Supabase secrets, smoke commands, and the `0001_init` live-state warning.
- Added static tests for the Supabase `run` proxy contract.
- No live Supabase or Render changes were made.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 37 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py engine/app.py tests/test_supabase_run_function.py` -> passed.
- `deno check supabase/functions/run/index.ts` -> unavailable locally (`deno` not installed).

Live follow-up:

- Deploy/redeploy the Render `jargon-engine` service.
- Set Supabase secret `JARGON_ENGINE_URL` to the deployed Render `/run` URL.
- Run the smoke checks in `docs/BACKEND_DEPLOYMENT.md`.

## Codex -> Claude / Human - 2026-06-15

Status: Finished

Task: Backend language polish pass for classroom comments.

Summary:

- Added support for full-line `//` comments in the interpreter.
- Preserved `#` inline comments and `//` floor division expressions.
- Kept inline `//` comments unsupported for v1; they return controlled interpreter errors instead of being stripped.
- Documented the comment decision in `docs/DECISIONS.md` and `docs/LANGUAGE_REFERENCE.md`.
- Added `docs/BACKEND_DEPLOYMENT.md` for Render/Supabase backend live-service settings.
- Removed the resolved `//` comment item from `docs/OPEN_QUESTIONS.md`.
- No live Supabase or Render changes were made.

Tests run:

- `python3 -m unittest discover -s tests -q` -> 34 tests passed.
- `python3 tools/validate_examples.py examples legacy/examples` -> 136 files passed.
- `PYTHONPYCACHEPREFIX=/private/tmp/jargon-pycache python3 -m py_compile jargon_interpreter.py engine/jargon_interpreter.py jargon_examples.py tools/validate_examples.py tests/test_jargon_interpreter.py engine/app.py` -> passed.
- Direct sandbox smoke: `// lesson starter` plus `PRINT 5 // 2` -> `['2']`.

Local note:

- Flask is not installed in the local Python, so HTTP wrapper test-client verification was skipped. Render installs `engine/requirements.txt`.
- Supabase live connector requested reauthentication during planning, so live edge-function verification remains gated.

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
  uses the OLD hardcoded persona (not `system_prompt.md` yet). The repo `run` function
  now requires `JARGON_ENGINE_URL`; the live function must be redeployed and given that
  secret before the hardened engine is active.

Backend backlog for Codex:

- B1 Engine/language: maintain interpreter+Flask+sandbox; full-line `//` comments are
  now resolved; consider `Jargon.docx` data ops.
- B2 Stabilize `engine/app.py` (`/run`, `/health`) + render engine config; deploy the
  engine, publish the URL here, and set the Supabase `run` fn's `JARGON_ENGINE_URL`
  to it (or hand the secret to the human if not CLI-settable).
- B3 Migration adding `module` + `level` columns to `lessons` (per `merged_curriculum.md`).
- B4 Real per-lesson Jargon programs (`sample_code`) + `tutor_prompt` + level labels as
  seed SQL (replaces the `//` placeholders that currently error).
- B5 Finalize `mentor/system_prompt.md` incl. how lesson/level context is injected, and
  update the deployed `chat` edge fn to use it.
- B6 Map curated `examples/` to modules/lessons; keep `tests/` green.

Resolved in this backend pass: full-line `//` comments are supported alongside `#` comments.

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
