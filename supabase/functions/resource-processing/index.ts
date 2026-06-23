// Resource processing for teacher-reviewed Mentor context.
// PDF text/page previews are extracted in the teacher's browser; uploaded
// audio/video and scanned PDF page images are processed server-side with
// OpenAI. All chunks stay draft until approved.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbRow = Record<string, unknown>;

type Config = {
  url: string;
  anonKey: string;
  authorization: string;
};

type ChunkInput = {
  id?: string;
  page_number?: number;
  chunk_index?: number;
  chunk_text?: string;
  source_kind?: string;
  start_seconds?: number | string | null;
  end_seconds?: number | string | null;
  confidence?: number | string | null;
  metadata?: DbRow;
};

type ProcessingJobType =
  | "pdf_text_extraction"
  | "pdf_page_render"
  | "pdf_ocr"
  | "audio_transcription"
  | "video_transcription";

type PageAssetInput = {
  page_number?: number;
  asset_type?: string;
  storage_bucket?: string;
  storage_path?: string;
  mime_type?: string;
  width?: number | string | null;
  height?: number | string | null;
  file_size_bytes?: number | string | null;
  metadata?: DbRow;
};

const MAX_CHUNKS = 500;
const MAX_CHUNK_CHARS = 8000;
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGE_ASSETS = 60;
const MAX_OCR_PAGES = 30;
const MAX_OCR_IMAGE_BYTES = 1.5 * 1024 * 1024;
const SUPPORTED_TRANSCRIPTION_EXTENSIONS = new Set([
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "wav",
  "webm",
]);
const SUPPORTED_TRANSCRIPTION_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
  "video/mp4",
  "video/mpeg",
  "video/webm",
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorResponse(message: string, status = 500): Response {
  return json({ status: "error", error: message }, status);
}

function envConfig(req: Request): Config {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") || "";

  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL or SUPABASE_ANON_KEY is not configured.");
  }
  if (!authorization) throw new Error("Authentication is required.");
  return { url, anonKey, authorization };
}

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanId(value: unknown): string {
  return cleanText(value);
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function optionalNumberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanSourceKind(value: unknown, fallback = "document"): string {
  const clean = cleanText(value, fallback);
  return ["document", "audio", "video", "manual"].includes(clean) ? clean : fallback;
}

function idFilter(ids: string[]): string {
  const clean = ids.map((id) => cleanId(id)).filter(Boolean);
  return `in.(${clean.map(encodeURIComponent).join(",")})`;
}

async function supabaseFetch(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.anonKey);
  headers.set("Authorization", config.authorization);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as DbRow).message)
        : res.statusText;
    throw new Error(message);
  }
  return data;
}

async function fetchCurrentUser(config: Config): Promise<DbRow> {
  const res = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: config.authorization,
    },
  });
  const data = await res.json();
  if (!res.ok || !data?.id) {
    throw new Error("Could not identify authenticated user.");
  }
  return data as DbRow;
}

async function userCanManageResource(config: Config, resourceId: string): Promise<boolean> {
  const data = await supabaseFetch(config, "rpc/can_manage_lesson_resource", {
    method: "POST",
    body: JSON.stringify({ target_resource_id: resourceId }),
  });
  return data === true || data === "true";
}

async function requireManageableResource(
  config: Config,
  resourceId: string,
): Promise<DbRow> {
  if (!resourceId) throw new Error("resource_id is required.");
  const canManage = await userCanManageResource(config, resourceId);
  if (!canManage) throw new Error("Resource management access is required.");

  const data = await supabaseFetch(
    config,
    `lesson_resources?id=eq.${encodeURIComponent(resourceId)}&select=id,organization_id,class_id,lesson_id,title,resource_type,source_type,storage_bucket,storage_path,mime_type,file_size_bytes,status,visibility,page_count,thumbnail_path`,
  );
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
    throw new Error("Resource not found.");
  }
  return data[0] as DbRow;
}

function assertUploadedPdf(resource: DbRow, message = "Only uploaded PDF resources are supported.") {
  if (resource.resource_type !== "pdf" || resource.source_type !== "upload") {
    throw new Error(message);
  }
}

function cleanAssetType(value: unknown): "thumbnail" | "ocr_image" {
  const clean = cleanText(value);
  if (clean === "thumbnail" || clean === "ocr_image") return clean;
  throw new Error("PDF page assets must be thumbnails or OCR images.");
}

function normalizePageAsset(raw: PageAssetInput, index: number): DbRow {
  const pageNumber = Math.max(1, Math.floor(numberValue(raw.page_number, index + 1)));
  const storageBucket = cleanText(raw.storage_bucket, "lesson-resources");
  const storagePath = cleanText(raw.storage_path);
  if (!storagePath) throw new Error("PDF page asset storage_path is required.");
  if (storageBucket !== "lesson-resources") {
    throw new Error("PDF page assets must stay in the private lesson-resources bucket.");
  }
  const assetType = cleanAssetType(raw.asset_type);
  const mimeType = cleanText(raw.mime_type, "image/jpeg").toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("PDF page assets must be JPEG, PNG, or WebP images.");
  }
  const fileSizeBytes = optionalNumberValue(raw.file_size_bytes);
  if (fileSizeBytes !== null && fileSizeBytes > MAX_OCR_IMAGE_BYTES) {
    throw new Error("PDF page OCR images must be under 1.5 MB.");
  }
  return {
    page_number: pageNumber,
    asset_type: assetType,
    storage_bucket: storageBucket,
    storage_path: storagePath,
    mime_type: mimeType,
    width: optionalNumberValue(raw.width),
    height: optionalNumberValue(raw.height),
    file_size_bytes: fileSizeBytes,
    status: "ready",
    metadata:
      raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
        ? raw.metadata
        : {},
  };
}

function normalizeChunk(raw: ChunkInput, index: number): DbRow {
  const pageNumber = Math.max(1, Math.floor(numberValue(raw.page_number, 1)));
  const chunkIndex = Math.max(0, Math.floor(numberValue(raw.chunk_index, index)));
  const chunkText = cleanText(raw.chunk_text);
  if (!chunkText) throw new Error("Extracted chunks cannot be empty.");
  if (chunkText.length > MAX_CHUNK_CHARS) {
    throw new Error("One extracted chunk is too large. Split the text into smaller chunks.");
  }
  const startSeconds = optionalNumberValue(raw.start_seconds);
  const endSeconds = optionalNumberValue(raw.end_seconds);
  const confidence = optionalNumberValue(raw.confidence);
  if (startSeconds !== null && startSeconds < 0) {
    throw new Error("Transcript start time cannot be negative.");
  }
  if (endSeconds !== null && startSeconds !== null && endSeconds < startSeconds) {
    throw new Error("Transcript end time cannot be before the start time.");
  }
  if (confidence !== null && (confidence < 0 || confidence > 1)) {
    throw new Error("Transcript confidence must be between 0 and 1.");
  }
  return {
    page_number: pageNumber,
    chunk_index: chunkIndex,
    chunk_text: chunkText,
    source_kind: cleanSourceKind(raw.source_kind),
    start_seconds: startSeconds,
    end_seconds: endSeconds,
    confidence,
    metadata:
      raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
        ? raw.metadata
        : {},
  };
}

async function listResourceChunks(config: Config, resourceId: string) {
  await requireManageableResource(config, resourceId);
  const [chunks, jobs, errors, assets] = await Promise.all([
    supabaseFetch(
      config,
      `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&select=*&order=page_number.asc,chunk_index.asc,created_at.asc`,
    ),
    supabaseFetch(
      config,
      `resource_processing_jobs?resource_id=eq.${encodeURIComponent(resourceId)}&select=*&order=created_at.desc&limit=10`,
    ),
    supabaseFetch(
      config,
      `resource_processing_errors?resource_id=eq.${encodeURIComponent(resourceId)}&select=*&order=created_at.desc&limit=20`,
    ),
    supabaseFetch(
      config,
      `resource_page_assets?resource_id=eq.${encodeURIComponent(resourceId)}&status=eq.ready&select=*&order=page_number.asc,asset_type.asc`,
    ),
  ]);
  return { status: "ok", chunks, jobs, errors, assets };
}

async function extractPdfChunks(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  const resource = await requireManageableResource(config, resourceId);
  if (resource.resource_type !== "pdf" || resource.source_type !== "upload") {
    throw new Error("Only uploaded PDF resources can be extracted in v1.");
  }

  const rawChunks = Array.isArray(body.chunks) ? (body.chunks as ChunkInput[]) : [];
  if (!rawChunks.length) throw new Error("No PDF text chunks were provided.");
  if (rawChunks.length > MAX_CHUNKS) throw new Error("Too many chunks. Keep extraction under 500 chunks.");

  const chunks = rawChunks.map((chunk, index) =>
    normalizeChunk({ ...chunk, source_kind: "document" }, index),
  );
  const userId = String(user.id);

  const jobRows = await supabaseFetch(config, "resource_processing_jobs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      resource_id: resourceId,
      organization_id: resource.organization_id || null,
      class_id: resource.class_id || null,
      lesson_id: resource.lesson_id || null,
      job_type: "pdf_text_extraction",
      status: "complete",
      requested_by: userId,
      completed_by: userId,
      chunk_count: chunks.length,
      metadata:
        body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? body.metadata
          : {},
      completed_at: new Date().toISOString(),
    }),
  });
  const job = Array.isArray(jobRows) ? (jobRows[0] as DbRow | undefined) : undefined;
  if (!job?.id) throw new Error("Could not create processing job.");

  await supabaseFetch(
    config,
    `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&status=eq.draft`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    },
  );

  const insertRows = chunks.map((chunk) => ({
    ...chunk,
    resource_id: resourceId,
    job_id: job.id,
    organization_id: resource.organization_id || null,
    class_id: resource.class_id || null,
    lesson_id: resource.lesson_id || null,
    status: "draft",
    created_by: userId,
    updated_by: userId,
  }));
  const inserted = await supabaseFetch(config, "resource_text_chunks", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(insertRows),
  });

  return {
    status: "ok",
    resource_id: resourceId,
    job_id: job.id,
    chunks: inserted,
  };
}

async function createProcessingJob(
  config: Config,
  resource: DbRow,
  user: DbRow,
  jobType: ProcessingJobType,
  status: "processing" | "complete" | "failed",
  metadata: DbRow = {},
) {
  const jobRows = await supabaseFetch(config, "resource_processing_jobs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      resource_id: resource.id,
      organization_id: resource.organization_id || null,
      class_id: resource.class_id || null,
      lesson_id: resource.lesson_id || null,
      job_type: jobType,
      status,
      requested_by: user.id,
      metadata,
    }),
  });
  const job = Array.isArray(jobRows) ? (jobRows[0] as DbRow | undefined) : undefined;
  if (!job?.id) throw new Error("Could not create processing job.");
  return job;
}

async function updateProcessingJob(config: Config, jobId: string, patch: DbRow) {
  await supabaseFetch(config, `resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function insertProcessingError(
  config: Config,
  resourceId: string,
  jobId: string,
  message: string,
  payload: DbRow = {},
) {
  await supabaseFetch(config, "resource_processing_errors", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      job_id: jobId,
      resource_id: resourceId,
      severity: "error",
      message,
      payload,
    }),
  });
}

async function savePdfPageAssets(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  const resource = await requireManageableResource(config, resourceId);
  assertUploadedPdf(resource, "Only uploaded PDF resources can have page previews.");

  const rawAssets = Array.isArray(body.assets) ? (body.assets as PageAssetInput[]) : [];
  if (!rawAssets.length) throw new Error("No PDF page assets were provided.");
  if (rawAssets.length > MAX_PDF_PAGE_ASSETS) {
    throw new Error("Too many PDF page assets. Generate previews for at most 30 pages.");
  }
  const assets = rawAssets.map(normalizePageAsset);
  const pageCount = Math.max(...assets.map((asset) => numberValue(asset.page_number, 1)));
  const job = await createProcessingJob(config, resource, user, "pdf_page_render", "complete", {
    rendered_in: "browser",
    asset_count: assets.length,
    metadata:
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {},
  });

  const insertRows = assets.map((asset) => ({
    ...asset,
    resource_id: resourceId,
    job_id: job.id,
    organization_id: resource.organization_id || null,
    class_id: resource.class_id || null,
    lesson_id: resource.lesson_id || null,
    created_by: user.id,
  }));
  const inserted = await supabaseFetch(
    config,
    "resource_page_assets?on_conflict=resource_id,page_number,asset_type",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(insertRows),
    },
  );
  const firstThumbnail = Array.isArray(inserted)
    ? (inserted as DbRow[]).find(
        (asset) => asset.asset_type === "thumbnail" && numberValue(asset.page_number, 0) === 1,
      )
    : null;

  await supabaseFetch(config, `lesson_resources?id=eq.${encodeURIComponent(resourceId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      page_count: pageCount,
      thumbnail_path:
        typeof firstThumbnail?.storage_path === "string"
          ? firstThumbnail.storage_path
          : resource.thumbnail_path || null,
      updated_at: new Date().toISOString(),
    }),
  });

  await updateProcessingJob(config, String(job.id), {
    completed_by: user.id,
    chunk_count: Array.isArray(inserted) ? inserted.length : assets.length,
    completed_at: new Date().toISOString(),
  });

  return {
    status: "ok",
    resource_id: resourceId,
    job_id: job.id,
    assets: inserted,
  };
}

function resourceFileName(resource: DbRow): string {
  const storagePath = cleanText(resource.storage_path);
  const title = cleanText(resource.title, "media");
  return storagePath.split("/").filter(Boolean).pop() || `${title}.media`;
}

function fileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

function mimeTypeForExtension(extension: string, fallback: string): string {
  if (fallback) return fallback;
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "wav") return "audio/wav";
  if (extension === "m4a") return "audio/mp4";
  return "audio/mpeg";
}

function assertSupportedMedia(resource: DbRow) {
  const resourceType = cleanText(resource.resource_type);
  if (!["audio", "video"].includes(resourceType)) {
    throw new Error("Only uploaded audio and video resources can be transcribed.");
  }
  if (resource.source_type !== "upload") {
    throw new Error("Only uploaded audio and video files can be transcribed.");
  }
  const fileName = resourceFileName(resource);
  const extension = fileExtension(fileName);
  const mimeType = cleanText(resource.mime_type).toLowerCase();
  if (
    !SUPPORTED_TRANSCRIPTION_EXTENSIONS.has(extension)
    && !SUPPORTED_TRANSCRIPTION_MIME_TYPES.has(mimeType)
  ) {
    throw new Error(
      "Unsupported transcription file type. Use mp3, mp4, mpeg, mpga, m4a, wav, or webm.",
    );
  }
  const declaredSize = numberValue(resource.file_size_bytes, 0);
  if (declaredSize > MAX_TRANSCRIPTION_BYTES) {
    throw new Error("Audio/video transcription is limited to files under 25 MB in v1.");
  }
}

function storageObjectUrl(config: Config, bucket: string, path: string): string {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${config.url}/storage/v1/object/${encodedBucket}/${encodedPath}`;
}

async function downloadStorageFile(
  config: Config,
  bucket: string,
  path: string,
  maxBytes: number,
  emptyMessage: string,
) {
  if (!path) throw new Error(emptyMessage);
  const res = await fetch(storageObjectUrl(config, bucket, path), {
    headers: {
      apikey: config.anonKey,
      Authorization: config.authorization,
    },
  });
  if (!res.ok) {
    throw new Error(`Could not open the private file (${res.status}).`);
  }
  const blob = await res.blob();
  if (blob.size > maxBytes) throw new Error("The private file is too large for this operation.");
  if (!blob.size) throw new Error("The private file is empty.");
  return blob;
}

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

function requireOpenAiKey(purpose = "resource processing"): string {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error(`OPENAI_API_KEY is not configured for ${purpose}.`);
  return key;
}

type OpenAiSegment = {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  avg_logprob?: unknown;
};

function splitTranscriptText(text: string, sourceKind: "audio" | "video"): DbRow[] {
  const clean = text.trim();
  if (!clean) return [];
  const rows: DbRow[] = [];
  let cursor = 0;
  let index = 0;
  const maxLength = 3000;
  while (cursor < clean.length) {
    const next = clean.slice(cursor, cursor + maxLength);
    const sentenceBreak = next.lastIndexOf(". ");
    const cut =
      cursor + next.length < clean.length && sentenceBreak > 500
        ? sentenceBreak + 1
        : next.length;
    const chunkText = clean.slice(cursor, cursor + cut).trim();
    if (chunkText) {
      rows.push(
        normalizeChunk(
          {
            page_number: 1,
            chunk_index: index,
            chunk_text: chunkText,
            source_kind: sourceKind,
            metadata: { generated_from: "openai_transcription_text" },
          },
          index,
        ),
      );
      index += 1;
    }
    cursor += Math.max(cut, 1);
  }
  return rows;
}

function splitDocumentText(text: string, pageNumber: number, metadata: DbRow): DbRow[] {
  const clean = text.trim();
  if (!clean) return [];
  const rows: DbRow[] = [];
  let cursor = 0;
  let index = 0;
  const maxLength = 3000;
  while (cursor < clean.length) {
    const next = clean.slice(cursor, cursor + maxLength);
    const sentenceBreak = Math.max(
      next.lastIndexOf(". "),
      next.lastIndexOf("? "),
      next.lastIndexOf("! "),
      next.lastIndexOf("; "),
      next.lastIndexOf("\n"),
    );
    const cut =
      cursor + next.length < clean.length && sentenceBreak > 500
        ? sentenceBreak + 1
        : next.length;
    const chunkText = clean.slice(cursor, cursor + cut).replace(/\s+/g, " ").trim();
    if (chunkText) {
      rows.push(
        normalizeChunk(
          {
            page_number: pageNumber,
            chunk_index: index,
            chunk_text: chunkText,
            source_kind: "document",
            metadata,
          },
          index,
        ),
      );
      index += 1;
    }
    cursor += Math.max(cut, 1);
  }
  return rows;
}

function chunksFromTranscriptionResponse(response: DbRow, sourceKind: "audio" | "video") {
  const rawSegments = Array.isArray(response.segments)
    ? (response.segments as OpenAiSegment[])
    : [];
  const segmentChunks = rawSegments
    .filter((segment) => cleanText(segment.text))
    .map((segment, index) =>
      normalizeChunk(
        {
          page_number: 1,
          chunk_index: index,
          chunk_text: cleanText(segment.text),
          source_kind: sourceKind,
          start_seconds: optionalNumberValue(segment.start),
          end_seconds: optionalNumberValue(segment.end),
          confidence: null,
          metadata:
            segment.avg_logprob === undefined || segment.avg_logprob === null
              ? { generated_from: "openai_transcription_segment" }
              : {
                  generated_from: "openai_transcription_segment",
                  avg_logprob: segment.avg_logprob,
                },
        },
        index,
      ),
    );
  if (segmentChunks.length) return segmentChunks;

  return splitTranscriptText(cleanText(response.text), sourceKind);
}

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  });
}

async function ocrPageWithOpenAi(openAiKey: string, asset: DbRow, imageBlob: Blob): Promise<string> {
  const model = Deno.env.get("OPENAI_OCR_MODEL") || "gpt-5.4-mini";
  const mimeType = cleanText(asset.mime_type, imageBlob.type || "image/jpeg");
  const base64 = await blobToBase64(imageBlob);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract the visible text from this scanned PDF page. Return only the OCR text in natural reading order. If no readable text is visible, return an empty string.",
            },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
      max_completion_tokens: 1800,
    }),
  });
  const data = (await res.json().catch(() => null)) as DbRow | null;
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? cleanText((data.error as DbRow)?.message, res.statusText)
        : res.statusText;
    throw new Error(`OpenAI OCR failed: ${message}`);
  }
  const choices = Array.isArray(data?.choices) ? (data?.choices as DbRow[]) : [];
  const first = choices[0];
  const message = first?.message as DbRow | undefined;
  return cleanText(message?.content);
}

async function transcribeWithOpenAi(
  openAiKey: string,
  resource: DbRow,
  mediaBlob: Blob,
): Promise<DbRow> {
  const fileName = resourceFileName(resource);
  const extension = fileExtension(fileName);
  const mimeType = mimeTypeForExtension(extension, cleanText(resource.mime_type));
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("file", new File([mediaBlob], fileName, { type: mimeType }));

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
    },
    body: form,
  });
  const data = (await res.json().catch(() => null)) as DbRow | null;
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? cleanText((data.error as DbRow)?.message, res.statusText)
        : res.statusText;
    throw new Error(`OpenAI transcription failed: ${message}`);
  }
  if (!data || typeof data !== "object") {
    throw new Error("OpenAI transcription returned an invalid response.");
  }
  return data;
}

async function transcribeMediaResource(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  const resource = await requireManageableResource(config, resourceId);
  assertSupportedMedia(resource);

  const sourceKind = resource.resource_type === "video" ? "video" : "audio";
  const jobType: ProcessingJobType =
    sourceKind === "video" ? "video_transcription" : "audio_transcription";
  const openAiKey = requireOpenAiKey();
  const job = await createProcessingJob(config, resource, user, jobType, "processing", {
    model: "whisper-1",
    supported_limit_bytes: MAX_TRANSCRIPTION_BYTES,
  });

  try {
    const mediaBlob = await downloadResourceFile(config, resource);
    const transcription = await transcribeWithOpenAi(openAiKey, resource, mediaBlob);
    const chunks = chunksFromTranscriptionResponse(transcription, sourceKind);
    if (!chunks.length) {
      throw new Error("No transcript text was found in this media file.");
    }
    if (chunks.length > MAX_CHUNKS) {
      throw new Error("Too many transcript chunks. Use a shorter file for v1.");
    }

    await supabaseFetch(
      config,
      `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&status=eq.draft&source_kind=eq.${sourceKind}`,
      {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      },
    );

    const insertRows = chunks.map((chunk) => ({
      ...chunk,
      resource_id: resourceId,
      job_id: job.id,
      organization_id: resource.organization_id || null,
      class_id: resource.class_id || null,
      lesson_id: resource.lesson_id || null,
      status: "draft",
      created_by: user.id,
      updated_by: user.id,
    }));
    const inserted = await supabaseFetch(config, "resource_text_chunks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(insertRows),
    });

    await updateProcessingJob(config, String(job.id), {
      status: "complete",
      completed_by: user.id,
      chunk_count: chunks.length,
      completed_at: new Date().toISOString(),
      metadata: {
        media_size_bytes: mediaBlob.size,
        response_format: "verbose_json",
        timestamp_granularity: "segment",
      },
    });

    return {
      status: "ok",
      resource_id: resourceId,
      job_id: job.id,
      chunks: inserted,
    };
  } catch (error) {
    const message = errorMessage(error);
    await updateProcessingJob(config, String(job.id), {
      status: "failed",
      completed_by: user.id,
      error_count: 1,
      completed_at: new Date().toISOString(),
    });
    await insertProcessingError(config, resourceId, String(job.id), message, {
      action: "transcribe_media_resource",
      resource_type: resource.resource_type,
    });
    throw error;
  }
}

function requestedPageNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Math.floor(numberValue(item, 0)))
    .filter((item) => item > 0)
    .filter((item, index, all) => all.indexOf(item) === index)
    .sort((a, b) => a - b);
}

async function loadOcrPageAssets(config: Config, resourceId: string, pageNumbers: number[]) {
  const pageFilter = pageNumbers.length
    ? `&page_number=in.(${pageNumbers.map(String).join(",")})`
    : "";
  const rows = await supabaseFetch(
    config,
    `resource_page_assets?resource_id=eq.${encodeURIComponent(resourceId)}&asset_type=eq.ocr_image&status=eq.ready${pageFilter}&select=*&order=page_number.asc`,
  );
  const assets = Array.isArray(rows) ? (rows as DbRow[]) : [];
  if (assets.length) return assets;
  const fallbackRows = await supabaseFetch(
    config,
    `resource_page_assets?resource_id=eq.${encodeURIComponent(resourceId)}&asset_type=eq.thumbnail&status=eq.ready${pageFilter}&select=*&order=page_number.asc`,
  );
  return Array.isArray(fallbackRows) ? (fallbackRows as DbRow[]) : [];
}

async function ocrPdfPages(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  const resource = await requireManageableResource(config, resourceId);
  assertUploadedPdf(resource, "Only uploaded PDF resources can be OCR processed.");
  const pageNumbers = requestedPageNumbers(body.page_numbers);
  if (pageNumbers.length > MAX_OCR_PAGES) {
    throw new Error("OCR is limited to 30 pages per run.");
  }
  const assets = await loadOcrPageAssets(config, resourceId, pageNumbers);
  if (!assets.length) {
    throw new Error("Generate PDF page previews before running OCR.");
  }
  if (assets.length > MAX_OCR_PAGES) {
    throw new Error("OCR is limited to 30 pages per run.");
  }

  const openAiKey = requireOpenAiKey("OCR");
  const model = Deno.env.get("OPENAI_OCR_MODEL") || "gpt-5.4-mini";
  const job = await createProcessingJob(config, resource, user, "pdf_ocr", "processing", {
    model,
    page_count: assets.length,
    max_image_bytes: MAX_OCR_IMAGE_BYTES,
  });

  try {
    const chunks: DbRow[] = [];
    for (const asset of assets) {
      const bucket = cleanText(asset.storage_bucket, "lesson-resources");
      const path = cleanText(asset.storage_path);
      const blob = await downloadStorageFile(
        config,
        bucket,
        path,
        MAX_OCR_IMAGE_BYTES,
        "This PDF page asset has no private image file.",
      );
      const ocrText = await ocrPageWithOpenAi(openAiKey, asset, blob);
      chunks.push(
        ...splitDocumentText(ocrText, numberValue(asset.page_number, 1), {
          generated_from: "openai_vision_ocr",
          model,
          page_asset_id: asset.id,
          asset_type: asset.asset_type,
        }),
      );
    }
    if (!chunks.length) {
      throw new Error("No OCR text was found in the selected PDF pages.");
    }
    if (chunks.length > MAX_CHUNKS) {
      throw new Error("Too many OCR chunks. Use fewer pages in one OCR run.");
    }

    const insertRows = chunks.map((chunk) => ({
      ...chunk,
      resource_id: resourceId,
      job_id: job.id,
      organization_id: resource.organization_id || null,
      class_id: resource.class_id || null,
      lesson_id: resource.lesson_id || null,
      status: "draft",
      created_by: user.id,
      updated_by: user.id,
    }));
    const inserted = await supabaseFetch(config, "resource_text_chunks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(insertRows),
    });

    await updateProcessingJob(config, String(job.id), {
      status: "complete",
      completed_by: user.id,
      chunk_count: chunks.length,
      completed_at: new Date().toISOString(),
      metadata: {
        model,
        page_count: assets.length,
        response_format: "plain_text",
      },
    });

    return {
      status: "ok",
      resource_id: resourceId,
      job_id: job.id,
      chunks: inserted,
    };
  } catch (error) {
    const message = errorMessage(error);
    await updateProcessingJob(config, String(job.id), {
      status: "failed",
      completed_by: user.id,
      error_count: 1,
      completed_at: new Date().toISOString(),
    });
    await insertProcessingError(config, resourceId, String(job.id), message, {
      action: "ocr_pdf_pages",
      resource_type: resource.resource_type,
    });
    throw error;
  }
}

async function saveChunkEdits(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  await requireManageableResource(config, resourceId);
  const chunks = Array.isArray(body.chunks) ? (body.chunks as ChunkInput[]) : [];
  if (!chunks.length) throw new Error("No chunk edits were provided.");
  if (chunks.length > 100) throw new Error("Too many chunk edits in one request.");

  const updated: DbRow[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunkId = cleanId(chunks[i].id);
    if (!chunkId) throw new Error("chunk id is required.");
    const normalized = normalizeChunk(chunks[i], i);
    const patch: DbRow = {
      page_number: normalized.page_number,
      chunk_index: normalized.chunk_index,
      chunk_text: normalized.chunk_text,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if ("metadata" in chunks[i]) patch.metadata = normalized.metadata;
    if ("source_kind" in chunks[i]) patch.source_kind = normalized.source_kind;
    if ("start_seconds" in chunks[i]) patch.start_seconds = normalized.start_seconds;
    if ("end_seconds" in chunks[i]) patch.end_seconds = normalized.end_seconds;
    if ("confidence" in chunks[i]) patch.confidence = normalized.confidence;
    const rows = await supabaseFetch(
      config,
      `resource_text_chunks?id=eq.${encodeURIComponent(chunkId)}&resource_id=eq.${encodeURIComponent(resourceId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      },
    );
    if (Array.isArray(rows) && rows[0]) updated.push(rows[0] as DbRow);
  }
  return { status: "ok", chunks: updated };
}

async function setChunkStatus(
  config: Config,
  body: DbRow,
  user: DbRow,
  status: "approved" | "rejected",
) {
  const resourceId = cleanId(body.resource_id);
  await requireManageableResource(config, resourceId);
  const chunkIds = Array.isArray(body.chunk_ids)
    ? (body.chunk_ids as unknown[]).map(cleanId).filter(Boolean)
    : [];
  if (!chunkIds.length) throw new Error("Select at least one chunk.");
  if (chunkIds.length > 200) throw new Error("Too many chunks in one status update.");

  const rows = await supabaseFetch(
    config,
    `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&id=${idFilter(chunkIds)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return { status: "ok", chunks: rows };
}

async function deleteChunks(config: Config, body: DbRow) {
  const resourceId = cleanId(body.resource_id);
  await requireManageableResource(config, resourceId);
  const chunkIds = Array.isArray(body.chunk_ids)
    ? (body.chunk_ids as unknown[]).map(cleanId).filter(Boolean)
    : [];
  if (!chunkIds.length) throw new Error("Select at least one chunk.");
  if (chunkIds.length > 200) throw new Error("Too many chunks in one delete request.");

  await supabaseFetch(
    config,
    `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&id=${idFilter(chunkIds)}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    },
  );
  return { status: "ok", deleted_chunk_ids: chunkIds };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

  try {
    const config = envConfig(req);
    const body = (await req.json()) as DbRow;
    const action = cleanText(body.action);
    const user = await fetchCurrentUser(config);

    if (action === "list_resource_chunks") {
      return json(await listResourceChunks(config, cleanId(body.resource_id)));
    }
    if (action === "extract_pdf_chunks") {
      return json(await extractPdfChunks(config, body, user));
    }
    if (action === "save_pdf_page_assets") {
      return json(await savePdfPageAssets(config, body, user));
    }
    if (action === "ocr_pdf_pages") {
      return json(await ocrPdfPages(config, body, user));
    }
    if (action === "transcribe_media_resource") {
      return json(await transcribeMediaResource(config, body, user));
    }
    if (action === "save_chunk_edits") {
      return json(await saveChunkEdits(config, body, user));
    }
    if (action === "approve_chunks") {
      return json(await setChunkStatus(config, body, user, "approved"));
    }
    if (action === "reject_chunks") {
      return json(await setChunkStatus(config, body, user, "rejected"));
    }
    if (action === "delete_chunks") {
      return json(await deleteChunks(config, body));
    }

    return errorResponse("Unknown resource-processing action.", 400);
  } catch (error) {
    const message = errorMessage(error);
    const status =
      message.includes("Authentication") || message.includes("authenticated")
        ? 401
        : message.includes("access") || message.includes("Resource management")
          ? 403
          : 400;
    return errorResponse(message, status);
  }
});
