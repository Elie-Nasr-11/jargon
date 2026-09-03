-- R100: the delayed unaided ask — rubric §10 (transfer), §11 (retention), §20.
--
-- The rubric is explicit that these two cannot be inferred from the original response:
-- "Transfer should generally be assessed through a separate task rather than inferred
-- from the original response", and "Retention should be assessed through delayed
-- independent retrieval". Until now the product had no moment where it asked a student
-- to produce something with no help, later — so §10 and §11 were unmeasurable, and §14
-- ("a learner who performs well only when substantial AI support is available should not
-- be classified as independently proficient") and §16 had nothing to compare against.
--
-- The owner's call: the ask lives INSIDE the next lesson session. The mentor opens with
-- one question about an idea the student met on a previous day, before any teaching
-- happens. No new student surface, and no notification to ignore.
--
-- Four rules make it a measurement rather than a nuisance, and the schema enforces the
-- ones it can:
--   * ONE PER SESSION — `unique (session_id)`. Not a convention the handler remembers.
--   * ONE PER DAY — the handler reads the student's most recent probe and stays quiet if
--     it is younger than the gap. Sessions are cheap to start; probes are not.
--   * ONLY GENUINELY DELAYED — the idea's last evidence must predate this session AND be
--     older than the gap, or "delayed retrieval" is just a rephrased comprehension check.
--   * ANSWERED, EXPIRED, OR NOTHING — a student who skips is not scored a zero. `status`
--     carries which happened, so an unanswered probe is visible as itself.

create table if not exists public.cognition_probes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  lesson_id text not null references public.lessons(id) on delete cascade,
  -- The idea being probed, and its title copied at ask time: the probe is a record of a
  -- question that was actually asked, and it should still read correctly if the idea is
  -- later retitled or retired.
  idea_key text not null,
  idea_title text not null default '',
  kind text not null check (kind in ('retention', 'transfer')),
  -- What the student's mastery of that idea looked like when the question was asked,
  -- decayed. This is why the question was a retention one and not a transfer one, and
  -- keeping it makes that choice auditable later.
  effective_at_ask numeric,
  status text not null default 'asked' check (status in ('asked', 'answered', 'expired')),
  answer_turn_id uuid references public.learning_turns(id) on delete set null,
  -- Filled by the scorer, not by chat: the mentor asks, the judge scores.
  retention smallint check (retention is null or (retention >= 0 and retention <= 4)),
  transfer smallint check (transfer is null or (transfer >= 0 and transfer <= 4)),
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  scored_at timestamptz,
  constraint cognition_probes_one_per_session unique (session_id)
);

create index if not exists cognition_probes_user_asked
  on public.cognition_probes (user_id, asked_at desc);

alter table public.cognition_probes enable row level security;

-- chat writes these under the CALLER's JWT (it never holds the service key), so the
-- student owns their own rows — the same pattern as student_idea_mastery.
do $$ begin
  create policy cognition_probes_owner_insert on public.cognition_probes
    for insert to authenticated with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy cognition_probes_owner_update on public.cognition_probes
    for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Reads follow the ledger's rule verbatim: the student, a teacher who shares an active
-- class with them, an org admin over their organization, a platform admin. A probe names
-- what a child could not remember, so it is read exactly as narrowly as a turn score.
do $$ begin
  create policy cognition_probes_read on public.cognition_probes
    for select to authenticated using (
      auth.uid() = user_id
      or exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
      or exists (
        select 1 from public.class_memberships t
        join public.class_memberships s on s.class_id = t.class_id
        where t.user_id = auth.uid() and t.role = 'teacher' and t.status = 'active'
          and s.user_id = cognition_probes.user_id
          and s.role = 'student' and s.status = 'active'
      )
      or exists (
        select 1 from public.organization_memberships oa
        join public.organization_memberships so on so.organization_id = oa.organization_id
        where oa.user_id = auth.uid() and oa.role = 'org_admin' and oa.status = 'active'
          and so.user_id = cognition_probes.user_id and so.status = 'active'
      )
    );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- The two new dimensions, and §14's independence numbers.
--
-- Additive columns rather than a rubric_version bump: nothing already scored changes
-- meaning, and a row without them reads as "not assessed", which is the truth.

alter table public.cognition_turn_scores
  add column if not exists retention smallint,
  add column if not exists transfer smallint;

do $$ begin
  alter table public.cognition_turn_scores
    add constraint cognition_turn_scores_retention_range
    check (retention is null or (retention >= 0 and retention <= 4));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cognition_turn_scores
    add constraint cognition_turn_scores_transfer_range
    check (transfer is null or (transfer >= 0 and transfer <= 4));
exception when duplicate_object then null; end $$;

alter table public.cognition_profiles
  add column if not exists retention smallint,
  add column if not exists transfer smallint,
  add column if not exists probes_answered integer not null default 0,
  -- §14: "percentage of tasks completed at S0-S1" and "supported versus unsupported
  -- mastery". Stored as the count and the share so a reader can see the denominator —
  -- "2 of 3" and "67%" are different claims when the denominator is three.
  add column if not exists unaided_count integer not null default 0,
  add column if not exists share_unaided numeric,
  add column if not exists split jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- The queue: a probe answer is scored on the NEXT tick.
--
-- The queue exists to keep model calls worth making, so it waits for five new responses
-- before surfacing a pair. A probe answer is the exception in both directions: it can be
-- shorter than the constructed-response floor ("the part where the water splits") and
-- still be exactly what §11 measures, and it is worthless if it arrives in the teacher's
-- view a week after the question. Both exemptions are here rather than in the scorer, so
-- the queue and the judge still agree about what is scoreable.

create or replace view public.cognition_sweep_queue as
select
  lt.user_id,
  lt.lesson_id,
  count(*)::int as unscored,
  max(lt.created_at) as last_activity
from public.learning_turns lt
left join public.cognition_turn_scores cts
  on cts.turn_id = lt.id and cts.rubric_version = 1
where lt.role = 'student'
  and cts.id is null
  and lt.created_at > now() - interval '30 days'
  and (
    coalesce(nullif(lt.payload->>'code', ''), '') <> ''
    or length(trim(coalesce(nullif(lt.payload->>'text', ''), lt.content, ''))) >= 25
    or lt.payload ? 'probe'
  )
group by lt.user_id, lt.lesson_id
having count(*) >= 5 or bool_or(lt.payload ? 'probe');

revoke all on public.cognition_sweep_queue from anon, authenticated;
grant select on public.cognition_sweep_queue to service_role;
