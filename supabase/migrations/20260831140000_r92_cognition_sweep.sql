-- R92: scheduled cognition scoring (docs/COGNITION.md). Applied to production
-- 2026-08-31 via the management API; kept here so the repo remains the schema's
-- source of truth.
--
-- Profiles must exist without a teacher pressing a button, which means a caller with
-- no user behind it. Three pieces: a secret only the scheduler and the function can
-- read, a queue view that decides what is worth a model call, and a run log so
-- "is the scheduler alive?" has an answer.

-- 1. The sweep secret. RLS on with NO policies at all: anon and authenticated can
--    never read it; the service role (which bypasses RLS) and postgres can. The
--    scheduler reads it at fire time, so the plaintext never sits in cron.job.command.
create table if not exists public.cognition_sweep_auth (
  id boolean primary key default true,
  sweep_key text not null,
  created_at timestamptz not null default now(),
  constraint cognition_sweep_auth_single_row check (id)
);
alter table public.cognition_sweep_auth enable row level security;
revoke all on public.cognition_sweep_auth from anon, authenticated;

insert into public.cognition_sweep_auth (id, sweep_key)
values (true, encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

-- 2. What is worth scoring. The constructed-response test mirrors the scorer's
--    isConstructedResponse EXACTLY (code counts; an MCQ tap with no text does not;
--    25 trimmed characters is the floor) — a queue that disagreed with the judge
--    would either burn calls on turns it skips or hide turns it would score.
--
--    The 5-response threshold is the cost knob: a pair is only worth a model call
--    once it has five NEW responses to judge, which is also comfortably past the
--    three the §19 steer needs before it will act.
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
  )
group by lt.user_id, lt.lesson_id
having count(*) >= 5;

-- The view runs as its owner (postgres), so the GRANTS are the access control.
revoke all on public.cognition_sweep_queue from anon, authenticated;
grant select on public.cognition_sweep_queue to service_role;

-- 3. Run log — one row per sweep, so a silent scheduler is visible as a gap.
--    The row is INSERTed before any scoring and PATCHed at the end, so a tick the
--    edge gateway kills mid-flight still leaves a row: one with a null finished_at.
create table if not exists public.cognition_sweep_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pairs_seen integer not null default 0,
  pairs_scored integer not null default 0,
  responses_scored integer not null default 0,
  errors integer not null default 0,
  detail jsonb not null default '{}'::jsonb
);
alter table public.cognition_sweep_runs add column if not exists finished_at timestamptz;
alter table public.cognition_sweep_runs enable row level security;
revoke all on public.cognition_sweep_runs from anon;
-- Platform admins may read the log (it holds counts and lesson ids, no student text).
create policy cognition_sweep_runs_read on public.cognition_sweep_runs
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
  );
grant select on public.cognition_sweep_runs to authenticated;
create index if not exists cognition_sweep_runs_started_idx
  on public.cognition_sweep_runs (started_at desc);

-- 4. The schedule itself. pg_cron runs in UTC; the secret is READ at fire time, so it is
--    never stored in the job command.
--
--    THE BATCH IS 10, AND THE BUDGET IS THE REAL CEILING (raised from 2 on 2026-09-04).
--    `limit` is an upper bound, not a target: sweep() walks the queue SEQUENTIALLY and
--    starts another pair only while `elapsed + slowestPairMs <= SWEEP_BUDGET_MS`
--    (130s, inside this call's 150s timeout). So the batch size cannot make a tick
--    overrun, cannot fan out concurrent judge calls, and cannot cost anything when the
--    queue is short — a tick with two pairs waiting still does two.
--
--    Measured before the change, over the 16 runs that had work: 26.1 seconds per pair
--    (average run 44.1s, slowest 93.7s). At that rate the 130s budget fits about FIVE
--    pairs, so 10 buys roughly 5/tick = 20/hour = ~480/day, up from 192. It does not
--    buy 10/tick, and raising this number further buys nothing at all: the next lever
--    is the schedule (*/15 -> */10 or */5), which multiplies budgets instead of
--    sharing one. Re-measure with the query in docs/COGNITION.md before touching either.
create extension if not exists pg_cron;

select cron.schedule(
  'cognition-sweep',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://qztpieiizmiayzjhezwh.supabase.co/functions/v1/cognition-scorer',
    body := '{"action":"sweep","limit":10}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- The ANON key here is public (it ships in the frontend bundle); it only
      -- satisfies the function's "some Authorization header" check. x-sweep-key is
      -- what actually authorizes the sweep. app.settings.anon_key is NOT set on this
      -- project — reading it would send "Bearer " and 401 every 15 minutes, silently.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dHBpZWlpem1pYXl6amhlendoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NzE1NDEsImV4cCI6MjA4NjA0NzU0MX0.GhO5RAffyZnCTT5je9xUuIFyltHFvEvh2vuWJmsB_wk',
      'x-sweep-key', (select sweep_key from public.cognition_sweep_auth limit 1)),
    timeout_milliseconds := 150000
  );
  $$
);
