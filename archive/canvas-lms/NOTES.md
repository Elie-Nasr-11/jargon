# Canvas LMS integration — archived 2026-09-03 (R102)

**Was:** `supabase/functions/canvas/index.ts` — 2,046 lines, 16 actions.
**Now:** `archive/canvas-lms/function/index.ts`, byte-identical.

## What it did

A full read-and-write bridge to a school's Canvas instance, per-institution (each connection
stores its own `base_url`, since Canvas is self-hosted per school):

- **`start_oauth` / `oauth_callback`** — teacher or org-admin OAuth2 against the school's
  Canvas, storing tokens in `canvas_connections`.
- **`list_courses` / `preview_roster` / `import_course`** — read the Canvas course list,
  preview who is in it, and import a course and its roster into Jargon. Jargon stays the
  learning source of truth; Canvas is a directory.
- **`list_mappings` / `upsert_grade_link` / `list_grade_targets` / `delete_grade_link`** —
  map a Jargon assignment or assessment onto a Canvas assignment column.
- **`push_grades`** — write Jargon grades back into those columns.
- **`sync` / `set_sync_enabled`** — the recurring roster reconciliation, logged to
  `canvas_sync_runs`.
- **`disconnect`, `diagnose`** — teardown and a health probe.

## Why it left

It was never reachable. Not one of the 16 actions had a caller anywhere in
`frontend/src` — the integration was built backend-first and the UI was never written.
All five tables (`canvas_connections`, `canvas_course_mappings`, `canvas_user_mappings`,
`canvas_grade_links`, `canvas_sync_runs`) hold zero rows and always have.

This is a "finished the hard half, never did the easy half" removal, not a failed feature.
The code is believed sound; it has simply never run against a real Canvas.

## What is still live that it needs

- **Its tables and RLS**, created by `supabase/migrations/20260628000000_canvas_integration.sql`,
  still in the deploy list. A restore needs no migration.
- **`class_memberships`, `classes`, `courses`, `assignments`, `assessments`** — unchanged
  in shape since this was written, as far as the R102 audit could tell.
- **The deployed function itself.** Owner's decision 2026-09-03: `canvas` stays deployed
  (v17) rather than being deleted. Its source left this repo, but the last build is live.
  Restoring therefore means "put the source back so it can be updated again", not "deploy
  it from scratch".
- **Env vars** (names only): the Canvas OAuth client id and secret, deliberately kept set,
  since the function is still deployed.

## What changed underneath it since

- **Auth** moved on. This function predates the `assertCanViewClass` / `assertCanViewStudent`
  pattern that `cognition-scorer` uses; it rolls its own authorization. Restoring it is a
  good moment to bring it onto the shared doors.
- **Class scoping** hardened in R43: a class's catalog is now exactly its linked courses
  (`class_courses`), and an empty link set means no scoping. An importer that creates
  classes must create those links too.
- The frontend now lazy-loads every route (R82). Any UI you write for this belongs behind
  the admin or teacher chunk, not in the shared one.

## To restore

1. `git mv archive/canvas-lms/function supabase/functions/canvas`
2. In `.github/workflows/deploy-backend.yml`, re-add under the paths filter:
   `      - "supabase/functions/canvas/**"`
   and next to the other deploys:
   `          supabase functions deploy canvas --project-ref "$PROJECT_REF" --no-verify-jwt`
3. Write the UI. That is the actual work — there has never been one.
4. `deno check` it with the usual harness before shipping.
