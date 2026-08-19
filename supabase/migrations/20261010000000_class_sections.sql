-- R45 consolidated classes (owner decision, docs/DECISIONS.md 2026-08-18): sections are
-- student groupings WITHIN a class (7A/7B), not sibling classes. Free-text label on the
-- membership row, teacher-managed through curriculum-admin `set_member_section` /
-- `enroll_students` (both re-check class-teacher access server-side). Additive and
-- idempotent, like every migration in deploy-backend.yml's replay list.
alter table public.class_memberships
  add column if not exists section text;

comment on column public.class_memberships.section is
  'R45: student grouping within the class (e.g. 7A / 7B). Free text; teacher-managed.';
