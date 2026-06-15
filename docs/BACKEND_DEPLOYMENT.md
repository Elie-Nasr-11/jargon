# Backend Deployment Checklist

Use this checklist when wiring the repo-first backend work to live services.

## Render

- `jargon-engine` should deploy from `engine/`.
- Build command: `pip install -r requirements.txt`.
- Start command: `gunicorn app:app`.
- Health check target: `GET /health`.
- Optional engine environment variables:
  - `JARGON_TIMEOUT_SECONDS` controls sandbox timeout; default is `2`.
  - `JARGON_MEMORY_MB` controls sandbox memory; default is `128`.

## Supabase

- `JARGON_ENGINE_URL` must point to the Render engine `/run` endpoint.
- `OPENAI_API_KEY` must be configured for the `chat` edge function.
- The `run` edge function should continue forwarding `{ code, answers }` and passing the engine result through unchanged.
- The expected engine response includes `output`, `memory`, `errors`, `ask`, `ask_var`, `status`, `truncated`, `limits_hit`, and the compatibility alias `result`.

## Live Verification

- Confirm Render `GET /health` returns `{"status":"ok","service":"jargon-engine"}`.
- Run a Supabase `run` edge-function call with full-line `//` starter comments and `PRINT 5 // 2`.
- Check Supabase edge-function logs after one successful run and one controlled-error run.
