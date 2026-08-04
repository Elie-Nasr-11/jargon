-- Brain-first Phase B (docs/BRAIN_FIRST_PLAN.md): idea-level mastery — the evidence
-- store the brain read model (loadBrainContext) ranks weakness/strength from.
-- Additive + idempotent. Written by the chat fn under the CALLER's JWT (owner
-- policies below, same pattern as student_links); score is an EMA in [0,1] with
-- read-time decay applied in code (never stored).

create table if not exists public.student_idea_mastery (
  user_id uuid not null references auth.users(id) on delete cascade,
  idea_key text not null,
  score numeric not null default 0,
  attempts int not null default 0,
  last_result text,
  last_evidence_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, idea_key),
  constraint student_idea_mastery_score_check check (score >= 0 and score <= 1),
  constraint student_idea_mastery_result_check
    check (last_result is null or last_result in ('pass', 'fail', 'neutral'))
);

create index if not exists student_idea_mastery_user_score
  on public.student_idea_mastery (user_id, score asc);

alter table public.student_idea_mastery enable row level security;

do $$ begin
  create policy student_idea_mastery_owner_select on public.student_idea_mastery
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy student_idea_mastery_owner_insert on public.student_idea_mastery
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy student_idea_mastery_owner_update on public.student_idea_mastery
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Step -> ideas mapping (authored or extracted; Phase D fills it at intake). Null falls
-- back to the lesson's authored ideas in code.
alter table public.lesson_activities
  add column if not exists idea_keys text[];
