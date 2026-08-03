-- The turn router's usage rows have been silently dropped since Flow v3: recordModelUsage
-- stamps task_type 'routing', but the check constraint never included it (the write is
-- best-effort, so nothing surfaced until the Phase 4 cost work made usage rows worth
-- looking at). Widen the constraint; additive + idempotent.
alter table public.model_usage_events
  drop constraint if exists model_usage_events_task_type_check;
alter table public.model_usage_events
  add constraint model_usage_events_task_type_check
  check (task_type in (
    'mentor_turn', 'grading', 'rescue', 'authoring', 'summarization',
    'speech_to_text', 'text_to_speech', 'routing'
  ));
