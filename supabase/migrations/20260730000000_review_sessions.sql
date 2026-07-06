-- Post-v4.0 Phase 5: first-class ad-hoc review sessions (additive, GREENFIELD, idempotent).
--
-- Chosen over relaxing learning_sessions.lesson_id NOT NULL: an exhaustive blast-radius map showed
-- that path would break the review resume query (chat/index.ts loadOrCreateSession) and force NOT
-- NULL relaxations on learning_turns + lesson_attempts too — destabilizing the live tutor's hottest
-- tables. This table is never read/written by the lesson turn loop, so it carries ZERO regression
-- risk. The spaced-repetition analytics (mode='revision' evidence + student_mastery.last_practiced_at)
-- already ship from the P4b review handler and are untouched; this only adds a durable, teacher-
-- visible SESSION record on top. lesson_id is best-effort/informational (the skill's source lesson),
-- kept as plain nullable text (no FK) so a review can exist without a lesson.

create table if not exists public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  skill_key text not null,
  tier text,
  lesson_id text,
  state jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  score numeric,
  question_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'review_sessions_status_check'
  ) then
    alter table public.review_sessions
      add constraint review_sessions_status_check
      check (status in ('active', 'complete', 'abandoned'));
  end if;
end $$;

create index if not exists review_sessions_user_updated_idx
  on public.review_sessions (user_id, updated_at desc);
create index if not exists review_sessions_user_skill_idx
  on public.review_sessions (user_id, skill_key);

alter table if exists public.review_sessions enable row level security;

revoke all on public.review_sessions from anon;
revoke all on public.review_sessions from authenticated;
grant select, insert, update on public.review_sessions to authenticated;
grant select, insert, update, delete on public.review_sessions to service_role;

-- The student manages their own review sessions (create/continue/complete/read). Mirrors the
-- student-owns pattern used by student_mastery.
drop policy if exists review_sessions_owner on public.review_sessions;
create policy review_sessions_owner on public.review_sessions
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Managing teachers/admins may READ a student's review sessions (teacher visibility). Mirrors the
-- can_view_student boundary used across the teacher surface.
drop policy if exists review_sessions_teacher_read on public.review_sessions;
create policy review_sessions_teacher_read on public.review_sessions
  for select
  to authenticated
  using (can_view_student(user_id));
