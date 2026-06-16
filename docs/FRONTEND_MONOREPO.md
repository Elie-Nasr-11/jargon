# Frontend Monorepo

This repository now carries two layers:

- the hardened Jargon interpreter and Python-side tooling at the repo root
- a new framework frontend app under `frontend/`

## Frontend App

The frontend app is a Vite + React + TypeScript workspace that takes visual and interaction cues from the public `jargon-ai-tutor` repo, but it is wired to the live Jargon runtime:

- Supabase auth
- `lessons`, `lesson_activities`, `learning_sessions`, `learning_turns`, and `lesson_attempts`
- typed `chat` edge function
- `run` edge function for Jargon execution

JS and Python still run locally in-browser in v1. Jargon runs through the live backend.

## Local Commands

```bash
cd frontend
npm install
npm run dev
```

Build:

```bash
cd frontend
npm run build
```

## Environment

The frontend can read:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

If those are not set, it falls back to the current live public Jargon project values so development can start immediately.

## Deployment

For a static frontend deployment, publish the built `frontend/dist` output and keep a SPA fallback so `/login` and `/chat` resolve to `index.html`.

The backend remains unchanged:

- Supabase edge function `chat`
- Supabase edge function `run`
- Render-hosted Jargon engine
