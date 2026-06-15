# Jargon Engine

This folder contains the hardened Jargon runtime and its thin HTTP wrapper.

## Endpoints

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
