-- Canvas LMS integration foundation. Mirrors the Google Classroom spike
-- (0014): teacher/org-admin OAuth2, read-only course/roster import, with Jargon
-- the learning source of truth. Canvas is per-institution, so the connection
-- stores the institution base_url (e.g. https://school.instructure.com).
-- The grade-passback (push_grades) and scheduled (sync) actions are pre-declared
-- for the deeper phases (C3/C4) so no follow-up migration is needed.

create table if not exists public.canvas_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  connected_by uuid not null references auth.users on delete cascade,
  base_url text not null,
  canvas_user_id text not null,
  canvas_login_id text not null default '',
  canvas_name text not null default '',
  scopes text[] not null default '{}',
  encrypted_refresh_token text not null,
  refresh_token_iv text not null,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  last_error text,
  last_refreshed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, connected_by, canvas_user_id)
);

create table if not exists public.canvas_course_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  connection_id uuid references public.canvas_connections on delete set null,
  canvas_course_id text not null,
  canvas_course_name text not null,
  canvas_course_code text,
  canvas_workflow_state text,
  class_id uuid references public.classes on delete set null,
  status text not null default 'active' check (status in ('active', 'archived', 'disconnected')),
  last_synced_at timestamptz,
  raw_course jsonb not null default '{}'::jsonb,
  imported_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, canvas_course_id)
);

create table if not exists public.canvas_user_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  course_mapping_id uuid references public.canvas_course_mappings on delete cascade,
  canvas_course_id text,
  canvas_user_id text not null,
  email text not null,
  display_name text not null default '',
  role text not null check (role in ('student', 'teacher')),
  user_id uuid references auth.users on delete set null,
  last_seen_at timestamptz not null default now(),
  raw_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, canvas_user_id, role)
);

create table if not exists public.canvas_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  connection_id uuid references public.canvas_connections on delete set null,
  course_mapping_id uuid references public.canvas_course_mappings on delete set null,
  class_id uuid references public.classes on delete set null,
  triggered_by uuid references auth.users on delete set null,
  action text not null check (action in ('oauth_connect', 'list_courses', 'preview_roster', 'import_course', 'disconnect', 'push_grades', 'sync')),
  status text not null default 'success' check (status in ('success', 'partial', 'failed')),
  counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Maps a Jargon graded item to a Canvas assignment for grade passback (C3).
create table if not exists public.canvas_grade_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  course_mapping_id uuid references public.canvas_course_mappings on delete cascade,
  class_id uuid references public.classes on delete set null,
  jargon_kind text not null check (jargon_kind in ('assignment', 'assessment')),
  jargon_id uuid not null,
  canvas_course_id text not null,
  canvas_assignment_id text not null,
  last_pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, jargon_kind, jargon_id)
);

alter table public.canvas_connections enable row level security;
alter table public.canvas_course_mappings enable row level security;
alter table public.canvas_user_mappings enable row level security;
alter table public.canvas_sync_runs enable row level security;
alter table public.canvas_grade_links enable row level security;

create index if not exists canvas_connections_org_status_idx
  on public.canvas_connections (organization_id, status, updated_at desc);
create index if not exists canvas_course_mappings_org_idx
  on public.canvas_course_mappings (organization_id, status, updated_at desc);
create index if not exists canvas_course_mappings_class_idx
  on public.canvas_course_mappings (class_id);
create index if not exists canvas_user_mappings_org_email_idx
  on public.canvas_user_mappings (organization_id, lower(email), role);
create index if not exists canvas_user_mappings_user_idx
  on public.canvas_user_mappings (user_id);
create index if not exists canvas_sync_runs_org_idx
  on public.canvas_sync_runs (organization_id, started_at desc);
create index if not exists canvas_grade_links_org_idx
  on public.canvas_grade_links (organization_id);

grant select, insert, update, delete on public.canvas_connections to service_role;
grant select, insert, update, delete on public.canvas_course_mappings to service_role;
grant select, insert, update, delete on public.canvas_user_mappings to service_role;
grant select, insert, update, delete on public.canvas_sync_runs to service_role;
grant select, insert, update, delete on public.canvas_grade_links to service_role;

grant select on public.canvas_course_mappings to authenticated;
grant select on public.canvas_user_mappings to authenticated;
grant select on public.canvas_sync_runs to authenticated;
grant select on public.canvas_grade_links to authenticated;

revoke all privileges on table public.canvas_connections from anon, authenticated;
revoke all privileges on table public.canvas_course_mappings from anon;
revoke all privileges on table public.canvas_user_mappings from anon;
revoke all privileges on table public.canvas_sync_runs from anon;
revoke all privileges on table public.canvas_grade_links from anon;

-- Token-bearing connection rows stay service-role-only. The app reads redacted
-- connection summaries through the canvas Edge Function.

drop policy if exists "Admins can view Canvas course mappings" on public.canvas_course_mappings;
create policy "Admins can view Canvas course mappings"
  on public.canvas_course_mappings for select
  to authenticated
  using (public.is_org_admin(organization_id));

drop policy if exists "Admins can view Canvas user mappings" on public.canvas_user_mappings;
create policy "Admins can view Canvas user mappings"
  on public.canvas_user_mappings for select
  to authenticated
  using (public.is_org_admin(organization_id));

drop policy if exists "Admins can view Canvas sync runs" on public.canvas_sync_runs;
create policy "Admins can view Canvas sync runs"
  on public.canvas_sync_runs for select
  to authenticated
  using (public.is_org_admin(organization_id));

drop policy if exists "Admins can view Canvas grade links" on public.canvas_grade_links;
create policy "Admins can view Canvas grade links"
  on public.canvas_grade_links for select
  to authenticated
  using (public.is_org_admin(organization_id));
