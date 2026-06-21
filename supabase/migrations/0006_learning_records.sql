-- Learning records for quizzes, assignments, evidence, mastery, recommendations, and audit.
-- Live note: apply after 0005_curriculum_hierarchy.

create table if not exists public.quiz_items (
  id text primary key,
  lesson_id text not null references public.lessons on delete cascade,
  milestone_id text references public.milestones on delete set null,
  activity_id text references public.lesson_activities on delete set null,
  position integer not null,
  prompt text not null,
  question_type text not null default 'multiple_choice'
    check (question_type in ('multiple_choice', 'text', 'code')),
  choices jsonb not null default '[]'::jsonb,
  correct_choice_ids text[] not null default '{}',
  rubric jsonb not null default '{}'::jsonb,
  skill_keys text[] not null default '{}',
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_item_id text not null references public.quiz_items on delete cascade,
  session_id uuid references public.learning_sessions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  lesson_id text not null references public.lessons on delete cascade,
  answer_mode text not null check (answer_mode in ('text', 'code', 'multiple_choice', 'file')),
  answer_text text,
  answer_code text,
  choice_id text,
  run_result jsonb,
  score numeric,
  passed boolean,
  feedback text,
  graded_by text not null default 'mentor' check (graded_by in ('mentor', 'teacher', 'system')),
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete set null,
  course_id text references public.courses on delete set null,
  lesson_id text references public.lessons on delete set null,
  milestone_id text references public.milestones on delete set null,
  title text not null,
  instructions text not null default '',
  assigned_by uuid references auth.users on delete set null,
  source text not null default 'teacher' check (source in ('teacher', 'mentor_recommendation', 'system')),
  status text not null default 'draft'
    check (status in ('recommended', 'draft', 'assigned', 'archived')),
  requires_teacher_approval boolean not null default false,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignment_recipients (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  status text not null default 'assigned'
    check (status in ('assigned', 'started', 'submitted', 'returned', 'complete')),
  score numeric,
  feedback text,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (assignment_id, user_id)
);

create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  content text,
  code text,
  file_path text,
  run_result jsonb,
  score numeric,
  feedback text,
  status text not null default 'submitted'
    check (status in ('submitted', 'returned', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  lesson_id text references public.lessons on delete set null,
  milestone_id text references public.milestones on delete set null,
  session_id uuid references public.learning_sessions on delete cascade,
  source_type text not null
    check (source_type in ('chat_turn', 'code_run', 'quiz', 'file', 'teacher_note', 'assignment')),
  source_ref jsonb not null default '{}'::jsonb,
  skill_keys text[] not null default '{}',
  score numeric,
  confidence numeric,
  rubric_result jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.teacher_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users on delete cascade,
  teacher_id uuid not null references auth.users on delete cascade,
  class_id uuid references public.classes on delete set null,
  lesson_id text references public.lessons on delete set null,
  note text not null,
  visibility text not null default 'teacher_private'
    check (visibility in ('teacher_private', 'student_visible')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mentor_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid references public.learning_sessions on delete cascade,
  lesson_id text references public.lessons on delete set null,
  milestone_id text references public.milestones on delete set null,
  recommendation_type text not null
    check (recommendation_type in ('assignment', 'retry', 'rescue', 'intervention')),
  title text not null,
  rationale text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'applied')),
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.grade_overrides (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users on delete cascade,
  teacher_id uuid not null references auth.users on delete cascade,
  target_type text not null
    check (target_type in ('assignment', 'quiz', 'lesson_attempt', 'learning_session')),
  target_id text not null,
  previous_score numeric,
  new_score numeric not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users on delete set null,
  organization_id uuid references public.organizations on delete set null,
  class_id uuid references public.classes on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.student_mastery
  add column if not exists attempt_count integer not null default 0;

alter table public.student_mastery
  add column if not exists latest_score numeric;

alter table public.student_mastery
  add column if not exists confidence numeric;

alter table public.student_mastery
  add column if not exists common_error_patterns jsonb not null default '[]'::jsonb;

alter table public.student_mastery
  add column if not exists last_practiced_at timestamptz;

alter table public.student_mastery
  add column if not exists updated_at timestamptz not null default now();

alter table public.quiz_items enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_recipients enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.learning_evidence enable row level security;
alter table public.teacher_notes enable row level security;
alter table public.mentor_recommendations enable row level security;
alter table public.grade_overrides enable row level security;
alter table public.audit_events enable row level security;

create index if not exists quiz_items_lesson_position_idx
  on public.quiz_items (lesson_id, position);

create index if not exists quiz_attempts_user_lesson_idx
  on public.quiz_attempts (user_id, lesson_id, created_at desc);

create index if not exists assignments_class_status_idx
  on public.assignments (class_id, status, due_at);

create index if not exists assignment_recipients_user_status_idx
  on public.assignment_recipients (user_id, status, updated_at desc);

create index if not exists assignment_submissions_user_assignment_idx
  on public.assignment_submissions (user_id, assignment_id, created_at desc);

create index if not exists learning_evidence_user_skill_idx
  on public.learning_evidence (user_id, created_at desc);

create index if not exists teacher_notes_student_idx
  on public.teacher_notes (student_id, created_at desc);

create index if not exists mentor_recommendations_user_status_idx
  on public.mentor_recommendations (user_id, status, created_at desc);

create index if not exists audit_events_entity_idx
  on public.audit_events (entity_type, entity_id, created_at desc);

create or replace function public.is_assignment_recipient(target_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assignment_recipients ar
    where ar.assignment_id = target_assignment_id
      and ar.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_assignment(target_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.assignments a
      where a.id = target_assignment_id
        and (
          a.assigned_by = auth.uid()
          or (a.class_id is not null and public.is_class_teacher(a.class_id))
          or (a.organization_id is not null and public.is_org_admin(a.organization_id))
        )
    );
$$;

revoke all on function public.is_assignment_recipient(uuid) from public;
revoke all on function public.can_manage_assignment(uuid) from public;
grant execute on function public.is_assignment_recipient(uuid) to authenticated, service_role;
grant execute on function public.can_manage_assignment(uuid) to authenticated, service_role;

grant select on public.quiz_items to anon, authenticated;
grant select, insert, update, delete on public.quiz_attempts to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;
grant select, insert, update, delete on public.assignment_recipients to authenticated;
grant select, insert, update, delete on public.assignment_submissions to authenticated;
grant select, insert, update, delete on public.learning_evidence to authenticated;
grant select, insert, update, delete on public.teacher_notes to authenticated;
grant select, insert, update, delete on public.mentor_recommendations to authenticated;
grant select, insert, update, delete on public.grade_overrides to authenticated;
grant select on public.audit_events to authenticated;

grant select, insert, update, delete on public.quiz_items to service_role;
grant select, insert, update, delete on public.quiz_attempts to service_role;
grant select, insert, update, delete on public.assignments to service_role;
grant select, insert, update, delete on public.assignment_recipients to service_role;
grant select, insert, update, delete on public.assignment_submissions to service_role;
grant select, insert, update, delete on public.learning_evidence to service_role;
grant select, insert, update, delete on public.teacher_notes to service_role;
grant select, insert, update, delete on public.mentor_recommendations to service_role;
grant select, insert, update, delete on public.grade_overrides to service_role;
grant select, insert, update, delete on public.audit_events to service_role;

create policy "Published quiz items are readable"
  on public.quiz_items for select
  using (
    status = 'published'
    and exists (
      select 1
      from public.lessons l
      left join public.units u on u.id = l.unit_id
      left join public.course_versions cv on cv.id = u.course_version_id
      left join public.courses c on c.id = cv.course_id
      where l.id = lesson_id
        and l.publication_status = 'published'
        and (
          l.unit_id is null
          or (cv.status = 'published' and c.status = 'published' and c.organization_id is null)
        )
    )
  );

create policy "Members can view organization quiz items"
  on public.quiz_items for select
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
          (l.publication_status = 'published' and (c.organization_id is null or l.unit_id is null))
          or (c.organization_id is not null and public.is_org_member(c.organization_id))
        )
    )
  );

create policy "Admins can manage quiz items"
  on public.quiz_items for all
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

create policy "Students and teachers can view quiz attempts"
  on public.quiz_attempts for select
  to authenticated
  using (public.can_view_student(user_id));

create policy "Students can create own quiz attempts"
  on public.quiz_attempts for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Teachers can update managed quiz attempts"
  on public.quiz_attempts for update
  to authenticated
  using (public.can_view_student(user_id))
  with check (public.can_view_student(user_id));

create policy "Users can view relevant assignments"
  on public.assignments for select
  to authenticated
  using (
    public.can_manage_assignment(id)
    or public.is_assignment_recipient(id)
    or (class_id is not null and public.is_class_member(class_id))
  );

create policy "Teachers can create assignments"
  on public.assignments for insert
  to authenticated
  with check (
    assigned_by = auth.uid()
    and (
      public.is_platform_admin()
      or (class_id is not null and public.is_class_teacher(class_id))
      or (organization_id is not null and public.is_org_admin(organization_id))
    )
  );

create policy "Teachers can update assignments"
  on public.assignments for update
  to authenticated
  using (public.can_manage_assignment(id))
  with check (
    public.is_platform_admin()
    or (class_id is not null and public.is_class_teacher(class_id))
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Teachers can delete assignments"
  on public.assignments for delete
  to authenticated
  using (public.can_manage_assignment(id));

create policy "Students and teachers can view assignment recipients"
  on public.assignment_recipients for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_assignment(assignment_id)
  );

create policy "Teachers can manage assignment recipients"
  on public.assignment_recipients for all
  to authenticated
  using (public.can_manage_assignment(assignment_id))
  with check (public.can_manage_assignment(assignment_id));

create policy "Students can update own assignment recipient status"
  on public.assignment_recipients for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Students and teachers can view assignment submissions"
  on public.assignment_submissions for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_assignment(assignment_id)
  );

create policy "Students can create own assignment submissions"
  on public.assignment_submissions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Students and teachers can update assignment submissions"
  on public.assignment_submissions for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_assignment(assignment_id)
  )
  with check (
    user_id = auth.uid()
    or public.can_manage_assignment(assignment_id)
  );

create policy "Students and teachers can view learning evidence"
  on public.learning_evidence for select
  to authenticated
  using (public.can_view_student(user_id));

create policy "Students and teachers can create learning evidence"
  on public.learning_evidence for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or public.can_view_student(user_id)
  );

create policy "Teachers can view notes for managed students"
  on public.teacher_notes for select
  to authenticated
  using (
    teacher_id = auth.uid()
    or (visibility = 'student_visible' and student_id = auth.uid())
    or public.can_view_student(student_id)
  );

create policy "Teachers can create notes for managed students"
  on public.teacher_notes for insert
  to authenticated
  with check (
    teacher_id = auth.uid()
    and public.can_view_student(student_id)
  );

create policy "Teachers can update their notes"
  on public.teacher_notes for update
  to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy "Teachers can delete their notes"
  on public.teacher_notes for delete
  to authenticated
  using (teacher_id = auth.uid());

create policy "Students and teachers can view mentor recommendations"
  on public.mentor_recommendations for select
  to authenticated
  using (public.can_view_student(user_id));

create policy "Students can create own mentor recommendations"
  on public.mentor_recommendations for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Teachers can review mentor recommendations"
  on public.mentor_recommendations for update
  to authenticated
  using (public.can_view_student(user_id))
  with check (public.can_view_student(user_id));

create policy "Teachers can view grade overrides for managed students"
  on public.grade_overrides for select
  to authenticated
  using (public.can_view_student(student_id));

create policy "Teachers can create grade overrides for managed students"
  on public.grade_overrides for insert
  to authenticated
  with check (
    teacher_id = auth.uid()
    and public.can_view_student(student_id)
  );

create policy "Admins can view audit events"
  on public.audit_events for select
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Teachers and admins can view managed mastery"
  on public.student_mastery for select
  to authenticated
  using (public.can_view_student(user_id));

insert into public.quiz_items (
  id,
  lesson_id,
  milestone_id,
  activity_id,
  position,
  prompt,
  question_type,
  choices,
  correct_choice_ids,
  rubric,
  skill_keys,
  status
) values
(
  'lesson1-purpose-check',
  'lesson1',
  'lesson1-milestone',
  'lesson1-practice',
  1,
  'Which Jargon line stores the purpose before it is printed?',
  'multiple_choice',
  '[{"id":"a","text":"SET purpose (\"hammers nails\")"},{"id":"b","text":"PRINT tool"},{"id":"c","text":"BREAK"}]'::jsonb,
  ARRAY['a'],
  '{"checks":["Chooses the SET line that stores the purpose"],"pass_threshold":1}'::jsonb,
  ARRAY['process.purpose','jargon.set'],
  'published'
),
(
  'coding2-condition-check',
  'coding2',
  'coding2-milestone',
  'coding2-practice',
  1,
  'In the starter, what decides whether the program prints Wear a jacket?',
  'multiple_choice',
  '[{"id":"a","text":"The value of temperature compared with 20"},{"id":"b","text":"The word PRINT"},{"id":"c","text":"The order of the lesson list"}]'::jsonb,
  ARRAY['a'],
  '{"checks":["Identifies the comparison as the decision point"],"pass_threshold":1}'::jsonb,
  ARRAY['logic.condition','jargon.comparison'],
  'published'
)
on conflict (id) do update set
  lesson_id = excluded.lesson_id,
  milestone_id = excluded.milestone_id,
  activity_id = excluded.activity_id,
  position = excluded.position,
  prompt = excluded.prompt,
  question_type = excluded.question_type,
  choices = excluded.choices,
  correct_choice_ids = excluded.correct_choice_ids,
  rubric = excluded.rubric,
  skill_keys = excluded.skill_keys,
  status = excluded.status,
  updated_at = now();
