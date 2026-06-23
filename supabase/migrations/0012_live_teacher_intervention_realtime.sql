-- Enable pilot-scale realtime updates for live teacher intervention.
-- Existing RLS policies still decide which rows clients are allowed to receive.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'live_session_viewers'
    ) then
      alter publication supabase_realtime add table public.live_session_viewers;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'teacher_live_comments'
    ) then
      alter publication supabase_realtime add table public.teacher_live_comments;
    end if;
  end if;
end $$;
