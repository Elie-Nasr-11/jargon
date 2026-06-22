-- Full platform foundation for admin-seeded pilots, resources, voice, interventions, and ops.
-- Live note: apply after 0008_lessons_primary_milestone_pointer.
-- This migration is additive and does not replay or rewrite 0001-0008.

create table if not exists public.environment_modes (
  id text primary key,
  label text not null,
  description text not null default '',
  is_default boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null,
  environment_mode_id text references public.environment_modes on delete set null,
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete cascade,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flag_key, environment_mode_id, organization_id, class_id)
);

create table if not exists public.admin_account_seed_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  created_by uuid references auth.users on delete set null,
  label text not null,
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'processing', 'complete', 'failed', 'cancelled')),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_account_seed_entries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.admin_account_seed_batches on delete cascade,
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  user_id uuid references auth.users on delete set null,
  email text not null,
  display_name text,
  grade text,
  role text not null check (role in ('student', 'teacher', 'org_admin', 'platform_admin')),
  status text not null default 'pending'
    check (status in ('pending', 'created', 'invited', 'failed', 'skipped', 'disabled')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations on delete cascade,
  mentor_settings jsonb not null default '{}'::jsonb,
  voice_settings jsonb not null default '{}'::jsonb,
  quiz_settings jsonb not null default '{}'::jsonb,
  resource_settings jsonb not null default '{}'::jsonb,
  privacy_settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.class_settings (
  class_id uuid primary key references public.classes on delete cascade,
  mentor_settings jsonb not null default '{}'::jsonb,
  voice_settings jsonb not null default '{}'::jsonb,
  quiz_settings jsonb not null default '{}'::jsonb,
  assignment_settings jsonb not null default '{}'::jsonb,
  live_intervention_settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.student_settings (
  user_id uuid primary key references auth.users on delete cascade,
  mentor_settings jsonb not null default '{}'::jsonb,
  voice_settings jsonb not null default '{}'::jsonb,
  accessibility_settings jsonb not null default '{}'::jsonb,
  privacy_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_completion_rules (
  id uuid primary key default gen_random_uuid(),
  lesson_id text not null references public.lessons on delete cascade,
  milestone_id text references public.milestones on delete cascade,
  rule_type text not null
    check (rule_type in ('rubric_score', 'quiz_pass', 'activity_complete', 'teacher_review', 'manual')),
  required_score numeric,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rubric_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  title text not null,
  description text not null default '',
  rubric jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  course_id text references public.courses on delete set null,
  course_version_id text references public.course_versions on delete set null,
  unit_id text references public.units on delete set null,
  lesson_id text references public.lessons on delete set null,
  milestone_id text references public.milestones on delete set null,
  activity_id text references public.lesson_activities on delete set null,
  assignment_id uuid references public.assignments on delete set null,
  created_by uuid references auth.users on delete set null,
  title text not null,
  description text not null default '',
  resource_type text not null
    check (resource_type in ('video', 'audio', 'pdf', 'flipbook', 'youtube', 'image', 'link', 'document')),
  source_type text not null
    check (source_type in ('upload', 'external_url')),
  storage_bucket text,
  storage_path text,
  external_url text,
  mime_type text,
  file_size_bytes bigint,
  duration_seconds numeric,
  page_count integer,
  thumbnail_path text,
  teacher_notes text not null default '',
  student_instructions text not null default '',
  transcript_text text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  visibility text not null default 'class_private'
    check (visibility in ('class_private', 'org_private', 'public')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (source_type = 'upload' and storage_bucket is not null and storage_path is not null)
    or (source_type = 'external_url' and external_url is not null)
  )
);

create table if not exists public.lesson_resource_placements (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.lesson_resources on delete cascade,
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  course_id text references public.courses on delete cascade,
  course_version_id text references public.course_versions on delete cascade,
  unit_id text references public.units on delete cascade,
  lesson_id text references public.lessons on delete cascade,
  milestone_id text references public.milestones on delete cascade,
  activity_id text references public.lesson_activities on delete cascade,
  assignment_id uuid references public.assignments on delete cascade,
  quiz_item_id text references public.quiz_items on delete cascade,
  position integer not null default 0,
  display_mode text not null default 'card' check (display_mode in ('inline', 'modal', 'card')),
  show_before_stage text check (show_before_stage in ('intro', 'teach', 'practice', 'assessment', 'review', 'complete')),
  created_at timestamptz not null default now()
);

create table if not exists public.resource_interactions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.lesson_resources on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid references public.learning_sessions on delete cascade,
  lesson_id text references public.lessons on delete set null,
  event_type text not null
    check (event_type in ('shown', 'opened', 'played', 'paused', 'completed', 'downloaded')),
  progress_seconds numeric,
  progress_percent numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.assignment_submission_files (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments on delete cascade,
  submission_id uuid references public.assignment_submissions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  storage_bucket text not null default 'student-submissions',
  storage_path text not null,
  original_filename text not null,
  mime_type text,
  file_size_bytes bigint,
  status text not null default 'submitted'
    check (status in ('submitted', 'returned', 'accepted', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intervention_alerts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users on delete cascade,
  class_id uuid references public.classes on delete set null,
  session_id uuid references public.learning_sessions on delete cascade,
  lesson_id text references public.lessons on delete set null,
  created_by uuid references auth.users on delete set null,
  alert_type text not null
    check (alert_type in ('needs_help', 'retry_loop', 'rescue_needed', 'teacher_review', 'safety')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  title text not null,
  message text not null default '',
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  payload jsonb not null default '{}'::jsonb,
  resolved_by uuid references auth.users on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_session_viewers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions on delete cascade,
  student_id uuid not null references auth.users on delete cascade,
  teacher_id uuid not null references auth.users on delete cascade,
  class_id uuid references public.classes on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, teacher_id)
);

create table if not exists public.teacher_live_comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions on delete cascade,
  student_id uuid not null references auth.users on delete cascade,
  teacher_id uuid not null references auth.users on delete cascade,
  class_id uuid references public.classes on delete set null,
  content text not null,
  visibility text not null default 'student_visible'
    check (visibility in ('student_visible', 'teacher_private')),
  turn_id uuid references public.learning_turns on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.transcript_heatmap_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  lesson_id text references public.lessons on delete set null,
  turn_id uuid references public.learning_turns on delete set null,
  event_type text not null
    check (event_type in ('confusion', 'retry', 'rescue', 'quiz_miss', 'failed_code_run', 'low_confidence_dictation', 'teacher_intervention')),
  intensity numeric not null default 1,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.voice_interaction_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid references public.learning_sessions on delete cascade,
  lesson_id text references public.lessons on delete set null,
  turn_id uuid references public.learning_turns on delete set null,
  event_type text not null
    check (event_type in ('dictation_started', 'dictation_transcribed', 'dictation_submitted', 'read_aloud_started', 'read_aloud_finished')),
  input_modality text check (input_modality in ('dictated', 'audio_session')),
  transcript text,
  transcript_confidence numeric,
  duration_seconds numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.runtime_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  organization_id uuid references public.organizations on delete set null,
  class_id uuid references public.classes on delete set null,
  session_id uuid references public.learning_sessions on delete set null,
  lesson_id text references public.lessons on delete set null,
  event_type text not null
    check (event_type in ('chat_failure', 'run_failure', 'stage_transition', 'completion', 'retry', 'rescue', 'controlled_error')),
  status text not null default 'ok' check (status in ('ok', 'error')),
  latency_ms integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.model_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  organization_id uuid references public.organizations on delete set null,
  class_id uuid references public.classes on delete set null,
  session_id uuid references public.learning_sessions on delete set null,
  lesson_id text references public.lessons on delete set null,
  provider text not null default 'openai',
  model text not null,
  task_type text not null
    check (task_type in ('mentor_turn', 'grading', 'rescue', 'authoring', 'summarization', 'speech_to_text', 'text_to_speech')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  estimated_cost_usd numeric,
  latency_ms integer,
  status text not null default 'ok' check (status in ('ok', 'error')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.speech_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  organization_id uuid references public.organizations on delete set null,
  class_id uuid references public.classes on delete set null,
  session_id uuid references public.learning_sessions on delete set null,
  provider text not null default 'browser',
  task_type text not null check (task_type in ('speech_to_text', 'text_to_speech')),
  duration_seconds numeric,
  character_count integer,
  estimated_cost_usd numeric,
  status text not null default 'ok' check (status in ('ok', 'error')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.lesson_attempts
  add column if not exists input_modality text
    check (input_modality in ('typed', 'dictated', 'audio_session'));

alter table public.lesson_attempts
  add column if not exists transcript_confidence numeric;

alter table public.quiz_attempts
  add column if not exists input_modality text
    check (input_modality in ('typed', 'dictated', 'audio_session'));

alter table public.quiz_attempts
  add column if not exists transcript_confidence numeric;

alter table public.assignment_submissions
  add column if not exists submitted_at timestamptz;

alter table public.environment_modes enable row level security;
alter table public.feature_flags enable row level security;
alter table public.admin_account_seed_batches enable row level security;
alter table public.admin_account_seed_entries enable row level security;
alter table public.organization_settings enable row level security;
alter table public.class_settings enable row level security;
alter table public.student_settings enable row level security;
alter table public.lesson_completion_rules enable row level security;
alter table public.rubric_templates enable row level security;
alter table public.lesson_resources enable row level security;
alter table public.lesson_resource_placements enable row level security;
alter table public.resource_interactions enable row level security;
alter table public.assignment_submission_files enable row level security;
alter table public.intervention_alerts enable row level security;
alter table public.live_session_viewers enable row level security;
alter table public.teacher_live_comments enable row level security;
alter table public.transcript_heatmap_events enable row level security;
alter table public.voice_interaction_events enable row level security;
alter table public.runtime_events enable row level security;
alter table public.model_usage_events enable row level security;
alter table public.speech_usage_events enable row level security;

create index if not exists feature_flags_scope_idx
  on public.feature_flags (flag_key, environment_mode_id, organization_id, class_id);

create index if not exists account_seed_batches_org_status_idx
  on public.admin_account_seed_batches (organization_id, status, created_at desc);

create index if not exists account_seed_entries_batch_status_idx
  on public.admin_account_seed_entries (batch_id, status);

create index if not exists lesson_completion_rules_lesson_idx
  on public.lesson_completion_rules (lesson_id, milestone_id, status);

create index if not exists rubric_templates_org_status_idx
  on public.rubric_templates (organization_id, status, updated_at desc);

create index if not exists lesson_resources_scope_idx
  on public.lesson_resources (organization_id, class_id, lesson_id, status, visibility);

create index if not exists lesson_resources_storage_idx
  on public.lesson_resources (storage_bucket, storage_path);

create index if not exists lesson_resource_placements_resource_idx
  on public.lesson_resource_placements (resource_id, position);

create index if not exists lesson_resource_placements_lesson_idx
  on public.lesson_resource_placements (lesson_id, milestone_id, activity_id, position);

create index if not exists resource_interactions_user_resource_idx
  on public.resource_interactions (user_id, resource_id, created_at desc);

create index if not exists assignment_submission_files_user_idx
  on public.assignment_submission_files (user_id, assignment_id, created_at desc);

create index if not exists intervention_alerts_student_status_idx
  on public.intervention_alerts (student_id, status, created_at desc);

create index if not exists live_session_viewers_session_idx
  on public.live_session_viewers (session_id, status, last_seen_at desc);

create index if not exists teacher_live_comments_session_idx
  on public.teacher_live_comments (session_id, created_at);

create index if not exists transcript_heatmap_events_session_idx
  on public.transcript_heatmap_events (session_id, event_type, created_at);

create index if not exists voice_interaction_events_user_idx
  on public.voice_interaction_events (user_id, created_at desc);

create index if not exists runtime_events_session_idx
  on public.runtime_events (session_id, event_type, created_at desc);

create index if not exists model_usage_events_scope_idx
  on public.model_usage_events (organization_id, class_id, user_id, created_at desc);

create index if not exists speech_usage_events_scope_idx
  on public.speech_usage_events (organization_id, class_id, user_id, created_at desc);

create or replace function public.can_manage_lesson_resource(target_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.lesson_resources lr
      where lr.id = target_resource_id
        and (
          lr.created_by = auth.uid()
          or (lr.organization_id is not null and public.is_org_admin(lr.organization_id))
          or (lr.class_id is not null and public.is_class_teacher(lr.class_id))
        )
    );
$$;

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
          or (lr.class_id is null and lr.organization_id is not null and public.is_org_member(lr.organization_id))
        )
    );
$$;

revoke all on function public.can_manage_lesson_resource(uuid) from public;
revoke all on function public.can_view_lesson_resource(uuid) from public;
grant execute on function public.can_manage_lesson_resource(uuid) to authenticated, service_role;
grant execute on function public.can_view_lesson_resource(uuid) to authenticated, service_role;

grant select on public.environment_modes to authenticated;
grant select, insert, update, delete on public.feature_flags to authenticated;
grant select, insert, update, delete on public.admin_account_seed_batches to authenticated;
grant select, insert, update, delete on public.admin_account_seed_entries to authenticated;
grant select, insert, update, delete on public.organization_settings to authenticated;
grant select, insert, update, delete on public.class_settings to authenticated;
grant select, insert, update, delete on public.student_settings to authenticated;
grant select, insert, update, delete on public.lesson_completion_rules to authenticated;
grant select, insert, update, delete on public.rubric_templates to authenticated;
grant select, insert, update, delete on public.lesson_resources to authenticated;
grant select, insert, update, delete on public.lesson_resource_placements to authenticated;
grant select, insert, update, delete on public.resource_interactions to authenticated;
grant select, insert, update, delete on public.assignment_submission_files to authenticated;
grant select, insert, update, delete on public.intervention_alerts to authenticated;
grant select, insert, update, delete on public.live_session_viewers to authenticated;
grant select, insert, update, delete on public.teacher_live_comments to authenticated;
grant select, insert, update, delete on public.transcript_heatmap_events to authenticated;
grant select, insert, update, delete on public.voice_interaction_events to authenticated;
grant select, insert, update, delete on public.runtime_events to authenticated;
grant select, insert, update, delete on public.model_usage_events to authenticated;
grant select, insert, update, delete on public.speech_usage_events to authenticated;

grant select, insert, update, delete on public.environment_modes to service_role;
grant select, insert, update, delete on public.feature_flags to service_role;
grant select, insert, update, delete on public.admin_account_seed_batches to service_role;
grant select, insert, update, delete on public.admin_account_seed_entries to service_role;
grant select, insert, update, delete on public.organization_settings to service_role;
grant select, insert, update, delete on public.class_settings to service_role;
grant select, insert, update, delete on public.student_settings to service_role;
grant select, insert, update, delete on public.lesson_completion_rules to service_role;
grant select, insert, update, delete on public.rubric_templates to service_role;
grant select, insert, update, delete on public.lesson_resources to service_role;
grant select, insert, update, delete on public.lesson_resource_placements to service_role;
grant select, insert, update, delete on public.resource_interactions to service_role;
grant select, insert, update, delete on public.assignment_submission_files to service_role;
grant select, insert, update, delete on public.intervention_alerts to service_role;
grant select, insert, update, delete on public.live_session_viewers to service_role;
grant select, insert, update, delete on public.teacher_live_comments to service_role;
grant select, insert, update, delete on public.transcript_heatmap_events to service_role;
grant select, insert, update, delete on public.voice_interaction_events to service_role;
grant select, insert, update, delete on public.runtime_events to service_role;
grant select, insert, update, delete on public.model_usage_events to service_role;
grant select, insert, update, delete on public.speech_usage_events to service_role;

revoke all privileges on table public.environment_modes from anon;
revoke all privileges on table public.feature_flags from anon;
revoke all privileges on table public.admin_account_seed_batches from anon;
revoke all privileges on table public.admin_account_seed_entries from anon;
revoke all privileges on table public.organization_settings from anon;
revoke all privileges on table public.class_settings from anon;
revoke all privileges on table public.student_settings from anon;
revoke all privileges on table public.lesson_completion_rules from anon;
revoke all privileges on table public.rubric_templates from anon;
revoke all privileges on table public.lesson_resources from anon;
revoke all privileges on table public.lesson_resource_placements from anon;
revoke all privileges on table public.resource_interactions from anon;
revoke all privileges on table public.assignment_submission_files from anon;
revoke all privileges on table public.intervention_alerts from anon;
revoke all privileges on table public.live_session_viewers from anon;
revoke all privileges on table public.teacher_live_comments from anon;
revoke all privileges on table public.transcript_heatmap_events from anon;
revoke all privileges on table public.voice_interaction_events from anon;
revoke all privileges on table public.runtime_events from anon;
revoke all privileges on table public.model_usage_events from anon;
revoke all privileges on table public.speech_usage_events from anon;

create policy "Authenticated users can read environment modes"
  on public.environment_modes for select
  to authenticated
  using (true);

create policy "Platform admins can manage environment modes"
  on public.environment_modes for all
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "Users can read scoped feature flags"
  on public.feature_flags for select
  to authenticated
  using (
    public.is_platform_admin()
    or organization_id is null
    or public.is_org_member(organization_id)
    or (class_id is not null and public.is_class_member(class_id))
  );

create policy "Admins can manage feature flags"
  on public.feature_flags for all
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
    or (class_id is not null and public.is_class_teacher(class_id))
  )
  with check (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
    or (class_id is not null and public.is_class_teacher(class_id))
  );

create policy "Admins can manage account seed batches"
  on public.admin_account_seed_batches for all
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
    or (class_id is not null and public.is_class_teacher(class_id))
  )
  with check (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
    or (class_id is not null and public.is_class_teacher(class_id))
  );

create policy "Admins can manage account seed entries"
  on public.admin_account_seed_entries for all
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
    or (class_id is not null and public.is_class_teacher(class_id))
  )
  with check (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
    or (class_id is not null and public.is_class_teacher(class_id))
  );

create policy "Org members can view organization settings"
  on public.organization_settings for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Org admins can manage organization settings"
  on public.organization_settings for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy "Class members can view class settings"
  on public.class_settings for select
  to authenticated
  using (public.is_class_member(class_id));

create policy "Class teachers can manage class settings"
  on public.class_settings for all
  to authenticated
  using (public.is_class_teacher(class_id))
  with check (public.is_class_teacher(class_id));

create policy "Students and managed teachers can view student settings"
  on public.student_settings for select
  to authenticated
  using (public.can_view_student(user_id));

create policy "Students can manage own student settings"
  on public.student_settings for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Published lesson completion rules are readable"
  on public.lesson_completion_rules for select
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.lessons l
      left join public.units u on u.id = l.unit_id
      left join public.course_versions cv on cv.id = u.course_version_id
      left join public.courses c on c.id = cv.course_id
      where l.id = lesson_id
        and (
          c.organization_id is null
          or public.is_org_member(c.organization_id)
        )
    )
  );

create policy "Admins can manage lesson completion rules"
  on public.lesson_completion_rules for all
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.lessons l
      join public.units u on u.id = l.unit_id
      join public.course_versions cv on cv.id = u.course_version_id
      join public.courses c on c.id = cv.course_id
      where l.id = lesson_id
        and c.organization_id is not null
        and public.is_org_admin(c.organization_id)
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.lessons l
      join public.units u on u.id = l.unit_id
      join public.course_versions cv on cv.id = u.course_version_id
      join public.courses c on c.id = cv.course_id
      where l.id = lesson_id
        and c.organization_id is not null
        and public.is_org_admin(c.organization_id)
    )
  );

create policy "Org members can view rubric templates"
  on public.rubric_templates for select
  to authenticated
  using (
    public.is_platform_admin()
    or organization_id is null
    or public.is_org_member(organization_id)
  );

create policy "Org admins can manage rubric templates"
  on public.rubric_templates for all
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  )
  with check (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Users can view authorized lesson resources"
  on public.lesson_resources for select
  to authenticated
  using (public.can_view_lesson_resource(id));

create policy "Teachers can create lesson resources"
  on public.lesson_resources for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.is_platform_admin()
      or (organization_id is not null and public.is_org_teacher(organization_id))
      or (class_id is not null and public.is_class_teacher(class_id))
    )
  );

create policy "Teachers can update lesson resources"
  on public.lesson_resources for update
  to authenticated
  using (public.can_manage_lesson_resource(id))
  with check (public.can_manage_lesson_resource(id));

create policy "Teachers can delete lesson resources"
  on public.lesson_resources for delete
  to authenticated
  using (public.can_manage_lesson_resource(id));

create policy "Users can view authorized resource placements"
  on public.lesson_resource_placements for select
  to authenticated
  using (public.can_view_lesson_resource(resource_id));

create policy "Teachers can manage resource placements"
  on public.lesson_resource_placements for all
  to authenticated
  using (public.can_manage_lesson_resource(resource_id))
  with check (public.can_manage_lesson_resource(resource_id));

create policy "Students and teachers can view resource interactions"
  on public.resource_interactions for select
  to authenticated
  using (
    public.can_view_student(user_id)
    or public.can_manage_lesson_resource(resource_id)
  );

create policy "Students can create own resource interactions"
  on public.resource_interactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.can_view_lesson_resource(resource_id)
  );

create policy "Students and teachers can view assignment submission files"
  on public.assignment_submission_files for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_assignment(assignment_id)
  );

create policy "Students can create own assignment submission files"
  on public.assignment_submission_files for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_assignment_recipient(assignment_id)
  );

create policy "Students and teachers can update assignment submission files"
  on public.assignment_submission_files for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_assignment(assignment_id)
  )
  with check (
    user_id = auth.uid()
    or public.can_manage_assignment(assignment_id)
  );

create policy "Students and teachers can view intervention alerts"
  on public.intervention_alerts for select
  to authenticated
  using (public.can_view_student(student_id));

create policy "Teachers can create intervention alerts"
  on public.intervention_alerts for insert
  to authenticated
  with check (public.can_view_student(student_id));

create policy "Teachers can update intervention alerts"
  on public.intervention_alerts for update
  to authenticated
  using (public.can_view_student(student_id))
  with check (public.can_view_student(student_id));

create policy "Students and teachers can view live viewers"
  on public.live_session_viewers for select
  to authenticated
  using (
    student_id = auth.uid()
    or public.can_view_student(student_id)
  );

create policy "Teachers can create live viewer rows"
  on public.live_session_viewers for insert
  to authenticated
  with check (
    teacher_id = auth.uid()
    and public.can_view_student(student_id)
  );

create policy "Teachers can update own live viewer rows"
  on public.live_session_viewers for update
  to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy "Students and teachers can view live comments"
  on public.teacher_live_comments for select
  to authenticated
  using (
    student_id = auth.uid()
    or public.can_view_student(student_id)
  );

create policy "Teachers can create live comments"
  on public.teacher_live_comments for insert
  to authenticated
  with check (
    teacher_id = auth.uid()
    and public.can_view_student(student_id)
  );

create policy "Students and teachers can view heatmap events"
  on public.transcript_heatmap_events for select
  to authenticated
  using (public.can_view_student(user_id));

create policy "Runtime can create heatmap events"
  on public.transcript_heatmap_events for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or public.can_view_student(user_id)
  );

create policy "Students and teachers can view voice events"
  on public.voice_interaction_events for select
  to authenticated
  using (public.can_view_student(user_id));

create policy "Students can create own voice events"
  on public.voice_interaction_events for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Students and teachers can view runtime events"
  on public.runtime_events for select
  to authenticated
  using (
    public.is_platform_admin()
    or (user_id is not null and public.can_view_student(user_id))
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Runtime can create runtime events"
  on public.runtime_events for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or public.is_platform_admin()
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Admins and teachers can view model usage"
  on public.model_usage_events for select
  to authenticated
  using (
    public.is_platform_admin()
    or (user_id is not null and public.can_view_student(user_id))
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Runtime can create model usage"
  on public.model_usage_events for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or public.is_platform_admin()
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Admins and teachers can view speech usage"
  on public.speech_usage_events for select
  to authenticated
  using (
    public.is_platform_admin()
    or (user_id is not null and public.can_view_student(user_id))
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Runtime can create speech usage"
  on public.speech_usage_events for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or public.is_platform_admin()
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

insert into public.environment_modes (id, label, description, is_default, settings)
values
  ('local', 'Local', 'Local developer mode.', false, '{}'::jsonb),
  ('staging', 'Staging', 'Pre-pilot verification mode.', false, '{}'::jsonb),
  ('pilot', 'Pilot', 'Real classroom pilot mode.', true, '{"admin_seeded_accounts": true}'::jsonb),
  ('production', 'Production', 'Production classroom mode.', false, '{}'::jsonb)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  is_default = excluded.is_default,
  settings = excluded.settings,
  updated_at = now();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('lesson-resources', 'lesson-resources', false, 104857600, null),
  ('student-submissions', 'student-submissions', false, 52428800, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Authorized users can read lesson resource files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lesson-resources'
    and exists (
      select 1
      from public.lesson_resources lr
      where lr.storage_bucket = storage.objects.bucket_id
        and lr.storage_path = storage.objects.name
        and public.can_view_lesson_resource(lr.id)
    )
  );

create policy "Teachers can upload lesson resource files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'lesson-resources'
    and (
      public.is_platform_admin()
      or exists (
        select 1
        from public.organization_memberships om
        where om.user_id = auth.uid()
          and om.role in ('teacher', 'org_admin')
          and om.status = 'active'
      )
    )
  );

create policy "Teachers can update lesson resource files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'lesson-resources'
    and exists (
      select 1
      from public.lesson_resources lr
      where lr.storage_bucket = storage.objects.bucket_id
        and lr.storage_path = storage.objects.name
        and public.can_manage_lesson_resource(lr.id)
    )
  )
  with check (bucket_id = 'lesson-resources');

create policy "Students and teachers can read submission files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'student-submissions'
    and exists (
      select 1
      from public.assignment_submission_files sf
      where sf.storage_bucket = storage.objects.bucket_id
        and sf.storage_path = storage.objects.name
        and (
          sf.user_id = auth.uid()
          or public.can_manage_assignment(sf.assignment_id)
        )
    )
  );

create policy "Students can upload own submission files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'student-submissions'
    and owner = auth.uid()
  );
