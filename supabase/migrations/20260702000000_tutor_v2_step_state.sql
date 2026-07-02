-- Tutor v2.0 Phase B: persisted per-step progress for the flow core.
-- Additive + idempotent; inert under pre-v2 function code (safe rollback).

alter table if exists public.learning_sessions
  add column if not exists step_state jsonb not null default '{}'::jsonb;

comment on column public.learning_sessions.step_state is
  'Per-activity progress for the tutor flow core: { activity_id, presented_at, code_passed_at, quiz_presented_at, quiz_passed_at, understanding_at, attempts, graded_fails }. Reset (mismatched activity_id treated as empty) when the session advances to a new activity.';
