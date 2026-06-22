-- Keep resource RLS helper functions available to authenticated users and service role,
-- but do not expose them as anonymous RPC endpoints.

revoke execute on function public.can_manage_lesson_resource(uuid) from anon;
revoke execute on function public.can_view_lesson_resource(uuid) from anon;

grant execute on function public.can_manage_lesson_resource(uuid) to authenticated, service_role;
grant execute on function public.can_view_lesson_resource(uuid) to authenticated, service_role;
