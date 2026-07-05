-- Phase 3: teacher hold/pause of the live Mentor flow (additive, idempotent).
--
-- A watching teacher can PAUSE a student's live session. The chat edge fn reads an active hold
-- (under the student's own JWT — RLS lets a student read their own hold — fail-open) and, instead
-- of running the mentor, returns a benign "your teacher paused" turn. There is at most ONE row per
-- session (unique session_id); `active` toggles true on hold / false on release. Teachers write it;
-- the student reads their own row to flip a paused banner via realtime. Nothing existing reads this
-- table, so unmigrated code is unaffected.

create table if not exists public.session_holds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique,
  student_id uuid not null,
  teacher_id uuid not null,
  class_id uuid,
  active boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists session_holds_active_idx
  on public.session_holds (session_id) where active;

alter table if exists public.session_holds enable row level security;

-- Revoke Supabase's default broad grants, then re-grant the minimum: the student/teacher read, and
-- teachers insert/update (RLS below narrows to managed students). service_role bypasses RLS.
revoke all on public.session_holds from anon;
revoke all on public.session_holds from authenticated;
grant select, insert, update on public.session_holds to authenticated;
grant select, insert, update, delete on public.session_holds to service_role;

-- The student reads their own hold (to show the paused banner); managing teachers read + write.
-- NOTE the `student_id <> auth.uid()` guard on write: can_view_student() is TRUE for the student
-- themselves, so without this a student could PATCH their own hold to active=false and release a
-- teacher's pause. The write predicate therefore requires the actor to be a teacher/admin who can
-- view the student AND is not the student. Reads are unrestricted to self (needed for the banner).
drop policy if exists session_holds_select on public.session_holds;
create policy session_holds_select on public.session_holds
  for select
  to authenticated
  using ((student_id = auth.uid()) or can_view_student(student_id));

drop policy if exists session_holds_insert on public.session_holds;
create policy session_holds_insert on public.session_holds
  for insert
  to authenticated
  with check (
    (teacher_id = auth.uid())
    and (student_id <> auth.uid())
    and can_view_student(student_id)
  );

-- Any managing teacher may toggle/release (so a co-teacher can release, and upsert-on-conflict works);
-- the student themselves may never write (the <> auth.uid() guard blocks a self-release).
drop policy if exists session_holds_update on public.session_holds;
create policy session_holds_update on public.session_holds
  for update
  to authenticated
  using ((student_id <> auth.uid()) and can_view_student(student_id))
  with check ((student_id <> auth.uid()) and can_view_student(student_id));

-- Realtime so the student's paused banner flips instantly (RLS still gates which rows they receive).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'session_holds'
    ) then
      alter publication supabase_realtime add table public.session_holds;
    end if;
  end if;
end $$;
