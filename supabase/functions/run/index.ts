// Jargon Interpreter — proxy to the external Jargon execution engine.
// Forwards { code, answers } to the engine and passes the response through.
// Engine URL comes from the JARGON_ENGINE_URL secret (falls back to the test engine).
// JWT-verified: only signed-in users can call it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_ENGINE_URL = "https://jargon-engine-test.onrender.com/run";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const engineUrl = Deno.env.get("JARGON_ENGINE_URL") || DEFAULT_ENGINE_URL;

  try {
    const payload = await req.text();
    const res = await fetch(engineUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

    // Pass the engine's response through unchanged.
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ result: `[ERROR] Engine unreachable: ${err.message}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
