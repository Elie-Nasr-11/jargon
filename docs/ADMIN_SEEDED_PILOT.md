# Admin-Seeded Pilot Setup

This is the first account-management path for the classroom pilot. It is intentionally not a public signup or claim-admin flow.

## Boundary

- Platform admins use `/admin` to create or reuse organizations, classes, teacher accounts, student accounts, profiles, and memberships.
- The frontend never sees the Supabase service-role key.
- The only privileged account-creation path is the `admin-seed` Edge Function.
- Temporary passwords are sent to Supabase Auth only. Jargon records whether a password was supplied, but never stores plaintext passwords in public tables.
- Rerunning the same roster should reuse existing auth users and upsert memberships instead of duplicating people.

## One-Time Bootstrap

The first platform admin must be inserted manually after that user signs in once:

```sql
insert into public.platform_admins (user_id)
values ('<signed-in-auth-user-id>')
on conflict (user_id) do nothing;
```

After that, the platform admin can open `/admin` and seed the pilot classroom.

## Required Secret

Deploy `supabase/functions/admin-seed` with:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The service-role key must stay in Supabase Edge Function secrets only.

## Pilot Flow

1. Platform admin signs in.
2. Platform admin opens `/admin`.
3. Platform admin enters organization and class names.
4. Platform admin pastes teacher/student roster rows.
5. Platform admin provides a default temporary password or per-row passwords.
6. `admin-seed` creates or reuses Supabase Auth users.
7. `admin-seed` upserts `profiles`, `organization_memberships`, `class_memberships`, `admin_account_seed_batches`, and `admin_account_seed_entries`.
8. Teacher signs in and opens `/teacher`.
9. Teacher sees assigned class shell and roster counts.
10. Student signs in and continues using `/chat`.

## Roster Format

CSV or tab-separated text is supported. Header fields can be:

```text
email,name,role,grade,password
```

Roles are:

- `student`
- `teacher`

Example:

```text
email,name,role,grade,password
teacher@example.com,Teacher Name,teacher,,temporary123
student@example.com,Student Name,student,Grade 4,temporary123
```

## Security Expectations

- Anonymous users are rejected.
- Authenticated non-platform-admin users are rejected.
- Account creation uses service-role access only inside the Edge Function.
- Normal frontend reads continue through Supabase RLS.
- Teacher dashboard data is scoped by class membership.

## Live Smoke

After deploy:

1. Bootstrap one platform admin manually.
2. Sign into `/admin`.
3. Seed one organization, one class, one teacher, and two students.
4. Sign in as the teacher and open `/teacher`.
5. Sign in as a student and complete `lesson1` in `/chat`.
6. Confirm rows exist in Auth, `profiles`, memberships, seed batch/entries, and learning records.
