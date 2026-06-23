# Media Processing v1

## Purpose

Media Processing v1 makes teacher-approved PDF material useful inside Mentor chat without trusting raw extraction automatically.

The v1 path is intentionally narrow:

1. Teacher uploads a private PDF lesson resource.
2. Teacher clicks **Extract PDF text** in `/teacher`.
3. The teacher browser extracts selectable PDF text with PDF.js.
4. The JWT-protected `resource-processing` Edge Function stores extracted chunks as `draft`.
5. Teacher reviews, edits, approves, rejects, or deletes chunks.
6. `chat` loads only `approved` chunks for resources attached to the active lesson.
7. Mentor may cite resource title and page number, but must not claim the student opened/read the resource unless `resource_interactions` proves it.

## Tables

- `resource_processing_jobs`: extraction job metadata and counts.
- `resource_processing_errors`: extraction or validation warnings/errors.
- `resource_text_chunks`: page-numbered chunks with `draft | approved | rejected` status.

All tables have RLS enabled. Anonymous access is revoked.

## Access Model

- Teachers, org admins, and platform admins can manage chunks only when `can_manage_lesson_resource(resource_id)` returns true.
- Students can read only `approved` chunks for resources they can already view through `can_view_lesson_resource(resource_id)`.
- Draft and rejected chunks are teacher-only and never enter Mentor context.
- Files remain in the private `lesson-resources` bucket.

## Edge Function

`resource-processing` supports:

- `extract_pdf_chunks`
- `save_chunk_edits`
- `approve_chunks`
- `reject_chunks`
- `delete_chunks`
- `list_resource_chunks`

It requires a signed-in JWT. It uses the caller's authorization context and Postgres RLS/resource helper functions; no service-role key is exposed to the frontend.

## Mentor Context

The `chat` function now loads a bounded set of approved chunks for the active lesson resources:

- resource title
- page number
- chunk index
- chunk text

This is private prompt context only. The typed chat response shape is unchanged.

## Deferred

- Audio/video transcription.
- YouTube transcript import.
- OCR for scanned PDFs.
- Page thumbnails.
- Embeddings/vector search.
- Automatic trust of extracted text.

## Live Acceptance

1. Teacher uploads a PDF to `lesson1`.
2. Teacher extracts text.
3. Teacher edits and approves at least one chunk.
4. Student opens `lesson1`.
5. Mentor references approved PDF context with resource title/page.
6. Student opens the resource card.
7. `resource_interactions` records `shown` and `opened`.
