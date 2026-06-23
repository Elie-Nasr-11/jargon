-- Google Classroom roster import foundation.
-- This is the first school-integration spike: teacher/org-admin OAuth,
-- read-only course/roster import, Jargon remains the learning source of truth.

create table if not exists public.google_classroom_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  connected_by uuid not null references auth.users on delete cascade,
  google_user_id text not null,
  google_email text not null,
  google_name text not null default '',
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
  unique (organization_id, connected_by, google_user_id)
);

create table if not exists public.google_classroom_course_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  connection_id uuid references public.google_classroom_connections on delete set null,
  google_course_id text not null,
  google_course_name text not null,
  google_course_section text,
  google_course_state text,
  class_id uuid references public.classes on delete set null,
  status text not null default 'active' check (status in ('active', 'archived', 'disconnected')),
  last_synced_at timestamptz,
  raw_course jsonb not null default '{}'::jsonb,
  imported_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, google_course_id)
);

create table if not exists public.google_classroom_user_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  course_mapping_id uuid references public.google_classroom_course_mappings on delete cascade,
  google_course_id text,
  google_user_id text not null,
  email text not null,
  display_name text not null default '',
  role text not null check (role in ('student', 'teacher')),
  user_id uuid references auth.users on delete set null,
  last_seen_at timestamptz not null default now(),
  raw_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, google_user_id, role)
);

create table if not exists public.google_classroom_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  connection_id uuid references public.google_classroom_connections on delete set null,
  course_mapping_id uuid references public.google_classroom_course_mappings on delete set null,
  class_id uuid references public.classes on delete set null,
  triggered_by uuid references auth.users on delete set null,
  action text not null check (action in ('oauth_connect', 'list_courses', 'preview_roster', 'import_course', 'disconnect')),
  status text not null default 'success' check (status in ('success', 'partial', 'failed')),
  counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.google_classroom_connections enable row level security;
alter table public.google_classroom_course_mappings enable row level security;
alter table public.google_classroom_user_mappings enable row level security;
alter table public.google_classroom_sync_runs enable row level security;

create index if not exists google_classroom_connections_org_status_idx
  on public.google_classroom_connections (organization_id, status, updated_at desc);

create index if not exists google_classroom_course_mappings_org_idx
  on public.google_classroom_course_mappings (organization_id, status, updated_at desc);

create index if not exists google_classroom_course_mappings_class_idx
  on public.google_classroom_course_mappings (class_id);

create index if not exists google_classroom_user_mappings_org_email_idx
  on public.google_classroom_user_mappings (organization_id, lower(email), role);

create index if not exists google_classroom_user_mappings_user_idx
  on public.google_classroom_user_mappings (user_id);

create index if not exists google_classroom_sync_runs_org_idx
  on public.google_classroom_sync_runs (organization_id, started_at desc);

grant select, insert, update, delete on public.google_classroom_connections to service_role;
grant select, insert, update, delete on public.google_classroom_course_mappings to service_role;
grant select, insert, update, delete on public.google_classroom_user_mappings to service_role;
grant select, insert, update, delete on public.google_classroom_sync_runs to service_role;

grant select on public.google_classroom_course_mappings to authenticated;
grant select on public.google_classroom_user_mappings to authenticated;
grant select on public.google_classroom_sync_runs to authenticated;

revoke all privileges on table public.google_classroom_connections from anon, authenticated;
revoke all privileges on table public.google_classroom_course_mappings from anon;
revoke all privileges on table public.google_classroom_user_mappings from anon;
revoke all privileges on table public.google_classroom_sync_runs from anon;

-- Token-bearing connection rows stay service-role-only. The app reads redacted
-- connection summaries through the google-classroom Edge Function.

drop policy if exists "Admins can view Google Classroom course mappings"
  on public.google_classroom_course_mappings;
create policy "Admins can view Google Classroom course mappings"
  on public.google_classroom_course_mappings for select
  to authenticated
  using (public.is_org_admin(organization_id));

drop policy if exists "Admins can view Google Classroom user mappings"
  on public.google_classroom_user_mappings;
create policy "Admins can view Google Classroom user mappings"
  on public.google_classroom_user_mappings for select
  to authenticated
  using (public.is_org_admin(organization_id));

drop policy if exists "Admins can view Google Classroom sync runs"
  on public.google_classroom_sync_runs;
create policy "Admins can view Google Classroom sync runs"
  on public.google_classroom_sync_runs for select
  to authenticated
  using (public.is_org_admin(organization_id));
