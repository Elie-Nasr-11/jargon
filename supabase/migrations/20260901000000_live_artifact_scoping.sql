-- Artifacts v1 P8: live mentor-generated artifacts.
--
-- (1) lessons.allow_live_artifacts — per-lesson teacher opt-in for the mentor offering to
--     build a one-off interactive activity for a struggling student (default OFF).
-- (2) lesson_resources.student_id + visibility 'student_private' — a mentor-built artifact
--     belongs to ONE student. created_by stays NULL for these rows (no human authored it);
--     provenance lives in metadata.generated.
-- (3) can_view_lesson_resource is re-declared with the student_private branch. The
--     pre-existing class-null org fallback branch was never visibility-gated, so it is
--     explicitly fenced from student_private here — without the fence, a student_private
--     row with organization_id set and class_id null would be readable by every org
--     member. Teachers keep oversight via can_manage_lesson_resource (unchanged). The
--     lesson-resources storage read policy delegates to this function, so single-file
--     artifacts need NO storage policy change.
--
-- This file is re-applied on every backend deploy — every statement must be idempotent.

alter table public.lessons
  add column if not exists allow_live_artifacts boolean not null default false;

alter table public.lesson_resources
  add column if not exists student_id uuid references auth.users (id) on delete cascade;

create index if not exists lesson_resources_student_lesson_idx
  on public.lesson_resources (student_id, lesson_id)
  where student_id is not null;

alter table public.lesson_resources
  drop constraint if exists lesson_resources_visibility_check;
alter table public.lesson_resources
  add constraint lesson_resources_visibility_check
  check (visibility in ('class_private', 'org_private', 'public', 'student_private'));

alter table public.lesson_resources
  drop constraint if exists lesson_resources_student_private_scope_check;
alter table public.lesson_resources
  add constraint lesson_resources_student_private_scope_check
  check (visibility <> 'student_private' or student_id is not null);

-- Full re-declaration of the view gate (create or replace keeps the 0009 grants).
create or replace function public.can_view_lesson_resource(target_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_lesson_resource(target_resource_id)
    or exists (
      select 1
      from public.lesson_resources lr
      where lr.id = target_resource_id
        and lr.status = 'published'
        and (
          lr.visibility = 'public'
          or (lr.visibility = 'org_private' and lr.organization_id is not null and public.is_org_member(lr.organization_id))
          or (lr.visibility = 'class_private' and lr.class_id is not null and public.is_class_member(lr.class_id))
          or (lr.visibility = 'student_private' and lr.student_id = auth.uid())
          -- Legacy fallback for class-null org rows; must NEVER match student_private.
          or (lr.visibility <> 'student_private' and lr.class_id is null and lr.organization_id is not null and public.is_org_member(lr.organization_id))
        )
    );
$$;
