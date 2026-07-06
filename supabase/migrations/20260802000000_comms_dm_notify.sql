-- Comms Slice 3: DM discovery helper + direct_message notification writer (additive, idempotent).
--
-- Two small additions on top of the Slice 2 foundation, both best-effort and additive:
--   * list_my_teachers(): a student cannot read teacher rows in class_memberships (its SELECT policy
--     is `user_id = auth.uid() OR is_class_teacher(class_id)`), so they have no way to discover WHICH
--     teacher to open a DM with. This SECURITY DEFINER function returns ONLY the active teachers of the
--     classes the caller is an active student in — nothing broader.
--   * notify_direct_message(): when a DM message lands, raise a `direct_message` notification to the
--     COUNTERPART so their bell (Slice 1 realtime) lights up. Best-effort (own EXCEPTION block) so a
--     notify failure never rolls back the message. Deduped to one unread notification per recipient per
--     channel (a burst of messages does not spam the bell; a fresh one appears once the prior is read).

-- Dedup: one unread direct_message per (recipient, channel). Scoped to the kind so it never interferes
-- with the existing submission/mentor dedup index.
create unique index if not exists notifications_dm_unread_idx
  on public.notifications (user_id, kind, (ref->>'channel_id'))
  where read_at is null and kind = 'direct_message';

create or replace function public.list_my_teachers()
returns table (teacher_id uuid, teacher_name text, class_id uuid, class_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct t.user_id, coalesce(nullif(p.name, ''), 'Teacher'), t.class_id, c.name
  from public.class_memberships s
  join public.class_memberships t
    on t.class_id = s.class_id and t.role = 'teacher' and t.status = 'active'
    and t.user_id <> auth.uid()
  join public.classes c on c.id = t.class_id and c.status = 'active'
  left join public.profiles p on p.id = t.user_id
  where s.user_id = auth.uid() and s.role = 'student' and s.status = 'active';
$$;
revoke all on function public.list_my_teachers() from public;
grant execute on function public.list_my_teachers() to authenticated;

create or replace function public.notify_direct_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ch record;
  recipient uuid;
  sender_name text;
begin
  select student_id, teacher_id, class_id into ch
    from public.dm_channels where id = new.channel_id;
  if ch.student_id is null then
    return new;
  end if;
  recipient := case when new.sender_id = ch.student_id then ch.teacher_id else ch.student_id end;
  if recipient is null or recipient = new.sender_id then
    return new;
  end if;
  select coalesce(nullif(p.name, ''), 'Someone') into sender_name
    from public.profiles p where p.id = new.sender_id;
  insert into public.notifications
    (user_id, class_id, related_student_id, kind, title, ref)
  values (
    recipient,
    ch.class_id,
    ch.student_id,
    'direct_message',
    coalesce(sender_name, 'Someone') || ' sent you a message',
    jsonb_build_object('channel_id', new.channel_id::text, 'subject_id', new.channel_id::text)
  )
  on conflict do nothing;
  return new;
exception when others then
  return new; -- best-effort: never break the message write
end;
$$;

drop trigger if exists trg_notify_direct_message on public.dm_messages;
create trigger trg_notify_direct_message
  after insert on public.dm_messages
  for each row execute function public.notify_direct_message();
