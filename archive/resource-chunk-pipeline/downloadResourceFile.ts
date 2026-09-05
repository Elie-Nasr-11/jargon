// ARCHIVED 2026-09-03 — R102. Orphaned when transcribeMediaResource left: it was the only
// caller. Downloads a whole resource file from storage. The OCR path uses
// downloadStorageFile (which takes a bucket and path) instead, and that one stays live.

async function downloadResourceFile(config: Config, resource: DbRow) {
  const bucket = cleanText(resource.storage_bucket, "lesson-resources");
  const path = cleanText(resource.storage_path);
  return downloadStorageFile(
    config,
    bucket,
    path,
    MAX_TRANSCRIPTION_BYTES,
    "This resource has no uploaded media file.",
  );
}
