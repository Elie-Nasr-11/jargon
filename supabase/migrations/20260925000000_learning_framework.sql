-- Learning framework F1 (2026-08-02, docs/LEARNING_FRAMEWORK.md — owner-decided §6).
-- IDEAS (authored per lesson + student-scoped EMERGENT ones the mentor mints from
-- conversation), VOCAB TERMS (subject-homed, definition-carrying), CURRICULUM LINKS
-- (what CAN connect), STUDENT LINKS (earned, permanent), STUDENT VOCAB (encounter
-- state). Subject = course title (owner decision). Additive + idempotent.

-- ---------------------------------------------------------------------------
-- Ideas: the atomic knowledge node. user_id null = authored (curriculum-shared);
-- user_id set = emergent (this student's brain grew it; origin 'emergent').
-- ---------------------------------------------------------------------------
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  title text not null,
  one_liner text not null default '',
  subject text not null default '',
  grade_band text,
  origin text not null default 'authored',
  status text not null default 'published',
  lesson_id text references public.lessons(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint ideas_origin_check check (origin in ('authored', 'emergent')),
  constraint ideas_status_check check (status in ('draft', 'published')),
  constraint ideas_emergent_owned check (origin != 'emergent' or user_id is not null)
);
create unique index if not exists ideas_authored_key
  on public.ideas (key) where user_id is null;
create unique index if not exists ideas_emergent_key
  on public.ideas (user_id, key) where user_id is not null;
create index if not exists ideas_lesson on public.ideas (lesson_id);

-- ---------------------------------------------------------------------------
-- Vocab terms: a word that names an idea, with matching variants and a
-- student-facing definition. Home subject = where the word "lives".
-- ---------------------------------------------------------------------------
create table if not exists public.vocab_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null unique,
  variants text[] not null default '{}',
  definition text not null,
  subject text not null default '',
  idea_keys text[] not null default '{}',
  status text not null default 'published',
  lesson_id text references public.lessons(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vocab_terms_status_check check (status in ('draft', 'published'))
);

-- ---------------------------------------------------------------------------
-- Curriculum links: authored idea↔idea edges — what CAN be connected.
-- ---------------------------------------------------------------------------
create table if not exists public.curriculum_links (
  id uuid primary key default gen_random_uuid(),
  from_key text not null,
  to_key text not null,
  kind text not null,
  note text not null default '',
  status text not null default 'published',
  created_at timestamptz not null default now(),
  constraint curriculum_links_kind_check
    check (kind in ('prerequisite', 'same_pattern', 'contrast', 'vocab_bridge')),
  constraint curriculum_links_status_check check (status in ('draft', 'published')),
  unique (from_key, to_key, kind)
);

-- ---------------------------------------------------------------------------
-- Student links: EARNED edges — made once, never unmade. The product's heartbeat.
-- ---------------------------------------------------------------------------
create table if not exists public.student_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_key text not null,
  to_key text not null,
  kind text not null default 'same_pattern',
  evidence_kind text not null,
  note text not null default '',
  session_id uuid,
  created_at timestamptz not null default now(),
  constraint student_links_evidence_check
    check (evidence_kind in ('vocab_in_new_subject', 'mentor_flagged', 'student_articulated')),
  unique (user_id, from_key, to_key)
);
create index if not exists student_links_user on public.student_links (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Student vocab: per-student encounter state for each term.
-- ---------------------------------------------------------------------------
create table if not exists public.student_vocab (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  term_id uuid not null references public.vocab_terms(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  first_defined_at timestamptz,
  used_at timestamptz,
  subjects_seen text[] not null default '{}',
  unique (user_id, term_id)
);

-- ---------------------------------------------------------------------------
-- One-query lesson→subject resolution for the chat fn (subject = course title).
-- security_invoker: reads run under the caller's own table policies.
-- ---------------------------------------------------------------------------
create or replace view public.lesson_subjects as
select l.id as lesson_id, c.title as subject
from public.lessons l
join public.units u on u.id = l.unit_id
join public.course_versions cv on cv.id = u.course_version_id
join public.courses c on c.id = cv.course_id;
alter view public.lesson_subjects set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- RLS. Published shared knowledge reads for any authenticated user; emergent ideas
-- and student rows: owner + the student's teachers (can_view_student). All writes go
-- through the service role (the chat fn's validated pipeline) — no client writes.
-- ---------------------------------------------------------------------------
alter table public.ideas enable row level security;
alter table public.vocab_terms enable row level security;
alter table public.curriculum_links enable row level security;
alter table public.student_links enable row level security;
alter table public.student_vocab enable row level security;

drop policy if exists ideas_read on public.ideas;
create policy ideas_read on public.ideas for select to authenticated using (
  (user_id is null and status = 'published')
  or user_id = auth.uid()
  or (user_id is not null and public.can_view_student(user_id))
);
drop policy if exists vocab_terms_read on public.vocab_terms;
create policy vocab_terms_read on public.vocab_terms for select to authenticated
  using (status = 'published');
drop policy if exists curriculum_links_read on public.curriculum_links;
create policy curriculum_links_read on public.curriculum_links for select to authenticated
  using (status = 'published');
drop policy if exists student_links_read on public.student_links;
create policy student_links_read on public.student_links for select to authenticated
  using (user_id = auth.uid() or public.can_view_student(user_id));
drop policy if exists student_vocab_read on public.student_vocab;
create policy student_vocab_read on public.student_vocab for select to authenticated
  using (user_id = auth.uid() or public.can_view_student(user_id));

-- The chat fn writes under the CALLER'S JWT (restConfig), so the student-owned rows need
-- owner write policies. Emergent-idea inserts are owner-scoped and origin-locked; shared
-- knowledge (authored ideas / vocab / curriculum links) stays read-only to clients.
drop policy if exists ideas_emergent_insert on public.ideas;
create policy ideas_emergent_insert on public.ideas for insert to authenticated
  with check (user_id = auth.uid() and origin = 'emergent');
drop policy if exists student_links_insert on public.student_links;
create policy student_links_insert on public.student_links for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists student_vocab_insert on public.student_vocab;
create policy student_vocab_insert on public.student_vocab for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists student_vocab_update on public.student_vocab;
create policy student_vocab_update on public.student_vocab for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===========================================================================
-- DEMO SEED — keyed to the MVP catalog + Book F where present. Idempotent
-- (on conflict do nothing); lesson bindings guard on the lesson existing.
-- ===========================================================================

insert into public.ideas (key, title, one_liner, subject, lesson_id)
select v.key, v.title, v.one_liner, v.subject, v.lesson_id
from (values
  ('exact-instructions', 'Exact, ordered instructions',
   'A program is an ordered list of exact instructions — computers follow them literally.',
   'Thinking in Jargon', 'mvp-coding-l1'),
  ('state-and-repetition', 'Remembering and repeating',
   'Programs hold values (SET), show them (PRINT), and repeat steps (REPEAT) instead of copying them out.',
   'Thinking in Jargon', 'mvp-coding-l2'),
  ('claims-vs-reasons', 'Claims vs. reasons',
   'A claim is what someone believes; reasons are the why — and reasons must actually support the claim.',
   'Reasoning Well', 'mvp-thinking-l1'),
  ('fractions-as-division', 'Fractions are division',
   'A fraction is a division in disguise: the bar means "split fairly".',
   'Number Sense', 'mvp-math-l1')
) as v(key, title, one_liner, subject, lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

insert into public.vocab_terms (term, variants, definition, subject, idea_keys, lesson_id)
select v.term, v.variants, v.definition, v.subject, v.idea_keys, v.lesson_id
from (values
  ('instruction', array['instructions'],
   'One exact step you tell a computer (or a person) to do — programs are lists of these in order.',
   'Thinking in Jargon', array['exact-instructions'], 'mvp-coding-l1'),
  ('loop', array['loops', 'looping'],
   'A part of a program that repeats steps — REPEAT is how Jargon writes one.',
   'Thinking in Jargon', array['state-and-repetition'], 'mvp-coding-l2'),
  ('claim', array['claims'],
   'Something someone says is true — the "what I believe" part of an argument.',
   'Reasoning Well', array['claims-vs-reasons'], 'mvp-thinking-l1'),
  ('reason', array['reasons', 'reasoning'],
   'The "why" offered for a claim — good reasons actually support what they''re attached to.',
   'Reasoning Well', array['claims-vs-reasons'], 'mvp-thinking-l1'),
  ('fraction', array['fractions'],
   'A number written as one value over another — really a division waiting to happen.',
   'Number Sense', array['fractions-as-division'], 'mvp-math-l1'),
  ('divide', array['division', 'divides', 'dividing'],
   'Splitting something into equal parts — the bar in a fraction means exactly this.',
   'Number Sense', array['fractions-as-division'], 'mvp-math-l1'),
  ('pattern', array['patterns'],
   'Something that repeats in a predictable way — spotting one lets you predict what comes next.',
   'Thinking in Jargon', array['state-and-repetition'], null),
  ('order', array['ordered', 'ordering'],
   'The sequence things happen in — in programs and arguments alike, order changes the result.',
   'Thinking in Jargon', array['exact-instructions'], null)
) as v(term, variants, definition, subject, idea_keys, lesson_id)
where v.lesson_id is null or exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

insert into public.curriculum_links (from_key, to_key, kind, note)
values
  ('exact-instructions', 'claims-vs-reasons', 'same_pattern',
   'A program is to its instructions what a claim is to its reasons — the parts have to genuinely carry the whole.'),
  ('exact-instructions', 'fractions-as-division', 'same_pattern',
   'Both split one big thing into exact, equal parts — steps of a program, shares of a whole.'),
  ('state-and-repetition', 'fractions-as-division', 'same_pattern',
   'Repeating equal steps IS division in motion — REPEAT 4 splits the work into four fair shares.'),
  ('state-and-repetition', 'claims-vs-reasons', 'vocab_bridge',
   'The word "pattern" travels: repeated steps in code, repeated structure in arguments.')
on conflict do nothing;
