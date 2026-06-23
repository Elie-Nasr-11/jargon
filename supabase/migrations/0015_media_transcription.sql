-- Media processing v2: audio/video transcript chunks.
-- Additive only: existing PDF extracted chunks remain valid and approved
-- chunks are still the only material available to Mentor context.

alter table public.resource_processing_jobs
  drop constraint if exists resource_processing_jobs_job_type_check;

alter table public.resource_processing_jobs
  add constraint resource_processing_jobs_job_type_check
  check (
    job_type in (
      'pdf_text_extraction',
      'audio_transcription',
      'video_transcription'
    )
  );

alter table public.resource_text_chunks
  add column if not exists source_kind text not null default 'document',
  add column if not exists start_seconds numeric,
  add column if not exists end_seconds numeric,
  add column if not exists confidence numeric;

alter table public.resource_text_chunks
  drop constraint if exists resource_text_chunks_source_kind_check,
  drop constraint if exists resource_text_chunks_time_range_check,
  drop constraint if exists resource_text_chunks_confidence_check;

alter table public.resource_text_chunks
  add constraint resource_text_chunks_source_kind_check
  check (source_kind in ('document', 'audio', 'video', 'manual')),
  add constraint resource_text_chunks_time_range_check
  check (
    (
      start_seconds is null
      and end_seconds is null
    )
    or (
      start_seconds is not null
      and start_seconds >= 0
      and (
        end_seconds is null
        or end_seconds >= start_seconds
      )
    )
  ),
  add constraint resource_text_chunks_confidence_check
  check (
    confidence is null
    or (
      confidence >= 0
      and confidence <= 1
    )
  );

create index if not exists resource_text_chunks_resource_source_idx
  on public.resource_text_chunks (
    resource_id,
    status,
    source_kind,
    start_seconds,
    page_number,
    chunk_index
  );

revoke all privileges on table public.resource_processing_jobs from anon;
revoke all privileges on table public.resource_processing_errors from anon;
revoke all privileges on table public.resource_text_chunks from anon;
