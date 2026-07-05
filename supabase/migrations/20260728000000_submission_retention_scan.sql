-- Phase 2b: submission scan-status + retention tombstone (additive, idempotent).
--
-- Adds a dedicated scan-status dimension to submission files (separate from the existing
-- lifecycle `status` enum of submitted/returned/accepted/removed) and a `purged_at` tombstone
-- for retention. Both default to a benign state, so existing rows and the client are unaffected.
-- A provider-ready scan sweep (the `submission-maintenance` edge fn) flips scan_status; a
-- scheduled retention sweep sets purged_at after removing the object bytes. The storage read
-- boundary is tightened so a quarantined or purged file can no longer produce a signed URL
-- (defense in depth on top of the existing owner/teacher gate). Recreating that SELECT policy is
-- behaviourally a no-op today — no row is quarantined or purged (the table is empty).

alter table if exists public.assignment_submission_files
  add column if not exists scan_status text not null default 'pending';

alter table if exists public.assignment_submission_files
  add column if not exists purged_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'assignment_submission_files_scan_status_check'
  ) then
    alter table public.assignment_submission_files
      add constraint assignment_submission_files_scan_status_check
      check (scan_status in ('pending', 'clean', 'quarantined', 'skipped'));
  end if;
end $$;

-- The scan sweep drains this partial index; retention scans the un-purged set by age.
create index if not exists assignment_submission_files_scan_pending_idx
  on public.assignment_submission_files (created_at)
  where scan_status = 'pending';

create index if not exists assignment_submission_files_retention_idx
  on public.assignment_submission_files (created_at)
  where purged_at is null;

-- Tighten the storage read boundary: a quarantined or purged file is unreadable even to the
-- owner/teacher (createSignedUrl fails at RLS). Faithful recreation of the existing predicate
-- with two extra AND clauses; idempotent (drop-if-exists + create).
drop policy if exists "Students and teachers can read submission files" on storage.objects;
create policy "Students and teachers can read submission files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'student-submissions'
    and exists (
      select 1
      from public.assignment_submission_files sf
      where sf.storage_bucket = objects.bucket_id
        and sf.storage_path = objects.name
        and ((sf.user_id = auth.uid()) or can_manage_assignment(sf.assignment_id))
        and sf.scan_status <> 'quarantined'
        and sf.purged_at is null
    )
  );
