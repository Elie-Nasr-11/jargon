# Pilot Operations

This runbook is for running a real classroom pilot before external school integrations exist.
The goal is simple: know whether the class is ready, fix account issues quickly, and export a
scoped snapshot when a teacher or admin needs to inspect the state of the room.

## Access Model

- Platform admins use `/admin` to see all organizations and classes.
- Org admins use `/admin` to see only their own organization.
- Teachers use `/teacher` for classroom progress, evidence, assignments, resources, and live help.
- Students use `/chat`.
- Bulk roster seeding stays platform-admin-only for now.
- Passwords are never stored in Jargon tables. Reset flows send temporary passwords only to
  Supabase Auth through the privileged Edge Function.

## Classroom Launch Checklist

Before a class runs:

1. Confirm the organization exists and is active.
2. Confirm the class exists and is active.
3. Confirm at least one active teacher membership.
4. Confirm active student memberships.
5. Confirm published lessons are available.
6. Confirm at least one assigned activity or published resource if the pilot needs prepared work.
7. Confirm no recent runtime errors are blocking code/chat.
8. Confirm no open intervention alerts require teacher review.
9. Export the class CSV snapshot if the school needs a roster/progress record.
10. Copy login instructions from `/admin` and share them without passwords.

## Pilot Readiness Status

- `Ready`: roster, lessons, and support signals look usable.
- `Needs setup`: the class is missing preparation such as published lessons, assigned work, or
  resources.
- `Needs attention`: students can probably run, but recent runtime errors or open interventions
  need review.
- `Blocked`: the class lacks an active teacher or active students.

Readiness is deterministic. It is based on database records, not AI guesses.

## Account And Reset Flow

1. Platform admin seeds or reuses accounts with `/admin`.
2. Admins can reset a temporary password from the class roster.
3. The temporary password is sent to Supabase Auth only.
4. The reset writes an `audit_events` row with `password_supplied: true`, not the password.
5. Students and teachers sign in at `https://jargon-9bv5.onrender.com/login`.

## Exports

`/admin` can export a class snapshot CSV. The export is scoped:

- platform admins can export any class;
- org admins can export only classes in their organization.

The CSV includes roster identity, membership status, last sign-in, completed lessons, active
session count, assignment counts, and open alert counts. It does not include passwords.

## Classroom Smoke Path

Use this after deployment or before a demo:

1. Platform/admin opens `/admin`.
2. Confirm Pilot Readiness loads.
3. Select a class and confirm the checklist makes sense.
4. Export CSV and inspect that it is scoped and password-free.
5. Sign in as a teacher and open `/teacher`.
6. Confirm the class readiness strip shows roster, open work, latest completions, and alerts.
7. Sign in as a student and complete a lesson in `/chat`.
8. Return to `/admin` and refresh readiness.
9. Confirm completion counts and support signals update.

## Troubleshooting

- If `/admin` is blocked, confirm the user has `platform_admins` or active
  `organization_memberships.role = org_admin`.
- If readiness is empty, confirm `admin-ops` is deployed and Edge Function secrets are present:
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- If a class is `Blocked`, fix active teacher/student memberships first.
- If export fails, confirm the selected class belongs to the caller's admin scope.
- If recent runtime errors appear, inspect `runtime_events` and the Supabase Edge Function logs.
