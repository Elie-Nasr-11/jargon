# Canvas LMS Integration

Status: C1 (connect + import), C2 (create accounts on import), C3 (grade
passback), and C4 (ongoing scheduled sync) implemented, mirroring the Google
Classroom spike. Built per the integrations plan (Canvas native, phased C1-C4 +
Campus Live fallback).

Canvas is per-institution, so each connection stores the institution **base URL**
(e.g. `https://school.instructure.com`). The OAuth flow and every API call are
scoped to that base URL.

## Phases

- **C1 - Connect + import (done).** Read-only OAuth2, course/roster preview,
  import a Canvas course as a Jargon class, link matched existing users.
- **C2 - Create accounts on import (done).** Optionally provision missing
  student/teacher accounts during import (admin-only), reusing the `admin-seed`
  account shape (email-confirmed Auth user + profile row + seeded-role metadata),
  instead of only linking existing users.
- **C3 - Grade passback (done).** Map Jargon graded work to a Canvas assignment and
  push scores via `PUT /api/v1/courses/:id/assignments/:id/submissions/:user_id`
  (`submission[posted_grade]`). Uses the pre-declared `canvas_grade_links` table +
  `push_grades` action.
- **C4 - Ongoing sync (done).** A daily GitHub Actions job calls the `canvas`
  edge function's `sync` action, which sweeps every active connection to refresh
  rosters and re-push grades, recording each run in `canvas_sync_runs` (`sync`
  action). Includes a manual "Sync now" button and a per-connection auto-sync
  opt-out.

## C1 + C2 Scope

Canvas C1/C2 is a read-only course and roster import path, with optional account
provisioning.

- Connect a teacher/org-admin Canvas account for an institution through OAuth2.
- List the connected account's active Canvas courses.
- Preview course teachers/students.
- Match roster rows to existing Jargon users by email.
- Import a Canvas course as a Jargon class.
- Upsert organization/class memberships for matched existing users.
- **C2:** optionally create accounts for unmatched roster members during import.
- Record sync runs and audit events.

Jargon remains the source of truth for learning sessions, assignments, grades,
mastery, evidence, and teacher dashboards.

## C2 - Account Creation

When the admin checks "Create Jargon accounts for unmatched roster members" and
supplies a shared temporary password (>= 6 chars), `import_course` provisions a
new Jargon account for each roster row whose email has no existing Jargon user:

- Email-confirmed Auth user (`/auth/v1/admin/users`) with `name` metadata and
  `app_metadata.jargon_seeded_role`, plus a `profiles` row - the same shape the
  `admin-seed` function uses.
- The new user is then linked into the org + class like a matched user.
- The response returns `created_accounts` (email/role/user_id, no passwords) and
  `creation_errors`; the sync run records `counts.created` and per-row errors.

Account creation is **admin-only**: it is rejected for teacher-level Canvas
connections (only platform/org admins). The admin chooses the temporary password,
so no secret is generated or returned; new users should change it after first
sign-in. Roster rows without a usable email cannot be created and remain "missing"
(seed them via the existing admin roster tools, then re-import).

## C3 - Grade Passback

Link a Jargon graded item to a Canvas assignment, then push scores. Scores are
sent as a **percentage** of the Canvas assignment's points (Canvas converts
`submission[posted_grade]` ending in `%` against `points_possible`), which is
scale-independent and matches Jargon's own gradebook display convention:

- A Jargon score `<= 1` is a 0..1 fraction (pushed as `score * 100`%); a score
  `> 1` is already a 0..100 percent (pushed as-is).
- **Assessments:** read `assessment_recipients.final_score` (0..1) by `assessment_id`.
- **Assignments:** read `assignment_recipients.score` by `assignment_id`.
- Jargon `user_id` -> Canvas user via `canvas_user_mappings`; recipients with no
  Canvas mapping or no numeric score are skipped.

Actions (admin or teacher with org access through the connection):

- `list_grade_targets` (course_mapping_id) - returns the class's Jargon graded
  items, the course's Canvas assignments, and existing grade links.
- `upsert_grade_link` (course_mapping_id, jargon_kind, jargon_id, canvas_assignment_id)
  - validates the Jargon item is in the mapped org/class, then upserts a link.
- `delete_grade_link` (grade_link_id).
- `push_grades` (grade_link_id for one link, or course_mapping_id for all links of
  a course) - PUTs each student's percentage; records counts (pushed/skipped/
  failed) + per-row errors in `canvas_sync_runs` and stamps `last_pushed_at`.

Requires **grade-write permission** on the connected Canvas account (and the
matching write scope if the developer key enforces scopes). The push is manual via
the admin UI for now; automatic re-push happens via the C4 scheduled sync.

## Admin UI - Grade passback

The Canvas tab has a "Grade passback" section: choose an imported Canvas course,
link each Jargon assessment/assignment to a Canvas assignment, and push grades per
link or all at once. Last-pushed time and push results (pushed/skipped/failed) are
shown.

## C4 - Ongoing Sync

A `sync` action keeps imported classes and grades current after the initial
import/push:

- **What one sync does for a connection:** refresh the access token, re-pull the
  roster for each active course mapping (link-only: reconcile memberships +
  `canvas_user_mappings` for already-matched users; never creates classes or
  accounts), then re-push grades for every grade link (same percentage logic as
  C3). Each connection's run is recorded in `canvas_sync_runs` with `action='sync'`
  and counts `{ courses, memberships, grades_pushed, grades_skipped, grades_failed }`.
- **Manual:** a "Sync now" button on the connection card (user-authenticated,
  scoped to that connection) — the in-sandbox/admin-testable path.
- **Automatic (system sweep):** the `sync` action with **no** user, which iterates
  every active connection that has not opted out.

### System (scheduler) auth

There is no separate cron secret. The Supabase gateway accepts the **service-role
key as a Bearer JWT**, and the edge function treats a request whose
`Authorization` is exactly `Bearer <SUPABASE_SERVICE_ROLE_KEY>` as the trusted
system caller: it skips user/actor resolution and runs the cross-connection sweep.
The service-role key grants full project access — keep it only in the scheduler's
secret store, never in the repo, client, or logs.

### Scheduler - GitHub Actions

`.github/workflows/canvas-sync.yml` runs daily (07:00 UTC; `workflow_dispatch` for
manual/test runs) and `POST`s `{"action":"sync"}` to
`${SUPABASE_URL}/functions/v1/canvas` with the service-role key as the Bearer
token. The step fails on a non-2xx response or a `"status":"error"` body.

Required **repository secrets** (Settings → Secrets and variables → Actions):

- `SUPABASE_URL` (e.g. `https://<project-ref>.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`

### Auto-sync opt-out

Each connection carries `metadata.auto_sync` (default true). The system sweep
skips connections where `auto_sync === false`. Toggle it from the connection card
("Auto-sync on schedule") — the `set_sync_enabled` action. Manual "Sync now" works
regardless of the flag.

## Not In Canvas (C1-C4)

- No Canvas assignment creation.
- No Canvas tokens in frontend code.
- No realtime/webhook sync (sync is poll-based on the daily schedule + manual).

## OAuth Scopes

Canvas OAuth2 uses the institution base URL:

- Authorize: `GET {base}/login/oauth2/auth?client_id&response_type=code&redirect_uri&state[&scope]`
- Token exchange/refresh: `POST {base}/login/oauth2/token`

Scope handling is configurable. If the developer key enforces scopes, set the
`CANVAS_SCOPES` env var (space- or comma-separated) to the enabled read scopes,
for example:

```text
url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/users url:GET|/api/v1/users/:user_id/profile
```

If `CANVAS_SCOPES` is unset, the `scope` parameter is omitted (works with
non-scoped developer keys). Write scopes for grade passback are added in C3.

## Required Secrets

Set these on the Supabase Edge Functions environment before live use:

- `CANVAS_CLIENT_ID`
- `CANVAS_CLIENT_SECRET`
- `CANVAS_REDIRECT_URI`
- `CANVAS_TOKEN_ENCRYPTION_KEY` (falls back to `GOOGLE_TOKEN_ENCRYPTION_KEY` if unset)
- `CANVAS_SCOPES` (optional; only if the developer key enforces scopes)

`CANVAS_REDIRECT_URI` should point to the live admin route, for example:

```text
https://jargon-9bv5.onrender.com/admin
```

The Canvas developer key (created per institution in Canvas Admin → Developer Keys)
must allow that redirect URI. The institution's base URL is entered in the admin UI
at connect time (not a secret).

## Data Model

Migration `20260628000000_canvas_integration.sql` adds:

- `canvas_connections` (includes `base_url`; service-role-only, token-bearing)
- `canvas_course_mappings`
- `canvas_user_mappings`
- `canvas_sync_runs` (actions include `push_grades` and `sync` for C3/C4)
- `canvas_grade_links` (reserved for C3 grade passback)

Token-bearing connection rows are service-role-only. The frontend reads redacted
connection summaries through the `canvas` Edge Function. Mapping/sync/grade-link
tables are org-admin-readable via `is_org_admin(organization_id)` RLS.

## Edge Function

Function: `canvas`

Actions:

- `diagnose` (reports which secrets are configured)
- `start_oauth`
- `oauth_callback`
- `list_courses`
- `preview_roster`
- `import_course`
- `list_mappings` (includes grade links)
- `disconnect`
- `list_grade_targets` / `upsert_grade_link` / `delete_grade_link` / `push_grades` (C3)
- `sync` (C4 — user-scoped "Sync now", or system sweep when called with the
  service-role key as the Bearer token) / `set_sync_enabled` (auto-sync opt-out)

Deploy with JWT verification enabled. OAuth redirects return to `/admin`; the
signed-in frontend completes the callback by sending the `code` and `state` to the
Edge Function. Because Google Classroom and Canvas both return `?code&state` to
`/admin`, the frontend stores a provider hint (`jargon_oauth_provider`) in
`sessionStorage` before redirect and uses it to route the callback.

## Admin UI

`/admin` includes a Canvas panel:

1. Choose an organization.
2. Enter the institution Canvas base URL.
3. Connect Canvas.
4. Load courses.
5. Preview roster.
6. (Optional, C2) Check "Create Jargon accounts for unmatched roster members" and
   set a temporary password.
7. Import selected course into Jargon.
8. Seed any remaining users through existing admin roster tools if needed, then
   re-import to attach them.

## Acceptance (C1/C2)

- Platform admin or org admin connects Canvas for an institution base URL.
- Course list loads.
- Roster preview shows teachers and students.
- Existing Jargon users are matched by email.
- Import creates or reuses a Jargon class and memberships for matched users.
- (C2) With account creation on, unmatched roster members with valid emails get
  new Jargon accounts (temp password) and are added to the class; `counts.created`
  is recorded.
- Teacher sees the imported class in `/teacher`.
- Students can still complete lessons normally.
- `canvas_sync_runs` records the operation.
- (C4) "Sync now" refreshes rosters + grades and writes a `'sync'` run; the daily
  GitHub Actions workflow (or a manual "Run workflow") syncs every active,
  opted-in connection; toggling auto-sync off makes the system sweep skip that
  connection.

## Deploy Notes

Functional verification needs a live Canvas developer key + an institution base URL
and cannot run from the build sandbox (egress). Deploy the migration + edge function
through Supabase, set the secrets above, then exercise the flow against a Canvas test
course.

For C4, redeploy the `canvas` edge function and add the GitHub Actions repository
secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). The C4 changes need **no
migration** — they reuse `canvas_sync_runs.action='sync'` and
`canvas_connections.metadata`.
