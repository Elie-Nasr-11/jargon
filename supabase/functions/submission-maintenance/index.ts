// Submission maintenance (Phase 2b) — system-only sweeps for the student-submissions bucket.
//
// Two actions, both invoked by a scheduled GitHub Actions workflow (submission-maintenance.yml)
// authenticated with the service-role key as the Bearer JWT (the same system-caller pattern as
// the canvas `sync` action):
//
//   scan       Drains scan_status='pending' rows. If a scan provider is configured
//              (SCAN_API_URL [+ optional SCAN_API_KEY]) each file's bytes are POSTed to it and
//              the row is flipped clean/quarantined. With NO provider configured, pending files
//              are marked 'skipped' (unscanned, still readable) so the queue drains — enabling a
//              provider later only scans NEW uploads. The read boundary blocks only 'quarantined'.
//   retention  Purges the object bytes of files older than SUBMISSION_RETENTION_DAYS (default 365)
//              and stamps purged_at on the DB row (kept as a tombstone). Irreversible; the table
//              is empty today, so nothing is old enough to purge for ~a year.
//   sweep      scan then retention (what the daily workflow calls).
//
// This function refuses any caller whose bearer is not exactly the service-role key.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbRow = Record<string, unknown>;

type Config = {
  url: string;
  serviceRoleKey: string;
  authorization: string;
  scanApiUrl: string;
  scanApiKey: string;
  retentionDays: number;
  scanBatchLimit: number;
  retentionBatchLimit: number;
};

const BUCKET = "student-submissions";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envConfig(req: Request): Config {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  return {
    url,
    serviceRoleKey,
    authorization: req.headers.get("Authorization") || "",
    scanApiUrl: Deno.env.get("SCAN_API_URL") || "",
    scanApiKey: Deno.env.get("SCAN_API_KEY") || "",
    retentionDays: toPositiveInt(Deno.env.get("SUBMISSION_RETENTION_DAYS"), 365),
    scanBatchLimit: toPositiveInt(Deno.env.get("SCAN_BATCH_LIMIT"), 100),
    retentionBatchLimit: toPositiveInt(Deno.env.get("RETENTION_BATCH_LIMIT"), 200),
  };
}

async function restFetch(config: Config, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${config.url}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      data && typeof data === "object" && typeof (data as DbRow).message === "string"
        ? String((data as DbRow).message)
        : res.statusText;
    throw new Error(message);
  }
  return data;
}

// Delete one object from storage via the service-role storage API. A 404 (already gone) is treated
// as success so the tombstone still lands. Returns true when the object is confirmed removed/absent.
async function deleteStorageObject(config: Config, bucket: string, path: string): Promise<boolean> {
  const res = await fetch(
    `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      method: "DELETE",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
    },
  );
  if (res.ok || res.status === 404) {
    // Drain the body so the connection is reusable.
    await res.text().catch(() => "");
    return true;
  }
  const text = await res.text().catch(() => "");
  throw new Error(text || `storage delete failed (HTTP ${res.status})`);
}

async function downloadStorageObject(config: Config, bucket: string, path: string): Promise<Uint8Array> {
  const res = await fetch(
    `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
    },
  );
  if (!res.ok) throw new Error(`storage download failed (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// Provider contract (generic): POST the raw bytes to SCAN_API_URL. A JSON response flagging the
// file as unsafe (`clean:false` | `infected:true` | `malicious:true` | `threat` truthy) quarantines
// it; a clean 2xx marks it clean. A provider error THROWS so the row stays pending for a retry
// (never silently marked clean on an outage).
async function scanBytesWithProvider(
  config: Config,
  bytes: Uint8Array,
  contentType: string | null,
): Promise<"clean" | "quarantined"> {
  const headers = new Headers();
  headers.set("Content-Type", contentType || "application/octet-stream");
  if (config.scanApiKey) headers.set("Authorization", `Bearer ${config.scanApiKey}`);
  const res = await fetch(config.scanApiUrl, {
    method: "POST",
    headers,
    body: bytes,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`scan provider HTTP ${res.status}`);
  let parsed: DbRow = {};
  try {
    parsed = text ? (JSON.parse(text) as DbRow) : {};
  } catch {
    parsed = {};
  }
  const unsafe =
    parsed.clean === false ||
    parsed.infected === true ||
    parsed.malicious === true ||
    Boolean(parsed.threat);
  return unsafe ? "quarantined" : "clean";
}

async function runScan(config: Config): Promise<Record<string, number | boolean>> {
  const pending = (await restFetch(
    config,
    `/rest/v1/assignment_submission_files?scan_status=eq.pending&purged_at=is.null&select=id,storage_bucket,storage_path,mime_type&order=created_at.asc&limit=${config.scanBatchLimit}`,
  )) as DbRow[];

  if (!Array.isArray(pending) || pending.length === 0) {
    return { scanned: 0, clean: 0, quarantined: 0, skipped: 0, errors: 0, provider: Boolean(config.scanApiUrl) };
  }

  // No provider configured → drain the queue as 'skipped' (unscanned, still readable) in one PATCH.
  if (!config.scanApiUrl) {
    const ids = pending.map((row) => String(row.id)).join(",");
    await restFetch(config, `/rest/v1/assignment_submission_files?id=in.(${ids})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ scan_status: "skipped", updated_at: new Date().toISOString() }),
    });
    return { scanned: 0, clean: 0, quarantined: 0, skipped: pending.length, errors: 0, provider: false };
  }

  let clean = 0;
  let quarantined = 0;
  let errors = 0;
  for (const row of pending) {
    const bucket = String(row.storage_bucket || BUCKET);
    const path = String(row.storage_path || "");
    try {
      const bytes = await downloadStorageObject(config, bucket, path);
      const verdict = await scanBytesWithProvider(config, bytes, (row.mime_type as string) ?? null);
      await restFetch(config, `/rest/v1/assignment_submission_files?id=eq.${encodeURIComponent(String(row.id))}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ scan_status: verdict, updated_at: new Date().toISOString() }),
      });
      if (verdict === "quarantined") quarantined += 1;
      else clean += 1;
    } catch (_error) {
      // Leave the row 'pending' for the next sweep — never mark unscanned bytes clean on error.
      errors += 1;
    }
  }
  return { scanned: clean + quarantined, clean, quarantined, skipped: 0, errors, provider: true };
}

async function runRetention(config: Config): Promise<Record<string, number>> {
  const cutoff = new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const stale = (await restFetch(
    config,
    `/rest/v1/assignment_submission_files?purged_at=is.null&created_at=lt.${encodeURIComponent(cutoff)}&select=id,storage_bucket,storage_path&order=created_at.asc&limit=${config.retentionBatchLimit}`,
  )) as DbRow[];

  if (!Array.isArray(stale) || stale.length === 0) {
    return { candidates: 0, purged: 0, errors: 0 };
  }

  let purged = 0;
  let errors = 0;
  for (const row of stale) {
    const bucket = String(row.storage_bucket || BUCKET);
    const path = String(row.storage_path || "");
    try {
      await deleteStorageObject(config, bucket, path);
      await restFetch(config, `/rest/v1/assignment_submission_files?id=eq.${encodeURIComponent(String(row.id))}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ purged_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      purged += 1;
    } catch (_error) {
      // Leave un-purged for the next sweep.
      errors += 1;
    }
  }
  return { candidates: stale.length, purged, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "error", error: "Method not allowed." }, 405);

  let config: Config;
  try {
    config = envConfig(req);
  } catch (error) {
    return json({ status: "error", error: errorMessage(error) }, 500);
  }

  // System-only: the sole trusted caller is the service-role key presented as the Bearer token.
  if (config.authorization !== `Bearer ${config.serviceRoleKey}`) {
    return json({ status: "error", error: "Forbidden." }, 403);
  }

  let body: DbRow = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as DbRow) : {};
  } catch {
    body = {};
  }
  const action = typeof body.action === "string" ? body.action : "sweep";

  try {
    if (action === "scan") {
      return json({ status: "ok", action, scan: await runScan(config) });
    }
    if (action === "retention") {
      return json({ status: "ok", action, retention: await runRetention(config) });
    }
    if (action === "sweep") {
      const scan = await runScan(config);
      const retention = await runRetention(config);
      return json({ status: "ok", action, scan, retention });
    }
    return json({ status: "error", error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    return json({ status: "error", error: errorMessage(error) }, 500);
  }
});
