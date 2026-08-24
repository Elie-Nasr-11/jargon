-- R58: curriculum import — figures that live in private storage.
--
-- Figures until now were static assets committed to the frontend (/figures/*.png):
-- fine for eleven hand-made diagrams, wrong for two textbooks. Imported figures go
-- to the private `lesson-resources` bucket instead, and the client signs them at
-- render time (the same createSignedUrl path every other private resource uses).
--
-- Additive and backward compatible: existing rows keep their image_url and keep
-- rendering; storage_path simply wins when it is present.

alter table public.lesson_figures
  add column if not exists storage_path text;

comment on column public.lesson_figures.storage_path is
  'Private-bucket object path (lesson-resources). When set, the client signs this at render time and ignores image_url. Null for legacy static figures.';

-- image_url is NOT NULL from its original migration; an imported figure has no
-- durable public URL, so let it be empty instead of forcing a fake one.
alter table public.lesson_figures
  alter column image_url set default '';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lesson_figures'
      and column_name = 'image_url' and is_nullable = 'NO'
  ) then
    alter table public.lesson_figures alter column image_url drop not null;
  end if;
end $$;

-- Import provenance: which import run produced this row, so a re-import can tell
-- its own rows from a teacher's hand-made ones and never clobber the latter.
alter table public.lesson_figures
  add column if not exists import_key text;

create index if not exists lesson_figures_import_key_idx
  on public.lesson_figures (import_key)
  where import_key is not null;

-- Stable-id provenance for imported curriculum nodes. The importer is idempotent by
-- the ids the source JSON carries; this column records WHICH import owns a lesson so
-- re-running a chapter updates its own lessons and leaves everything else alone.
alter table public.lessons
  add column if not exists import_key text;

create index if not exists lessons_import_key_idx
  on public.lessons (import_key)
  where import_key is not null;

alter table public.units
  add column if not exists import_key text;

create index if not exists units_import_key_idx
  on public.units (import_key)
  where import_key is not null;
