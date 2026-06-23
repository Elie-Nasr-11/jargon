# Media Processing v2

## Purpose

Media Processing makes teacher-approved classroom media useful inside Mentor chat
without trusting raw extraction automatically.

The current path is intentionally review-first:

1. Teacher uploads a private PDF, audio, or video lesson resource.
2. PDF: teacher clicks **Extract PDF text** in `/teacher`; the browser extracts selectable text with PDF.js.
3. Audio/video: teacher clicks **Transcribe audio/video**; the `resource-processing` Edge Function downloads the private file and sends it to OpenAI speech-to-text server-side.
4. Extracted/transcribed chunks are stored as `draft`.
5. Teacher reviews, edits, approves, rejects, or deletes chunks.
6. `chat` loads only `approved` chunks for resources attached to the active lesson.
7. Mentor may cite PDF/document chunks by resource title/page and audio/video chunks by resource title/time range.
8. Mentor must not claim the student opened, watched, listened to, or read a resource unless `resource_interactions` proves it.

## Tables

- `resource_processing_jobs`: extraction/transcription job metadata and counts.
- `resource_processing_errors`: processing validation warnings/errors.
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

## Edge Function

`resource-processing` supports:

- `extract_pdf_chunks`
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
- OCR for scanned PDFs.
- PDF page thumbnails.
- Embeddings/vector search.
- Automatic trust of extracted/transcribed text.
- Audio/video chunking beyond 25 MB.

## Live Acceptance

PDF:

1. Teacher uploads a PDF to `lesson1`.
2. Teacher extracts text.
3. Teacher edits and approves at least one chunk.
4. Student opens `lesson1`.
5. Mentor references approved PDF context with resource title/page.
6. Student opens the resource card.
7. `resource_interactions` records `shown` and `opened`.

Audio/video:

1. Teacher uploads a small supported audio/video file under 25 MB.
2. Teacher transcribes it.
3. Teacher edits and approves at least one transcript chunk.
4. Student opens the lesson/resource in `/chat`.
5. Mentor references approved transcript context with resource title/time range.
6. Draft/rejected chunks are not used by Mentor.
