-- Tutor pedagogy layer v1.
--
-- Adds the data the pedagogy-aware mentor needs: per-lesson teacher "help-level"
-- policy + integrity controls, the student's active mentor mode + a rolling
-- independence score on the session, per-evidence teaching signals, and a
-- misconception-memory table. Everything is additive, defaulted, and idempotent
-- (this file is re-applied on every backend deploy via the Management API), so
-- existing lessons/sessions keep behaving exactly as before until a teacher opts in.

-- 1. Lesson-level tutor policy (the school-governance wedge). Defaults reproduce
--    today's behavior (guided help, attempt-first, answers only after an attempt).
alter table public.lessons
  add column if not exists help_ceiling text not null default 'guided'
    check (help_ceiling in ('clarify', 'hints', 'guided', 'worked_example', 'feedback', 'study'));
alter table public.lessons
  add column if not exists require_attempt_first boolean not null default true;
alter table public.lessons
  add column if not exists final_answer_policy text not null default 'after_attempt'
    check (final_answer_policy in ('never', 'after_attempt', 'allowed'));
alter table public.lessons
  add column if not exists tutor_tone text;
alter table public.lessons
  add column if not exists tutor_pace text;
alter table public.lessons
  add column if not exists grade_band text;

-- 2. Session: the student's active mentor mode + a rolling independence score.
alter table public.learning_sessions
  add column if not exists mentor_mode text not null default 'guide'
    check (mentor_mode in ('explain', 'guide', 'quiz', 'check', 'write', 'challenge'));
alter table public.learning_sessions
  add column if not exists independence_score numeric;

-- 3. Per-evidence teaching signals -> these roll up into the independence metric.
alter table public.learning_evidence
  add column if not exists teaching_move text;
alter table public.learning_evidence
  add column if not exists hint_rung integer;
alter table public.learning_evidence
  add column if not exists attempted_before_help boolean;

-- 4. Misconception memory: recurring conceptual errors per student + skill, so the
--    tutor can "remember how the student thinks" across sessions.
create table if not exists public.student_misconceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  organization_id uuid references public.organizations on delete set null,
  skill_key text not null,
  pattern text not null,
  hint text,
  occurrences integer not null default 1,
  status text not null default 'active' check (status in ('active', 'resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, skill_key, pattern)
);

create index if not exists student_misconceptions_user_skill_idx
  on public.student_misconceptions (user_id, skill_key);

alter table public.student_misconceptions enable row level security;

-- Students own their own rows; teachers/org-admins can read their managed students'
-- (mirrors the runtime read policies added in 0011 via can_view_student).
drop policy if exists "Students manage own misconceptions" on public.student_misconceptions;
create policy "Students manage own misconceptions"
  on public.student_misconceptions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Teachers view managed misconceptions" on public.student_misconceptions;
create policy "Teachers view managed misconceptions"
  on public.student_misconceptions for select
  to authenticated
  using (public.can_view_student(user_id));

grant select, insert, update, delete on public.student_misconceptions to authenticated;
grant select, insert, update, delete on public.student_misconceptions to service_role;
