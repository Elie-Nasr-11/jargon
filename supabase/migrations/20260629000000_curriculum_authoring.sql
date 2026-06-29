-- Curriculum authoring: additive ordering columns for top-down structure management.
-- Live note: apply after 20260628000000_canvas_integration.
--
-- Phase 1 of the curriculum authoring redesign. These columns let the new outline
-- drag-reorder subjects, courses, and lessons WITHIN a parent without disturbing the
-- global lesson spine (lessons.position, still used by the runtime lesson list) or the
-- units unique(course_version_id, position) constraint. Purely additive + backfilled;
-- the student runtime is unaffected.

alter table public.subjects
  add column if not exists position integer;

alter table public.courses
  add column if not exists position integer;

-- Per-unit lesson ordering, distinct from lessons.position (the global spine).
alter table public.lessons
  add column if not exists unit_position integer;

-- Backfill subjects.position within each organization, by current title order.
with ordered as (
  select id,
         row_number() over (
           partition by organization_id
           order by title asc, created_at asc
         ) as rn
  from public.subjects
  where position is null
)
update public.subjects s
set position = ordered.rn
from ordered
where s.id = ordered.id;

-- Backfill courses.position within each subject, by current title order.
with ordered as (
  select id,
         row_number() over (
           partition by subject_id
           order by title asc, created_at asc
         ) as rn
  from public.courses
  where position is null
)
update public.courses c
set position = ordered.rn
from ordered
where c.id = ordered.id;

-- Backfill lessons.unit_position within each unit, preserving the current spine order.
with ordered as (
  select id,
         row_number() over (
           partition by unit_id
           order by position asc
         ) as rn
  from public.lessons
  where unit_id is not null
    and unit_position is null
)
update public.lessons l
set unit_position = ordered.rn
from ordered
where l.id = ordered.id;

create index if not exists subjects_org_position_idx
  on public.subjects (organization_id, position);

create index if not exists courses_subject_position_idx
  on public.courses (subject_id, position);

create index if not exists lessons_unit_order_idx
  on public.lessons (unit_id, unit_position);
