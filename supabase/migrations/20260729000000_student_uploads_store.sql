-- v9: a general student file store for chat attachments (additive, idempotent).
--
-- Unlike assignment_submission_files, this store is NOT welded to an assignment: a student uploads
-- a file from the tutor chat composer and it lives in their own owner-only library, reusable across
-- turns and lessons. It reuses every submission-safety pattern — private bucket, path-bound INSERT,
-- scan_status read-gating, purged_at tombstone, size cap — but with owner-only RLS (no teacher
-- branch) and a `{userId}/...` path scheme (so the FIRST path segment is the uploader, vs
-- submissions' second). The chat edge fn re-reads these rows under the caller's JWT before fetching
-- bytes, so ownership is enforced server-side; the storage read gate blocks quarantined/purged files.

-- Private bucket, 25 MB/file (smaller than submissions' 50 MB — these feed a vision model).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-uploads', 'student-uploads', false, 26214400, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.student_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  storage_bucket text not null default 'student-uploads',
  storage_path text not null,
  original_filename text not null,
  mime_type text,
  file_size_bytes bigint,
  scan_status text not null default 'pending'
    check (scan_status in ('pending', 'clean', 'quarantined', 'skipped')),
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.student_uploads enable row level security;
revoke all on public.student_uploads from anon;
revoke all on public.student_uploads from authenticated;
grant select, insert, delete on public.student_uploads to authenticated;
grant select, insert, update, delete on public.student_uploads to service_role;

-- Owner-only table RLS. No UPDATE for students; the maintenance sweeper patches scan_status via
-- service_role (which bypasses RLS).
drop policy if exists "Students read own uploads" on public.student_uploads;
create policy "Students read own uploads"
  on public.student_uploads for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Students insert own uploads" on public.student_uploads;
create policy "Students insert own uploads"
  on public.student_uploads for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Students delete own uploads" on public.student_uploads;
create policy "Students delete own uploads"
  on public.student_uploads for delete
  to authenticated
  using (user_id = auth.uid());

-- The scan sweep drains this partial index; retention scans the un-purged set by age.
create index if not exists student_uploads_user_idx
  on public.student_uploads (user_id, created_at desc);
create index if not exists student_uploads_scan_pending_idx
  on public.student_uploads (created_at)
  where scan_status = 'pending';
create index if not exists student_uploads_retention_idx
  on public.student_uploads (created_at)
  where purged_at is null;

-- Storage read boundary: owner-only, and a quarantined or purged file is unreadable (createSignedUrl
-- fails at RLS) even to the owner.
drop policy if exists "Students can read own uploads" on storage.objects;
create policy "Students can read own uploads"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'student-uploads'
    and exists (
      select 1
      from public.student_uploads su
      where su.storage_bucket = storage.objects.bucket_id
        and su.storage_path = storage.objects.name
        and su.user_id = auth.uid()
        and su.scan_status <> 'quarantined'
        and su.purged_at is null
    )
  );

-- Path-bound INSERT: the FIRST path segment must be the uploader's uid (scheme `{userId}/...`), so a
-- student cannot place objects under another user's prefix. Malformed paths (<1 segment) → NULL → reject.
drop policy if exists "Students can upload own uploads" on storage.objects;
create policy "Students can upload own uploads"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'student-uploads'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner may delete their own object bytes (deleteStudentUpload removes the object first, then the row).
drop policy if exists "Students can delete own uploads" on storage.objects;
create policy "Students can delete own uploads"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'student-uploads'
    and exists (
      select 1
      from public.student_uploads su
      where su.storage_bucket = storage.objects.bucket_id
        and su.storage_path = storage.objects.name
        and su.user_id = auth.uid()
    )
  );
