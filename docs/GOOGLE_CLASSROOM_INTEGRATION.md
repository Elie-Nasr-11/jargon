# Google Classroom Integration v1

Status: repo implementation for the first Phase 12 school-integration spike.

## Scope

Google Classroom v1 is a read-only course and roster import path.

- Connect a teacher/org-admin Google Classroom account through OAuth.
- List the connected account's visible Google Classroom courses.
- Preview course teachers/students.
- Match roster rows to existing Jargon users by email.
- Import a Google course as a Jargon class.
- Upsert organization/class memberships for matched existing users.
- Record sync runs and audit events.

Jargon remains the source of truth for learning sessions, assignments, grades, mastery, evidence, and teacher dashboards.

## Not In v1

- No Google account creation.
- No Google assignment creation.
- No grade passback.
- No domain-wide delegation.
- No background sync/cron.
- No Google tokens in frontend code.

Missing Google roster users must be created through the existing Jargon admin seeding/password-reset flows, then the course can be imported again.

## OAuth Scopes

The initial connection requests only read-only Classroom scopes:

- `https://www.googleapis.com/auth/classroom.courses.readonly`
- `https://www.googleapis.com/auth/classroom.rosters.readonly`
- `https://www.googleapis.com/auth/classroom.profile.emails`

Coursework, submissions, and grade scopes stay disabled until assignment/grade export is explicitly designed.

## Required Secrets

Set these on the Supabase Edge Functions environment before live use:

- `GOOGLE_CLASSROOM_CLIENT_ID`
- `GOOGLE_CLASSROOM_CLIENT_SECRET`
- `GOOGLE_CLASSROOM_REDIRECT_URI`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`

`GOOGLE_CLASSROOM_REDIRECT_URI` should point to the live admin route, for example:

```text
https://jargon-9bv5.onrender.com/admin
```

The Google OAuth client must allow that redirect URI.

## Data Model

Migration `0014_google_classroom_integration.sql` adds:

- `google_classroom_connections`
- `google_classroom_course_mappings`
- `google_classroom_user_mappings`
- `google_classroom_sync_runs`

Token-bearing connection rows are service-role-only. The frontend reads redacted connection summaries through the `google-classroom` Edge Function.

## Edge Function

Function: `google-classroom`

Actions:

- `start_oauth`
- `oauth_callback`
- `list_courses`
- `preview_roster`
- `import_course`
- `list_mappings`
- `disconnect`

The function should be deployed with JWT verification enabled. OAuth redirects return to `/admin`, and the signed-in frontend completes the callback by sending the `code` and `state` to the Edge Function.

## Admin UI

`/admin` includes a Google Classroom panel:

1. Choose an organization.
2. Connect Google Classroom.
3. Load courses.
4. Preview roster.
5. Import selected course into Jargon.
6. Seed missing users through existing admin roster tools if needed.
7. Re-import to attach newly seeded users.

## Acceptance

- Platform admin or org admin connects Google Classroom.
- Course list loads.
- Roster preview shows teachers and students.
- Existing Jargon users are matched by email.
- Import creates or reuses a Jargon class and memberships for matched users.
- Teacher sees the imported class in `/teacher`.
- Students can still complete lessons normally.
- `google_classroom_sync_runs` records the operation.
