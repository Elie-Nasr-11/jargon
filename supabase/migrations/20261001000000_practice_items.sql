-- Brain-first Phase D (docs/BRAIN_FIRST_PLAN.md): teacher practice banks. Owner
-- decision: teacher-authored items are PRIMARY practice material when provided; the
-- mentor generates under strict guidelines otherwise. Drafted by extract_knowledge
-- (curriculum-admin, service-role writes), reviewed in studio-lite, read by the chat
-- fn under the caller's JWT (published-only policy below). Additive + idempotent.

create table if not exists public.practice_items (
  id uuid primary key default gen_random_uuid(),
  idea_key text not null,
  lesson_id text references public.lessons(id) on delete set null,
  prompt text not null,
  expected text not null default '',
  difficulty text not null default 'core',
  status text not null default 'draft',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint practice_items_difficulty_check
    check (difficulty in ('intro', 'core', 'stretch')),
  constraint practice_items_status_check
    check (status in ('draft', 'published', 'retired'))
);

create index if not exists practice_items_idea on public.practice_items (idea_key, status);
create index if not exists practice_items_lesson on public.practice_items (lesson_id, status);

alter table public.practice_items enable row level security;

-- Students (any authenticated reader) see only published items; authoring goes through
-- curriculum-admin's service-role writes, so no user-facing write policies exist.
do $$ begin
  create policy practice_items_published_read on public.practice_items
    for select using (status = 'published');
exception when duplicate_object then null; end $$;
