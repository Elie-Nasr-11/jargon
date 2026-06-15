// Jargon Mentor — structured course-session chat edge function.
// Legacy compatibility: { messages } -> { reply } still works.
// New contract: { lesson_id, session_id?, answer? } -> typed learning envelope.
// Requires OPENAI_API_KEY. New session persistence also uses SUPABASE_URL and SUPABASE_ANON_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STAGES = new Set(["intro", "teach", "practice", "assessment", "review", "complete"]);
const RESPONSE_MODES = new Set(["text", "code", "multiple_choice", "file"]);
const NEXT_ACTIONS = new Set(["reply", "run_code", "choose", "retry", "rescue", "continue", "complete"]);

const SYSTEM_PROMPT = `You are the Jargon Mentor, a warm, curious, firm logic coach for school children.

Your job is to guide a structured course conversation, not to act like an open-ended chat box.
Teach logical thought through this bridge:
natural speech -> baby Jargon -> Jargon pseudocode -> Python bridge when the learner is ready.

Rules:
- Stay on the current lesson goal. If the student drifts, briefly acknowledge and redirect.
- Never give the full solution before the student has made a clear attempt.
- Keep responses short, concrete, and age-appropriate.
- Ask one useful question or give one next action at a time.
- Treat code execution as deterministic: Jargon runs through the engine, not imagination.
- Python is a comparison bridge only in v1; do not claim to execute Python.
- File mode exists in the contract but is deferred; do not ask students to upload files yet.
- Prefer retry and rescue paths over failure language.
- Do not use emojis.

For typed course requests, return only valid JSON matching this shape:
{
  "status": "ok",
  "reply": "student-facing mentor message",
  "stage": "intro | teach | practice | assessment | review | complete",
  "response_mode": "text | code | multiple_choice | file",
  "choices": [],
  "exercise": null,
  "assessment": null,
  "next_action": "reply | run_code | choose | retry | rescue | continue | complete",
  "guardrail": { "redirected": false, "reason": null }
}`;

type Envelope = {
  status: "ok" | "error";
  reply: string;
  session_id: string | null;
  lesson_id: string | null;
  stage: string;
  response_mode: string;
  choices: unknown[];
  exercise: unknown | null;
  assessment: unknown | null;
  next_action: string;
  guardrail: { redirected: boolean; reason: string | null };
};

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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function makeEnvelope(partial: Partial<Envelope> = {}): Envelope {
  return {
    status: partial.status === "error" ? "error" : "ok",
    reply: typeof partial.reply === "string" ? partial.reply : "",
    session_id: typeof partial.session_id === "string" ? partial.session_id : null,
    lesson_id: typeof partial.lesson_id === "string" ? partial.lesson_id : null,
    stage: STAGES.has(String(partial.stage)) ? String(partial.stage) : "intro",
    response_mode: RESPONSE_MODES.has(String(partial.response_mode)) ? String(partial.response_mode) : "text",
    choices: Array.isArray(partial.choices) ? partial.choices : [],
    exercise: partial.exercise ?? null,
    assessment: partial.assessment ?? null,
    next_action: NEXT_ACTIONS.has(String(partial.next_action)) ? String(partial.next_action) : "reply",
    guardrail: {
      redirected: partial.guardrail?.redirected === true,
      reason: typeof partial.guardrail?.reason === "string" ? partial.guardrail.reason : null,
    },
  };
}

function typedError(message: string, status = 500, context: Partial<Envelope> = {}): Response {
  return json(
    makeEnvelope({
      ...context,
      status: "error",
      reply: `Error: ${message}`,
      next_action: "reply",
      guardrail: { redirected: false, reason: null },
    }),
    status,
  );
}

function isLegacyRequest(body: Record<string, unknown>): boolean {
  return Array.isArray(body.messages) && !body.lesson_id && !body.session_id && !body.answer;
}

function normalizeAnswer(answer: unknown): Record<string, unknown> | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const raw = answer as Record<string, unknown>;
  const mode = RESPONSE_MODES.has(String(raw.mode)) ? String(raw.mode) : "text";
  return {
    mode,
    text: typeof raw.text === "string" ? raw.text : "",
    code: typeof raw.code === "string" ? raw.code : "",
    choice_id: typeof raw.choice_id === "string" ? raw.choice_id : "",
    run_result: raw.run_result && typeof raw.run_result === "object" ? raw.run_result : null,
  };
}

function answerContent(answer: Record<string, unknown> | null): string {
  if (!answer) return "";
  if (answer.mode === "code") return String(answer.code || "");
  if (answer.mode === "multiple_choice") return String(answer.choice_id || "");
  if (answer.mode === "file") return "[file answer placeholder]";
  return String(answer.text || "");
}

function restConfig(req: Request): SupabaseConfig {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") || "";
  if (!url || !anonKey) throw new Error("SUPABASE_URL or SUPABASE_ANON_KEY is not configured.");
  if (!authorization) throw new Error("Authentication is required.");
  return { url, anonKey, authorization };
}

async function supabaseFetch(config: SupabaseConfig, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.anonKey);
  headers.set("Authorization", config.authorization);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.url}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data && typeof data === "object" && "message" in data
      ? String((data as Record<string, unknown>).message)
      : res.statusText;
    throw new Error(message);
  }
  return data;
}

async function fetchCurrentUser(config: SupabaseConfig): Promise<Record<string, unknown>> {
  const res = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: config.authorization,
    },
  });
  const data = await res.json();
  if (!res.ok || !data?.id) throw new Error("Could not identify authenticated user.");
  return data;
}

async function insertRow(config: SupabaseConfig, table: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const data = await supabaseFetch(config, table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
    throw new Error(`Insert into ${table} returned no row.`);
  }
  return data[0] as Record<string, unknown>;
}

async function loadFirst(config: SupabaseConfig, path: string): Promise<Record<string, unknown> | null> {
  const data = await supabaseFetch(config, path);
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") return null;
  return data[0] as Record<string, unknown>;
}

async function loadOrCreateSession(
  config: SupabaseConfig,
  userId: string,
  lessonId: string,
  sessionId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof sessionId === "string" && sessionId) {
    const session = await loadFirst(
      config,
      `learning_sessions?id=eq.${encodeURIComponent(sessionId)}&lesson_id=eq.${encodeURIComponent(lessonId)}&select=*`,
    );
    if (!session) throw new Error("Learning session was not found.");
    return session;
  }

  return await insertRow(config, "learning_sessions", {
    user_id: userId,
    lesson_id: lessonId,
    stage: "intro",
    status: "active",
  });
}

async function callOpenAI(messages: unknown[], jsonMode: boolean): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const body: Record<string, unknown> = {
    model: "gpt-4o",
    messages,
    temperature: 0.4,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || res.statusText);
  }
  return data?.choices?.[0]?.message?.content || "";
}

async function handleLegacyRequest(body: Record<string, unknown>): Promise<Response> {
  const chatHistory = Array.isArray(body.messages) ? [...body.messages] : [];
  const hasPersona = chatHistory.some(
    (m) =>
      m && typeof m === "object" &&
      (m as Record<string, unknown>).role === "system" &&
      typeof (m as Record<string, unknown>).content === "string" &&
      String((m as Record<string, unknown>).content).includes("You are the Jargon Mentor"),
  );
  if (!hasPersona) {
    chatHistory.unshift({ role: "system", content: SYSTEM_PROMPT });
  }

  try {
    const reply = await callOpenAI(chatHistory, false);
    return json({ reply: reply || "No response." });
  } catch (err) {
    return json({ reply: `Error: ${errorMessage(err)}` }, 500);
  }
}

async function handleTypedRequest(req: Request, body: Record<string, unknown>): Promise<Response> {
  const lessonId = typeof body.lesson_id === "string" ? body.lesson_id : "";
  if (!lessonId) {
    return typedError("lesson_id is required.", 400);
  }

  let config: SupabaseConfig;
  let user: Record<string, unknown>;
  let session: Record<string, unknown>;
  let lesson: Record<string, unknown> | null;
  let activity: Record<string, unknown> | null;

  try {
    config = restConfig(req);
    user = await fetchCurrentUser(config);
    const userId = String(user.id);
    session = await loadOrCreateSession(config, userId, lessonId, body.session_id);
    lesson = await loadFirst(
      config,
      `lessons?id=eq.${encodeURIComponent(lessonId)}&select=id,title,module,level,tutor_prompt,sample_code,expected_output`,
    );
    activity = await loadFirst(
      config,
      `lesson_activities?lesson_id=eq.${encodeURIComponent(lessonId)}&order=position.asc&limit=1&select=*`,
    );
  } catch (err) {
    return typedError(errorMessage(err), 500, { lesson_id: lessonId });
  }

  const userId = String(user.id);
  const sessionId = String(session.id);
  const currentStage = typeof session.stage === "string" ? session.stage : "intro";
  const answer = normalizeAnswer(body.answer);
  const content = answerContent(answer);

  try {
    if (answer && content) {
      await insertRow(config, "learning_turns", {
        session_id: sessionId,
        user_id: userId,
        lesson_id: lessonId,
        role: "student",
        stage: currentStage,
        response_mode: answer.mode,
        content,
        payload: answer,
      });
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          instruction: "Return only the typed JSON envelope. Keep the learner in a structured course flow.",
          lesson,
          activity,
          session: {
            id: sessionId,
            stage: currentStage,
            status: session.status || "active",
            retry_count: session.retry_count || 0,
            rescue_count: session.rescue_count || 0,
          },
          latest_answer: answer,
          required_fields: [
            "status",
            "reply",
            "stage",
            "response_mode",
            "choices",
            "exercise",
            "assessment",
            "next_action",
            "guardrail",
          ],
        }),
      },
    ];

    const contentJson = await callOpenAI(messages, true);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(contentJson);
    } catch {
      return typedError("Mentor returned invalid JSON.", 502, {
        session_id: sessionId,
        lesson_id: lessonId,
        stage: currentStage,
      });
    }

    const envelope = makeEnvelope({
      ...(parsed as Partial<Envelope>),
      session_id: sessionId,
      lesson_id: lessonId,
      stage: typeof parsed.stage === "string" ? parsed.stage : currentStage,
    });

    await insertRow(config, "learning_turns", {
      session_id: sessionId,
      user_id: userId,
      lesson_id: lessonId,
      role: "mentor",
      stage: envelope.stage,
      response_mode: envelope.response_mode,
      content: envelope.reply,
      payload: envelope,
    });

    if (answer) {
      const assessment = envelope.assessment && typeof envelope.assessment === "object"
        ? envelope.assessment as Record<string, unknown>
        : {};
      await insertRow(config, "lesson_attempts", {
        session_id: sessionId,
        activity_id: typeof activity?.id === "string" ? activity.id : null,
        user_id: userId,
        lesson_id: lessonId,
        answer_mode: answer.mode,
        answer_text: answer.mode === "text" ? answer.text : null,
        answer_code: answer.mode === "code" ? answer.code : null,
        choice_id: answer.mode === "multiple_choice" ? answer.choice_id : null,
        run_result: answer.run_result || null,
        score: typeof assessment.score === "number" ? assessment.score : null,
        passed: typeof assessment.passed === "boolean" ? assessment.passed : null,
        feedback: typeof assessment.feedback === "string" ? assessment.feedback : envelope.reply,
      });
    }

    const status = envelope.stage === "complete" || envelope.next_action === "complete"
      ? "complete"
      : envelope.next_action === "retry"
      ? "needs_retry"
      : envelope.next_action === "rescue"
      ? "needs_rescue"
      : "active";

    await supabaseFetch(config, `learning_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        stage: envelope.stage,
        status,
        updated_at: new Date().toISOString(),
      }),
    });

    return json(envelope);
  } catch (err) {
    return typedError(errorMessage(err), 500, {
      session_id: sessionId,
      lesson_id: lessonId,
      stage: currentStage,
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return typedError("Request body must be a JSON object.", 400);
    }

    const record = body as Record<string, unknown>;
    if (isLegacyRequest(record)) {
      return await handleLegacyRequest(record);
    }
    return await handleTypedRequest(req, record);
  } catch (err) {
    return typedError(errorMessage(err), 500);
  }
});
