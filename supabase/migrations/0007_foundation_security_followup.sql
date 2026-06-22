-- Security follow-up for the chat-LMS foundation.
-- Live note: apply after 0006_learning_records.

-- New foundation tables live in the exposed public schema for the v1 app, but
-- private learner/classroom records should not have anonymous direct table
-- grants. Public curriculum reads remain intentionally available through RLS.
revoke all privileges on table public.organizations from anon;
revoke all privileges on table public.platform_admins from anon;
revoke all privileges on table public.organization_memberships from anon;
revoke all privileges on table public.classes from anon;
revoke all privileges on table public.class_memberships from anon;
revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.chat_messages from anon;
revoke all privileges on table public.code_submissions from anon;
revoke all privileges on table public.learning_sessions from anon;
revoke all privileges on table public.learning_turns from anon;
revoke all privileges on table public.lesson_attempts from anon;
revoke all privileges on table public.student_mastery from anon;
revoke all privileges on table public.quiz_attempts from anon;
revoke all privileges on table public.assignments from anon;
revoke all privileges on table public.assignment_recipients from anon;
revoke all privileges on table public.assignment_submissions from anon;
revoke all privileges on table public.learning_evidence from anon;
revoke all privileges on table public.teacher_notes from anon;
revoke all privileges on table public.mentor_recommendations from anon;
revoke all privileges on table public.grade_overrides from anon;
revoke all privileges on table public.audit_events from anon;

-- RLS helper functions remain callable by authenticated users because policies
-- depend on them, but anonymous callers do not need direct execute access.
revoke execute on function public.is_platform_admin() from anon;
revoke execute on function public.is_org_member(uuid) from anon;
revoke execute on function public.is_org_admin(uuid) from anon;
revoke execute on function public.is_org_teacher(uuid) from anon;
revoke execute on function public.is_class_member(uuid) from anon;
revoke execute on function public.is_class_teacher(uuid) from anon;
revoke execute on function public.can_view_student(uuid) from anon;
revoke execute on function public.is_assignment_recipient(uuid) from anon;
revoke execute on function public.can_manage_assignment(uuid) from anon;
