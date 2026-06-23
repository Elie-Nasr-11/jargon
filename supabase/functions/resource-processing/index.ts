// PDF-first resource processing for teacher-reviewed Mentor context.
// The browser extracts PDF text after authorized file access; this function
// persists draft chunks and enforces teacher/org/platform authorization.
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
  metadata?: DbRow;
};

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
    `lesson_resources?id=eq.${encodeURIComponent(resourceId)}&select=id,organization_id,class_id,lesson_id,title,resource_type,source_type,storage_bucket,storage_path,status,visibility`,
  );
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
    throw new Error("Resource not found.");
  }
  return data[0] as DbRow;
}

function normalizeChunk(raw: ChunkInput, index: number): DbRow {
  const pageNumber = Math.max(1, Math.floor(numberValue(raw.page_number, 1)));
  const chunkIndex = Math.max(0, Math.floor(numberValue(raw.chunk_index, index)));
  const chunkText = cleanText(raw.chunk_text);
  if (!chunkText) throw new Error("Extracted chunks cannot be empty.");
  if (chunkText.length > 8000) {
    throw new Error("One extracted chunk is too large. Split the PDF text into smaller chunks.");
  }
  return {
    page_number: pageNumber,
    chunk_index: chunkIndex,
    chunk_text: chunkText,
    metadata:
      raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
        ? raw.metadata
        : {},
  };
}

async function listResourceChunks(config: Config, resourceId: string) {
  await requireManageableResource(config, resourceId);
  const [chunks, jobs, errors] = await Promise.all([
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
  ]);
  return { status: "ok", chunks, jobs, errors };
}

async function extractPdfChunks(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  const resource = await requireManageableResource(config, resourceId);
  if (resource.resource_type !== "pdf" || resource.source_type !== "upload") {
    throw new Error("Only uploaded PDF resources can be extracted in v1.");
  }

  const rawChunks = Array.isArray(body.chunks) ? (body.chunks as ChunkInput[]) : [];
  if (!rawChunks.length) throw new Error("No PDF text chunks were provided.");
  if (rawChunks.length > 500) throw new Error("Too many chunks. Keep extraction under 500 chunks.");

  const chunks = rawChunks.map(normalizeChunk);
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
    const rows = await supabaseFetch(
      config,
      `resource_text_chunks?id=eq.${encodeURIComponent(chunkId)}&resource_id=eq.${encodeURIComponent(resourceId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          page_number: normalized.page_number,
          chunk_index: normalized.chunk_index,
          chunk_text: normalized.chunk_text,
          metadata: normalized.metadata,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }),
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
