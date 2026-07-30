-- Memory v1 (docs/MVP_SCOPE.md §9): cross-session student memory (additive, GREENFIELD, idempotent).
--
-- Two tables the chat fn reads every turn and writes ONLY in a background task on the turn that
-- completes a session:
--   - session_summaries: one immutable per-session recap (unique session_id — the completing turn's
--     background writer inserts with ignore-duplicates so a double-complete can never fork history).
--   - student_memory: one rolling per-student profile row (narrative + capped lists), upserted.
-- The chat fn holds NO service key (test-pinned posture), so every policy below must let the
-- student's own JWT do the work: owner insert/select on summaries, owner insert/update/select on
-- the profile. Summaries get no UPDATE/DELETE policies at all — they are append-only history.
-- Teachers read both through the same can_view_student(user_id) boundary used across the teacher
-- surface (review_sessions, student_mastery, ...).

create table if not exists public.session_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null unique,
  lesson_id text,
  summary jsonb not null,
  created_at timestamptz not null default now()
);

-- The chat fn's read is "this student's latest summaries, newest first, excluding one session".
create index if not exists session_summaries_user_created_idx
  on public.session_summaries (user_id, created_at desc);

alter table if exists public.session_summaries enable row level security;

revoke all on public.session_summaries from anon;
revoke all on public.session_summaries from authenticated;
-- Append-only for students: no update/delete grant (and no such policies either).
grant select, insert on public.session_summaries to authenticated;
grant select, insert, update, delete on public.session_summaries to service_role;

drop policy if exists session_summaries_owner_insert on public.session_summaries;
create policy session_summaries_owner_insert on public.session_summaries
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists session_summaries_owner_select on public.session_summaries;
create policy session_summaries_owner_select on public.session_summaries
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Managing teachers/admins may READ a student's session summaries (teacher visibility).
drop policy if exists session_summaries_teacher_read on public.session_summaries;
create policy session_summaries_teacher_read on public.session_summaries
  for select
  to authenticated
  using (can_view_student(user_id));

create table if not exists public.student_memory (
  user_id uuid primary key,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table if exists public.student_memory enable row level security;

revoke all on public.student_memory from anon;
revoke all on public.student_memory from authenticated;
-- Upsert path: the student's own JWT must be able to insert the first row and update it after.
grant select, insert, update on public.student_memory to authenticated;
grant select, insert, update, delete on public.student_memory to service_role;

drop policy if exists student_memory_owner_insert on public.student_memory;
create policy student_memory_owner_insert on public.student_memory
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists student_memory_owner_update on public.student_memory;
create policy student_memory_owner_update on public.student_memory
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists student_memory_owner_select on public.student_memory;
create policy student_memory_owner_select on public.student_memory
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Managing teachers/admins may READ a student's memory profile (teacher visibility).
drop policy if exists student_memory_teacher_read on public.student_memory;
create policy student_memory_teacher_read on public.student_memory
  for select
  to authenticated
  using (can_view_student(user_id));
