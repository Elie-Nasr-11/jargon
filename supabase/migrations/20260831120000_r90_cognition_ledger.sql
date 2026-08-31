-- R90: the cognition ledger (docs/COGNITION.md). Applied to production 2026-08-31
-- via the management API; kept here so the repo remains the schema's source of truth.
--
-- One row per SCORED constructed student response, judged in the context of the
-- assistance immediately before it, plus a per (user, lesson) rollup the console
-- lists read. Written only by the cognition-scorer edge function (service role);
-- read by teachers who share an active class with the student, org admins, and
-- platform admins. No column anywhere holds a single composite percentage.

create table if not exists public.cognition_turn_scores (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references public.learning_turns(id) on delete cascade,
  session_id uuid not null,
  user_id uuid not null,
  lesson_id text not null,
  stage text,
  objective text not null default '',
  -- Rubric dimensions, 0-4. NULL means "not assessable on this response" — a
  -- two-word answer has no assessable organization, and NULL is not a zero.
  retrieval smallint check (retrieval between 0 and 4),
  organization smallint check (organization between 0 and 4),
  reasoning smallint check (reasoning between 0 and 4),
  elaboration smallint check (elaboration between 0 and 4),
  vocabulary smallint check (vocabulary between 0 and 4),
  expression smallint check (expression between 0 and 4),
  independence smallint check (independence between 0 and 4),
  metacognition smallint check (metacognition between 0 and 4),
  -- §13: the assistance level of the mentor turn(s) immediately before this response.
  scaffold_level smallint not null default 0 check (scaffold_level between 0 and 5),
  -- Short verbatim quotes per dimension + what was AI-supplied vs student-originated.
  evidence jsonb not null default '{}'::jsonb,
  -- §12 quantitative underlay (word count, propositions, self-corrections, ...).
  -- Supporting data, never presented as the score.
  signals jsonb not null default '{}'::jsonb,
  -- One teacher-readable sentence about this response.
  note text not null default '',
  model text not null default '',
  rubric_version smallint not null default 1,
  created_at timestamptz not null default now(),
  -- A turn is judged once per rubric version; a future rubric v2 re-scores without
  -- erasing v1 history.
  unique (turn_id, rubric_version)
);

create index if not exists cognition_turn_scores_user_lesson_idx
  on public.cognition_turn_scores (user_id, lesson_id, created_at desc);
create index if not exists cognition_turn_scores_session_idx
  on public.cognition_turn_scores (session_id);

create table if not exists public.cognition_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  lesson_id text not null,
  retrieval smallint check (retrieval between 0 and 4),
  organization smallint check (organization between 0 and 4),
  reasoning smallint check (reasoning between 0 and 4),
  elaboration smallint check (elaboration between 0 and 4),
  vocabulary smallint check (vocabulary between 0 and 4),
  expression smallint check (expression between 0 and 4),
  independence smallint check (independence between 0 and 4),
  metacognition smallint check (metacognition between 0 and 4),
  -- Scaffold trend: mean S-level over the earlier and the recent half of scored
  -- responses. The desired trajectory is recent < earlier (§14).
  scaffold_earlier numeric,
  scaffold_recent numeric,
  -- The teacher paragraph: what they understand, what they confuse, what to do next.
  narrative text not null default '',
  turns_scored integer not null default 0,
  model text not null default '',
  rubric_version smallint not null default 1,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

alter table public.cognition_turn_scores enable row level security;
alter table public.cognition_profiles enable row level security;

-- Readers: a teacher sharing an active class with the student; an org admin of an
-- organization the student is an active member of; a platform admin. Writes have no
-- policy at all — only the service role (which bypasses RLS) writes these rows.
create policy cognition_turn_scores_read on public.cognition_turn_scores
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
    or exists (
      select 1 from public.class_memberships t
      join public.class_memberships s on s.class_id = t.class_id
      where t.user_id = auth.uid() and t.role = 'teacher' and t.status = 'active'
        and s.user_id = cognition_turn_scores.user_id
        and s.role = 'student' and s.status = 'active'
    )
    or exists (
      select 1 from public.organization_memberships oa
      join public.organization_memberships so on so.organization_id = oa.organization_id
      where oa.user_id = auth.uid() and oa.role = 'org_admin' and oa.status = 'active'
        and so.user_id = cognition_turn_scores.user_id and so.status = 'active'
    )
  );

create policy cognition_profiles_read on public.cognition_profiles
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
    or exists (
      select 1 from public.class_memberships t
      join public.class_memberships s on s.class_id = t.class_id
      where t.user_id = auth.uid() and t.role = 'teacher' and t.status = 'active'
        and s.user_id = cognition_profiles.user_id
        and s.role = 'student' and s.status = 'active'
    )
    or exists (
      select 1 from public.organization_memberships oa
      join public.organization_memberships so on so.organization_id = oa.organization_id
      where oa.user_id = auth.uid() and oa.role = 'org_admin' and oa.status = 'active'
        and so.user_id = cognition_profiles.user_id and so.status = 'active'
    )
  );

grant select on public.cognition_turn_scores to authenticated;
grant select on public.cognition_profiles to authenticated;
