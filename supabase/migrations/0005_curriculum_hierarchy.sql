-- Curriculum hierarchy for structured authoring.
-- Live note: apply after 0004_identity_and_roles.

create table if not exists public.subjects (
  id text primary key,
  organization_id uuid references public.organizations on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id text primary key,
  subject_id text not null references public.subjects on delete cascade,
  organization_id uuid references public.organizations on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_versions (
  id text primary key,
  course_id text not null references public.courses on delete cascade,
  version_label text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_current boolean not null default false,
  content_schema_version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, version_label)
);

create table if not exists public.units (
  id text primary key,
  course_version_id text not null references public.course_versions on delete cascade,
  position integer not null,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_version_id, position)
);

alter table public.lessons
  add column if not exists unit_id text references public.units on delete set null;

alter table public.lessons
  add column if not exists author_user_id uuid references auth.users on delete set null;

alter table public.lessons
  add column if not exists publication_status text not null default 'published'
    check (publication_status in ('draft', 'published', 'archived'));

alter table public.lessons
  add column if not exists curriculum_metadata jsonb not null default '{}'::jsonb;

create table if not exists public.milestones (
  id text primary key,
  lesson_id text not null references public.lessons on delete cascade,
  position integer not null,
  title text not null,
  objective text not null,
  level text not null default 'Level 0-1',
  skill_keys text[] not null default '{}',
  expected_evidence jsonb not null default '{}'::jsonb,
  completion_rules jsonb not null default '{}'::jsonb,
  allowed_response_modes text[] not null default ARRAY['text'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, position)
);

alter table public.lesson_activities
  add column if not exists milestone_id text references public.milestones on delete set null;

alter table public.subjects enable row level security;
alter table public.courses enable row level security;
alter table public.course_versions enable row level security;
alter table public.units enable row level security;
alter table public.milestones enable row level security;

create index if not exists subjects_organization_status_idx
  on public.subjects (organization_id, status);

create index if not exists courses_subject_status_idx
  on public.courses (subject_id, status);

create index if not exists course_versions_course_status_idx
  on public.course_versions (course_id, status, is_current);

create index if not exists units_course_version_position_idx
  on public.units (course_version_id, position);

create index if not exists lessons_unit_position_idx
  on public.lessons (unit_id, position);

create index if not exists milestones_lesson_position_idx
  on public.milestones (lesson_id, position);

create index if not exists lesson_activities_milestone_idx
  on public.lesson_activities (milestone_id);

grant select on public.subjects to anon, authenticated;
grant select on public.courses to anon, authenticated;
grant select on public.course_versions to anon, authenticated;
grant select on public.units to anon, authenticated;
grant select on public.milestones to anon, authenticated;
grant select on public.lessons to anon, authenticated;
grant select on public.lesson_activities to anon, authenticated;

grant insert, update, delete on public.subjects to authenticated;
grant insert, update, delete on public.courses to authenticated;
grant insert, update, delete on public.course_versions to authenticated;
grant insert, update, delete on public.units to authenticated;
grant insert, update, delete on public.milestones to authenticated;
grant insert, update, delete on public.lessons to authenticated;
grant insert, update, delete on public.lesson_activities to authenticated;

grant select, insert, update, delete on public.subjects to service_role;
grant select, insert, update, delete on public.courses to service_role;
grant select, insert, update, delete on public.course_versions to service_role;
grant select, insert, update, delete on public.units to service_role;
grant select, insert, update, delete on public.milestones to service_role;

drop policy if exists "Lessons are readable by everyone" on public.lessons;
drop policy if exists "Lesson activities are readable by everyone" on public.lesson_activities;

create policy "Published global subjects are public"
  on public.subjects for select
  using (status = 'published' and organization_id is null);

create policy "Members can view organization subjects"
  on public.subjects for select
  to authenticated
  using (
    public.is_platform_admin()
    or (status = 'published' and organization_id is null)
    or (organization_id is not null and public.is_org_member(organization_id))
  );

create policy "Admins can manage subjects"
  on public.subjects for all
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  )
  with check (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Published global courses are public"
  on public.courses for select
  using (status = 'published' and organization_id is null);

create policy "Members can view organization courses"
  on public.courses for select
  to authenticated
  using (
    public.is_platform_admin()
    or (status = 'published' and organization_id is null)
    or (organization_id is not null and public.is_org_member(organization_id))
  );

create policy "Admins can manage courses"
  on public.courses for all
  to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  )
  with check (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "Published course versions are public"
  on public.course_versions for select
  using (
    status = 'published'
    and exists (
      select 1
      from public.courses c
      where c.id = course_id
        and c.status = 'published'
        and c.organization_id is null
    )
  );

create policy "Members can view organization course versions"
  on public.course_versions for select
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.courses c
      where c.id = course_id
        and (
          (c.status = 'published' and c.organization_id is null)
          or (c.organization_id is not null and public.is_org_member(c.organization_id))
        )
    )
  );

create policy "Admins can manage course versions"
  on public.course_versions for all
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.courses c
      where c.id = course_id
        and c.organization_id is not null
        and public.is_org_admin(c.organization_id)
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.courses c
      where c.id = course_id
        and c.organization_id is not null
        and public.is_org_admin(c.organization_id)
    )
  );

create policy "Published units are public"
  on public.units for select
  using (
    exists (
      select 1
      from public.course_versions cv
      join public.courses c on c.id = cv.course_id
      where cv.id = course_version_id
        and cv.status = 'published'
        and c.status = 'published'
        and c.organization_id is null
    )
  );

create policy "Members can view organization units"
  on public.units for select
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.course_versions cv
      join public.courses c on c.id = cv.course_id
      where cv.id = course_version_id
        and (
          (c.status = 'published' and c.organization_id is null)
          or (c.organization_id is not null and public.is_org_member(c.organization_id))
        )
    )
  );

create policy "Admins can manage units"
  on public.units for all
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.course_versions cv
      join public.courses c on c.id = cv.course_id
      where cv.id = course_version_id
        and c.organization_id is not null
        and public.is_org_admin(c.organization_id)
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.course_versions cv
      join public.courses c on c.id = cv.course_id
      where cv.id = course_version_id
        and c.organization_id is not null
        and public.is_org_admin(c.organization_id)
    )
  );

create policy "Published global lessons are public"
  on public.lessons for select
  using (
    publication_status = 'published'
    and (
      unit_id is null
      or exists (
        select 1
        from public.units u
        join public.course_versions cv on cv.id = u.course_version_id
        join public.courses c on c.id = cv.course_id
        where u.id = unit_id
          and cv.status = 'published'
          and c.status = 'published'
          and c.organization_id is null
      )
    )
  );

create policy "Members can view organization lessons"
  on public.lessons for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      publication_status = 'published'
      and (
        unit_id is null
        or exists (
          select 1
          from public.units u
          join public.course_versions cv on cv.id = u.course_version_id
          join public.courses c on c.id = cv.course_id
          where u.id = unit_id
            and cv.status = 'published'
            and c.status = 'published'
            and c.organization_id is null
        )
      )
    )
    or exists (
      select 1
      from public.units u
      join public.course_versions cv on cv.id = u.course_version_id
      join public.courses c on c.id = cv.course_id
      where u.id = unit_id
        and c.organization_id is not null
        and public.is_org_member(c.organization_id)
    )
  );

create policy "Admins can manage lessons"
  on public.lessons for all
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.units u
      join public.course_versions cv on cv.id = u.course_version_id
      join public.courses c on c.id = cv.course_id
      where u.id = unit_id
        and c.organization_id is not null
        and public.is_org_admin(c.organization_id)
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.units u
      join public.course_versions cv on cv.id = u.course_version_id
      join public.courses c on c.id = cv.course_id
      where u.id = unit_id
        and c.organization_id is not null
        and public.is_org_admin(c.organization_id)
    )
  );

create policy "Published milestones are public"
  on public.milestones for select
  using (
    exists (
      select 1
      from public.lessons l
      where l.id = lesson_id
        and l.publication_status = 'published'
        and (
          l.unit_id is null
          or exists (
            select 1
            from public.units u
            join public.course_versions cv on cv.id = u.course_version_id
            join public.courses c on c.id = cv.course_id
            where u.id = l.unit_id
              and cv.status = 'published'
              and c.status = 'published'
              and c.organization_id is null
          )
        )
    )
  );

create policy "Members can view organization milestones"
  on public.milestones for select
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
        and (
          (l.publication_status = 'published' and c.organization_id is null)
          or (c.organization_id is not null and public.is_org_member(c.organization_id))
        )
    )
  );

create policy "Admins can manage milestones"
  on public.milestones for all
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

create policy "Published global lesson activities are public"
  on public.lesson_activities for select
  using (
    exists (
      select 1
      from public.lessons l
      where l.id = lesson_id
        and l.publication_status = 'published'
        and (
          l.unit_id is null
          or exists (
            select 1
            from public.units u
            join public.course_versions cv on cv.id = u.course_version_id
            join public.courses c on c.id = cv.course_id
            where u.id = l.unit_id
              and cv.status = 'published'
              and c.status = 'published'
              and c.organization_id is null
          )
        )
    )
  );

create policy "Members can view organization lesson activities"
  on public.lesson_activities for select
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
        and (
          (l.publication_status = 'published' and c.organization_id is null)
          or (c.organization_id is not null and public.is_org_member(c.organization_id))
        )
    )
  );

create policy "Admins can manage lesson activities"
  on public.lesson_activities for all
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

insert into public.subjects (
  id,
  title,
  description,
  status
) values (
  'logic-coding-foundations',
  'Logic and Coding Foundations',
  'A beginner path from everyday logical speech to Jargon pseudocode and coding literacy.',
  'published'
)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

insert into public.courses (
  id,
  subject_id,
  title,
  description,
  status
) values (
  'jargon-foundations',
  'logic-coding-foundations',
  'Jargon Foundations',
  'The v1 course spine for processes, signals, memory, structured logic, and runnable pseudocode.',
  'published'
)
on conflict (id) do update set
  subject_id = excluded.subject_id,
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

insert into public.course_versions (
  id,
  course_id,
  version_label,
  status,
  is_current,
  content_schema_version,
  published_at
) values (
  'jargon-foundations-v1',
  'jargon-foundations',
  'v1',
  'published',
  true,
  1,
  now()
)
on conflict (id) do update set
  course_id = excluded.course_id,
  version_label = excluded.version_label,
  status = excluded.status,
  is_current = excluded.is_current,
  content_schema_version = excluded.content_schema_version,
  published_at = coalesce(public.course_versions.published_at, excluded.published_at),
  updated_at = now();

insert into public.units (
  id,
  course_version_id,
  position,
  title,
  description
) values
(
  'jargon-foundations-processes',
  'jargon-foundations-v1',
  1,
  'Processes',
  'Everyday systems, signals, purposes, memory, and exchange.'
),
(
  'jargon-foundations-coding',
  'jargon-foundations-v1',
  2,
  'Coding',
  'Sequences, conditions, lists, loops, input, output, and a final logic lab.'
)
on conflict (id) do update set
  course_version_id = excluded.course_version_id,
  position = excluded.position,
  title = excluded.title,
  description = excluded.description,
  updated_at = now();

update public.lessons
set unit_id = 'jargon-foundations-processes',
    publication_status = 'published',
    curriculum_metadata = curriculum_metadata || '{"course_id":"jargon-foundations","course_version_id":"jargon-foundations-v1"}'::jsonb
where id in ('lesson1', 'lesson2', 'lesson3', 'lesson4', 'lesson5');

update public.lessons
set unit_id = 'jargon-foundations-coding',
    publication_status = 'published',
    curriculum_metadata = curriculum_metadata || '{"course_id":"jargon-foundations","course_version_id":"jargon-foundations-v1"}'::jsonb
where id in ('coding1', 'coding2', 'coding3', 'coding4', 'coding5');

insert into public.milestones (
  id,
  lesson_id,
  position,
  title,
  objective,
  level,
  skill_keys,
  expected_evidence,
  completion_rules,
  allowed_response_modes
) values
(
  'lesson1-milestone',
  'lesson1',
  1,
  'Connect Tool And Purpose',
  'Explain how a tool serves a clear purpose, then express that relationship in Jargon.',
  'Level 0-1',
  ARRAY['process.purpose','jargon.set','jargon.print'],
  '{"student_can":["name a tool","state its purpose","run a SET/PRINT Jargon program"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
),
(
  'lesson2-milestone',
  'lesson2',
  1,
  'Trace Input Process Output',
  'Identify an input signal, process, and output signal in a simple system.',
  'Level 0-1',
  ARRAY['systems.input','systems.process','systems.output','jargon.print'],
  '{"student_can":["label input","label process","label output"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
),
(
  'lesson3-milestone',
  'lesson3',
  1,
  'Explain Signal Conversion',
  'Explain why a physical signal must be converted before a computer can process it.',
  'Level 0-1',
  ARRAY['signals.conversion','jargon.if','jargon.print'],
  '{"student_can":["describe conversion","trace an IF path"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
),
(
  'lesson4-milestone',
  'lesson4',
  1,
  'Use Memory As A List',
  'Use a list as memory and loop through stored items.',
  'Level 0-2',
  ARRAY['memory.storage','jargon.list','jargon.loop'],
  '{"student_can":["store values","loop over values","explain list memory"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
),
(
  'lesson5-milestone',
  'lesson5',
  1,
  'Follow Signal Exchange',
  'Trace a signal as it moves across systems.',
  'Level 0-1',
  ARRAY['signals.exchange','jargon.foreach','jargon.list'],
  '{"student_can":["name each stop","explain exchange across interfaces"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
),
(
  'coding1-milestone',
  'coding1',
  1,
  'Sequence A Process',
  'Turn an everyday process into ordered Jargon instructions.',
  'Level 1-2',
  ARRAY['logic.sequence','jargon.set','jargon.print'],
  '{"student_can":["order steps","map steps to code lines"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
),
(
  'coding2-milestone',
  'coding2',
  1,
  'Choose With Conditions',
  'Use IF/ELSE to choose between two paths.',
  'Level 1-2',
  ARRAY['logic.condition','jargon.if_else','jargon.comparison'],
  '{"student_can":["identify condition","predict output path"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
),
(
  'coding3-milestone',
  'coding3',
  1,
  'Filter A List With Logic',
  'Use a loop and compound condition to select list items.',
  'Level 2',
  ARRAY['jargon.list','jargon.foreach','logic.compound_condition'],
  '{"student_can":["trace list loop","explain compound condition","verify selected output"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
),
(
  'coding4-milestone',
  'coding4',
  1,
  'Use Input To Decide Output',
  'Use ASK input and comparison logic to respond to a student-provided value.',
  'Level 2',
  ARRAY['jargon.ask','jargon.foreach','logic.search'],
  '{"student_can":["provide input","trace comparison","explain input-driven output"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
),
(
  'coding5-milestone',
  'coding5',
  1,
  'Trace A Complete Logic Program',
  'Trace variables through a loop, condition, multiplication, and BREAK.',
  'Level 2',
  ARRAY['jargon.repeat','jargon.break','logic.trace','logic.factorial'],
  '{"student_can":["trace state changes","explain break condition","verify final output"]}'::jsonb,
  '{"requires":["successful_code_run","student_explanation"],"min_score":1}'::jsonb,
  ARRAY['text','code']
)
on conflict (id) do update set
  lesson_id = excluded.lesson_id,
  position = excluded.position,
  title = excluded.title,
  objective = excluded.objective,
  level = excluded.level,
  skill_keys = excluded.skill_keys,
  expected_evidence = excluded.expected_evidence,
  completion_rules = excluded.completion_rules,
  allowed_response_modes = excluded.allowed_response_modes,
  updated_at = now();

update public.lesson_activities
set milestone_id = lesson_id || '-milestone'
where lesson_id in (
  'lesson1',
  'lesson2',
  'lesson3',
  'lesson4',
  'lesson5',
  'coding1',
  'coding2',
  'coding3',
  'coding4',
  'coding5'
);
