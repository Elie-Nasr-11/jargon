# Media Processing v3

## Purpose

Media Processing makes teacher-approved classroom media useful inside Mentor chat
without trusting raw extraction automatically.

The current path is intentionally review-first:

1. Teacher uploads a private PDF, audio, or video lesson resource.
2. PDF: teacher can click **Generate page previews**; the browser renders private page thumbnails/OCR images with PDF.js.
3. PDF with selectable text: teacher clicks **Extract PDF text**; the browser extracts text with PDF.js.
4. Scanned PDF: teacher clicks **OCR scanned pages**; the `resource-processing` Edge Function sends private page images to OpenAI Vision server-side.
5. Audio/video: teacher clicks **Transcribe audio/video**; the Edge Function downloads the private file and sends it to OpenAI speech-to-text server-side.
6. Extracted/OCR/transcribed chunks are stored as `draft`.
7. Teacher reviews, edits, approves, rejects, or deletes chunks.
8. `chat` loads only `approved` chunks for resources attached to the active lesson.
9. Mentor may cite PDF/document/OCR chunks by resource title/page and audio/video chunks by resource title/time range.
10. Mentor must not claim the student opened, watched, listened to, or read a resource unless `resource_interactions` proves it.

## Tables

- `resource_processing_jobs`: extraction/transcription job metadata and counts.
- `resource_processing_errors`: processing validation warnings/errors.
- `resource_page_assets`: private rendered PDF page thumbnails/OCR images.
- `resource_text_chunks`: teacher-reviewed chunks with `draft | approved | rejected` status.

`resource_text_chunks` supports:

- `source_kind`: `document | audio | video | manual`
- `page_number` for PDF/document chunks
- `start_seconds` and `end_seconds` for audio/video transcript segments
- optional `confidence` and `metadata`

All tables have RLS enabled. Anonymous access is revoked.

## Access Model

- Teachers, org admins, and platform admins can manage chunks only when
  `can_manage_lesson_resource(resource_id)` returns true.
- Students can read only `approved` chunks for resources they can already view through
  `can_view_lesson_resource(resource_id)`.
- Draft and rejected chunks are teacher-only and never enter Mentor context.
- Files remain in the private `lesson-resources` bucket.
- The OpenAI API key is used only inside the Edge Function and is never exposed to the browser.
- Private PDF page thumbnails/OCR images are stored in `lesson-resources` and are readable only through the same resource access helpers.

## Edge Function

`resource-processing` supports:

- `extract_pdf_chunks`
- `save_pdf_page_assets`
- `ocr_pdf_pages`
- `transcribe_media_resource`
- `save_chunk_edits`
- `approve_chunks`
- `reject_chunks`
- `delete_chunks`
- `list_resource_chunks`

It requires a signed-in JWT. It uses the caller's authorization context and Postgres
RLS/resource helper functions.

Audio/video transcription v1 follows OpenAI's speech-to-text limits:

- supported uploads: `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, `webm`
- maximum uploaded media size: 25 MB
- timestamped chunks use `whisper-1` with `verbose_json` and segment timestamps

Files over 25 MB are rejected with a teacher-facing error. V1 does not split large files.

PDF OCR v1 follows OpenAI Vision limits:

- page assets are rendered in the teacher browser with PDF.js
- OCR images are capped at 1.5 MB each
- OCR runs are capped at 30 pages
- default model is `gpt-5.4-mini`, configurable with `OPENAI_OCR_MODEL`
- OCR output is stored as draft chunks with `metadata.generated_from = openai_vision_ocr`

## Mentor Context

The `chat` function loads a bounded set of approved chunks for active lesson resources:

- resource title
- source kind
- page number for PDF/document chunks
- start/end seconds for audio/video chunks
- chunk index
- chunk text

This is private prompt context only. The typed chat response shape is unchanged.

## Deferred

- YouTube transcript API import.
- OCR layout reconstruction beyond plain text.
- Embeddings/vector search.
- Automatic trust of extracted/transcribed text.
- Audio/video chunking beyond 25 MB.

## Live Acceptance

PDF:

1. Teacher uploads a PDF to `lesson1`.
2. Teacher generates page previews.
3. For selectable PDFs, teacher extracts text.
4. For scanned PDFs, teacher OCRs one or more pages.
5. Teacher edits and approves at least one chunk.
6. Student opens `lesson1`.
7. Mentor references approved PDF context with resource title/page.
8. Student opens the resource card.
9. `resource_interactions` records `shown` and `opened`.

Audio/video:

1. Teacher uploads a small supported audio/video file under 25 MB.
2. Teacher transcribes it.
3. Teacher edits and approves at least one transcript chunk.
4. Student opens the lesson/resource in `/chat`.
5. Mentor references approved transcript context with resource title/time range.
6. Draft/rejected chunks are not used by Mentor.
