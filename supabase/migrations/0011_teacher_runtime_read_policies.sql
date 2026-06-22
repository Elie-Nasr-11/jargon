-- Teacher Dashboard v1 runtime visibility follow-up.
-- Live note: apply after 0010_resource_helper_anon_revoke.
-- This is intentionally read-only: teachers can inspect runtime records for
-- managed students, but students still own writes through the existing runtime.

create policy "Teachers can view managed learning sessions"
  on public.learning_sessions for select
  to authenticated
  using (public.can_view_student(user_id));

create policy "Teachers can view managed learning turns"
  on public.learning_turns for select
  to authenticated
  using (public.can_view_student(user_id));

create policy "Teachers can view managed lesson attempts"
  on public.lesson_attempts for select
  to authenticated
  using (public.can_view_student(user_id));
