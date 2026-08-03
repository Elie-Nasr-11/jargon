-- Chat-flow Phase 3 (2026-08-02): the ROLLING MID-SESSION SUMMARY.
-- The prompt's history window is a hard 8 turns x 400 chars, so a long session silently
-- forgot its own beginning. The chat fn now maintains a compact running summary of the
-- conversation SO FAR on the session row itself (refreshed in the background every few
-- student turns by the cheap model) and feeds it to the mentor as conversation_so_far,
-- ahead of the verbatim recent-history window.
--
-- Additive + idempotent, like every migration in the deploy list. No RLS change needed:
-- learning_sessions' existing owner policies cover the new columns, and only the service
-- role writes them.

alter table public.learning_sessions
  add column if not exists running_summary text,
  add column if not exists summarized_turns integer not null default 0;

comment on column public.learning_sessions.running_summary is
  'Rolling compact summary of this session''s conversation so far (chat fn, cheap model); prompt-fed as conversation_so_far.';
comment on column public.learning_sessions.summarized_turns is
  'Student-turn count already folded into running_summary; the writer refreshes when the live count pulls ahead.';
