-- Comms Slice 1: in-app realtime for the notification bell (additive, idempotent).
--
-- The notifications table (20260720000000) already has hardened owner-read RLS
-- (user_id = auth.uid()) and is written best-effort as the service role. Today the bell POLLS
-- (NotificationsMenu, 90s). This migration adds public.notifications to the supabase_realtime
-- publication so a client can open a postgres_changes INSERT subscription and light the badge/toast
-- instantly. RLS still gates which rows a subscriber receives on the realtime stream (an authenticated
-- realtime connection enforces the SELECT policy), so a user only ever gets their OWN notifications.
--
-- Nothing else changes: no new rows, no new write path, no altered policy. The poll stays as a
-- fallback if the socket drops, so behavior is byte-identical until a row is written for that user.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;
