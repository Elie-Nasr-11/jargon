-- Platform completion sprint foundation.
-- Additive only: this prepares non-UI-cleanup breadth for CSV ops,
-- curriculum import, parent reports, consent settings, retention/export
-- workflows, and Google Classroom write-back mappings.

alter table public.google_classroom_sync_runs
  drop constraint if exists google_classroom_sync_runs_action_check;

alter table public.google_classroom_sync_runs
  add constraint google_classroom_sync_runs_action_check
  check (
    action in (
      'oauth_connect',
      'list_courses',
      'preview_roster',
      'import_course',
      'disconnect',
      'export_coursework',
      'sync_coursework',
      'passback_grade',
      'list_coursework',
      'list_submissions'
    )
  );

create table if not exists public.google_classroom_coursework_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  connection_id uuid references public.google_classroom_connections on delete set null,
  course_mapping_id uuid references public.google_classroom_course_mappings on delete cascade,
  class_id uuid references public.classes on delete set null,
  assignment_id uuid references public.assignments on delete set null,
  assessment_id uuid references public.assessments on delete set null,
  google_course_id text not null,
  google_coursework_id text not null,
  google_coursework_title text not null default '',
  alternate_link text,
  sync_direction text not null default 'jargon_to_google'
    check (sync_direction in ('jargon_to_google', 'google_to_jargon')),
  status text not null default 'active'
    check (status in ('active', 'archived', 'error')),
  last_synced_at timestamptz,
  last_error text,
  raw_coursework jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (assignment_id is not null or assessment_id is not null),
  unique (organization_id, google_coursework_id)
);

create table if not exists public.google_classroom_grade_passbacks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  coursework_mapping_id uuid not null references public.google_classroom_coursework_mappings on delete cascade,
  user_id uuid references auth.users on delete set null,
  assignment_submission_id uuid references public.assignment_submissions on delete set null,
  assessment_attempt_id uuid references public.assessment_attempts on delete set null,
  google_submission_id text,
  score numeric,
  max_score numeric,
  status text not null default 'queued'
    check (status in ('queued', 'synced', 'failed', 'skipped')),
  error text,
  payload jsonb not null default '{}'::jsonb,
  synced_by uuid references auth.users on delete set null,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (assignment_submission_id is not null or assessment_attempt_id is not null)
);

create table if not exists public.admin_csv_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  created_by uuid references auth.users on delete set null,
  import_type text not null default 'roster'
    check (import_type in ('roster', 'gradebook', 'progress')),
  status text not null default 'previewed'
    check (status in ('previewed', 'applied', 'failed', 'canceled')),
  filename text not null default '',
  headers text[] not null default '{}',
  row_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_csv_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.admin_csv_import_batches on delete cascade,
  row_index integer not null,
  raw_row jsonb not null default '{}'::jsonb,
  normalized_row jsonb not null default '{}'::jsonb,
  matched_user_id uuid references auth.users on delete set null,
  status text not null default 'ready'
    check (status in ('ready', 'needs_seed', 'duplicate', 'error', 'applied', 'skipped')),
  error text,
  created_at timestamptz not null default now(),
  unique (batch_id, row_index)
);

create table if not exists public.admin_data_export_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  target_user_id uuid references auth.users on delete set null,
  requested_by uuid references auth.users on delete set null,
  export_type text not null
    check (export_type in ('full_archive', 'roster', 'progress', 'gradebook', 'parent_report', 'student_archive')),
  status text not null default 'queued'
    check (status in ('queued', 'complete', 'failed', 'expired')),
  filename text,
  content_type text not null default 'application/json',
  storage_bucket text,
  storage_path text,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz
);

create table if not exists public.admin_data_retention_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  target_user_id uuid references auth.users on delete set null,
  requested_by uuid references auth.users on delete set null,
  approved_by uuid references auth.users on delete set null,
  request_type text not null check (request_type in ('delete', 'anonymize')),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'completed', 'rejected', 'canceled', 'failed')),
  reason text not null default '',
  plan jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.parent_guardian_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  student_id uuid not null references auth.users on delete cascade,
  guardian_user_id uuid references auth.users on delete set null,
  guardian_email text not null,
  guardian_name text not null default '',
  relationship text not null default 'guardian',
  status text not null default 'invited'
    check (status in ('invited', 'active', 'revoked')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_progress_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  student_id uuid not null references auth.users on delete cascade,
  generated_by uuid references auth.users on delete set null,
  report_type text not null default 'parent'
    check (report_type in ('parent', 'teacher', 'admin')),
  title text not null default 'Student progress report',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  summary jsonb not null default '{}'::jsonb,
  body jsonb not null default '{}'::jsonb,
  visibility text not null default 'teacher_private'
    check (visibility in ('teacher_private', 'guardian_visible', 'student_visible')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_consent_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete cascade,
  user_id uuid references auth.users on delete cascade,
  scope text not null check (scope in ('organization', 'class', 'student')),
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'organization' and organization_id is not null and class_id is null and user_id is null)
    or (scope = 'class' and class_id is not null and user_id is null)
    or (scope = 'student' and user_id is not null)
  )
);

create table if not exists public.curriculum_import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  resource_id uuid references public.lesson_resources on delete set null,
  created_by uuid references auth.users on delete set null,
  source_type text not null default 'resource'
    check (source_type in ('resource', 'text', 'upload')),
  status text not null default 'draft'
    check (status in ('draft', 'extracting', 'generated', 'reviewed', 'published', 'failed', 'canceled')),
  title text not null default '',
  source_metadata jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curriculum_import_suggestions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.curriculum_import_jobs on delete cascade,
  organization_id uuid references public.organizations on delete cascade,
  suggestion_type text not null
    check (suggestion_type in ('subject', 'course', 'unit', 'lesson', 'milestone', 'activity', 'quiz', 'resource')),
  position integer not null default 0,
  title text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'accepted', 'rejected', 'edited', 'published')),
  published_target_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_classroom_coursework_mappings enable row level security;
alter table public.google_classroom_grade_passbacks enable row level security;
alter table public.admin_csv_import_batches enable row level security;
alter table public.admin_csv_import_rows enable row level security;
alter table public.admin_data_export_requests enable row level security;
alter table public.admin_data_retention_requests enable row level security;
alter table public.parent_guardian_links enable row level security;
alter table public.student_progress_reports enable row level security;
alter table public.platform_consent_settings enable row level security;
alter table public.curriculum_import_jobs enable row level security;
alter table public.curriculum_import_suggestions enable row level security;

create index if not exists google_classroom_coursework_mappings_org_idx
  on public.google_classroom_coursework_mappings (organization_id, status, updated_at desc);
create index if not exists google_classroom_coursework_mappings_assignment_idx
  on public.google_classroom_coursework_mappings (assignment_id);
create index if not exists google_classroom_coursework_mappings_assessment_idx
  on public.google_classroom_coursework_mappings (assessment_id);
create index if not exists google_classroom_grade_passbacks_mapping_idx
  on public.google_classroom_grade_passbacks (coursework_mapping_id, status, updated_at desc);
create index if not exists admin_csv_import_batches_scope_idx
  on public.admin_csv_import_batches (organization_id, class_id, created_at desc);
create index if not exists admin_csv_import_rows_batch_idx
  on public.admin_csv_import_rows (batch_id, row_index);
create index if not exists admin_data_export_requests_scope_idx
  on public.admin_data_export_requests (organization_id, class_id, target_user_id, created_at desc);
create index if not exists admin_data_retention_requests_scope_idx
  on public.admin_data_retention_requests (organization_id, class_id, target_user_id, created_at desc);
create index if not exists parent_guardian_links_student_idx
  on public.parent_guardian_links (student_id, status);
create unique index if not exists parent_guardian_links_org_student_email_key
  on public.parent_guardian_links (organization_id, student_id, lower(guardian_email));
create index if not exists student_progress_reports_student_idx
  on public.student_progress_reports (student_id, status, created_at desc);
create index if not exists platform_consent_settings_scope_idx
  on public.platform_consent_settings (organization_id, class_id, user_id, scope);
create index if not exists curriculum_import_jobs_scope_idx
  on public.curriculum_import_jobs (organization_id, class_id, status, created_at desc);
create index if not exists curriculum_import_suggestions_job_idx
  on public.curriculum_import_suggestions (job_id, position);

grant select, insert, update, delete on public.google_classroom_coursework_mappings to service_role;
grant select, insert, update, delete on public.google_classroom_grade_passbacks to service_role;
grant select, insert, update, delete on public.admin_csv_import_batches to service_role;
grant select, insert, update, delete on public.admin_csv_import_rows to service_role;
grant select, insert, update, delete on public.admin_data_export_requests to service_role;
grant select, insert, update, delete on public.admin_data_retention_requests to service_role;
grant select, insert, update, delete on public.parent_guardian_links to service_role;
grant select, insert, update, delete on public.student_progress_reports to service_role;
grant select, insert, update, delete on public.platform_consent_settings to service_role;
grant select, insert, update, delete on public.curriculum_import_jobs to service_role;
grant select, insert, update, delete on public.curriculum_import_suggestions to service_role;

grant select, insert, update, delete on public.admin_csv_import_batches to authenticated;
grant select, insert, update, delete on public.admin_csv_import_rows to authenticated;
grant select, insert, update, delete on public.admin_data_export_requests to authenticated;
grant select, insert, update, delete on public.admin_data_retention_requests to authenticated;
grant select, insert, update, delete on public.parent_guardian_links to authenticated;
grant select, insert, update, delete on public.student_progress_reports to authenticated;
grant select, insert, update, delete on public.platform_consent_settings to authenticated;
grant select, insert, update, delete on public.curriculum_import_jobs to authenticated;
grant select, insert, update, delete on public.curriculum_import_suggestions to authenticated;
grant select on public.google_classroom_coursework_mappings to authenticated;
grant select on public.google_classroom_grade_passbacks to authenticated;

revoke all privileges on table public.google_classroom_coursework_mappings from anon;
revoke all privileges on table public.google_classroom_grade_passbacks from anon;
revoke all privileges on table public.admin_csv_import_batches from anon;
revoke all privileges on table public.admin_csv_import_rows from anon;
revoke all privileges on table public.admin_data_export_requests from anon;
revoke all privileges on table public.admin_data_retention_requests from anon;
revoke all privileges on table public.parent_guardian_links from anon;
revoke all privileges on table public.student_progress_reports from anon;
revoke all privileges on table public.platform_consent_settings from anon;
revoke all privileges on table public.curriculum_import_jobs from anon;
revoke all privileges on table public.curriculum_import_suggestions from anon;

drop policy if exists "Admins can view Google coursework mappings"
  on public.google_classroom_coursework_mappings;
create policy "Admins can view Google coursework mappings"
  on public.google_classroom_coursework_mappings for select
  to authenticated
  using (
    public.is_platform_admin()
    or public.is_org_admin(organization_id)
    or (class_id is not null and public.is_class_teacher(class_id))
  );

drop policy if exists "Admins can view Google grade passbacks"
  on public.google_classroom_grade_passbacks;
create policy "Admins can view Google grade passbacks"
  on public.google_classroom_grade_passbacks for select
  to authenticated
  using (
    public.is_platform_admin()
    or public.is_org_admin(organization_id)
    or exists (
      select 1
      from public.google_classroom_coursework_mappings gcm
      where gcm.id = coursework_mapping_id
        and gcm.class_id is not null
        and public.is_class_teacher(gcm.class_id)
    )
  );

drop policy if exists "Admins can manage CSV import batches"
  on public.admin_csv_import_batches;
create policy "Admins can manage CSV import batches"
  on public.admin_csv_import_batches for all
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  )
  with check (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

drop policy if exists "Admins can manage CSV import rows"
  on public.admin_csv_import_rows;
create policy "Admins can manage CSV import rows"
  on public.admin_csv_import_rows for all
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.admin_csv_import_batches b
      where b.id = batch_id
        and b.organization_id is not null
        and public.is_org_admin(b.organization_id)
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.admin_csv_import_batches b
      where b.id = batch_id
        and b.organization_id is not null
        and public.is_org_admin(b.organization_id)
    )
  );

drop policy if exists "Admins can manage data export requests"
  on public.admin_data_export_requests;
create policy "Admins can manage data export requests"
  on public.admin_data_export_requests for all
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

drop policy if exists "Admins can manage data retention requests"
  on public.admin_data_retention_requests;
create policy "Admins can manage data retention requests"
  on public.admin_data_retention_requests for all
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  )
  with check (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

drop policy if exists "Guardians and staff can view guardian links"
  on public.parent_guardian_links;
create policy "Guardians and staff can view guardian links"
  on public.parent_guardian_links for select
  to authenticated
  using (
    guardian_user_id = (select auth.uid())
    or public.can_view_student(student_id)
    or public.is_org_admin(organization_id)
  );

drop policy if exists "Staff can manage guardian links"
  on public.parent_guardian_links;
create policy "Staff can manage guardian links"
  on public.parent_guardian_links for all
  to authenticated
  using (
    public.is_platform_admin()
    or public.is_org_admin(organization_id)
    or (class_id is not null and public.is_class_teacher(class_id))
  )
  with check (
    public.is_platform_admin()
    or public.is_org_admin(organization_id)
    or (class_id is not null and public.is_class_teacher(class_id))
  );

drop policy if exists "Authorized users can view progress reports"
  on public.student_progress_reports;
create policy "Authorized users can view progress reports"
  on public.student_progress_reports for select
  to authenticated
  using (
    public.can_view_student(student_id)
    or exists (
      select 1
      from public.parent_guardian_links pgl
      where pgl.student_id = student_progress_reports.student_id
        and pgl.guardian_user_id = (select auth.uid())
        and pgl.status = 'active'
        and student_progress_reports.visibility = 'guardian_visible'
    )
  );

drop policy if exists "Staff can manage progress reports"
  on public.student_progress_reports;
create policy "Staff can manage progress reports"
  on public.student_progress_reports for all
  to authenticated
  using (public.can_view_student(student_id))
  with check (public.can_view_student(student_id));

drop policy if exists "Authorized users can view consent settings"
  on public.platform_consent_settings;
create policy "Authorized users can view consent settings"
  on public.platform_consent_settings for select
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_member(organization_id))
    or (class_id is not null and public.is_class_member(class_id))
    or user_id = (select auth.uid())
  );

drop policy if exists "Admins can manage consent settings"
  on public.platform_consent_settings;
create policy "Admins can manage consent settings"
  on public.platform_consent_settings for all
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
    or (class_id is not null and public.is_class_teacher(class_id))
    or user_id = (select auth.uid())
  )
  with check (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
    or (class_id is not null and public.is_class_teacher(class_id))
    or user_id = (select auth.uid())
  );

drop policy if exists "Staff can manage curriculum import jobs"
  on public.curriculum_import_jobs;
create policy "Staff can manage curriculum import jobs"
  on public.curriculum_import_jobs for all
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

drop policy if exists "Staff can manage curriculum import suggestions"
  on public.curriculum_import_suggestions;
create policy "Staff can manage curriculum import suggestions"
  on public.curriculum_import_suggestions for all
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.curriculum_import_jobs cij
      where cij.id = job_id
        and (
          (cij.organization_id is not null and public.is_org_admin(cij.organization_id))
          or (cij.class_id is not null and public.is_class_teacher(cij.class_id))
        )
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.curriculum_import_jobs cij
      where cij.id = job_id
        and (
          (cij.organization_id is not null and public.is_org_admin(cij.organization_id))
          or (cij.class_id is not null and public.is_class_teacher(cij.class_id))
        )
    )
  );
