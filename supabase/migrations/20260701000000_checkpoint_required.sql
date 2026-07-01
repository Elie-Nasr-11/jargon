-- Checkpoint unification, Phase 1: teacher-chosen "required for lesson completion".
-- A required assignment/assessment must be finished before the lesson counts as complete.
-- Additive + idempotent (applied via the Supabase Management API in deploy-backend.yml).

alter table if exists public.assignments
  add column if not exists required boolean not null default false;

alter table if exists public.assessments
  add column if not exists required boolean not null default false;

-- Decouple "finished the lesson's activities" from "lesson is complete": a lesson is only
-- complete once activities AND all required checkpoints are done. This lets the runtime gate
-- completion and lets the teacher gradebook show a unified status.
alter table if exists public.learning_sessions
  add column if not exists activities_complete boolean not null default false;
