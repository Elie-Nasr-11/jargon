-- Full lesson assessments built on top of the existing quiz item bank.
-- Chat checkpoint quizzes continue to use quiz_attempts.

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  lesson_id text not null references public.lessons on delete cascade,
  title text not null,
  instructions text not null default '',
  created_by uuid references auth.users on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  grading_mode text not null default 'mixed'
    check (grading_mode in ('auto', 'teacher', 'mixed')),
  result_release_policy text not null default 'after_review'
    check (result_release_policy in ('immediate', 'after_review', 'manual')),
  attempt_limit integer not null default 1 check (attempt_limit >= 1 and attempt_limit <= 10),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_items (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments on delete cascade,
  quiz_item_id text not null references public.quiz_items on delete cascade,
  position integer not null,
  points numeric not null default 1 check (points > 0),
  required boolean not null default true,
  rubric_override jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, quiz_item_id),
  unique (assessment_id, position)
);

create table if not exists public.assessment_recipients (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  status text not null default 'assigned'
    check (status in ('assigned', 'started', 'submitted', 'returned', 'complete')),
  final_score numeric,
  feedback text,
  assigned_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz,
  returned_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (assessment_id, user_id)
);

create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments on delete cascade,
  recipient_id uuid references public.assessment_recipients on delete set null,
  user_id uuid not null references auth.users on delete cascade,
  attempt_number integer not null default 1 check (attempt_number >= 1),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'graded', 'returned')),
  auto_score numeric,
  teacher_score numeric,
  final_score numeric,
  feedback text,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  graded_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, user_id, attempt_number)
);

create table if not exists public.assessment_item_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_attempt_id uuid not null references public.assessment_attempts on delete cascade,
  assessment_item_id uuid not null references public.assessment_items on delete cascade,
  quiz_item_id text not null references public.quiz_items on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  answer_mode text not null check (answer_mode in ('text', 'code', 'multiple_choice', 'file')),
  answer_text text,
  answer_code text,
  choice_id text,
  run_result jsonb,
  score numeric,
  max_score numeric not null default 1,
  passed boolean,
  feedback text,
  review_state text not null default 'pending_review'
    check (review_state in ('auto_graded', 'pending_review', 'reviewed')),
  graded_by text not null default 'system'
    check (graded_by in ('system', 'teacher')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_attempt_id, assessment_item_id)
);

alter table public.assessments enable row level security;
alter table public.assessment_items enable row level security;
alter table public.assessment_recipients enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.assessment_item_attempts enable row level security;

create index if not exists assessments_class_lesson_status_idx
  on public.assessments (class_id, lesson_id, status, updated_at desc);

create index if not exists assessments_org_status_idx
  on public.assessments (organization_id, status, updated_at desc);

create index if not exists assessment_items_assessment_position_idx
  on public.assessment_items (assessment_id, position);

create index if not exists assessment_recipients_user_status_idx
  on public.assessment_recipients (user_id, status, updated_at desc);

create index if not exists assessment_recipients_assessment_status_idx
  on public.assessment_recipients (assessment_id, status, updated_at desc);

create index if not exists assessment_attempts_user_assessment_idx
  on public.assessment_attempts (user_id, assessment_id, created_at desc);

create index if not exists assessment_item_attempts_attempt_idx
  on public.assessment_item_attempts (assessment_attempt_id, assessment_item_id);

create or replace function public.is_assessment_recipient(target_assessment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assessment_recipients ar
    where ar.assessment_id = target_assessment_id
      and ar.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_assessment(target_assessment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.assessments a
      where a.id = target_assessment_id
        and (
          a.created_by = auth.uid()
          or (a.class_id is not null and public.is_class_teacher(a.class_id))
          or (a.organization_id is not null and public.is_org_admin(a.organization_id))
        )
    );
$$;

create or replace function public.can_view_assessment_attempt(target_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assessment_attempts aa
    where aa.id = target_attempt_id
      and (
        aa.user_id = auth.uid()
        or public.can_manage_assessment(aa.assessment_id)
      )
  );
$$;

revoke all on function public.is_assessment_recipient(uuid) from public;
revoke all on function public.can_manage_assessment(uuid) from public;
revoke all on function public.can_view_assessment_attempt(uuid) from public;
grant execute on function public.is_assessment_recipient(uuid) to authenticated, service_role;
grant execute on function public.can_manage_assessment(uuid) to authenticated, service_role;
grant execute on function public.can_view_assessment_attempt(uuid) to authenticated, service_role;

grant select, insert, update, delete on public.assessments to authenticated;
grant select, insert, update, delete on public.assessment_items to authenticated;
grant select, insert, update, delete on public.assessment_recipients to authenticated;
grant select, insert, update, delete on public.assessment_attempts to authenticated;
grant select, insert, update, delete on public.assessment_item_attempts to authenticated;

grant select, insert, update, delete on public.assessments to service_role;
grant select, insert, update, delete on public.assessment_items to service_role;
grant select, insert, update, delete on public.assessment_recipients to service_role;
grant select, insert, update, delete on public.assessment_attempts to service_role;
grant select, insert, update, delete on public.assessment_item_attempts to service_role;

revoke all privileges on table public.assessments from anon;
revoke all privileges on table public.assessment_items from anon;
revoke all privileges on table public.assessment_recipients from anon;
revoke all privileges on table public.assessment_attempts from anon;
revoke all privileges on table public.assessment_item_attempts from anon;

create policy "Teachers and assigned students can view assessments"
  on public.assessments for select
  to authenticated
  using (
    public.can_manage_assessment(id)
    or (status = 'published' and public.is_assessment_recipient(id))
  );

create policy "Teachers can create assessments"
  on public.assessments for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Teachers can update assessments"
  on public.assessments for update
  to authenticated
  using (public.can_manage_assessment(id))
  with check (
    public.is_platform_admin()
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Teachers can delete assessments"
  on public.assessments for delete
  to authenticated
  using (public.can_manage_assessment(id));

create policy "Teachers and assigned students can view assessment items"
  on public.assessment_items for select
  to authenticated
  using (
    public.can_manage_assessment(assessment_id)
    or public.is_assessment_recipient(assessment_id)
  );

create policy "Teachers can manage assessment items"
  on public.assessment_items for all
  to authenticated
  using (public.can_manage_assessment(assessment_id))
  with check (public.can_manage_assessment(assessment_id));

create policy "Teachers and assigned students can view assessment recipients"
  on public.assessment_recipients for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_manage_assessment(assessment_id)
  );

create policy "Teachers can manage assessment recipients"
  on public.assessment_recipients for all
  to authenticated
  using (public.can_manage_assessment(assessment_id))
  with check (public.can_manage_assessment(assessment_id));

create policy "Students and teachers can view assessment attempts"
  on public.assessment_attempts for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_manage_assessment(assessment_id)
  );

create policy "Students can create own assessment attempts"
  on public.assessment_attempts for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_assessment_recipient(assessment_id)
  );

create policy "Students and teachers can update assessment attempts"
  on public.assessment_attempts for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_manage_assessment(assessment_id)
  )
  with check (
    user_id = (select auth.uid())
    or public.can_manage_assessment(assessment_id)
  );

create policy "Students and teachers can view assessment item attempts"
  on public.assessment_item_attempts for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_view_assessment_attempt(assessment_attempt_id)
  );

create policy "Students can create own assessment item attempts"
  on public.assessment_item_attempts for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_view_assessment_attempt(assessment_attempt_id)
  );

create policy "Students and teachers can update assessment item attempts"
  on public.assessment_item_attempts for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_view_assessment_attempt(assessment_attempt_id)
  )
  with check (
    user_id = (select auth.uid())
    or public.can_view_assessment_attempt(assessment_attempt_id)
  );
