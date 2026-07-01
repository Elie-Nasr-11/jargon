-- Checkpoint unification — Phase 3 (DUAL-WRITE + BACKFILL).
-- Keeps the unified checkpoint tables continuously in sync with the legacy assignments +
-- assessments (and their items/recipients) via SECURITY DEFINER triggers, so EVERY write path
-- — direct client inserts, the assessment-admin/chat edge functions, student status updates —
-- mirrors automatically and atomically. Then backfills the existing rows. Nothing reads the
-- unified tables yet (that's Phase 4). Idempotent: create-or-replace fns, drop-then-create
-- triggers, upsert backfill.

-- ---------------------------------------------------------------------------
-- Mirror functions (source row -> checkpoint row). SECURITY DEFINER so the mirror write
-- runs as the table owner and bypasses RLS regardless of who triggered the source write.
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
    title, instructions, created_by, source, status, required, requires_teacher_approval,
    due_at, created_at, updated_at
  ) values (
    'assignment', new.id, new.organization_id, new.class_id, new.course_id, new.lesson_id,
    new.milestone_id, new.title, new.instructions, new.assigned_by, new.source, new.status,
    new.required, new.requires_teacher_approval, new.due_at, new.created_at, new.updated_at
  )
  on conflict (kind, legacy_id) where legacy_id is not null
  do update set
    organization_id = excluded.organization_id, class_id = excluded.class_id,
    course_id = excluded.course_id, lesson_id = excluded.lesson_id,
    milestone_id = excluded.milestone_id, title = excluded.title,
    instructions = excluded.instructions, created_by = excluded.created_by,
    source = excluded.source, status = excluded.status, required = excluded.required,
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
    kind, legacy_id, organization_id, class_id, lesson_id, title, instructions, created_by,
    source, status, required, grading_mode, result_release_policy, attempt_limit,
    due_at, created_at, updated_at
  ) values (
    'assessment', new.id, new.organization_id, new.class_id, new.lesson_id, new.title,
    new.instructions, new.created_by, 'teacher', new.status, new.required, new.grading_mode,
    new.result_release_policy, new.attempt_limit, new.due_at, new.created_at, new.updated_at
  )
  on conflict (kind, legacy_id) where legacy_id is not null
  do update set
    organization_id = excluded.organization_id, class_id = excluded.class_id,
    lesson_id = excluded.lesson_id, title = excluded.title, instructions = excluded.instructions,
    created_by = excluded.created_by, status = excluded.status, required = excluded.required,
    grading_mode = excluded.grading_mode, result_release_policy = excluded.result_release_policy,
    attempt_limit = excluded.attempt_limit, due_at = excluded.due_at, updated_at = excluded.updated_at;
  return new;
end;
$function$;

create or replace function public.sync_checkpoint_recipient_from_assignment()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare cp_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.checkpoint_recipients cr using public.checkpoints c
      where cr.checkpoint_id = c.id and c.kind = 'assignment'
        and c.legacy_id = old.assignment_id and cr.user_id = old.user_id;
    return old;
  end if;
  select id into cp_id from public.checkpoints where kind = 'assignment' and legacy_id = new.assignment_id;
  if cp_id is null then return new; end if;
  insert into public.checkpoint_recipients (
    checkpoint_id, legacy_id, user_id, status, score, feedback, assigned_at, completed_at, updated_at
  ) values (
    cp_id, new.id, new.user_id, new.status, new.score, new.feedback, new.assigned_at,
    new.completed_at, new.updated_at
  )
  on conflict (checkpoint_id, user_id)
  do update set
    status = excluded.status, score = excluded.score, feedback = excluded.feedback,
    assigned_at = excluded.assigned_at, completed_at = excluded.completed_at,
    updated_at = excluded.updated_at, legacy_id = excluded.legacy_id;
  return new;
end;
$function$;

create or replace function public.sync_checkpoint_recipient_from_assessment()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare cp_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.checkpoint_recipients cr using public.checkpoints c
      where cr.checkpoint_id = c.id and c.kind = 'assessment'
        and c.legacy_id = old.assessment_id and cr.user_id = old.user_id;
    return old;
  end if;
  select id into cp_id from public.checkpoints where kind = 'assessment' and legacy_id = new.assessment_id;
  if cp_id is null then return new; end if;
  insert into public.checkpoint_recipients (
    checkpoint_id, legacy_id, user_id, status, final_score, feedback, assigned_at,
    started_at, submitted_at, returned_at, completed_at, updated_at
  ) values (
    cp_id, new.id, new.user_id, new.status, new.final_score, new.feedback, new.assigned_at,
    new.started_at, new.submitted_at, new.returned_at, new.completed_at, new.updated_at
  )
  on conflict (checkpoint_id, user_id)
  do update set
    status = excluded.status, final_score = excluded.final_score, feedback = excluded.feedback,
    assigned_at = excluded.assigned_at, started_at = excluded.started_at,
    submitted_at = excluded.submitted_at, returned_at = excluded.returned_at,
    completed_at = excluded.completed_at, updated_at = excluded.updated_at, legacy_id = excluded.legacy_id;
  return new;
end;
$function$;

create or replace function public.sync_checkpoint_item_from_assessment_item()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare cp_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.checkpoint_items ci using public.checkpoints c
      where ci.checkpoint_id = c.id and c.kind = 'assessment'
        and c.legacy_id = old.assessment_id and ci.quiz_item_id = old.quiz_item_id;
    return old;
  end if;
  select id into cp_id from public.checkpoints where kind = 'assessment' and legacy_id = new.assessment_id;
  if cp_id is null then return new; end if;
  insert into public.checkpoint_items (
    checkpoint_id, legacy_id, quiz_item_id, position, points, required, rubric_override,
    created_at, updated_at
  ) values (
    cp_id, new.id, new.quiz_item_id, new.position, new.points, new.required, new.rubric_override,
    new.created_at, new.updated_at
  )
  on conflict (checkpoint_id, quiz_item_id) where quiz_item_id is not null
  do update set
    position = excluded.position, points = excluded.points, required = excluded.required,
    rubric_override = excluded.rubric_override, updated_at = excluded.updated_at,
    legacy_id = excluded.legacy_id;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_sync_checkpoint_assignment on public.assignments;
create trigger trg_sync_checkpoint_assignment
  after insert or update or delete on public.assignments
  for each row execute function public.sync_checkpoint_from_assignment();

drop trigger if exists trg_sync_checkpoint_assessment on public.assessments;
create trigger trg_sync_checkpoint_assessment
  after insert or update or delete on public.assessments
  for each row execute function public.sync_checkpoint_from_assessment();

drop trigger if exists trg_sync_checkpoint_recipient_assignment on public.assignment_recipients;
create trigger trg_sync_checkpoint_recipient_assignment
  after insert or update or delete on public.assignment_recipients
  for each row execute function public.sync_checkpoint_recipient_from_assignment();

drop trigger if exists trg_sync_checkpoint_recipient_assessment on public.assessment_recipients;
create trigger trg_sync_checkpoint_recipient_assessment
  after insert or update or delete on public.assessment_recipients
  for each row execute function public.sync_checkpoint_recipient_from_assessment();

drop trigger if exists trg_sync_checkpoint_item_assessment on public.assessment_items;
create trigger trg_sync_checkpoint_item_assessment
  after insert or update or delete on public.assessment_items
  for each row execute function public.sync_checkpoint_item_from_assessment_item();

-- ---------------------------------------------------------------------------
-- Backfill existing rows (parents first, then children join to the now-populated parents).
-- Idempotent upserts keyed on (kind, legacy_id) / (checkpoint_id, user_id) / (checkpoint_id, quiz_item_id).
-- ---------------------------------------------------------------------------
insert into public.checkpoints (
  kind, legacy_id, organization_id, class_id, course_id, lesson_id, milestone_id,
  title, instructions, created_by, source, status, required, requires_teacher_approval,
  due_at, created_at, updated_at)
select 'assignment', a.id, a.organization_id, a.class_id, a.course_id, a.lesson_id, a.milestone_id,
  a.title, a.instructions, a.assigned_by, a.source, a.status, a.required, a.requires_teacher_approval,
  a.due_at, a.created_at, a.updated_at
from public.assignments a
on conflict (kind, legacy_id) where legacy_id is not null
do update set
  organization_id = excluded.organization_id, class_id = excluded.class_id,
  course_id = excluded.course_id, lesson_id = excluded.lesson_id, milestone_id = excluded.milestone_id,
  title = excluded.title, instructions = excluded.instructions, created_by = excluded.created_by,
  source = excluded.source, status = excluded.status, required = excluded.required,
  requires_teacher_approval = excluded.requires_teacher_approval, due_at = excluded.due_at,
  updated_at = excluded.updated_at;

insert into public.checkpoints (
  kind, legacy_id, organization_id, class_id, lesson_id, title, instructions, created_by,
  source, status, required, grading_mode, result_release_policy, attempt_limit,
  due_at, created_at, updated_at)
select 'assessment', s.id, s.organization_id, s.class_id, s.lesson_id, s.title, s.instructions,
  s.created_by, 'teacher', s.status, s.required, s.grading_mode, s.result_release_policy,
  s.attempt_limit, s.due_at, s.created_at, s.updated_at
from public.assessments s
on conflict (kind, legacy_id) where legacy_id is not null
do update set
  organization_id = excluded.organization_id, class_id = excluded.class_id,
  lesson_id = excluded.lesson_id, title = excluded.title, instructions = excluded.instructions,
  created_by = excluded.created_by, status = excluded.status, required = excluded.required,
  grading_mode = excluded.grading_mode, result_release_policy = excluded.result_release_policy,
  attempt_limit = excluded.attempt_limit, due_at = excluded.due_at, updated_at = excluded.updated_at;

insert into public.checkpoint_items (
  checkpoint_id, legacy_id, quiz_item_id, position, points, required, rubric_override,
  created_at, updated_at)
select c.id, ai.id, ai.quiz_item_id, ai.position, ai.points, ai.required, ai.rubric_override,
  ai.created_at, ai.updated_at
from public.assessment_items ai
join public.checkpoints c on c.kind = 'assessment' and c.legacy_id = ai.assessment_id
on conflict (checkpoint_id, quiz_item_id) where quiz_item_id is not null
do update set
  position = excluded.position, points = excluded.points, required = excluded.required,
  rubric_override = excluded.rubric_override, updated_at = excluded.updated_at,
  legacy_id = excluded.legacy_id;

insert into public.checkpoint_recipients (
  checkpoint_id, legacy_id, user_id, status, score, feedback, assigned_at, completed_at, updated_at)
select c.id, ar.id, ar.user_id, ar.status, ar.score, ar.feedback, ar.assigned_at,
  ar.completed_at, ar.updated_at
from public.assignment_recipients ar
join public.checkpoints c on c.kind = 'assignment' and c.legacy_id = ar.assignment_id
on conflict (checkpoint_id, user_id)
do update set
  status = excluded.status, score = excluded.score, feedback = excluded.feedback,
  assigned_at = excluded.assigned_at, completed_at = excluded.completed_at,
  updated_at = excluded.updated_at, legacy_id = excluded.legacy_id;

insert into public.checkpoint_recipients (
  checkpoint_id, legacy_id, user_id, status, final_score, feedback, assigned_at,
  started_at, submitted_at, returned_at, completed_at, updated_at)
select c.id, sr.id, sr.user_id, sr.status, sr.final_score, sr.feedback, sr.assigned_at,
  sr.started_at, sr.submitted_at, sr.returned_at, sr.completed_at, sr.updated_at
from public.assessment_recipients sr
join public.checkpoints c on c.kind = 'assessment' and c.legacy_id = sr.assessment_id
on conflict (checkpoint_id, user_id)
do update set
  status = excluded.status, final_score = excluded.final_score, feedback = excluded.feedback,
  assigned_at = excluded.assigned_at, started_at = excluded.started_at,
  submitted_at = excluded.submitted_at, returned_at = excluded.returned_at,
  completed_at = excluded.completed_at, updated_at = excluded.updated_at, legacy_id = excluded.legacy_id;
