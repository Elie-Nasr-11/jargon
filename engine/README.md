# Jargon Engine

This folder contains the hardened Jargon runtime and its thin HTTP wrapper.

## Endpoints

`GET /`

Redirects to `JARGON_APP_URL` when that environment variable is set. If it is
not set, returns a small diagnostic JSON response identifying the engine API.

`GET /health`

Returns:

```json
{"status": "ok", "service": "jargon-engine"}
```

`POST /run`

Request:

```json
{
  "code": "PRINT 2 + 3",
  "answers": [],
  "preset_answers": {}
}
```

Response:

- Full `run_sandboxed()` result dict
- Back-compatible `result` alias equal to `output`

## Local Run

```bash
cd engine
python3 -m pip install -r requirements.txt
python3 app.py
```

The Supabase `run` edge function should point `JARGON_ENGINE_URL` at this
service's `/run` URL when deployed on Render.

Set `JARGON_APP_URL` on the Render engine only after the correct public
student-app URL has been verified.
