-- Memory v2 (docs/DECISIONS.md 2026-08-01): student-owned reset + relevance index.
--
-- Reset: the v1 "append-only for students" stance on session_summaries yields ONE
-- exception — a student may erase their own memory WHOLESALE ("reset what your mentor
-- remembers"). Full-history deletion is a privacy affordance, not history forking:
-- per-row edits remain impossible (no update grant/policy), and the delete policies
-- scope to auth.uid() so a student can only ever erase themselves. The chat fn holds
-- no service key, so the client issues these deletes under the student's own JWT.

grant delete on public.session_summaries to authenticated;
drop policy if exists session_summaries_owner_delete on public.session_summaries;
create policy session_summaries_owner_delete on public.session_summaries
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant delete on public.student_memory to authenticated;
drop policy if exists student_memory_owner_delete on public.student_memory;
create policy student_memory_owner_delete on public.student_memory
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Relevance: the v2 summary picker pools a student's summaries and ranks them by
-- lesson/unit match for the CURRENT lesson — index the pair it filters on.
create index if not exists session_summaries_user_lesson_idx
  on public.session_summaries (user_id, lesson_id);
