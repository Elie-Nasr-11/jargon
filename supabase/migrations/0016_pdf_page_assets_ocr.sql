-- Media processing v3: private PDF page assets and OCR for scanned PDFs.
-- Additive only. Extracted OCR text remains draft until teacher approval.

alter table public.resource_processing_jobs
  drop constraint if exists resource_processing_jobs_job_type_check;

alter table public.resource_processing_jobs
  add constraint resource_processing_jobs_job_type_check
  check (
    job_type in (
      'pdf_text_extraction',
      'audio_transcription',
      'video_transcription',
      'pdf_page_render',
      'pdf_ocr'
    )
  );

create table if not exists public.resource_page_assets (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.lesson_resources on delete cascade,
  job_id uuid references public.resource_processing_jobs on delete set null,
  organization_id uuid references public.organizations on delete set null,
  class_id uuid references public.classes on delete set null,
  lesson_id text references public.lessons on delete set null,
  page_number integer not null check (page_number > 0),
  asset_type text not null check (asset_type in ('thumbnail', 'ocr_image')),
  storage_bucket text not null default 'lesson-resources',
  storage_path text not null,
  mime_type text not null default 'image/jpeg',
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes >= 0),
  status text not null default 'ready' check (status in ('ready', 'failed', 'deleted')),
  created_by uuid references auth.users on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, page_number, asset_type)
);

alter table public.resource_page_assets enable row level security;

create index if not exists resource_page_assets_resource_idx
  on public.resource_page_assets (resource_id, asset_type, page_number);

create index if not exists resource_page_assets_lesson_idx
  on public.resource_page_assets (lesson_id, asset_type, page_number);

grant select, insert, update, delete on public.resource_page_assets to authenticated;
grant select, insert, update, delete on public.resource_page_assets to service_role;
revoke all privileges on table public.resource_page_assets from anon;

drop policy if exists "Users can view resource page assets"
  on public.resource_page_assets;
create policy "Users can view resource page assets"
  on public.resource_page_assets for select
  to authenticated
  using (
    public.can_manage_lesson_resource(resource_id)
    or (
      status = 'ready'
      and public.can_view_lesson_resource(resource_id)
    )
  );

drop policy if exists "Teachers can create resource page assets"
  on public.resource_page_assets;
create policy "Teachers can create resource page assets"
  on public.resource_page_assets for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.can_manage_lesson_resource(resource_id)
  );

drop policy if exists "Teachers can update resource page assets"
  on public.resource_page_assets;
create policy "Teachers can update resource page assets"
  on public.resource_page_assets for update
  to authenticated
  using (public.can_manage_lesson_resource(resource_id))
  with check (public.can_manage_lesson_resource(resource_id));

drop policy if exists "Teachers can delete resource page assets"
  on public.resource_page_assets;
create policy "Teachers can delete resource page assets"
  on public.resource_page_assets for delete
  to authenticated
  using (public.can_manage_lesson_resource(resource_id));

drop policy if exists "Authorized users can read resource page asset files"
  on storage.objects;
create policy "Authorized users can read resource page asset files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lesson-resources'
    and exists (
      select 1
      from public.resource_page_assets rpa
      where rpa.storage_bucket = storage.objects.bucket_id
        and rpa.storage_path = storage.objects.name
        and (
          public.can_manage_lesson_resource(rpa.resource_id)
          or (
            rpa.status = 'ready'
            and public.can_view_lesson_resource(rpa.resource_id)
          )
        )
    )
  );

drop policy if exists "Teachers can update resource page asset files"
  on storage.objects;
create policy "Teachers can update resource page asset files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'lesson-resources'
    and exists (
      select 1
      from public.resource_page_assets rpa
      where rpa.storage_bucket = storage.objects.bucket_id
        and rpa.storage_path = storage.objects.name
        and public.can_manage_lesson_resource(rpa.resource_id)
    )
  )
  with check (bucket_id = 'lesson-resources');
