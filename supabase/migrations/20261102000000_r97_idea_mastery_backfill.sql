-- R97: give the brain something to know, and something to remember knowing it with.
--
-- TWO faults, found together. The first is a bug; the second is why fixing the bug alone
-- would have changed almost nothing.
--
-- 1. THE WRITE NEVER WROTE. chat's student_idea_mastery upsert dropped the helper's
--    required `onConflict` argument, so every request went out as
--    `?on_conflict=undefined`, PostgREST rejected it, and the writer's empty catch made
--    the failure invisible. The table held zero rows for every student since Phase B.
--    Fixed in supabase/functions/chat/index.ts in this same release.
--
-- 2. MOST LESSONS HAVE NO IDEAS TO WRITE ABOUT. Measured on production, 2026-09-02:
--    of 992 graded attempts, 973 sit on lessons with no authored ideas and no step-level
--    idea_keys — including every lesson of the IT Frontiers books, which is the content a
--    school actually teaches. `evidenceIdeaKeys()` returns an empty list for those, and an
--    empty list writes nothing. So the fixed writer would still have written almost
--    nothing, the brain map would still have shown empty bands, and the mentor's
--    brain.weak/strong read model would still have been reading an empty table.
--
-- This migration closes both, in order: mint the missing ideas, then replay the graded
-- work onto them.
--
-- ---------------------------------------------------------------------------
-- PART 1 — one authored idea per lesson that has none, from its own objective.
--
-- Every one of the 90 lessons without ideas has exactly one milestone carrying a real
-- learning objective (measured, same date). That objective IS the lesson's idea, written
-- by whoever authored the lesson — so minting from it invents nothing and needs no model.
--
-- This is deliberately LESSON-GRAINED: a floor, not a ceiling. Real extraction can add
-- finer ideas later without touching these, because the minted keys live in their own
-- `lesson-<lesson_id>` namespace and every hand-authored key is a bare slug.

insert into public.ideas (key, title, one_liner, subject, grade_band, origin, status, lesson_id, user_id)
select
  'lesson-' || l.id,
  -- The objective is the title, cut at a word boundary so a graph label stays readable.
  -- No clever clause-splitting: "Classify parts of human, personal-computer, and …"
  -- would lose its meaning at the first comma.
  case
    when length(trim(m.objective)) <= 80 then trim(m.objective)
    else regexp_replace(left(trim(m.objective), 80), '\s+\S*$', '') || '…'
  end,
  trim(m.objective),
  coalesce(s.title, ''),
  l.grade_band,
  'authored',
  'published',
  l.id,
  null
from public.lessons l
join lateral (
  select m.objective
  from public.milestones m
  where m.lesson_id = l.id and coalesce(trim(m.objective), '') <> ''
  order by m.position, m.id
  limit 1
) m on true
left join public.units u on u.id = l.unit_id
left join public.course_versions cv on cv.id = u.course_version_id
left join public.courses c on c.id = cv.course_id
left join public.subjects s on s.id = c.subject_id
where not exists (
  select 1 from public.ideas i where i.lesson_id = l.id and i.user_id is null
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- PART 2 — replay the graded work that already happened onto those ideas.
--
-- Source: lesson_attempts. It carries activity_id, user_id, lesson_id, passed and
-- created_at directly, and chat writes it under a broader guard than learning_evidence
-- (which has no activity_id and misses most failures). Replayed chronologically per
-- student with the runtime's own EMA, so a backfilled score is the score the runtime
-- would have held had the write worked.
--
-- Two knowing divergences from the runtime, recorded rather than hidden:
--   * the EMA is seeded from a NEUTRAL PRIOR of 0.5, matching the runtime fix shipped
--     alongside this migration. Seeding from 0 made "never seen" and "got it wrong" the
--     same starting point: a first correct answer scored 0.3 and read as "to refresh".
--   * an echo-rejected answer was "neutral" live (counts the attempt, moves no score);
--     the attempt row only knows passed=false, so it replays as a fail. Slightly harsh,
--     and unrecoverable from this source.
--   * the runtime's authored-idea fallback reads ideas in PostgREST's default order;
--     this orders by (created_at, key). A lesson with more than four authored ideas and
--     no idea_keys may map to a different four.
--
-- Idempotent twice over: the insert is `on conflict do nothing`, and the whole replay is
-- skipped for any student who already holds a row. The deploy workflow replays every
-- migration in its list on each push, so this must be, and is, a no-op on the second run.

do $$
declare
  attempt record;
  keys text[];
  unique_keys text[];
  k text;
  prev_score numeric;
  prev_attempts int;
  target numeric;
begin
  drop table if exists pg_temp.r97_mastery;
  create temporary table r97_mastery (
    user_id uuid not null,
    idea_key text not null,
    score numeric not null,
    attempts int not null,
    last_result text not null,
    last_evidence_at timestamptz not null,
    primary key (user_id, idea_key)
  ) on commit drop;

  for attempt in
    select la.user_id, la.lesson_id, la.activity_id, la.passed, la.created_at
    from public.lesson_attempts la
    where la.passed is not null
      -- Skip anyone the live writer has already served: their rows are authoritative.
      and not exists (
        select 1 from public.student_idea_mastery m where m.user_id = la.user_id
      )
    order by la.user_id, la.created_at, la.id
  loop
    -- The step's authored ideas when it has them, else the lesson's — mirroring
    -- evidenceIdeaKeys() in supabase/functions/chat/index.ts (6 and 4 respectively).
    keys := null;

    if attempt.activity_id is not null then
      select act.idea_keys[1:6] into keys
      from public.lesson_activities act
      where act.id = attempt.activity_id
        and act.idea_keys is not null
        and array_length(act.idea_keys, 1) > 0;
    end if;

    if keys is null or array_length(keys, 1) is null then
      select array_agg(i.key order by i.created_at, i.key) into keys
      from (
        select id.key, id.created_at
        from public.ideas id
        where id.lesson_id = attempt.lesson_id
          and id.user_id is null
          and id.status = 'published'
        order by id.created_at, id.key
        limit 4
      ) i;
    end if;

    if keys is null or array_length(keys, 1) is null then
      continue;
    end if;

    target := case when attempt.passed then 1 else 0 end;

    select array_agg(distinct x) into unique_keys
    from unnest(keys) x
    where x is not null and x <> '';

    if unique_keys is null then
      continue;
    end if;

    foreach k in array unique_keys
    loop
      select m.score, m.attempts into prev_score, prev_attempts
      from r97_mastery m
      where m.user_id = attempt.user_id and m.idea_key = k;

      if prev_score is null then
        -- MASTERY_PRIOR = 0.5: before any evidence, nothing is known either way.
        prev_score := 0.5;
        prev_attempts := 0;
      end if;

      insert into r97_mastery (user_id, idea_key, score, attempts, last_result, last_evidence_at)
      values (
        attempt.user_id,
        k,
        -- MASTERY_EMA_ALPHA = 0.3, rounded to three decimals, exactly as the runtime does.
        round(prev_score + 0.3 * (target - prev_score), 3),
        prev_attempts + 1,
        case when attempt.passed then 'pass' else 'fail' end,
        attempt.created_at
      )
      on conflict (user_id, idea_key) do update
        set score = excluded.score,
            attempts = excluded.attempts,
            last_result = excluded.last_result,
            last_evidence_at = excluded.last_evidence_at;
    end loop;
  end loop;

  insert into public.student_idea_mastery
    (user_id, idea_key, score, attempts, last_result, last_evidence_at, updated_at)
  select m.user_id, m.idea_key, m.score, m.attempts, m.last_result, m.last_evidence_at, now()
  from r97_mastery m
  on conflict (user_id, idea_key) do nothing;
end $$;
