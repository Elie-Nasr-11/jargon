-- R48 — work items as lesson steps (step ↔ work linkage).
-- A teacher authoring an assignment/assessment-mode step can create the real work item
-- FOR that step; the chat runtime gates the step on the student's submission. The link
-- lives on the work row (assignments/assessments.activity_id → lesson_activities.id),
-- mirroring the existing lesson_resources.activity_id / quiz_items.activity_id precedent:
-- deleting a step SETS NULL, so student work always survives in Classwork.
-- Idempotent and additive; RLS unchanged (the new column rides the existing row policies).

alter table public.assignments
  add column if not exists activity_id text references public.lesson_activities(id) on delete set null;
comment on column public.assignments.activity_id is
  'R48: the lesson step this assignment IS (created from the step editor). Null = standalone classwork.';

alter table public.assessments
  add column if not exists activity_id text references public.lesson_activities(id) on delete set null;
comment on column public.assessments.activity_id is
  'R48: the lesson step this quiz IS (created from the step editor). Null = standalone classwork.';

-- Loose mirror on the unified checkpoints table (no FK — same posture as its lesson_id).
alter table public.checkpoints
  add column if not exists activity_id text;

create index if not exists assignments_activity_idx
  on public.assignments (activity_id) where activity_id is not null;
create index if not exists assessments_activity_idx
  on public.assessments (activity_id) where activity_id is not null;

-- ---------------------------------------------------------------------------
-- Dual-write mirror functions (from 20260701130000) re-created with activity_id
-- so the unified checkpoint rows carry the step linkage too.
-- ---------------------------------------------------------------------------

create or replace function public.sync_checkpoint_from_assignment()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.checkpoints where kind = 'assignment' and legacy_id = old.id;
    return old;
  end if;
  insert into public.checkpoints (
    kind, legacy_id, organization_id, class_id, course_id, lesson_id, milestone_id,
    activity_id, title, instructions, created_by, source, status, required,
    requires_teacher_approval, due_at, created_at, updated_at
  ) values (
    'assignment', new.id, new.organization_id, new.class_id, new.course_id, new.lesson_id,
    new.milestone_id, new.activity_id, new.title, new.instructions, new.assigned_by,
    new.source, new.status, new.required, new.requires_teacher_approval, new.due_at,
    new.created_at, new.updated_at
  )
  on conflict (kind, legacy_id) where legacy_id is not null
  do update set
    organization_id = excluded.organization_id, class_id = excluded.class_id,
    course_id = excluded.course_id, lesson_id = excluded.lesson_id,
    milestone_id = excluded.milestone_id, activity_id = excluded.activity_id,
    title = excluded.title, instructions = excluded.instructions,
    created_by = excluded.created_by, source = excluded.source, status = excluded.status,
    required = excluded.required,
    requires_teacher_approval = excluded.requires_teacher_approval,
    due_at = excluded.due_at, updated_at = excluded.updated_at;
  return new;
end;
$function$;

create or replace function public.sync_checkpoint_from_assessment()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.checkpoints where kind = 'assessment' and legacy_id = old.id;
    return old;
  end if;
  insert into public.checkpoints (
    kind, legacy_id, organization_id, class_id, lesson_id, activity_id, title, instructions,
    created_by, source, status, required, grading_mode, result_release_policy, attempt_limit,
    due_at, created_at, updated_at
  ) values (
    'assessment', new.id, new.organization_id, new.class_id, new.lesson_id, new.activity_id,
    new.title, new.instructions, new.created_by, 'teacher', new.status, new.required,
    new.grading_mode, new.result_release_policy, new.attempt_limit, new.due_at,
    new.created_at, new.updated_at
  )
  on conflict (kind, legacy_id) where legacy_id is not null
  do update set
    organization_id = excluded.organization_id, class_id = excluded.class_id,
    lesson_id = excluded.lesson_id, activity_id = excluded.activity_id,
    title = excluded.title, instructions = excluded.instructions,
    created_by = excluded.created_by, status = excluded.status, required = excluded.required,
    grading_mode = excluded.grading_mode, result_release_policy = excluded.result_release_policy,
    attempt_limit = excluded.attempt_limit, due_at = excluded.due_at, updated_at = excluded.updated_at;
  return new;
end;
$function$;

-- One-shot backfill for rows mirrored before this migration (no-op on fresh DBs;
-- today nothing sets activity_id yet, so this is mostly future-proofing for replays).
update public.checkpoints c
   set activity_id = a.activity_id
  from public.assignments a
 where c.kind = 'assignment' and c.legacy_id = a.id
   and a.activity_id is not null and c.activity_id is distinct from a.activity_id;

update public.checkpoints c
   set activity_id = s.activity_id
  from public.assessments s
 where c.kind = 'assessment' and c.legacy_id = s.id
   and s.activity_id is not null and c.activity_id is distinct from s.activity_id;
