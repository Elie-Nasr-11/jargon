-- R30 (tester feedback #4): "Pull any image/illustration from the provided content and
-- display either side-bar or in-line ... students need visual elements."
--
-- A FIGURE is an illustration lifted out of a teacher-provided source (a diagram, a graph,
-- an annotated axis) and BOUND TO AN IDEA. The binding is what makes it teach: the mentor
-- shows the chloroplast diagram while discussing chloroplast structure, not while discussing
-- the Calvin cycle. Extraction proposes; a TEACHER approves (status draft -> published),
-- exactly like the Phase D knowledge intake — an unreviewed crop is never shown to a student.
--
-- Storage: `image_url` is either an app-relative path under /figures (the seeded set, served
-- by the frontend host) or an absolute https URL. Uploaded figures can later point at a
-- storage path without changing the read path.
--
-- Additive + idempotent.

create table if not exists public.lesson_figures (
  id uuid primary key default gen_random_uuid(),
  lesson_id text references public.lessons(id) on delete cascade,
  -- The idea this figure illustrates. Nullable so a figure can be lesson-wide.
  idea_key text,
  title text not null,
  caption text not null default '',
  image_url text not null,
  -- Provenance: which resource it was lifted from, and where.
  source_resource_id uuid references public.lesson_resources(id) on delete set null,
  source_page integer,
  alt_text text not null default '',
  position integer not null default 1,
  status text not null default 'draft',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint lesson_figures_status_check
    check (status in ('draft', 'published', 'retired'))
);

create index if not exists lesson_figures_lesson on public.lesson_figures (lesson_id, status);
create index if not exists lesson_figures_idea on public.lesson_figures (idea_key, status);

alter table public.lesson_figures enable row level security;

-- Students (any authenticated reader) see published figures only; all writes go through
-- curriculum-admin's service-role path, so no user-facing write policy exists.
do $$ begin
  create policy lesson_figures_published_read on public.lesson_figures
    for select using (status = 'published');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Seed: the figures cropped from the demo campus PDFs (biology paper, trig AFL).
-- Published where the binding is unambiguous; the two whose idea binding is a
-- judgement call are left as DRAFTS so the Knowledge review flow has real work.
-- Guarded on the lesson existing, and idempotent by (lesson_id, image_url).
-- ---------------------------------------------------------------------------

insert into public.lesson_figures (lesson_id, idea_key, title, caption, image_url, alt_text, position, status)
select v.lesson_id, v.idea_key, v.title, v.caption, v.image_url, v.alt_text, v.position, v.status
from (values
  ('camp-bio-l1', 'chloroplast-structure',
   'Chloroplast cross-section',
   'The chloroplast from the Term 2 paper, with structures A-C labelled.',
   '/figures/chloroplast-diagram.png',
   'Cross-section of a chloroplast showing stacked thylakoid membranes forming grana, surrounded by stroma, with labels A, B and C.',
   1, 'published'),
  ('camp-bio-l2', 'electron-transport',
   'Electron flow through the photosystems',
   'Light striking photosystem 2 and photosystem 1, with electrons moving along the chain.',
   '/figures/light-dependent-membrane.png',
   'Diagram of the thylakoid membrane showing light exciting electrons at photosystem 2, transfer along carriers, and re-excitation at photosystem 1.',
   1, 'published'),
  ('camp-bio-l3', 'calvin-cycle',
   'The Calvin cycle by carbon count',
   'Compounds M, N, O and P with the number of carbons and molecules at each stage.',
   '/figures/calvin-cycle-compounds.png',
   'Cycle diagram showing a 1-carbon compound entering, a 5-carbon compound, a 3-carbon compound and a 6-carbon compound, with stages A, B and C.',
   1, 'published'),
  ('camp-bio-l3', 'limiting-factors',
   'What limits the rate',
   'Rate against light intensity at four combinations of carbon dioxide and temperature.',
   '/figures/rate-limiting-factors.png',
   'Four curves of photosynthesis rate versus light intensity, plateauing at different heights for different carbon dioxide concentrations and temperatures.',
   2, 'published'),
  ('camp-math-l3', 'unit-circle',
   'Plotting a point and its angle of rotation',
   'The grid from the AFL paper, for constructing the angle at a plotted point.',
   '/figures/coordinate-grid-rotation.png',
   'Coordinate grid from -6 to 6 on both axes, for plotting a point and drawing its angle of rotation from the positive x-axis.',
   1, 'published'),
  ('camp-math-l5', 'trig-graphs',
   'Axes for sketching a transformed tangent',
   'The blank axes from the paper, for the five-step sketch of f(x) = tan(x + pi) - 1.',
   '/figures/tan-transform-axes.png',
   'Blank x and y axes with tick marks, for sketching a transformed tangent function.',
   1, 'published'),
  -- Deliberate drafts: the biology graphs below could each attach to more than one idea,
  -- so a teacher decides. They appear in the studio's review queue.
  ('camp-bio-l1', 'chloroplast-structure',
   'Normal versus mutant chlorophyll',
   'Oxygen produced against light intensity for normal and mutant chloroplasts.',
   '/figures/chlorophyll-mutant-graph.png',
   'Two curves of oxygen produced against light intensity; the normal chloroplast curve rises above the mutant one.',
   2, 'draft'),
  ('camp-bio-l3', 'calvin-cycle',
   'Radioactive carbon in light and dark',
   'How labelled compounds change when the light is switched off.',
   '/figures/calvin-radioactive-graph.png',
   'Graph of amount of radioactive substance over time, with the trace diverging after the light is turned off.',
   3, 'draft')
) as v(lesson_id, idea_key, title, caption, image_url, alt_text, position, status)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
  and not exists (
    select 1 from public.lesson_figures f
    where f.lesson_id = v.lesson_id and f.image_url = v.image_url
  );

-- Bind the seeded figures to the reading they were lifted from, where that reading exists.
update public.lesson_figures f
set source_resource_id = r.id, source_page = 1
from public.lesson_resources r
where f.source_resource_id is null
  and r.external_url = '/readings/photosynthesis-paper.pdf'
  and f.image_url in (
    '/figures/chloroplast-diagram.png',
    '/figures/light-dependent-membrane.png',
    '/figures/calvin-cycle-compounds.png',
    '/figures/rate-limiting-factors.png',
    '/figures/chlorophyll-mutant-graph.png',
    '/figures/calvin-radioactive-graph.png'
  );

update public.lesson_figures f
set source_resource_id = r.id, source_page = 1
from public.lesson_resources r
where f.source_resource_id is null
  and r.external_url = '/readings/trigonometry-afl.pdf'
  and f.image_url in (
    '/figures/coordinate-grid-rotation.png',
    '/figures/tan-transform-axes.png'
  );
