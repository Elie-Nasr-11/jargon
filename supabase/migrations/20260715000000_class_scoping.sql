-- v4.0 Phase 3: class ↔ course scoping (docs/PLATFORM.md class-scoping rule).
-- Additive + idempotent (re-applied on every deploy). Links a class to the courses its students
-- should see. An empty link set for a class means NO scoping — the student catalog falls back to
-- the full published lesson list, so the LIVE student is unaffected until a teacher deliberately
-- links courses. Scoping is a UX filter, not a security boundary (lesson read-RLS stays open).

create table if not exists public.class_courses (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes on delete cascade,
  course_id text not null references public.courses on delete cascade,
  -- Defaults to the acting user so a direct authenticated write can't leave the audit column
  -- null; the write policy's WITH CHECK also pins it to auth.uid() (see below). The edge function
  -- writes as the service role and sets created_by = the resolved actor id explicitly.
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (class_id, course_id)
);

create index if not exists class_courses_class_idx
  on public.class_courses (class_id);
create index if not exists class_courses_course_idx
  on public.class_courses (course_id);

alter table if exists public.class_courses enable row level security;
-- Never reachable by the anon role (matches the per-table hardening elsewhere in the schema).
revoke all on public.class_courses from anon;
grant select, insert, update, delete on public.class_courses to authenticated;
grant select, insert, update, delete on public.class_courses to service_role;

-- Read: any active member of the class (students need this to scope their OWN catalog) plus the
-- class's org admins and platform admins — is_class_member() covers all three. A course_id is not
-- a secret (it is a published-course identifier), so member-level read is safe.
drop policy if exists class_courses_select on public.class_courses;
create policy class_courses_select on public.class_courses
  for select
  to authenticated
  using (public.is_class_member(class_id));

-- Write: the class's teachers + the class's org admins + platform admins — is_class_teacher()
-- covers all three. The curriculum-admin edge function performs writes with the service role and
-- re-checks via assertCanAuthor; this policy governs any direct authenticated-client write.
drop policy if exists class_courses_write on public.class_courses;
create policy class_courses_write on public.class_courses
  for all
  to authenticated
  using (public.is_class_teacher(class_id))
  with check (public.is_class_teacher(class_id) and created_by = auth.uid());

comment on table public.class_courses is
  'v4.0 class↔course scoping: links a class to the courses its students should see. Empty link set = no scoping (full published-catalog fallback in fetchStudentCatalog).';
