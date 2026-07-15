-- Flow v3 session state: per-step completion history, pre-emption credit, and the
-- revisit/resume navigation frame. All additive with defaults; idempotent (re-applied on
-- every backend deploy via the workflow's migration list).
--
--   steps_done: {activity_id: {done_at, via:'gates'|'stuck_cap'}} — written on advance;
--     lazily backfilled from the cursor position for sessions that predate this column.
--     Fixes "completion history is only implicit in cursor position" and powers the
--     clickable stepper.
--   preempted:  {activity_id: {note, at}} — future-step objectives the student already
--     articulated; read by the compressed-delivery presentation directive. Never sets
--     any gate.
--   nav: null = normal flow; non-null = the student is revisiting a completed step:
--     {frontier_activity_id, paused_step_state, revisit_of, started_at}. While set,
--     graders are masked and advancement is off; resume restores the frontier exactly.

alter table public.learning_sessions
  add column if not exists steps_done jsonb not null default '{}'::jsonb;

alter table public.learning_sessions
  add column if not exists preempted jsonb not null default '{}'::jsonb;

alter table public.learning_sessions
  add column if not exists nav jsonb;
