-- Chat-LMS identity and role foundation.
-- Live note: apply after 0001_init, 0002_lesson_spine, and 0003_learning_session_runtime.

alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- Tighten early proof-of-concept grants before adding broader classroom roles.
-- Public curriculum remains readable, but private learner records should never be
-- discoverable before sign-in.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.chat_messages from anon;
revoke all privileges on table public.code_submissions from anon;
revoke all privileges on table public.learning_sessions from anon;
revoke all privileges on table public.learning_turns from anon;
revoke all privileges on table public.lesson_attempts from anon;
revoke all privileges on table public.student_mastery from anon;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  organization_type text not null default 'school'
    check (organization_type in ('school', 'district', 'tutoring_group', 'internal')),
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('student', 'teacher', 'org_admin')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  name text not null,
  class_code text unique,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.class_memberships (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('student', 'teacher')),
  status text not null default 'active' check (status in ('active', 'invited', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, user_id)
);

alter table public.organizations enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.classes enable row level security;
alter table public.class_memberships enable row level security;

create index if not exists organization_memberships_user_idx
  on public.organization_memberships (user_id, status);

create index if not exists organization_memberships_org_role_idx
  on public.organization_memberships (organization_id, role, status);

create index if not exists classes_organization_idx
  on public.classes (organization_id, status);

create index if not exists class_memberships_user_idx
  on public.class_memberships (user_id, status);

create index if not exists class_memberships_class_role_idx
  on public.class_memberships (class_id, role, status);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.status = 'active'
    );
$$;

create or replace function public.is_org_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.role = 'org_admin'
        and om.status = 'active'
    );
$$;

create or replace function public.is_org_teacher(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.role in ('teacher', 'org_admin')
        and om.status = 'active'
    );
$$;

create or replace function public.is_class_member(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.classes c
      where c.id = target_class_id
        and public.is_org_admin(c.organization_id)
    )
    or exists (
      select 1
      from public.class_memberships cm
      where cm.class_id = target_class_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    );
$$;

create or replace function public.is_class_teacher(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.classes c
      where c.id = target_class_id
        and public.is_org_admin(c.organization_id)
    )
    or exists (
      select 1
      from public.class_memberships cm
      where cm.class_id = target_class_id
        and cm.user_id = auth.uid()
        and cm.role = 'teacher'
        and cm.status = 'active'
    );
$$;

create or replace function public.can_view_student(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = target_user_id
    or public.is_platform_admin()
    or exists (
      select 1
      from public.class_memberships student_cm
      join public.classes c on c.id = student_cm.class_id
      where student_cm.user_id = target_user_id
        and student_cm.role = 'student'
        and student_cm.status = 'active'
        and public.is_org_admin(c.organization_id)
    )
    or exists (
      select 1
      from public.class_memberships student_cm
      join public.class_memberships teacher_cm
        on teacher_cm.class_id = student_cm.class_id
      where student_cm.user_id = target_user_id
        and student_cm.role = 'student'
        and student_cm.status = 'active'
        and teacher_cm.user_id = auth.uid()
        and teacher_cm.role = 'teacher'
        and teacher_cm.status = 'active'
    );
$$;

revoke all on function public.is_platform_admin() from public;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.is_org_admin(uuid) from public;
revoke all on function public.is_org_teacher(uuid) from public;
revoke all on function public.is_class_member(uuid) from public;
revoke all on function public.is_class_teacher(uuid) from public;
revoke all on function public.can_view_student(uuid) from public;

grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;
grant execute on function public.is_org_teacher(uuid) to authenticated, service_role;
grant execute on function public.is_class_member(uuid) to authenticated, service_role;
grant execute on function public.is_class_teacher(uuid) to authenticated, service_role;
grant execute on function public.can_view_student(uuid) to authenticated, service_role;

grant select on public.organizations to authenticated;
grant update on public.organizations to authenticated;
grant select on public.platform_admins to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select, insert, update, delete on public.class_memberships to authenticated;
grant select on public.profiles to authenticated;

grant select, insert, update, delete on public.organizations to service_role;
grant select, insert, update, delete on public.platform_admins to service_role;
grant select, insert, update, delete on public.organization_memberships to service_role;
grant select, insert, update, delete on public.classes to service_role;
grant select, insert, update, delete on public.class_memberships to service_role;

create policy "Members can view their organizations"
  on public.organizations for select
  to authenticated
  using (public.is_org_member(id));

create policy "Org admins can update their organizations"
  on public.organizations for update
  to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

create policy "Platform admins can view platform admin records"
  on public.platform_admins for select
  to authenticated
  using (public.is_platform_admin());

create policy "Members can view relevant organization memberships"
  on public.organization_memberships for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_org_admin(organization_id)
  );

create policy "Org admins can manage organization memberships"
  on public.organization_memberships for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy "Members can view their classes"
  on public.classes for select
  to authenticated
  using (public.is_class_member(id));

create policy "Teachers and org admins can create classes"
  on public.classes for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_org_teacher(organization_id)
  );

create policy "Teachers and org admins can update classes"
  on public.classes for update
  to authenticated
  using (public.is_class_teacher(id))
  with check (public.is_org_teacher(organization_id));

create policy "Teachers and org admins can delete classes"
  on public.classes for delete
  to authenticated
  using (public.is_class_teacher(id));

create policy "Class members can view relevant class memberships"
  on public.class_memberships for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_class_teacher(class_id)
  );

create policy "Class teachers can manage class memberships"
  on public.class_memberships for all
  to authenticated
  using (public.is_class_teacher(class_id))
  with check (public.is_class_teacher(class_id));

create policy "Teachers and admins can view managed profiles"
  on public.profiles for select
  to authenticated
  using (public.can_view_student(id));
