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
  if (!engineUrl) {
    return json(runError("JARGON_ENGINE_URL is not configured."), 500);
  }

  try {
    const payload = await req.text();
    const res = await fetchEngine(engineUrl, payload);

    const text = await res.text();
    try {
      return json(JSON.parse(text), res.status);
    } catch {
      return json(runError(`Engine returned non-JSON response with status ${res.status}.`), 502);
    }
  } catch (err) {
    const message = err instanceof DOMException && err.name === "AbortError"
      ? `Engine request timed out after ${ENGINE_FETCH_TIMEOUT_MS}ms.`
      : `Engine unreachable: ${errorMessage(err)}`;
    return json(runError(message), 502);
  }
});
