# The chunk pipeline, minus OCR — archived 2026-09-03 (R102)

**Was:** eight action handlers inside `supabase/functions/resource-processing/index.ts`.
**Now:** `archive/resource-chunk-pipeline/actions.ts` (+ `downloadResourceFile.ts`).

The owner's instruction was "keep only the OCR". **That needed one correction, and this is
the most important thing on this page.**

## OCR cannot run alone — three actions were kept, not one

`ocr_pdf_pages` sits in the middle of a chain:

```
  frontend renders PDF pages  ->  save_pdf_page_assets  ->  resource_page_assets
                                                                    |
                                                          ocr_pdf_pages  (reads them)
                                                                    |
                                                          resource_text_chunks
                                                                    |
                                                          list_resource_chunks  (reads them back)
```

`ocrPdfPages` calls `loadOcrPageAssets`, which reads `resource_page_assets` rows of type
`ocr_image` (falling back to `thumbnail`), and throws *"Generate PDF page previews before
running OCR"* when there are none. Those rows are written by `save_pdf_page_assets`. The
chunks OCR produces are only readable through `list_resource_chunks`.

So archiving everything except `ocr_pdf_pages` would have left a function that can never
execute and whose output nothing can read. **Three actions stayed live:
`save_pdf_page_assets`, `ocr_pdf_pages`, `list_resource_chunks`.** That is the minimum
runnable OCR path. Everything else went.

## What was archived, and what each did

| Action | What it did |
|---|---|
| `extract_pdf_chunks` | The **non-OCR** path: pulls the PDF's own text layer into chunks. This is the one OCR replaces for scanned books; it is cheaper and exact when a PDF has real text. |
| `transcribe_media_resource` | Audio/video resources to text via the speech model. |
| `save_chunk_edits` | Teacher edits to extracted chunk text before approval. |
| `approve_chunks` / `reject_chunks` | The review workflow — a human confirms extracted text before it becomes curriculum. |
| `delete_chunks` | Removes chunks from a resource. |
| `create_curriculum_import_draft` | Turned approved chunks into a **draft course**: the R58/R59 chapter-to-curriculum path. |
| `list_curriculum_import_job` | Polled that import job's progress. |

`downloadResourceFile` was archived separately: it became orphaned the moment
`transcribe_media_resource` left, being its only caller. The OCR path uses
`downloadStorageFile` (bucket + path), which is still live.

## Why it left

None of the eight had a caller — not in `frontend/src`, not in another edge function, not in
a cron. The **output** of this pipeline is very much alive (50 rows in
`resource_text_chunks`, 80 in `resource_page_assets`, and the IT Frontiers books are built
from what it produced) — but the machinery that produced it has not been reachable since the
authoring surface was rebuilt in R74/R75.

`curriculum_import_jobs` and `curriculum_import_suggestions` hold zero rows.

## What is still live that these need

Everything they call is still in `resource-processing`: `requireManageableResource`,
`assertUploadedPdf`, `normalizeChunk`, `splitDocumentText`, `createProcessingJob`,
`updateProcessingJob`, `insertProcessingError`, `insertModelUsage`, `estimatedCostUsd`,
`enforceProcessingRateLimit`, `supabaseFetch`, `downloadStorageFile`. None of those were
removed, because the OCR path uses them too.

The frontend still has `lib/pdf-extract.ts`, which renders PDF pages to images and extracts
the text layer in the browser. Only `extractPdfTextChunksFromUrl` is used today (by
`features/teacher/authoring/referenceInput.tsx`); the page-rendering exports that fed
`save_pdf_page_assets` are still there, unused.

## To restore any of them

1. Paste the handler(s) from `actions.ts` back into
   `supabase/functions/resource-processing/index.ts`, above `Deno.serve`.
2. Re-add the router branch(es). They read exactly:
   ```ts
       if (action === "extract_pdf_chunks") {
         return json(await extractPdfChunks(config, body, user));
       }
   ```
   …and the same shape for `transcribe_media_resource`, `save_chunk_edits`,
   `approve_chunks`, `reject_chunks`, `delete_chunks`,
   `create_curriculum_import_draft`, `list_curriculum_import_job`.
3. `approve_chunks` and `reject_chunks` both call `setChunkStatus` — take it with them.
4. `transcribe_media_resource` needs `transcribeWithOpenAi` **and**
   `downloadResourceFile.ts`.
5. Write the UI. There has been none since R74.
6. `deno check` with the usual harness; the function checked clean at 0 errors after this
   removal, so any error you see is yours.
