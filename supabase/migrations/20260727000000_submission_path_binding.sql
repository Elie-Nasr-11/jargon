-- Phase 2a: bind the student-submissions INSERT path to the uploader (idempotent, additive hardening).
--
-- The existing INSERT policy on storage.objects for the student-submissions bucket only checks
-- `owner = auth.uid()` — it does not verify that the object path belongs to the uploader. The client
-- writes submission files under `{assignmentId}/{userId}/{submissionId}/{file}` (see
-- storagePathForSubmission), so the 2nd path segment is the student's own id. This policy additionally
-- requires that 2nd segment to equal auth.uid(), so a student cannot place objects under another
-- user's path prefix. Verified: (storage.foldername(name))[2] is the userId segment for the client's
-- scheme, and a legitimate upload always satisfies it (the client builds the path with its own uid).
-- Malformed paths with <2 segments yield NULL → rejected. The real read boundary is unchanged (the
-- SELECT policy is gated by the assignment_submission_files row, not the path); this is defense in
-- depth on the write side.

drop policy if exists "Students can upload own submission files" on storage.objects;
create policy "Students can upload own submission files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'student-submissions'
    and owner = auth.uid()
    and (storage.foldername(name))[2] = auth.uid()::text
  );
