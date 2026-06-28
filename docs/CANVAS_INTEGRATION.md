# Canvas LMS Integration

Status: C1 (connect + import) and C2 (create accounts on import) implemented,
mirroring the Google Classroom spike. Built per the integrations plan (Canvas
native, phased C1-C4 + Campus Live fallback).

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
- **C3 - Grade passback.** Map Jargon graded work to a Canvas assignment and push
  scores via `PUT /api/v1/courses/:id/assignments/:id/submissions/:user_id`
  (`submission[posted_grade]`). The `canvas_grade_links` table + `push_grades`
  action/enum are pre-declared so no follow-up migration is needed.
- **C4 - Ongoing sync.** Scheduled re-sync (pg_cron / scheduled function) calling
  the `canvas` edge function per active connection, recording each run in
  `canvas_sync_runs` (`sync` action).

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

## Not In C1/C2

- No Canvas assignment creation.
- No grade passback (C3).
- No background sync/cron (C4).
- No Canvas tokens in frontend code.

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
- `list_mappings`
- `disconnect`
- `push_grades` / `sync` (C3/C4 — currently return 409 "not enabled yet")

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

## Deploy Notes

Functional verification needs a live Canvas developer key + an institution base URL
and cannot run from the build sandbox (egress). Deploy the migration + edge function
through Supabase, set the secrets above, then exercise the flow against a Canvas test
course.
