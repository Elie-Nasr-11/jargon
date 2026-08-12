# Backend Deployment Checklist

Use this checklist when wiring the repo-first backend work to live services.

## Handoff Output

Fill this in after the live Render engine is created:

- Render engine `/run` URL: `https://jargon-engine.onrender.com/run`
- Render engine `/health` URL: `https://jargon-engine.onrender.com/health`
- Supabase project: `qztpieiizmiayzjhezwh`
- Supabase `run` edge function points to current engine: `YES - signed-in smoke returned output ["hammer -> hammers nails"]`
- Supabase migrations applied live: `0001_init`, `0002_lesson_spine`, `0003_learning_session_runtime`
- Supabase edge functions deployed live: `run` v2, `chat` v2
- Supabase `chat` OpenAI secret: `YES - legacy chat and typed lesson chat returned status ok`
- Render static front-end URL: `https://jargon-9bv5.onrender.com/` (verified 2026-08-04:
  serves the current Vite bundle, and files under `frontend/public/` — e.g.
  `/readings/*.pdf` — are served directly, ahead of the SPA catch-all rewrite).
  NOT `jargon.onrender.com`, which still answers with an unrelated legacy CRA app.

## Render

`render.yaml` defines two services. For the backend engine service, use:

- Name: `jargon-engine`
- Runtime: Python
- Root directory: `engine`
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app --bind 0.0.0.0:$PORT`
- Health check target: `GET /health`

The engine service exposes:

- `GET /` redirects to `JARGON_APP_URL` when set, otherwise returns diagnostic JSON.
- `GET /health`
- `POST /run` with `{ "code": "...", "answers": [], "preset_answers": {}, "limits": {} }`

Required Render environment variables: none.

- Optional engine environment variables:
  - `JARGON_TIMEOUT_SECONDS` controls sandbox timeout; default is `2`.
  - `JARGON_MEMORY_MB` controls sandbox memory; default is `128`.
  - `JARGON_APP_URL` controls where `GET /` redirects. Set this only after the
    correct public student-app URL is verified.

## Supabase

- Live project `qztpieiizmiayzjhezwh` already has migration `0001_init` applied. Do not re-run it.
- Apply `supabase/migrations/0002_lesson_spine.sql` next to add `module`, `level`, `expected_output`, and the 10-lesson starter spine.
- Future schema changes must continue as new migrations.
- Required secret for `run`: `JARGON_ENGINE_URL`, pointing to the Render engine `/run` endpoint.
- Required secret for `chat`: `ANTHROPIC_API_KEY` (Claude is the default tutor provider).
  `OPENAI_API_KEY` still powers the legacy path and the fallback: if the resolved
  provider's key is missing but the other's exists, the gateway falls back rather than
  failing every turn — so a deploy before the Anthropic key is set keeps running on OpenAI.
- Optional `chat` environment variables (defaults in parentheses):
  - `TUTOR_PROVIDER` (`anthropic`) — set `openai` to run the legacy OpenAI path.
  - `TUTOR_MODEL_CONVERSATION` (`claude-opus-5` on Anthropic, `gpt-4o` on OpenAI) — the
    student-facing mentor model. A model pinned for the wrong provider's family is
    ignored in favor of the provider default, so a stale pin can never 404 every turn.
  - `TUTOR_MODEL_UNDERSTANDING` (`claude-haiku-4-5` / `gpt-4o-mini`) — the cheap
    grader/summarizer route.
  - `TUTOR_EFFORT_CONVERSATION` (`medium`) and `TUTOR_EFFORT_UNDERSTANDING` (`low`) —
    Claude effort levels (`low`–`max`); tutoring wants snappy turns, and Claude Opus 5
    stays strong at medium. Ignored on models without the effort parameter.
  - `TUTOR_MAX_OUTPUT_TOKENS` (`8192`) — Claude output cap (reply JSON + adaptive
    thinking headroom).
  - `TUTOR_TEMPERATURE_DEFAULT` (`0.6`) — OpenAI path only; current Claude models
    reject sampling parameters.
- The mentor's static system prompt and the step-stable half of the turn payload carry
  Anthropic `cache_control` breakpoints: turns after a step's first read them from cache
  (~0.1x input price, faster first token). No configuration required.
- The `run` edge function should continue forwarding `{ code, answers }` and passing the engine result through unchanged.
- The expected engine response includes `output`, `memory`, `errors`, `ask`, `ask_var`, `status`, `truncated`, `limits_hit`, and the compatibility alias `result`.
- If `JARGON_ENGINE_URL` is missing, `run` should fail loudly with a canonical error-shaped JSON response rather than using any fallback engine.

## Live Verification

Set these local shell variables first:

```bash
export RENDER_ENGINE_BASE_URL="https://<render-engine-host>"
export SUPABASE_URL="https://qztpieiizmiayzjhezwh.supabase.co"
export SUPABASE_ANON_KEY="<anon-or-publishable-key>"
export SUPABASE_FUNCTION_JWT="<signed-in-user-access-token>"
```

Confirm Render health:

```bash
curl -sS "$RENDER_ENGINE_BASE_URL/health"
```

Expected response:

```json
{"status":"ok","service":"jargon-engine"}
```

Confirm Render engine execution:

```bash
curl -sS "$RENDER_ENGINE_BASE_URL/run" \
  -H "Content-Type: application/json" \
  -d '{"code":"// lesson starter\nPRINT 5 // 2","answers":[]}'
```

Expected response includes:

```json
{"output":["2"],"result":["2"],"status":"ok"}
```

Set the Supabase secret after the Render `/run` URL is known:

```bash
supabase secrets set JARGON_ENGINE_URL="$RENDER_ENGINE_BASE_URL/run" --project-ref qztpieiizmiayzjhezwh
```

Confirm Supabase edge-function execution:

```bash
curl -sS "$SUPABASE_URL/functions/v1/run" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_FUNCTION_JWT" \
  -d '{"code":"// lesson starter\nPRINT 5 // 2","answers":[]}'
```

Expected response includes:

```json
{"output":["2"],"result":["2"],"status":"ok"}
```

Then check Supabase edge-function logs after one successful run and one controlled-error run.
