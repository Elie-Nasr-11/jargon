-- Checkpoint unification — Phase 2 (EXPAND).
-- Adds the unified checkpoint tables as a superset of today's assignments + assessments.
-- Purely additive: nothing reads or writes these yet. Dual-write + backfill land in Phase 3,
-- read migration + contract in Phase 4. Idempotent (safe to re-run on every backend deploy):
-- create table/index if not exists, create-or-replace functions, drop-then-create policies.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The assigned unit (unifies the assignments + assessments headers). `kind` discriminates
-- the two; assessment-only fields (grading_mode/result_release_policy/attempt_limit) and the
-- assignment-only field (requires_teacher_approval) coexist, unused by the other kind.
-- `legacy_id` back-references the source row (assignments.id / assessments.id) so the Phase 3
-- backfill + dual-write can upsert idempotently.
create table if not exists public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('assignment', 'assessment')),
  organization_id uuid,
  class_id uuid,
  course_id text,
  lesson_id text,
  milestone_id text,
  title text not null,
  instructions text not null default '',
  created_by uuid,
  source text not null default 'teacher',
  status text not null default 'draft',
  required boolean not null default false,
  requires_teacher_approval boolean not null default false,
  grading_mode text,
  result_release_policy text,
  attempt_limit integer,
  due_at timestamptz,
  legacy_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The questions/tasks inside a checkpoint (superset of assessment_items; assignments carry none).
create table if not exists public.checkpoint_items (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references public.checkpoints(id) on delete cascade,
  quiz_item_id text,
  position integer not null default 1,
  points numeric not null default 1,
  required boolean not null default true,
  rubric_override jsonb not null default '{}'::jsonb,
  legacy_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-student assignment + progress (unifies assignment_recipients + assessment_recipients).
-- Keeps both `score` (assignment) and `final_score` (assessment) for lossless backfill.
create table if not exists public.checkpoint_recipients (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references public.checkpoints(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'assigned',
  score numeric,
  final_score numeric,
  feedback text,
  assigned_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz,
  returned_at timestamptz,
  completed_at timestamptz,
  legacy_id uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists checkpoints_lesson_idx on public.checkpoints (lesson_id);
create index if not exists checkpoints_class_idx on public.checkpoints (class_id);
create index if not exists checkpoints_org_idx on public.checkpoints (organization_id);
create index if not exists checkpoints_kind_idx on public.checkpoints (kind);
-- One checkpoint per source row (idempotent Phase 3 backfill/dual-write).
create unique index if not exists checkpoints_legacy_uidx
  on public.checkpoints (kind, legacy_id) where legacy_id is not null;

create index if not exists checkpoint_items_checkpoint_idx on public.checkpoint_items (checkpoint_id);
create unique index if not exists checkpoint_items_quiz_uidx
  on public.checkpoint_items (checkpoint_id, quiz_item_id) where quiz_item_id is not null;

create index if not exists checkpoint_recipients_user_idx on public.checkpoint_recipients (user_id);
create unique index if not exists checkpoint_recipients_unique_uidx
  on public.checkpoint_recipients (checkpoint_id, user_id);

-- ---------------------------------------------------------------------------
-- Access helpers (mirror can_manage_assignment/assessment + is_*_recipient)
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_checkpoint(target_checkpoint_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.checkpoints c
      where c.id = target_checkpoint_id
        and (
          c.created_by = auth.uid()
          or (c.class_id is not null and public.is_class_teacher(c.class_id))
          or (c.organization_id is not null and public.is_org_admin(c.organization_id))
        )
    );
$function$;

create or replace function public.is_checkpoint_recipient(target_checkpoint_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.checkpoint_recipients cr
    where cr.checkpoint_id = target_checkpoint_id
      and cr.user_id = auth.uid()
  );
$function$;

-- ---------------------------------------------------------------------------
-- RLS (faithful union of the assignment + assessment policies, per kind)
-- ---------------------------------------------------------------------------
alter table public.checkpoints enable row level security;
alter table public.checkpoint_items enable row level security;
alter table public.checkpoint_recipients enable row level security;

grant select, insert, update, delete on public.checkpoints to authenticated;
grant select, insert, update, delete on public.checkpoint_items to authenticated;
grant select, insert, update, delete on public.checkpoint_recipients to authenticated;

-- checkpoints: assignment recipients (and class members) see assignments; assessment recipients
-- see only PUBLISHED assessments — exactly preserving each kind's current visibility.
drop policy if exists "Users can view relevant checkpoints" on public.checkpoints;
create policy "Users can view relevant checkpoints" on public.checkpoints
  for select to authenticated
  using (
    public.can_manage_checkpoint(id)
    or (
      kind = 'assignment'
      and (
        public.is_checkpoint_recipient(id)
        or (class_id is not null and public.is_class_member(class_id))
      )
    )
    or (kind = 'assessment' and status = 'published' and public.is_checkpoint_recipient(id))
  );

drop policy if exists "Teachers can create checkpoints" on public.checkpoints;
create policy "Teachers can create checkpoints" on public.checkpoints
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

drop policy if exists "Teachers can update checkpoints" on public.checkpoints;
create policy "Teachers can update checkpoints" on public.checkpoints
  for update to authenticated
  using (public.can_manage_checkpoint(id))
  with check (
    public.is_platform_admin()
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

drop policy if exists "Teachers can delete checkpoints" on public.checkpoints;
create policy "Teachers can delete checkpoints" on public.checkpoints
  for delete to authenticated
  using (public.can_manage_checkpoint(id));

-- checkpoint_items
drop policy if exists "Teachers and assigned students can view checkpoint items" on public.checkpoint_items;
create policy "Teachers and assigned students can view checkpoint items" on public.checkpoint_items
  for select to authenticated
  using (
    public.can_manage_checkpoint(checkpoint_id)
    or public.is_checkpoint_recipient(checkpoint_id)
  );

drop policy if exists "Teachers can manage checkpoint items" on public.checkpoint_items;
create policy "Teachers can manage checkpoint items" on public.checkpoint_items
  for all to authenticated
  using (public.can_manage_checkpoint(checkpoint_id))
  with check (public.can_manage_checkpoint(checkpoint_id));

-- checkpoint_recipients
drop policy if exists "Students and teachers can view checkpoint recipients" on public.checkpoint_recipients;
create policy "Students and teachers can view checkpoint recipients" on public.checkpoint_recipients
  for select to authenticated
  using (user_id = auth.uid() or public.can_manage_checkpoint(checkpoint_id));

-- Only ASSIGNMENT recipients allow student self-update (mirrors assignment_recipients today).
-- Assessment progress is written by the graded edge function (service role), never the student,
-- so the kind guard keeps students from self-updating assessment status/score once reads migrate.
drop policy if exists "Students can update own checkpoint recipient status" on public.checkpoint_recipients;
create policy "Students can update own checkpoint recipient status" on public.checkpoint_recipients
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.kind = 'assignment')
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.kind = 'assignment')
  );

drop policy if exists "Teachers can manage checkpoint recipients" on public.checkpoint_recipients;
create policy "Teachers can manage checkpoint recipients" on public.checkpoint_recipients
  for all to authenticated
  using (public.can_manage_checkpoint(checkpoint_id))
  with check (public.can_manage_checkpoint(checkpoint_id));
