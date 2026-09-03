-- R101: the queue finishes what it starts.
--
-- The sweep's threshold (R92) surfaces a (student, lesson) pair only once FIVE new
-- constructed responses are waiting, and R100 added the probe answer as the one exception.
-- That left a hole nobody could see from the teacher's side: a lesson a student finished
-- or abandoned with one to four responses waiting was never read — at any age. Measured
-- on 2026-09-03: nine such pairs holding eighteen responses across two students, every
-- one older than two hours, and a sweep that had run 96 times in a day and scored nothing.
-- The teacher's "Read the thinking" button was the only thing reading them, which is
-- exactly the click the owner asked to remove. "Just shows" is false while a tail can wait
-- forever, so the queue takes responsibility for it here.
--
-- THE RULE: a tail surfaces two hours after its last constructed response, at whatever
-- count. The sweep already orders by last_activity descending, so live work goes first
-- and aged tails fill the idle ticks; under load they drain in the quiet hours.
--
-- THE COST: one short judge call per abandoned tail — a tail is under five responses by
-- definition. A lunch break mid-lesson costs one call; the resumed work queues again at
-- five or after the next two-hour gap. Bounded by (students × lessons × pauses), never by
-- the clock.
--
-- THE WINDOW STAYS. Turns older than thirty days are still outside the queue. The 149
-- constructed responses beyond it (six students) predate the ledger: a backfill would draw
-- a "trajectory" no teacher saw at the time, and the score_lesson action remains for
-- anyone who wants a specific lesson read.

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
having count(*) >= 5 or bool_or(lt.payload ? 'probe') or max(lt.created_at) < now() - interval '2 hours';

revoke all on public.cognition_sweep_queue from anon, authenticated;
grant select on public.cognition_sweep_queue to service_role;
