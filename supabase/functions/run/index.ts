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

function runError(message: string) {
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
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const engineUrl = Deno.env.get("JARGON_ENGINE_URL");
  const startedAt = Date.now();
  const runtime = runtimeConfig(req);
  if (!engineUrl) {
    await recordRuntimeEvent(runtime, {
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
    const res = await fetchEngine(engineUrl, payload);

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (
        data &&
        typeof data === "object" &&
        (data.status !== "ok" || (Array.isArray(data.errors) && data.errors.length > 0))
      ) {
        await recordRuntimeEvent(runtime, {
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
        eventType: "run_failure",
        latencyMs: Date.now() - startedAt,
        payload: { reason: "engine_non_json", engine_status: res.status },
      });
      return json(runError(`Engine returned non-JSON response with status ${res.status}.`), 502);
    }
  } catch (err) {
    const message = err instanceof DOMException && err.name === "AbortError"
      ? `Engine request timed out after ${ENGINE_FETCH_TIMEOUT_MS}ms.`
      : `Engine unreachable: ${errorMessage(err)}`;
    await recordRuntimeEvent(runtime, {
      eventType: "run_failure",
      latencyMs: Date.now() - startedAt,
      payload: { message },
    });
    return json(runError(message), 502);
  }
});
