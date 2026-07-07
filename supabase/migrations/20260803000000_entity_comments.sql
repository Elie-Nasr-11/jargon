-- Student UI v5: universal comments — entity_comments (additive, idempotent).
--
-- One polymorphic 2-level comment thread per learning entity (lesson / activity / assignment /
-- assessment / grade), class-anchored like material_comments. Two visibilities:
--   * class_public    — every class member sees it (the default "Comment").
--   * teacher_private — ONLY the author and the class's teachers see it ("Private"); classmates never.
-- Visibility is IMMUTABLE post-insert (excluded from UPDATE grants + frozen in the guard).
--
-- entity_id is TEXT on purpose: lessons.id and lesson_activities.id are text PKs while
-- assignments/assessments/checkpoint_recipients are uuid — uuid entities store id::text and the guard
-- casts back per type. No FK (polymorphic); the class_id anchor + per-type guard validation are the
-- integrity gate, and orphaned comments after an entity deletion are inert (nothing joins them back).
--
-- Grade comments are minor-safety sensitive: the guard forces teacher_private for non-teacher authors
-- and requires the checkpoint_recipient row to belong to the author (or the author to be a teacher),
-- so a student can never comment on — or leak — a classmate's grade.

-- ===================================================================================================
-- Table
-- ===================================================================================================
create table if not exists public.entity_comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('lesson', 'activity', 'assignment', 'assessment', 'grade')),
  entity_id text not null,
  class_id uuid not null references public.classes on delete cascade,   -- MANDATORY read anchor
  user_id uuid not null references auth.users on delete cascade,
  parent_id uuid references public.entity_comments on delete cascade,   -- null = top-level; else a reply
  visibility text not null default 'class_public'
    check (visibility in ('class_public', 'teacher_private')),
  body text not null,
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'hidden')),
  hidden_by uuid references auth.users on delete set null,
  hidden_at timestamptz,
  deleted_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists entity_comments_entity_idx
  on public.entity_comments (entity_type, entity_id, class_id, created_at);
create index if not exists entity_comments_parent_idx
  on public.entity_comments (parent_id);

alter table if exists public.entity_comments enable row level security;
revoke all on public.entity_comments from anon;
revoke all on public.entity_comments from authenticated;
grant select, insert on public.entity_comments to authenticated;
-- visibility deliberately NOT grantable: immutable post-insert.
grant update (moderation_status, hidden_by, hidden_at, deleted_at) on public.entity_comments to authenticated;
grant select, insert, update, delete on public.entity_comments to service_role;

-- ===================================================================================================
-- RLS
-- ===================================================================================================
-- Read: class members see live class_public rows plus their OWN teacher_private rows; a class
-- teacher/admin additionally sees everything in the class (incl. hidden/deleted, for moderation).
drop policy if exists entity_comments_select on public.entity_comments;
create policy entity_comments_select on public.entity_comments
  for select to authenticated
  using (
    purged_at is null
    and public.is_class_member(class_id)
    and (
      public.is_class_teacher(class_id)
      or (
        moderation_status = 'visible' and deleted_at is null
        and (visibility = 'class_public' or user_id = auth.uid())
      )
    )
  );

-- Insert: an enrolled member of the class posts as themselves; entity existence/class-match/grade
-- privacy is validated in the guard trigger (per-type, below).
drop policy if exists entity_comments_insert on public.entity_comments;
create policy entity_comments_insert on public.entity_comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_class_member(class_id)
  );

-- Update: a class teacher/admin moderates; the author may soft-delete their own comment. Column grant +
-- guard trigger enforce which columns each may change.
drop policy if exists entity_comments_update on public.entity_comments;
create policy entity_comments_update on public.entity_comments
  for update to authenticated
  using (public.is_class_teacher(class_id) or user_id = auth.uid())
  with check (public.is_class_teacher(class_id) or user_id = auth.uid());

-- ===================================================================================================
-- Guard: entity validation + grade privacy + reply inheritance on INSERT; freeze + moderation gating
-- on UPDATE (the material_comments model, plus the visibility rules).
-- ===================================================================================================
create or replace function public.guard_entity_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  is_mod boolean;
  parent record;
  entity_uuid uuid;
  entity_class uuid;
  grade_owner uuid;
begin
  if tg_op = 'INSERT' then
    new.moderation_status := 'visible';
    new.hidden_by := null;
    new.hidden_at := null;
    new.deleted_at := null;
    new.purged_at := null;

    is_mod := coalesce(public.is_class_teacher(new.class_id), false);

    -- Per-type existence + class-match validation. uuid-backed entities store id::text.
    if new.entity_type in ('assignment', 'assessment', 'grade') then
      begin
        entity_uuid := new.entity_id::uuid;
      exception when others then
        raise exception 'entity_comments: % id must be a uuid', new.entity_type;
      end;
    end if;

    if new.entity_type = 'lesson' then
      if not exists (select 1 from public.lessons l where l.id = new.entity_id) then
        raise exception 'entity_comments: lesson % not found', new.entity_id;
      end if;
    elsif new.entity_type = 'activity' then
      if not exists (select 1 from public.lesson_activities a where a.id = new.entity_id) then
        raise exception 'entity_comments: activity % not found', new.entity_id;
      end if;
    elsif new.entity_type = 'assignment' then
      select a.class_id into entity_class from public.assignments a where a.id = entity_uuid;
      if not found then
        raise exception 'entity_comments: assignment % not found', new.entity_id;
      end if;
      if entity_class is not null and entity_class <> new.class_id then
        raise exception 'entity_comments: class does not match the assignment';
      end if;
    elsif new.entity_type = 'assessment' then
      select a.class_id into entity_class from public.assessments a where a.id = entity_uuid;
      if not found then
        raise exception 'entity_comments: assessment % not found', new.entity_id;
      end if;
      if entity_class is not null and entity_class <> new.class_id then
        raise exception 'entity_comments: class does not match the assessment';
      end if;
    elsif new.entity_type = 'grade' then
      select cr.user_id, c.class_id into grade_owner, entity_class
        from public.checkpoint_recipients cr
        join public.checkpoints c on c.id = cr.checkpoint_id
        where cr.id = entity_uuid;
      if not found then
        raise exception 'entity_comments: grade % not found', new.entity_id;
      end if;
      if entity_class is null or entity_class <> new.class_id then
        raise exception 'entity_comments: class does not match the grade';
      end if;
      -- Grade privacy: only the grade's owner (or a class teacher) may comment on it, and a
      -- non-teacher author's comment is ALWAYS teacher_private — classmates never see grade talk.
      if actor is not null and not is_mod then
        if grade_owner is distinct from actor then
          raise exception 'entity_comments: you may only comment on your own grade';
        end if;
        new.visibility := 'teacher_private';
      end if;
    end if;

    -- 2-level threading: a reply's parent must be a TOP-LEVEL comment on the SAME entity + class,
    -- and the reply INHERITS the parent's visibility (a private thread stays private end to end).
    if new.parent_id is not null then
      select id, parent_id, entity_type, entity_id, class_id, visibility into parent
        from public.entity_comments where id = new.parent_id;
      if parent.id is null then
        raise exception 'entity_comments: parent % not found', new.parent_id;
      end if;
      if parent.parent_id is not null then
        raise exception 'entity_comments: replies may not be nested beyond one level';
      end if;
      if parent.entity_type <> new.entity_type
        or parent.entity_id <> new.entity_id
        or parent.class_id <> new.class_id then
        raise exception 'entity_comments: reply must match parent entity and class';
      end if;
      new.visibility := parent.visibility;
    end if;
    return new;
  end if;

  new.body := old.body;
  new.user_id := old.user_id;
  new.entity_type := old.entity_type;
  new.entity_id := old.entity_id;
  new.class_id := old.class_id;
  new.parent_id := old.parent_id;
  new.visibility := old.visibility;
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

drop trigger if exists trg_guard_entity_comment_ins on public.entity_comments;
create trigger trg_guard_entity_comment_ins
  before insert on public.entity_comments
  for each row execute function public.guard_entity_comment();
drop trigger if exists trg_guard_entity_comment_upd on public.entity_comments;
create trigger trg_guard_entity_comment_upd
  before update on public.entity_comments
  for each row execute function public.guard_entity_comment();

comment on table public.entity_comments is
  'v5 universal comments: 2-level threads on lesson/activity/assignment/assessment/grade, class-anchored; visibility class_public|teacher_private (immutable); grade comments forced teacher_private for students.';

-- ===================================================================================================
-- Notify: a student''s teacher_private comment raises a `private_comment` notification to the class''s
-- active teachers (best-effort; the DM-notify pattern). Deduped to one unread per teacher per student
-- per entity so a burst of comments does not spam the bell.
-- ===================================================================================================
create unique index if not exists notifications_private_comment_unread_idx
  on public.notifications (user_id, kind, related_student_id, (ref->>'entity_type'), (ref->>'entity_id'))
  where read_at is null and kind = 'private_comment';

create or replace function public.notify_entity_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  teacher record;
  author_name text;
begin
  if new.visibility <> 'teacher_private' then
    return new;
  end if;
  -- Teachers replying privately should not notify themselves/other teachers.
  if exists (
    select 1 from public.class_memberships m
    where m.class_id = new.class_id and m.user_id = new.user_id
      and m.role = 'teacher' and m.status = 'active'
  ) then
    return new;
  end if;
  select coalesce(nullif(p.name, ''), 'A student') into author_name
    from public.profiles p where p.id = new.user_id;
  for teacher in
    select m.user_id from public.class_memberships m
    where m.class_id = new.class_id and m.role = 'teacher' and m.status = 'active'
  loop
    insert into public.notifications
      (user_id, class_id, related_student_id, kind, title, ref)
    values (
      teacher.user_id,
      new.class_id,
      new.user_id,
      'private_comment',
      coalesce(author_name, 'A student') || ' left a private comment',
      jsonb_build_object(
        'comment_id', new.id::text,
        'entity_type', new.entity_type,
        'entity_id', new.entity_id,
        'subject_id', new.entity_id,
        'class_id', new.class_id::text
      )
    )
    on conflict do nothing;
  end loop;
  return new;
exception when others then
  return new; -- best-effort: never break the comment write
end;
$$;

drop trigger if exists trg_notify_entity_comment on public.entity_comments;
create trigger trg_notify_entity_comment
  after insert on public.entity_comments
  for each row execute function public.notify_entity_comment();

-- ===================================================================================================
-- Realtime: publish entity_comments so open threads receive live INSERT/UPDATE (RLS still gates rows).
-- ===================================================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entity_comments'
    ) then
      execute 'alter publication supabase_realtime add table public.entity_comments';
    end if;
  end if;
end $$;
