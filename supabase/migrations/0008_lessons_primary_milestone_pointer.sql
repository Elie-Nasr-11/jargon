-- Optional lesson-level primary milestone pointer.
-- This keeps deployed chat runtimes compatible while milestones remain the canonical table.

alter table public.lessons
  add column if not exists milestone_id text references public.milestones on delete set null;

update public.lessons l
set milestone_id = m.id
from public.milestones m
where m.lesson_id = l.id
  and m.position = 1
  and l.milestone_id is null;

create index if not exists lessons_milestone_idx
  on public.lessons (milestone_id);
