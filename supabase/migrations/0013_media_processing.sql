-- Media processing foundation: PDF-first extracted text chunks for Mentor context.
-- This is additive. It does not alter existing lesson/resource/runtime contracts.

create table if not exists public.resource_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.lesson_resources on delete cascade,
  organization_id uuid references public.organizations on delete set null,
  class_id uuid references public.classes on delete set null,
  lesson_id text references public.lessons on delete set null,
  job_type text not null default 'pdf_text_extraction'
    check (job_type in ('pdf_text_extraction')),
  status text not null default 'complete'
    check (status in ('draft', 'processing', 'complete', 'failed', 'cancelled')),
  requested_by uuid references auth.users on delete set null,
  completed_by uuid references auth.users on delete set null,
  chunk_count integer not null default 0 check (chunk_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.resource_processing_errors (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.resource_processing_jobs on delete cascade,
  resource_id uuid not null references public.lesson_resources on delete cascade,
  severity text not null default 'error' check (severity in ('warning', 'error')),
  page_number integer check (page_number is null or page_number > 0),
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.resource_text_chunks (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.lesson_resources on delete cascade,
  job_id uuid references public.resource_processing_jobs on delete set null,
  organization_id uuid references public.organizations on delete set null,
  class_id uuid references public.classes on delete set null,
  lesson_id text references public.lessons on delete set null,
  page_number integer not null check (page_number > 0),
  chunk_index integer not null default 0 check (chunk_index >= 0),
  chunk_text text not null check (
    length(trim(chunk_text)) > 0
    and length(chunk_text) <= 8000
  ),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.resource_processing_jobs enable row level security;
alter table public.resource_processing_errors enable row level security;
alter table public.resource_text_chunks enable row level security;

create index if not exists resource_processing_jobs_resource_idx
  on public.resource_processing_jobs (resource_id, status, created_at desc);

create index if not exists resource_processing_errors_resource_idx
  on public.resource_processing_errors (resource_id, created_at desc);

create index if not exists resource_text_chunks_resource_status_idx
  on public.resource_text_chunks (resource_id, status, page_number, chunk_index);

create index if not exists resource_text_chunks_lesson_status_idx
  on public.resource_text_chunks (lesson_id, status, page_number, chunk_index);

grant select, insert, update, delete on public.resource_processing_jobs to authenticated;
grant select, insert, update, delete on public.resource_processing_errors to authenticated;
grant select, insert, update, delete on public.resource_text_chunks to authenticated;

grant select, insert, update, delete on public.resource_processing_jobs to service_role;
grant select, insert, update, delete on public.resource_processing_errors to service_role;
grant select, insert, update, delete on public.resource_text_chunks to service_role;

revoke all privileges on table public.resource_processing_jobs from anon;
revoke all privileges on table public.resource_processing_errors from anon;
revoke all privileges on table public.resource_text_chunks from anon;

drop policy if exists "Teachers can view resource processing jobs"
  on public.resource_processing_jobs;
create policy "Teachers can view resource processing jobs"
  on public.resource_processing_jobs for select
  to authenticated
  using (public.can_manage_lesson_resource(resource_id));

drop policy if exists "Teachers can create resource processing jobs"
  on public.resource_processing_jobs;
create policy "Teachers can create resource processing jobs"
  on public.resource_processing_jobs for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and public.can_manage_lesson_resource(resource_id)
  );

drop policy if exists "Teachers can update resource processing jobs"
  on public.resource_processing_jobs;
create policy "Teachers can update resource processing jobs"
  on public.resource_processing_jobs for update
  to authenticated
  using (public.can_manage_lesson_resource(resource_id))
  with check (public.can_manage_lesson_resource(resource_id));

drop policy if exists "Teachers can delete resource processing jobs"
  on public.resource_processing_jobs;
create policy "Teachers can delete resource processing jobs"
  on public.resource_processing_jobs for delete
  to authenticated
  using (public.can_manage_lesson_resource(resource_id));

drop policy if exists "Teachers can view resource processing errors"
  on public.resource_processing_errors;
create policy "Teachers can view resource processing errors"
  on public.resource_processing_errors for select
  to authenticated
  using (public.can_manage_lesson_resource(resource_id));

drop policy if exists "Teachers can manage resource processing errors"
  on public.resource_processing_errors;
create policy "Teachers can manage resource processing errors"
  on public.resource_processing_errors for all
  to authenticated
  using (public.can_manage_lesson_resource(resource_id))
  with check (public.can_manage_lesson_resource(resource_id));

drop policy if exists "Users can view approved resource chunks"
  on public.resource_text_chunks;
create policy "Users can view approved resource chunks"
  on public.resource_text_chunks for select
  to authenticated
  using (
    public.can_manage_lesson_resource(resource_id)
    or (
      status = 'approved'
      and public.can_view_lesson_resource(resource_id)
    )
  );

drop policy if exists "Teachers can create resource chunks"
  on public.resource_text_chunks;
create policy "Teachers can create resource chunks"
  on public.resource_text_chunks for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.can_manage_lesson_resource(resource_id)
  );

drop policy if exists "Teachers can update resource chunks"
  on public.resource_text_chunks;
create policy "Teachers can update resource chunks"
  on public.resource_text_chunks for update
  to authenticated
  using (public.can_manage_lesson_resource(resource_id))
  with check (public.can_manage_lesson_resource(resource_id));

drop policy if exists "Teachers can delete resource chunks"
  on public.resource_text_chunks;
create policy "Teachers can delete resource chunks"
  on public.resource_text_chunks for delete
  to authenticated
  using (public.can_manage_lesson_resource(resource_id));
