# Google Classroom integration — archived 2026-09-03 (R102)

**Was:** `supabase/functions/google-classroom/index.ts` — 1,189 lines, 10 actions.
**Now:** `archive/google-classroom/function/index.ts`, byte-identical.

## What it did

The same shape as the Canvas bridge, against Google Classroom:

- **`start_oauth` / `oauth_callback`** — Google OAuth2 for a teacher or org admin, stored in
  `google_classroom_connections`.
- **`list_courses` / `preview_roster` / `import_course`** — pull the teacher's Classroom
  courses and rosters into Jargon classes, mapping users in
  `google_classroom_user_mappings`.
- **`export_coursework`** — publish a Jargon assignment as Classroom coursework, tracked in
  `google_classroom_coursework_mappings`.
- **`passback_grade`** — write a Jargon grade back to the Classroom submission, logged in
  `google_classroom_grade_passbacks`.
- **`list_mappings`, `disconnect`, `diagnose`.**

## Why it left

Identical to Canvas: **all 10 actions unreachable**, no frontend reference, all six tables
empty. Built backend-first, UI never written.

Of the two integrations this is the one a school is more likely to ask for — Classroom is
far more common in schools than self-hosted Canvas. If exactly one comes back, this is it.

## What is still live that it needs

- Its tables and RLS, from the Google Classroom migration, still in the deploy list.
- **The deployed function itself.** Owner's decision 2026-09-03: `google-classroom` stays
  deployed (v18) rather than being deleted. Its source left this repo, but the last build is
  live and still serves its OAuth callback.
- Env vars (names only): the Google OAuth client id and secret, plus the redirect URI —
  deliberately kept set, since the function is still deployed and the registered redirect
  URI still points at a callback it can serve.

## What changed underneath it since

Same three as Canvas: the shared authorization doors did not exist yet; R43 class scoping
means an importer must write `class_courses` links; routes lazy-load now.

## To restore

1. `git mv archive/google-classroom/function supabase/functions/google-classroom`
2. Re-add to `.github/workflows/deploy-backend.yml`:
   `      - "supabase/functions/google-classroom/**"`
   `          supabase functions deploy google-classroom --project-ref "$PROJECT_REF" --no-verify-jwt`
3. Restore `tests/test_google_classroom_integration.py` from history at `a9ded0b` if you
   want its pins back — it was left in `tests/` and rewritten to assert the archive, so
   check what it says now before overwriting.
4. Write the UI.
