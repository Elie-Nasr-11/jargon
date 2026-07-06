-- Comms Slice 2: messaging + comment table FOUNDATION (additive, idempotent).
--
-- Net-new tables for two §9 comms features. A REAL MINOR is live, so this is built maximally safe:
--   * dm_channels / dm_messages  -> strict 1:1 student<->teacher direct messaging (mini-chat).
--   * material_comments          -> threaded (2-level) comments under a lesson material.
-- NOTHING reads or writes these tables yet (the UI lands in Slices 3/4), and every table is
-- outward-FK-only (no FK back into any live write path), so the tutor/student flow is byte-
-- unaffected until those UIs ship and a teacher/admin flips the per-class feature flag.
--
-- Safety model (post-moderation, RLS-ENFORCED — never client-only visibility):
--   * Legitimacy: a DM channel is valid only between a DISTINCT active student and active teacher of
--     the SAME class (is_dm_pair). This avoids the can_view_student SELF-trap (that helper is TRUE for
--     a student on their own row), so a student can never forge the teacher side.
--   * Two-writer moderation without RLS column-scoping: column-level UPDATE grants + BEFORE-UPDATE
--     guard triggers freeze body/sender and gate the moderation columns. A teacher/admin may hide;
--     the author may only soft-delete THEIR OWN row (deleted_at) and can NEVER un-hide a moderated
--     message. purged_at is a retention tombstone only the service role can set.
--   * Reads are RLS-enforced: a student sees only visible, non-deleted, non-purged rows; a
--     teacher/admin sees hidden/deleted rows too (moderation + minor-safety audit), never purged.
--   * material_comments carry a MANDATORY class_id anchor: can_view_lesson_resource() is TRUE org-wide
--     or globally for public / class_id-null materials, so reads gate on is_class_member(class_id) to
--     prevent cross-class comment leakage.

-- ---------------------------------------------------------------------------------------------------
-- Helper: is_dm_pair — proves a legitimate 1:1 student<->teacher pairing in a shared active class.
-- SECURITY DEFINER + stable, mirrors the identity helpers in 0004. Distinct roles + distinct users.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.is_dm_pair(p_student uuid, p_teacher uuid, p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_student is not null
    and p_teacher is not null
    and p_class is not null
    and p_student <> p_teacher
    and exists (
      select 1 from public.class_memberships s
      where s.user_id = p_student and s.class_id = p_class
        and s.role = 'student' and s.status = 'active'
    )
    and exists (
      select 1 from public.class_memberships t
      where t.user_id = p_teacher and t.class_id = p_class
        and t.role = 'teacher' and t.status = 'active'
    );
$$;
revoke all on function public.is_dm_pair(uuid, uuid, uuid) from public;
grant execute on function public.is_dm_pair(uuid, uuid, uuid) to authenticated, service_role;

-- ===================================================================================================
-- dm_channels — one open thread per (student, teacher, class).
-- ===================================================================================================
create table if not exists public.dm_channels (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users on delete cascade,
  teacher_id uuid not null references auth.users on delete cascade,
  class_id uuid not null references public.classes on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed', 'blocked')),
  created_by uuid references auth.users on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, teacher_id, class_id)
);
create index if not exists dm_channels_student_idx on public.dm_channels (student_id, last_message_at desc);
create index if not exists dm_channels_teacher_idx on public.dm_channels (teacher_id, last_message_at desc);

alter table if exists public.dm_channels enable row level security;
revoke all on public.dm_channels from anon;
revoke all on public.dm_channels from authenticated;
-- authenticated may read (participants/teachers), open a channel, and update ONLY status
-- (student_id/teacher_id/class_id are immutable — not in the update grant); last_message_at is bumped
-- by a SECURITY DEFINER trigger (owner) so it is not in the authenticated grant either.
grant select, insert on public.dm_channels to authenticated;
grant update (status) on public.dm_channels to authenticated;
grant select, insert, update, delete on public.dm_channels to service_role;

-- Read: the student participant, or any teacher/admin of the class (moderation + the teacher of record).
drop policy if exists dm_channels_select on public.dm_channels;
create policy dm_channels_select on public.dm_channels
  for select to authenticated
  using ((student_id = auth.uid()) or public.is_class_teacher(class_id));

-- Open a channel: EITHER party may open, but the pair must be a legitimate distinct student+teacher of
-- the class (is_dm_pair). A student setting teacher_id=self fails (self isn't an active teacher); a
-- student forging student_id=victim fails (neither party = auth.uid()).
drop policy if exists dm_channels_insert on public.dm_channels;
create policy dm_channels_insert on public.dm_channels
  for insert to authenticated
  with check (
    ((student_id = auth.uid()) or (teacher_id = auth.uid()))
    and public.is_dm_pair(student_id, teacher_id, class_id)
    -- a freshly opened channel is always open and created by the actor (no forged created_by /
    -- pre-blocked channel); status transitions are the teacher-only UPDATE path.
    and status = 'open'
    and created_by = auth.uid()
  );

-- Status changes (close/block/reopen) are a teacher/admin moderation action; the grant already limits
-- authenticated writes to the status column, and is_class_teacher has no self-trap (a student is never
-- a class teacher), so a student can never flip their own channel status.
drop policy if exists dm_channels_update on public.dm_channels;
create policy dm_channels_update on public.dm_channels
  for update to authenticated
  using (public.is_class_teacher(class_id))
  with check (public.is_class_teacher(class_id));

comment on table public.dm_channels is
  '1:1 student<->teacher DM channel, one per (student,teacher,class); validated by is_dm_pair (comms Slice 2).';

-- ===================================================================================================
-- dm_messages — messages within a channel; post-moderation + author self-delete + retention tombstone.
-- ===================================================================================================
create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.dm_channels on delete cascade,
  sender_id uuid not null references auth.users on delete cascade,
  body text not null,
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'hidden')),
  hidden_by uuid references auth.users on delete set null,
  hidden_at timestamptz,
  deleted_at timestamptz,   -- author self-retract (their own row only)
  purged_at timestamptz,    -- retention tombstone (service role only)
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_channel_idx on public.dm_messages (channel_id, created_at);

alter table if exists public.dm_messages enable row level security;
revoke all on public.dm_messages from anon;
revoke all on public.dm_messages from authenticated;
-- Send (insert) + read; update ONLY the moderation/soft-delete columns (body/sender/channel/created_at
-- are immutable — the guard trigger additionally freezes them and gates who may touch which columns).
grant select, insert on public.dm_messages to authenticated;
grant update (moderation_status, hidden_by, hidden_at, deleted_at) on public.dm_messages to authenticated;
grant select, insert, update, delete on public.dm_messages to service_role;

-- Read: the student participant sees only live rows (visible + not self-deleted + not purged); a
-- teacher/admin of the class sees hidden and author-deleted rows too (moderation + minor-safety audit),
-- but never a purged (retention-tombstoned) row.
drop policy if exists dm_messages_select on public.dm_messages;
create policy dm_messages_select on public.dm_messages
  for select to authenticated
  using (
    purged_at is null
    and exists (
      select 1 from public.dm_channels c
      where c.id = channel_id
        and (
          public.is_class_teacher(c.class_id)
          or (
            c.student_id = auth.uid()
            and moderation_status = 'visible'
            and deleted_at is null
          )
        )
    )
  );

-- Send: only a participant, only their own sender_id, only into an OPEN channel. A 'blocked'/'closed'
-- channel rejects new messages. The guard trigger forces clean moderation columns on insert.
drop policy if exists dm_messages_insert on public.dm_messages;
create policy dm_messages_insert on public.dm_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.dm_channels c
      where c.id = channel_id
        and c.status = 'open'
        and ((c.student_id = auth.uid()) or (c.teacher_id = auth.uid()))
    )
  );

-- Update: a teacher/admin moderates any message in the channel; the author may touch only their own
-- row (to soft-delete). The guard trigger enforces WHICH columns each may change.
drop policy if exists dm_messages_update on public.dm_messages;
create policy dm_messages_update on public.dm_messages
  for update to authenticated
  using (
    exists (
      select 1 from public.dm_channels c
      where c.id = channel_id
        and (public.is_class_teacher(c.class_id) or sender_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.dm_channels c
      where c.id = channel_id
        and (public.is_class_teacher(c.class_id) or sender_id = auth.uid())
    )
  );

-- Guard: clean moderation columns on INSERT; freeze immutable columns + gate moderation columns on
-- UPDATE. auth.uid() is null for the service role (PostgREST), so retention/system writes skip the
-- author/teacher gating (service may set purged_at); real authenticated writers are constrained.
create or replace function public.guard_dm_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  is_mod boolean;
begin
  if tg_op = 'INSERT' then
    -- a sender can never pre-hide, pre-moderate, pre-delete, or pre-purge a message
    new.moderation_status := 'visible';
    new.hidden_by := null;
    new.hidden_at := null;
    new.deleted_at := null;
    new.purged_at := null;
    return new;
  end if;

  -- UPDATE: body and identity are immutable for everyone.
  new.body := old.body;
  new.sender_id := old.sender_id;
  new.channel_id := old.channel_id;
  new.created_at := old.created_at;

  if actor is null then
    return new; -- service role (retention sweep etc.) is unconstrained beyond the immutable freeze
  end if;

  select public.is_class_teacher(c.class_id) into is_mod
    from public.dm_channels c where c.id = old.channel_id;

  if coalesce(is_mod, false) then
    -- teacher/admin moderation: may hide/unhide. purge is retention-only; the author's soft-delete
    -- (deleted_at) is theirs to keep (a moderator can never resurrect a retracted message); the
    -- hide-audit metadata is trigger-derived, never client-forged (frozen to old, then re-derived
    -- ONLY on a real status transition).
    new.purged_at := old.purged_at;
    new.deleted_at := old.deleted_at;
    new.hidden_by := old.hidden_by;
    new.hidden_at := old.hidden_at;
    if new.moderation_status = 'hidden' and old.moderation_status <> 'hidden' then
      new.hidden_by := actor;
      new.hidden_at := now();
    elsif new.moderation_status = 'visible' and old.moderation_status <> 'visible' then
      new.hidden_by := null;
      new.hidden_at := null;
    end if;
  else
    -- author path: may ONLY soft-delete their own row; all moderation columns are frozen.
    new.moderation_status := old.moderation_status;
    new.hidden_by := old.hidden_by;
    new.hidden_at := old.hidden_at;
    new.purged_at := old.purged_at;
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_at := now();
    elsif old.deleted_at is not null then
      new.deleted_at := old.deleted_at; -- a soft-delete cannot be reverted by the author
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_dm_message_ins on public.dm_messages;
create trigger trg_guard_dm_message_ins
  before insert on public.dm_messages
  for each row execute function public.guard_dm_message();
drop trigger if exists trg_guard_dm_message_upd on public.dm_messages;
create trigger trg_guard_dm_message_upd
  before update on public.dm_messages
  for each row execute function public.guard_dm_message();

-- Keep dm_channels.last_message_at fresh as messages arrive (SECURITY DEFINER: bumps a column the
-- authenticated sender is not granted). Best-effort; never blocks the message write.
create or replace function public.bump_dm_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dm_channels
    set last_message_at = new.created_at, updated_at = now()
    where id = new.channel_id;
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists trg_bump_dm_channel on public.dm_messages;
create trigger trg_bump_dm_channel
  after insert on public.dm_messages
  for each row execute function public.bump_dm_channel();

comment on table public.dm_messages is
  'Messages in a dm_channel; post-moderation (RLS-enforced hide) + author soft-delete + retention purge (comms Slice 2).';

-- ===================================================================================================
-- material_comments — 2-level threaded comments under a lesson_resource, class-anchored.
-- ===================================================================================================
create table if not exists public.material_comments (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.lesson_resources on delete cascade,
  class_id uuid not null references public.classes on delete cascade,   -- MANDATORY read anchor
  user_id uuid not null references auth.users on delete cascade,
  parent_id uuid references public.material_comments on delete cascade, -- null = top-level; else a reply
  body text not null,
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'hidden')),
  hidden_by uuid references auth.users on delete set null,
  hidden_at timestamptz,
  deleted_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists material_comments_resource_idx
  on public.material_comments (resource_id, class_id, created_at);
create index if not exists material_comments_parent_idx
  on public.material_comments (parent_id);

alter table if exists public.material_comments enable row level security;
revoke all on public.material_comments from anon;
revoke all on public.material_comments from authenticated;
grant select, insert on public.material_comments to authenticated;
grant update (moderation_status, hidden_by, hidden_at, deleted_at) on public.material_comments to authenticated;
grant select, insert, update, delete on public.material_comments to service_role;

-- Read: class members see live rows; a class teacher/admin additionally sees hidden/deleted (moderation
-- + audit). class_id anchor prevents cross-class leakage on public/org/null-class materials.
drop policy if exists material_comments_select on public.material_comments;
create policy material_comments_select on public.material_comments
  for select to authenticated
  using (
    purged_at is null
    and public.is_class_member(class_id)
    and (
      public.is_class_teacher(class_id)
      or (moderation_status = 'visible' and deleted_at is null)
    )
  );

-- Insert: an enrolled member of the class who can actually see the material posts as themselves.
-- can_view_lesson_resource() is belt-and-suspenders (the class_id anchor is the real gate).
drop policy if exists material_comments_insert on public.material_comments;
create policy material_comments_insert on public.material_comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_class_member(class_id)
    and public.can_view_lesson_resource(resource_id)
  );

-- Update: a class teacher/admin moderates; the author may soft-delete their own comment. Column grant +
-- guard trigger enforce which columns each may change.
drop policy if exists material_comments_update on public.material_comments;
create policy material_comments_update on public.material_comments
  for update to authenticated
  using (public.is_class_teacher(class_id) or user_id = auth.uid())
  with check (public.is_class_teacher(class_id) or user_id = auth.uid());

-- Guard: clean moderation columns + validate 2-level threading on INSERT; freeze identity/body + gate
-- moderation columns on UPDATE (author vs teacher), matching the dm_messages model.
create or replace function public.guard_material_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  is_mod boolean;
  parent record;
begin
  if tg_op = 'INSERT' then
    new.moderation_status := 'visible';
    new.hidden_by := null;
    new.hidden_at := null;
    new.deleted_at := null;
    new.purged_at := null;
    -- 2-level threading: a reply's parent must be a TOP-LEVEL comment on the SAME resource + class.
    if new.parent_id is not null then
      select id, parent_id, resource_id, class_id into parent
        from public.material_comments where id = new.parent_id;
      if parent.id is null then
        raise exception 'material_comments: parent % not found', new.parent_id;
      end if;
      if parent.parent_id is not null then
        raise exception 'material_comments: replies may not be nested beyond one level';
      end if;
      if parent.resource_id <> new.resource_id or parent.class_id <> new.class_id then
        raise exception 'material_comments: reply must match parent resource and class';
      end if;
    end if;
    return new;
  end if;

  new.body := old.body;
  new.user_id := old.user_id;
  new.resource_id := old.resource_id;
  new.class_id := old.class_id;
  new.parent_id := old.parent_id;
  new.created_at := old.created_at;

  if actor is null then
    return new; -- service role unconstrained beyond the freeze
  end if;

  is_mod := public.is_class_teacher(old.class_id);
  if coalesce(is_mod, false) then
    -- moderator: purge is retention-only; the author's soft-delete is theirs to keep; hide-audit
    -- metadata is trigger-derived (frozen to old, then re-derived only on a real status transition).
    new.purged_at := old.purged_at;
    new.deleted_at := old.deleted_at;
    new.hidden_by := old.hidden_by;
    new.hidden_at := old.hidden_at;
    if new.moderation_status = 'hidden' and old.moderation_status <> 'hidden' then
      new.hidden_by := actor;
      new.hidden_at := now();
    elsif new.moderation_status = 'visible' and old.moderation_status <> 'visible' then
      new.hidden_by := null;
      new.hidden_at := null;
    end if;
  else
    new.moderation_status := old.moderation_status;
    new.hidden_by := old.hidden_by;
    new.hidden_at := old.hidden_at;
    new.purged_at := old.purged_at;
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_at := now();
    elsif old.deleted_at is not null then
      new.deleted_at := old.deleted_at;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_material_comment_ins on public.material_comments;
create trigger trg_guard_material_comment_ins
  before insert on public.material_comments
  for each row execute function public.guard_material_comment();
drop trigger if exists trg_guard_material_comment_upd on public.material_comments;
create trigger trg_guard_material_comment_upd
  before update on public.material_comments
  for each row execute function public.guard_material_comment();

comment on table public.material_comments is
  '2-level threaded comments under a lesson_resource, class-anchored; post-moderation + author soft-delete (comms Slice 2).';

-- ===================================================================================================
-- Realtime: publish the three tables so Slice 3/4 UIs receive live INSERT/UPDATE (RLS still gates rows).
-- ===================================================================================================
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['dm_channels', 'dm_messages', 'material_comments'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
