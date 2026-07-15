-- Artifacts v1 P6: interactive artifact resources (html_sim / deck).
--
-- Adds 'artifact' to the lesson_resources.resource_type CHECK (idempotent swap — this
-- file re-applies on every deploy). Artifact config lives in lesson_resources.metadata
-- under an "artifact" key: {kind: 'html_sim'|'deck', version: 1, height_hint?,
-- poster_text?, deck?}. An html_sim's payload is ONE self-contained HTML file stored at
-- artifacts/{resource_id}/index.html in the private lesson-resources bucket, with the
-- resource's storage_path pointing at it — the existing exact-name storage read policy
-- (0009) authorizes student reads, so NO storage policy change is needed (single-file is
-- a hard format rule). A deck's slide JSON lives in metadata.artifact.deck, mirrored to
-- artifacts/{resource_id}/deck.json to satisfy the upload/url CHECK.
--
-- Client rendering rule (enforced by static tests, not SQL): html_sim renders in an
-- iframe with sandbox="allow-scripts" ONLY — never allow-same-origin. The sandbox is the
-- security boundary; the client-side lint is defense-in-depth.

alter table public.lesson_resources
  drop constraint if exists lesson_resources_resource_type_check;

alter table public.lesson_resources
  add constraint lesson_resources_resource_type_check
  check (resource_type in ('video', 'audio', 'pdf', 'flipbook', 'youtube', 'image', 'link', 'document', 'artifact'));
