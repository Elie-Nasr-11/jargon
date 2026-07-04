-- v4.0 Phase 2: org-shared lesson templates (docs/PLATFORM.md §4).
-- Additive + idempotent (re-applied on every deploy). A template is a by-value SNAPSHOT of a
-- lesson's mode flow + policy, decoupled from the source lesson so it never drifts.

create table if not exists public.lesson_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  title text not null,
  description text not null default '',
  source_lesson_id text references public.lessons on delete set null,
  -- Versioned snapshot: [{v, position, title, mode, mode_type, prompt, response_mode,
  --   starter_code, expected_output, choices, rubric, skill_keys, pass_score, quiz?}]
  steps jsonb not null default '[]'::jsonb,
  -- Lesson policy snapshot (tutor_tone, tutor_pace, help_ceiling, require_attempt_first,
  -- final_answer_policy, grade_band, objective, skill_keys).
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lesson_templates_org_active_idx
  on public.lesson_templates (organization_id)
  where status = 'active';

alter table if exists public.lesson_templates enable row level security;
-- Never reachable by the anon role (matches the per-table hardening elsewhere in the schema).
revoke all on public.lesson_templates from anon;

-- Templates are a TEACHER-authoring artifact and their `steps` snapshot embeds answer keys
-- (quiz.correct_choice_ids). So both read and write are restricted to org teachers + admins;
-- students (also org members) must never read them. The curriculum-admin edge function uses
-- the service role and re-checks via assertCanAuthor; these policies govern direct client access.
drop policy if exists lesson_templates_select on public.lesson_templates;
create policy lesson_templates_select on public.lesson_templates
  for select using (public.is_org_admin(organization_id) or public.is_org_teacher(organization_id));

drop policy if exists lesson_templates_write on public.lesson_templates;
create policy lesson_templates_write on public.lesson_templates
  for all
  using (public.is_org_admin(organization_id) or public.is_org_teacher(organization_id))
  with check (public.is_org_admin(organization_id) or public.is_org_teacher(organization_id));

comment on table public.lesson_templates is
  'v4.0 org-shared lesson templates: a by-value snapshot of a lesson mode flow + policy that teachers instantiate into new lessons (docs/PLATFORM.md).';
