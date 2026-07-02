// Jargon Interpreter — proxy to the external Jargon execution engine.
// Forwards { code, answers } to the engine and passes the response through.
// Engine URL must come from the JARGON_ENGINE_URL secret.
// JWT-verified: only signed-in users can call it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ENGINE_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_ENGINE_RETRY_COUNT = 1;
const DEFAULT_ENGINE_RETRY_DELAY_MS = 1_500;

type RuntimeEventType = "run_failure" | "controlled_error";

type SupabaseConfig = {
  url: string;
  anonKey: string;
  authorization: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function runError(message: string, timedOut = false) {
  const output = [`[ERROR] ${message}`];
  return {
    output,
    result: output,
    errors: [message],
    memory: {},
    ask: null,
    ask_var: null,
    status: "error",
    truncated: false,
    limits_hit: [],
    // Explicit infra-timeout flag so the tutor never has to string-match the message
    // to tell an engine timeout from a student error.
    ...(timedOut ? { timeout: true } : {}),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function isRetryableEngineStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function runtimeConfig(req: Request): SupabaseConfig | null {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") || "";
  if (!url || !anonKey || !authorization) return null;
  return { url, anonKey, authorization };
}

async function fetchCurrentUser(config: SupabaseConfig): Promise<string | null> {
  try {
    const res = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.anonKey,
        Authorization: config.authorization,
      },
    });
    const data = await res.json();
    return res.ok && typeof data?.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

async function recordRuntimeEvent(
  config: SupabaseConfig | null,
  input: {
    userId?: string | null;
    eventType: RuntimeEventType;
    status?: "ok" | "error";
    latencyMs?: number | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  if (!config) return;
  try {
    const userId = input.userId ?? (await fetchCurrentUser(config));
    await fetch(`${config.url}/rest/v1/runtime_events`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: config.authorization,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        event_type: input.eventType,
        status: input.status || "error",
        latency_ms: input.latencyMs ?? null,
        payload: input.payload || {},
      }),
    });
  } catch {
    // Runtime telemetry must never block code execution.
  }
}

async function fetchEngine(engineUrl: string, payload: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENGINE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(engineUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchEngineWithRetry(
  engineUrl: string,
  payload: string,
  input: {
    runtime: SupabaseConfig | null;
    userId?: string | null;
    startedAt: number;
    codeChars: number | null;
  },
): Promise<Response> {
  const retryCount = envInt("JARGON_ENGINE_RETRY_COUNT", DEFAULT_ENGINE_RETRY_COUNT, 0, 3);
  const retryDelayMs = envInt(
    "JARGON_ENGINE_RETRY_DELAY_MS",
    DEFAULT_ENGINE_RETRY_DELAY_MS,
    250,
    10_000,
  );
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const res = await fetchEngine(engineUrl, payload);
      if (isRetryableEngineStatus(res.status) && attempt < retryCount) {
        await recordRuntimeEvent(input.runtime, {
          userId: input.userId,
          eventType: "run_failure",
          status: "error",
          latencyMs: Date.now() - input.startedAt,
          payload: {
            reason: "engine_retryable_status",
            engine_status: res.status,
            attempt: attempt + 1,
            max_attempts: retryCount + 1,
            retry_delay_ms: retryDelayMs,
            code_chars: input.codeChars,
          },
        });
        await sleep(retryDelayMs);
        continue;
      }
      if (attempt > 0) {
        await recordRuntimeEvent(input.runtime, {
          userId: input.userId,
          eventType: "run_failure",
          status: "ok",
          latencyMs: Date.now() - input.startedAt,
          payload: {
            reason: "engine_retry_success",
            attempt: attempt + 1,
            max_attempts: retryCount + 1,
            engine_status: res.status,
            code_chars: input.codeChars,
          },
        });
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retryCount) {
        await recordRuntimeEvent(input.runtime, {
          userId: input.userId,
          eventType: "run_failure",
          status: "error",
          latencyMs: Date.now() - input.startedAt,
          payload: {
            reason: isAbortError(err) ? "engine_wake_timeout_retrying" : "engine_unreachable_retrying",
            message: errorMessage(err),
            attempt: attempt + 1,
            max_attempts: retryCount + 1,
            retry_delay_ms: retryDelayMs,
            code_chars: input.codeChars,
          },
        });
        await sleep(retryDelayMs);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Engine request failed.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const engineUrl = Deno.env.get("JARGON_ENGINE_URL");
  const startedAt = Date.now();
  const runtime = runtimeConfig(req);
  const userId = runtime ? await fetchCurrentUser(runtime) : null;
  if (!engineUrl) {
    await recordRuntimeEvent(runtime, {
      userId,
      eventType: "run_failure",
      latencyMs: Date.now() - startedAt,
      payload: { reason: "missing_engine_url" },
    });
    return json(runError("JARGON_ENGINE_URL is not configured."), 500);
  }

  try {
    const payload = await req.text();
    let parsedPayload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(payload);
      parsedPayload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      parsedPayload = {};
    }
    const codeChars =
      typeof parsedPayload.code === "string" ? parsedPayload.code.length : null;
    const res = await fetchEngineWithRetry(engineUrl, payload, {
      runtime,
      userId,
      startedAt,
      codeChars,
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (
        data &&
        typeof data === "object" &&
        (data.status !== "ok" || (Array.isArray(data.errors) && data.errors.length > 0))
      ) {
        await recordRuntimeEvent(runtime, {
          userId,
          eventType: "controlled_error",
          latencyMs: Date.now() - startedAt,
          payload: {
            engine_status: typeof data.status === "string" ? data.status : null,
            error_count: Array.isArray(data.errors) ? data.errors.length : 0,
            code_chars:
              typeof parsedPayload.code === "string" ? parsedPayload.code.length : null,
          },
        });
      }
      return json(data, res.status);
    } catch {
      await recordRuntimeEvent(runtime, {
        userId,
        eventType: "run_failure",
        latencyMs: Date.now() - startedAt,
        payload: { reason: "engine_non_json", engine_status: res.status },
      });
      return json(runError(`Engine returned non-JSON response with status ${res.status}.`), 502);
    }
  } catch (err) {
    const timedOut = isAbortError(err);
    const message = timedOut
      ? `Engine request timed out after ${ENGINE_FETCH_TIMEOUT_MS}ms after wake retry.`
      : `Engine unreachable: ${errorMessage(err)}`;
    await recordRuntimeEvent(runtime, {
      userId,
      eventType: "run_failure",
      latencyMs: Date.now() - startedAt,
      payload: { reason: timedOut ? "engine_wake_timeout" : "engine_unreachable", message },
    });
    return json(runError(message, timedOut), 502);
  }
});
