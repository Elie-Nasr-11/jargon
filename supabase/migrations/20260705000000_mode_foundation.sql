-- v4.0 Phase 1: the eight-mode lesson vocabulary (docs/PLATFORM.md is canonical).
-- Additive + idempotent (this file re-runs on every deploy). Rows with mode null use the
-- legacy runtime derivation (response_mode + quiz-row presence) and behave exactly as before.

alter table if exists public.lesson_activities
  add column if not exists mode text,
  add column if not exists mode_type text;

-- Named check constraint, added idempotently. All eight values from day one (revision's
-- runtime lands in a later phase) so this constraint never needs touching again.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lesson_activities_mode_check'
      and conrelid = 'public.lesson_activities'::regclass
  ) then
    alter table public.lesson_activities
      add constraint lesson_activities_mode_check
      check (mode is null or mode in (
        'explanation','media','reflection','practice',
        'assignment','inquiry','assessment','revision'
      ));
  end if;
end $$;

comment on column public.lesson_activities.mode is
  'v4.0 learning mode (docs/PLATFORM.md): explanation, media, reflection, practice, assignment, inquiry, assessment, revision. Null = legacy step (kind derived from response_mode + quiz presence).';
comment on column public.lesson_activities.mode_type is
  'Per-mode subtype (validated in curriculum-admin, not the DB): practice code|applied, assessment mcq|open_ended, revision recall.';

alter table if exists public.learning_evidence
  add column if not exists mode text,
  add column if not exists mode_type text;

comment on column public.learning_evidence.mode is
  'The learning mode that produced this evidence (docs/PLATFORM.md). Null = legacy row that could not be mapped.';

-- One-time backfill marker: the backfill runs ONCE and never again, so a step a teacher
-- later clears back to Legacy (mode null) is never silently re-stamped on the next deploy
-- (honors the null-clears-to-legacy contract across deploys). Service-role only.
create table if not exists public.platform_backfill_markers (
  key text primary key,
  applied_at timestamptz not null default now()
);
alter table if exists public.platform_backfill_markers enable row level security;

-- ---------------------------------------------------------------------------
-- ONE-TIME backfill. Only stamps rows whose legacy behavior a single static mode replicates
-- in EVERY future state (requirement-equivalent forever), leaving ambiguous rows legacy:
--   * code            -> practice/code  (a bound quiz stays an orthogonal gate, tracked live)
--   * multiple_choice -> assessment/mcq (legacy always requires the quiz for MCQ activities)
--   * text, NO bound published quiz -> reflection
-- Deliberately NOT stamped (stay null/legacy, whose derivation tracks live quiz presence and
-- gracefully degrades): text/file steps WITH a bound quiz, and file steps (no 'file' mode).
do $$
begin
  if not exists (
    select 1 from public.platform_backfill_markers where key = 'mode_foundation_v1'
  ) then
    update public.lesson_activities
    set mode = 'practice', mode_type = 'code'
    where mode is null and response_mode = 'code';

    update public.lesson_activities
    set mode = 'assessment', mode_type = 'mcq'
    where mode is null and response_mode = 'multiple_choice';

    update public.lesson_activities a
    set mode = 'reflection'
    where a.mode is null
      and a.response_mode = 'text'
      and not exists (
        select 1 from public.quiz_items q
        where q.activity_id = a.id and q.status = 'published'
      );

    -- learning_evidence via the teaching_move (directive-key) lookup. Ambiguous moves
    -- (present_step, converse, post_completion, ...) stay null and read as "legacy".
    update public.learning_evidence
    set mode = 'practice', mode_type = 'code'
    where mode is null
      and teaching_move in ('run_failed', 'code_objective_met', 'runtime_timeout');

    update public.learning_evidence
    set mode = 'assessment', mode_type = 'mcq'
    where mode is null
      and teaching_move in ('quiz_first_presentation', 'quiz_passed', 'quiz_wrong', 'quiz_active_chat');

    update public.learning_evidence
    set mode = 'reflection'
    where mode is null
      and teaching_move in ('understanding_demonstrated', 'explanation_pending', 'step_concluding_stuck');

    insert into public.platform_backfill_markers (key) values ('mode_foundation_v1');
  end if;
end $$;
