// Jargon Mentor - structured course-session chat edge function.
// Legacy compatibility: { messages } -> { reply } still works.
// Typed contract: { lesson_id, session_id?, answer?, mentor_preferences? } -> learning envelope.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STAGES = new Set([
  "intro",
  "teach",
  "practice",
  "assessment",
  "review",
  "complete",
]);
const RESPONSE_MODES = new Set(["text", "code", "multiple_choice", "file"]);
const NEXT_ACTIONS = new Set([
  "reply",
  "run_code",
  "choose",
  "retry",
  "rescue",
  "continue",
  "complete",
]);
const PACE_OPTIONS = new Set(["brief", "balanced", "guided"]);
const TONE_OPTIONS = new Set(["neutral", "encouraging"]);
const HINT_LEVEL_OPTIONS = new Set(["low", "medium", "high"]);
const MENTOR_MODE_OPTIONS = new Set([
  "explain",
  "guide",
  "quiz",
  "check",
  "write",
  "challenge",
]);
const HELP_REQUEST_OPTIONS = new Set(["hint", "show_me_how", "explain"]);
const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;
const CHAT_RATE_LIMIT_MAX = 30;

const SYSTEM_PROMPT = `You are the Jargon Mentor, a warm, curious, firm tutor for school children.

You teach through a real back-and-forth conversation — diagnosing what the student needs and adapting — not by
reading a script. The lesson teaches logical thinking through the bridge: natural speech -> baby Jargon ->
Jargon pseudocode -> Python bridge when the learner is ready.

Every turn, FIRST read the student's latest message and respond to what they actually said:
- Acknowledge what they got right, by name. Build on their words.
- If they already answered correctly or completely, CONFIRM it, add one sentence of consolidation, and move
  forward. Do NOT ask the same thing again — recognizing understanding and progressing is required.
- Never repeat a question you have already asked (your recent questions are listed for you). Vary and advance.
- If they say something incorrect, correct that specific point clearly and kindly.
- Respond to their intent: "I don't understand" -> explain the exact sticking point simply with a concrete
  example (don't re-ask the same question); a request to summarize -> summarize what you've covered;
  frustration or "didn't we discuss this" -> acknowledge it and move on or summarize; a breakthrough ("oh!")
  -> celebrate briefly and advance.
- The recommended teaching move (provided below) is guidance, not a script — follow the student's real need.

Hard rules (always):
- Stay on the current lesson goal; if the student drifts, briefly acknowledge and redirect.
- Keep responses short, concrete, and age-appropriate. Do not use emojis.
- Treat code execution as deterministic: Jargon runs through the engine, not imagination. Python is a
  comparison bridge only; do not claim to execute Python. Do not ask students to upload files.
- Honor the integrity policy and help ceiling you are given.

Set "understanding" to reflect whether the student's words show they understand THIS step's objective:
demonstrated=true only when their explanation/answer is essentially correct and complete.

Return only valid JSON matching this shape:
{
  "status": "ok",
  "reply": "student-facing mentor message",
  "stage": "intro | teach | practice | assessment | review | complete",
  "response_mode": "text | code | multiple_choice | file",
  "choices": [],
  "exercise": null,
  "assessment": null,
  "understanding": { "demonstrated": false, "level": "none | partial | solid", "note": "" },
  "next_action": "reply | run_code | choose | retry | rescue | continue | complete",
  "guardrail": { "redirected": false, "reason": null }
}`;

type Stage =
  | "intro"
  | "teach"
  | "practice"
  | "assessment"
  | "review"
  | "complete";
type ResponseMode = "text" | "code" | "multiple_choice" | "file";
type NextAction =
  | "reply"
  | "run_code"
  | "choose"
  | "retry"
  | "rescue"
  | "continue"
  | "complete";

type Envelope = {
  status: "ok" | "error";
  reply: string;
  session_id: string | null;
  lesson_id: string | null;
  stage: Stage;
  response_mode: ResponseMode;
  choices: unknown[];
  exercise: unknown | null;
  assessment: unknown | null;
  resources?: LessonChatResource[];
  next_action: NextAction;
  guardrail: { redirected: boolean; reason: string | null };
};

type LessonChatResource = {
  id: string;
  title: string;
  description?: string;
  resource_type: string;
  display_mode: "inline" | "modal" | "card";
  source_type: "upload" | "external_url";
  storage_bucket?: string | null;
  storage_path?: string | null;
  external_url?: string | null;
  thumbnail_url?: string | null;
  thumbnail_bucket?: string | null;
  thumbnail_path?: string | null;
  student_instructions?: string;
};

type SupabaseConfig = {
  url: string;
  anonKey: string;
  authorization: string;
};

type DbRow = Record<string, unknown>;

type OpenAIResult = {
  content: string;
  model: string;
  route: ModelRoute;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  latencyMs: number;
};

type ModelRoute = "default" | "grading" | "rescue" | "resource_context";
type ModelUsageTaskType =
  | "mentor_turn"
  | "grading"
  | "rescue"
  | "summarization";

type Assessment = {
  score?: number;
  passed?: boolean;
  feedback?: string;
  source: "orchestrator" | "mentor";
};

// The mentor's judgment of whether the student's words show they understand the
// current step's objective. Drives advancement for free-text / explanation work
// (where there is no deterministic grade).
type Understanding = {
  demonstrated: boolean;
  level: "none" | "partial" | "solid";
  note: string;
};

type FlowDecision = {
  stage: Stage;
  responseMode: ResponseMode;
  nextAction: NextAction;
  choices: unknown[];
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

function envText(name: string, fallback: string): string {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : fallback;
}

function stage(value: unknown, fallback: Stage = "intro"): Stage {
  const candidate = String(value || "");
  return STAGES.has(candidate) ? (candidate as Stage) : fallback;
}

function responseMode(
  value: unknown,
  fallback: ResponseMode = "text",
): ResponseMode {
  const candidate = String(value || "");
  return RESPONSE_MODES.has(candidate) ? (candidate as ResponseMode) : fallback;
}

function nextAction(
  value: unknown,
  fallback: NextAction = "reply",
): NextAction {
  const candidate = String(value || "");
  return NEXT_ACTIONS.has(candidate) ? (candidate as NextAction) : fallback;
}

function makeEnvelope(partial: Partial<Envelope> = {}): Envelope {
  return {
    status: partial.status === "error" ? "error" : "ok",
    reply: typeof partial.reply === "string" ? partial.reply : "",
    session_id:
      typeof partial.session_id === "string" ? partial.session_id : null,
    lesson_id: typeof partial.lesson_id === "string" ? partial.lesson_id : null,
    stage: stage(partial.stage),
    response_mode: responseMode(partial.response_mode),
    choices: Array.isArray(partial.choices) ? partial.choices : [],
    exercise: partial.exercise ?? null,
    assessment: partial.assessment ?? null,
    resources: Array.isArray(partial.resources) ? partial.resources : [],
    next_action: nextAction(partial.next_action),
    guardrail: {
      redirected: partial.guardrail?.redirected === true,
      reason:
        typeof partial.guardrail?.reason === "string"
          ? partial.guardrail.reason
          : null,
    },
  };
}

function typedError(
  message: string,
  status = 500,
  context: Partial<Envelope> = {},
): Response {
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

function typedAuthStatus(message: string): number {
  if (
    message.includes("Authentication is required") ||
    message.includes("authenticated")
  )
    return 401;
  if (
    message.includes("identify authenticated user") ||
    message.includes("JWT")
  )
    return 403;
  return 500;
}

function isLegacyRequest(body: Record<string, unknown>): boolean {
  return (
    Array.isArray(body.messages) &&
    !body.lesson_id &&
    !body.session_id &&
    !body.answer
  );
}

function normalizeAnswer(answer: unknown): DbRow | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer))
    return null;
  const raw = answer as DbRow;
  const mode = responseMode(raw.mode, "text");
  const inputModality = ["typed", "dictated", "audio_session"].includes(
    String(raw.input_modality),
  )
    ? String(raw.input_modality)
    : "typed";
  const transcriptConfidence =
    typeof raw.transcript_confidence === "number" &&
    Number.isFinite(raw.transcript_confidence)
      ? Math.max(0, Math.min(1, raw.transcript_confidence))
      : null;
  return {
    mode,
    text: typeof raw.text === "string" ? raw.text : "",
    code: typeof raw.code === "string" ? raw.code : "",
    choice_id: typeof raw.choice_id === "string" ? raw.choice_id : "",
    run_result:
      raw.run_result && typeof raw.run_result === "object"
        ? raw.run_result
        : null,
    input_modality: inputModality,
    transcript_confidence: transcriptConfidence,
  };
}

function answerContent(answer: DbRow | null): string {
  if (!answer) return "";
  if (answer.mode === "code") return String(answer.code || "");
  if (answer.mode === "multiple_choice") return String(answer.choice_id || "");
  if (answer.mode === "file") return "[file answer placeholder]";
  return String(answer.text || "");
}

function normalizeMentorPreferences(
  raw: unknown,
): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const prefs = raw as DbRow;
  const pace = PACE_OPTIONS.has(String(prefs.pace))
    ? String(prefs.pace)
    : "balanced";
  const tone = TONE_OPTIONS.has(String(prefs.tone))
    ? String(prefs.tone)
    : "neutral";
  const hintLevel = HINT_LEVEL_OPTIONS.has(String(prefs.hint_level))
    ? String(prefs.hint_level)
    : "medium";
  const mode = MENTOR_MODE_OPTIONS.has(String(prefs.mode))
    ? String(prefs.mode)
    : "guide";
  return { pace, tone, hint_level: hintLevel, mode };
}

function restConfig(req: Request): SupabaseConfig {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") || "";
  if (!url || !anonKey)
    throw new Error("SUPABASE_URL or SUPABASE_ANON_KEY is not configured.");
  if (!authorization) throw new Error("Authentication is required.");
  return { url, anonKey, authorization };
}

async function supabaseFetch(
  config: SupabaseConfig,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.anonKey);
  headers.set("Authorization", config.authorization);
  if (!headers.has("Content-Type") && init.body)
    headers.set("Content-Type", "application/json");

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

async function fetchCurrentUser(config: SupabaseConfig): Promise<DbRow> {
  const res = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: config.authorization,
    },
  });
  const data = await res.json();
  if (!res.ok || !data?.id)
    throw new Error("Could not identify authenticated user.");
  return data;
}

async function insertRow(
  config: SupabaseConfig,
  table: string,
  row: DbRow,
): Promise<DbRow> {
  const data = await supabaseFetch(config, table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
    throw new Error(`Insert into ${table} returned no row.`);
  }
  return data[0] as DbRow;
}

async function patchRows(
  config: SupabaseConfig,
  path: string,
  row: DbRow,
): Promise<void> {
  await supabaseFetch(config, path, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
}

async function recordRuntimeEvent(
  config: SupabaseConfig,
  row: {
    userId?: string | null;
    sessionId?: string | null;
    lessonId?: string | null;
    eventType:
      | "chat_failure"
      | "run_failure"
      | "stage_transition"
      | "completion"
      | "retry"
      | "rescue"
      | "controlled_error";
    status?: "ok" | "error";
    latencyMs?: number | null;
    payload?: DbRow;
  },
): Promise<void> {
  try {
    await insertRow(config, "runtime_events", {
      user_id: row.userId || null,
      session_id: row.sessionId || null,
      lesson_id: row.lessonId || null,
      event_type: row.eventType,
      status: row.status || "ok",
      latency_ms: row.latencyMs ?? null,
      payload: row.payload || {},
    });
  } catch {
    // Observability must never block the lesson flow.
  }
}

async function recordModelUsage(
  config: SupabaseConfig,
  userId: string,
  sessionId: string,
  lessonId: string,
  usage: OpenAIResult,
  taskType: ModelUsageTaskType = "mentor_turn",
  status: "ok" | "error" = "ok",
): Promise<void> {
  try {
    await insertRow(config, "model_usage_events", {
      user_id: userId,
      session_id: sessionId,
      lesson_id: lessonId,
      provider: usage.provider || "openai",
      model: usage.model,
      task_type: taskType,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cached_tokens: usage.cachedTokens,
      estimated_cost_usd: null,
      latency_ms: usage.latencyMs,
      status,
      payload: { route: usage.route },
    });
  } catch {
    // Best-effort cost/usage telemetry.
  }
}

async function loadFirst(
  config: SupabaseConfig,
  path: string,
): Promise<DbRow | null> {
  const data = await supabaseFetch(config, path);
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object")
    return null;
  return data[0] as DbRow;
}

async function loadMany(
  config: SupabaseConfig,
  path: string,
): Promise<DbRow[]> {
  const data = await supabaseFetch(config, path);
  return Array.isArray(data)
    ? (data.filter((row) => row && typeof row === "object") as DbRow[])
    : [];
}

async function recentRowCount(
  config: SupabaseConfig,
  path: string,
): Promise<number> {
  const rows = await loadMany(config, path);
  return rows.length;
}

async function isChatRateLimited(
  config: SupabaseConfig,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const since = encodeURIComponent(
    new Date(Date.now() - CHAT_RATE_LIMIT_WINDOW_MS).toISOString(),
  );
  const count = await recentRowCount(
    config,
    `learning_turns?user_id=eq.${encodeURIComponent(userId)}&session_id=eq.${encodeURIComponent(sessionId)}&created_at=gte.${since}&select=id&limit=${CHAT_RATE_LIMIT_MAX + 1}`,
  );
  return count >= CHAT_RATE_LIMIT_MAX;
}

async function loadOrCreateSession(
  config: SupabaseConfig,
  userId: string,
  lessonId: string,
  sessionId: unknown,
): Promise<DbRow> {
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

// --- Model-agnostic LLM gateway ----------------------------------------------
// One entry point (`callModel`) the tutor uses; the provider/model/temperature are
// configured via env so Jargon's value stays in the governance layer, not a model.
// Defaults to OpenAI so production behavior is unchanged unless TUTOR_PROVIDER flips.

function modelFor(route: ModelRoute): string {
  // Prefer TUTOR_MODEL_*; fall back to the legacy OPENAI_MODEL_* then sane defaults.
  const def = envText("TUTOR_MODEL_DEFAULT", envText("OPENAI_MODEL_DEFAULT", "gpt-4o-mini"));
  const strong = envText("TUTOR_MODEL_STRONG", envText("OPENAI_MODEL_GRADING", "gpt-4o"));
  if (route === "grading") return envText("TUTOR_MODEL_GRADING", strong);
  if (route === "rescue") return envText("TUTOR_MODEL_RESCUE", envText("OPENAI_MODEL_RESCUE", strong));
  if (route === "resource_context") {
    return envText("TUTOR_MODEL_RESOURCE_CONTEXT", envText("OPENAI_MODEL_RESOURCE_CONTEXT", strong));
  }
  return def;
}

function temperatureFor(route: ModelRoute): number {
  // Conversation wants variety (a key fix for the flat re-asking); grading / extraction
  // want determinism.
  if (route === "grading" || route === "resource_context") return 0.2;
  if (route === "rescue") return 0.4;
  const raw = Number(envText("TUTOR_TEMPERATURE_DEFAULT", "0.6"));
  return Number.isFinite(raw) ? Math.max(0, Math.min(1.2, raw)) : 0.6;
}

async function callModel(
  messages: unknown[],
  jsonMode: boolean,
  route: ModelRoute = "default",
): Promise<OpenAIResult> {
  const provider = envText("TUTOR_PROVIDER", "openai").toLowerCase();
  const model = modelFor(route);
  const temperature = temperatureFor(route);
  if (provider === "anthropic") {
    return await callAnthropic(messages, jsonMode, route, model, temperature);
  }
  return await callOpenAIChat(messages, jsonMode, route, model, temperature);
}

async function callOpenAIChat(
  messages: unknown[],
  jsonMode: boolean,
  route: ModelRoute,
  model: string,
  temperature: number,
): Promise<OpenAIResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const body: DbRow = { model, messages, temperature };
  if (jsonMode) body.response_format = { type: "json_object" };

  const startedAt = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || res.statusText);
  const usage = data?.usage && typeof data.usage === "object" ? data.usage : {};
  const promptDetails =
    usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
      ? usage.prompt_tokens_details
      : {};
  return {
    content: data?.choices?.[0]?.message?.content || "",
    model: typeof data?.model === "string" ? data.model : model,
    route,
    provider: "openai",
    inputTokens: Number(usage.prompt_tokens || 0),
    outputTokens: Number(usage.completion_tokens || 0),
    cachedTokens: Number(promptDetails.cached_tokens || 0),
    latencyMs: Date.now() - startedAt,
  };
}

function extractJsonObject(text: string): string {
  const t = (text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const inner = fenced ? fenced[1].trim() : t;
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  return start >= 0 && end > start ? inner.slice(start, end + 1) : inner;
}

async function callAnthropic(
  messages: unknown[],
  jsonMode: boolean,
  route: ModelRoute,
  model: string,
  temperature: number,
): Promise<OpenAIResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
  const rows = messages as DbRow[];
  // Anthropic takes `system` as a top-level param, not a message role.
  let system = rows
    .filter((m) => m.role === "system")
    .map((m) => String(m.content || ""))
    .join("\n\n");
  if (jsonMode) {
    system = `${system}\n\nRespond with ONLY a single valid JSON object and nothing else.`;
  }
  const convo = rows
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    }));

  const startedAt = Date.now();
  // Note: temperature is intentionally omitted — current Claude models reject it (HTTP
  // 400); we steer variety via the prompt instead. `temperature` is accepted here only
  // to keep the adapter signature uniform with the OpenAI path.
  void temperature;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system,
      messages: convo.length ? convo : [{ role: "user", content: "Begin." }],
      max_tokens: 4096,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || res.statusText);
  if (data?.stop_reason === "max_tokens") {
    throw new Error("Anthropic reply was truncated at max_tokens; raise max_tokens.");
  }
  const blocks = Array.isArray(data?.content) ? data.content : [];
  let content = blocks
    .filter((b: DbRow) => b?.type === "text")
    .map((b: DbRow) => String(b.text || ""))
    .join("");
  if (jsonMode) content = extractJsonObject(content);
  const usage = data?.usage && typeof data.usage === "object" ? data.usage : {};
  return {
    content,
    model: typeof data?.model === "string" ? data.model : model,
    route,
    provider: "anthropic",
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    cachedTokens: Number(usage.cache_read_input_tokens || 0),
    latencyMs: Date.now() - startedAt,
  };
}

function modelRouteFor(
  flow: FlowDecision,
  answer: DbRow | null,
  assessment: Assessment | null,
  context: Awaited<ReturnType<typeof loadContext>>,
): { route: ModelRoute; taskType: ModelUsageTaskType } {
  if (flow.nextAction === "rescue") return { route: "rescue", taskType: "rescue" };
  if (answer && assessment) return { route: "grading", taskType: "grading" };
  if (context.resourceChunks.length > 0) {
    return { route: "resource_context", taskType: "summarization" };
  }
  return { route: "default", taskType: "mentor_turn" };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? (value.filter((item) => typeof item === "string") as string[])
    : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inFilter(values: string[]): string {
  return `in.(${values.map((value) => encodeURIComponent(value)).join(",")})`;
}

function outputLines(runResult: unknown): string[] {
  if (!runResult || typeof runResult !== "object") return [];
  const raw = runResult as DbRow;
  const direct = Array.isArray(raw.output)
    ? raw.output
    : Array.isArray(raw.result)
      ? raw.result
      : null;
  if (direct) return direct.map((item) => String(item));
  if (typeof raw.output === "string") return raw.output.split(/\r?\n/);
  return [];
}

function runHasErrors(runResult: unknown): boolean {
  if (!runResult || typeof runResult !== "object") return true;
  const raw = runResult as DbRow;
  if (raw.ok === false) return true;
  if (typeof raw.status === "string" && raw.status !== "ok") return true;
  return Array.isArray(raw.errors) && raw.errors.length > 0;
}

function expectedOutputFor(
  lesson: DbRow | null,
  activity: DbRow | null,
): string {
  return String(
    activity?.expected_output || lesson?.expected_output || "",
  ).trim();
}

function passThreshold(activity: DbRow | null, quiz: DbRow | null): number {
  const activityThreshold = numberOrNull(activity?.pass_score);
  if (activityThreshold !== null) return activityThreshold;
  const rubric =
    quiz?.rubric && typeof quiz.rubric === "object"
      ? (quiz.rubric as DbRow)
      : null;
  return numberOrNull(rubric?.pass_threshold) ?? 1;
}

function assessAnswer(
  answer: DbRow | null,
  lesson: DbRow | null,
  activity: DbRow | null,
  quiz: DbRow | null,
): Assessment | null {
  if (!answer) return null;
  if (answer.mode === "code") {
    const expected = expectedOutputFor(lesson, activity);
    const lines = outputLines(answer.run_result);
    const joined = lines.join("\n").trim();
    const hasErrors = runHasErrors(answer.run_result);
    const matched = expected ? joined.includes(expected) : !hasErrors;
    const passed = !hasErrors && matched;
    return {
      score: passed ? 1 : 0,
      passed,
      feedback: passed
        ? "The code ran and produced the expected result."
        : expected
          ? `Run the code again and aim for output that includes: ${expected}`
          : "The code did not run cleanly yet. Try one small fix.",
      source: "orchestrator",
    };
  }

  if (answer.mode === "multiple_choice" && quiz) {
    const correct = stringArray(quiz.correct_choice_ids);
    const choice = String(answer.choice_id || "");
    const passed = correct.includes(choice);
    return {
      score: passed ? 1 : 0,
      passed,
      feedback: passed ? "Correct choice." : "That choice is not correct yet.",
      source: "orchestrator",
    };
  }

  return null;
}

function parsedAssessment(value: unknown): Assessment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as DbRow;
  const score = numberOrNull(raw.score);
  const passed = boolOrNull(raw.passed);
  if (score === null && passed === null && typeof raw.feedback !== "string")
    return null;
  return {
    score: score ?? undefined,
    passed: passed ?? undefined,
    feedback: typeof raw.feedback === "string" ? raw.feedback : undefined,
    source: "mentor",
  };
}

function parsedUnderstanding(value: unknown): Understanding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as DbRow;
  const demonstrated = raw.demonstrated === true;
  const levelRaw = String(raw.level || "");
  const level = (["none", "partial", "solid"].includes(levelRaw)
    ? levelRaw
    : demonstrated
      ? "solid"
      : "none") as Understanding["level"];
  return {
    demonstrated,
    level,
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

function mergeAssessment(
  orchestrator: Assessment | null,
  mentor: Assessment | null,
): Assessment | null {
  if (!orchestrator && !mentor) return null;
  if (!orchestrator) return mentor;
  if (!mentor) return orchestrator;
  return {
    ...mentor,
    ...orchestrator,
    feedback: mentor.feedback || orchestrator.feedback,
  };
}

// --- Pedagogy decision layer -------------------------------------------------
// Sits between context-load and the LLM call: diagnose the learner, resolve the
// teacher's help ceiling against the student's chosen mode, and pick ONE teaching
// move. Pure + deterministic (no extra model round-trip). It shapes the system
// prompt + user payload so the model executes a *chosen* move under a *known*
// integrity ceiling instead of inferring all pedagogy from one generic prompt.

type TeachingMove =
  | "present"
  | "diagnose"
  | "explain"
  | "model"
  | "hint"
  | "scaffold"
  | "socratic"
  | "correct"
  | "retrieve"
  | "extend"
  | "reflect";

type StudentDiagnosis = {
  level: "beginner" | "emerging" | "capable" | "advanced";
  difficulty:
    | "conceptual"
    | "procedural"
    | "careless"
    | "confidence"
    | "none"
    | "unknown";
  gradeBand: "lower" | "middle" | "upper" | "unknown";
};

type HelpPolicy = {
  helpCeiling: string;
  requireAttemptFirst: boolean;
  finalAnswerPolicy: "never" | "after_attempt" | "allowed";
  tone: string;
  pace: string;
};

const HELP_RANK: Record<string, number> = {
  clarify: 1,
  hints: 2,
  guided: 3,
  worked_example: 4,
  feedback: 5,
  study: 6,
};
// The help level each student mode *wants* (clamped down to the teacher ceiling).
const MODE_HELP_WANT: Record<string, number> = {
  explain: 4,
  guide: 3,
  quiz: 2,
  check: 5,
  write: 5,
  challenge: 2,
};

const MOVE_GUIDANCE: Record<TeachingMove, string> = {
  present:
    "PRESENT this step: introduce the task in a sentence or two at the student's grade level and invite them to make their first attempt. Don't pre-empt their thinking, give away the answer, or interrogate them yet.",
  diagnose:
    "DIAGNOSE first: ask ONE short question to pinpoint where the student is stuck (the idea, the method, the wording, or just getting started). Do not explain or solve yet.",
  explain:
    "EXPLAIN directly and simply, calibrated to the grade band, using one concrete example or analogy, then immediately check understanding with a quick question or tiny task.",
  model:
    "MODEL with a WORKED EXAMPLE on a SIMILAR (not the assigned) item: show the steps and your thinking, then ask the student to try the assigned one themselves. Never hand over the assigned answer.",
  hint: "Give exactly ONE hint at the requested rung, then stop and ask the student to try. Do not reveal the full solution.",
  scaffold:
    "SCAFFOLD: name only the NEXT single step, ask the student to do just that step, then wait.",
  socratic:
    "Ask ONE guiding question that leads the student toward the next step. Do not give the answer; let them reason.",
  correct:
    "Acknowledge what is right first, then point to the ONE specific step that is wrong and why in a sentence, and ask the student to fix just that.",
  retrieve:
    "RETRIEVAL PRACTICE: ask a short recall/application question that targets a weak skill. Do not show the answer first; respond after the student answers.",
  extend:
    "EXTEND: the student is solid — pose a harder variant, an edge case, or a 'why' question that stretches them.",
  reflect:
    "Ask the student to explain HOW they solved it or what strategy helped, to consolidate the learning, and name the strategy.",
};

function gradeBandFor(
  grade: unknown,
  lessonBand: unknown,
): StudentDiagnosis["gradeBand"] {
  const explicit = String(lessonBand || "").toLowerCase();
  if (explicit === "lower" || explicit === "middle" || explicit === "upper") {
    return explicit;
  }
  const digits = String(grade || "").replace(/[^0-9]/g, "");
  if (digits) {
    const n = Number.parseInt(digits, 10);
    if (Number.isFinite(n)) {
      if (n <= 5) return "lower";
      if (n <= 8) return "middle";
      return "upper";
    }
  }
  return "unknown";
}

function diagnoseStudent(
  context: Awaited<ReturnType<typeof loadContext>>,
  session: DbRow,
  skills: string[],
  answer: DbRow | null,
  assessment: Assessment | null,
): StudentDiagnosis {
  const relevant = context.mastery.filter((m) =>
    skills.includes(String(m.skill_key)),
  );
  const pool = relevant.length ? relevant : context.mastery;
  const avg = pool.length
    ? pool.reduce((sum, m) => sum + Number(m.score || 0), 0) / pool.length
    : 0;
  const retry = Number(session.retry_count || 0);
  const rescue = Number(session.rescue_count || 0);

  let level: StudentDiagnosis["level"];
  if (pool.length === 0) level = "beginner";
  else if (avg < 0.4) level = "beginner";
  else if (avg < 0.7) level = "emerging";
  else if (avg < 0.9) level = "capable";
  else level = "advanced";
  if (rescue >= 2 && level === "advanced") level = "capable";

  let difficulty: StudentDiagnosis["difficulty"] = "unknown";
  if (!answer) difficulty = "unknown";
  else if (assessment?.passed === true) difficulty = "none";
  else if (answer.mode === "code") {
    difficulty = runHasErrors(answer.run_result)
      ? "procedural"
      : retry >= 1
        ? "conceptual"
        : "careless";
  } else {
    difficulty = retry >= 1 ? "conceptual" : "careless";
  }
  if (difficulty !== "none" && difficulty !== "unknown" && rescue >= 1) {
    difficulty = "conceptual";
  }

  return {
    level,
    difficulty,
    gradeBand: gradeBandFor(context.profile?.grade, context.lesson?.grade_band),
  };
}

function resolveHelpPolicy(lesson: DbRow | null): HelpPolicy {
  const ceiling = String(lesson?.help_ceiling || "guided");
  const helpCeiling = HELP_RANK[ceiling] ? ceiling : "guided";
  const finalAnswerRaw = String(lesson?.final_answer_policy || "after_attempt");
  const finalAnswerPolicy = (
    ["never", "after_attempt", "allowed"].includes(finalAnswerRaw)
      ? finalAnswerRaw
      : "after_attempt"
  ) as HelpPolicy["finalAnswerPolicy"];
  return {
    helpCeiling,
    requireAttemptFirst: lesson?.require_attempt_first !== false,
    finalAnswerPolicy,
    tone: String(lesson?.tutor_tone || ""),
    pace: String(lesson?.tutor_pace || ""),
  };
}

function selectTeachingMove(
  diagnosis: StudentDiagnosis,
  policy: HelpPolicy,
  mode: string,
  answer: DbRow | null,
  assessment: Assessment | null,
  hasAttempt: boolean,
  helpRequest: string,
  requestedRung: number,
  isIntro: boolean,
  intent: string,
): { move: TeachingMove; hintRung: number } {
  const wantRank = MODE_HELP_WANT[mode] ?? 3;
  const ceil = Math.min(HELP_RANK[policy.helpCeiling] ?? 3, wantRank);
  const rung = Math.max(1, Math.min(4, requestedRung || 1));

  // Intro/presentation turn: the orchestrator presents the activity and never grades,
  // so PRESENT the task — don't let attempt-first gating turn the lesson opener into an
  // interrogation. (Applies even if the turn carried a message, mirroring flowFor.)
  if (isIntro && !helpRequest) return { move: "present", hintRung: 0 };

  // Confused student: never recommend another socratic re-ask — explain the gap (or
  // diagnose if a worked explanation isn't allowed). This was the core rigidity bug.
  if (intent === "confused" && !helpRequest) {
    return ceil >= HELP_RANK.guided
      ? { move: "explain", hintRung: 0 }
      : { move: "diagnose", hintRung: 0 };
  }

  // Integrity gate: attempt-first required and nothing attempted yet -> never model
  // or hand over a path; diagnose, or give one gentle hint if explicitly asked.
  if (policy.requireAttemptFirst && !hasAttempt && assessment?.passed !== true) {
    if (helpRequest === "hint") return { move: "hint", hintRung: Math.min(rung, 2) };
    return { move: "diagnose", hintRung: 0 };
  }

  // Explicit student help requests (Hint / Show-me-how).
  if (helpRequest === "hint") return { move: "hint", hintRung: rung };
  if (helpRequest === "show_me_how") {
    return ceil >= HELP_RANK.worked_example
      ? { move: "model", hintRung: rung }
      : { move: "hint", hintRung: Math.max(2, rung) };
  }

  // Mode-led bias.
  if (mode === "quiz") return { move: "retrieve", hintRung: 0 };
  if (mode === "check") return { move: "correct", hintRung: 0 };
  if (mode === "write") return { move: "scaffold", hintRung: 0 };
  if (mode === "challenge") {
    return {
      move: assessment?.passed === true ? "extend" : "socratic",
      hintRung: 0,
    };
  }

  // Outcome-led for guide / explain.
  if (assessment?.passed === true) {
    return diagnosis.level === "advanced"
      ? { move: "extend", hintRung: 0 }
      : { move: "reflect", hintRung: 0 };
  }
  if (!hasAttempt && !answer) {
    return mode === "explain" && ceil >= HELP_RANK.guided
      ? { move: "explain", hintRung: 0 }
      : { move: "diagnose", hintRung: 0 };
  }
  if (diagnosis.difficulty === "procedural") {
    return ceil >= HELP_RANK.worked_example
      ? { move: "model", hintRung: rung }
      : { move: "scaffold", hintRung: rung };
  }
  if (diagnosis.difficulty === "conceptual") {
    if (mode === "explain" && ceil >= HELP_RANK.worked_example) {
      return { move: "explain", hintRung: 0 };
    }
    return ceil >= HELP_RANK.guided
      ? { move: "socratic", hintRung: rung }
      : { move: "hint", hintRung: rung };
  }
  if (diagnosis.difficulty === "careless") return { move: "correct", hintRung: rung };
  if (diagnosis.difficulty === "confidence") {
    return { move: "hint", hintRung: Math.max(1, rung) };
  }
  return { move: "diagnose", hintRung: 0 };
}

// Lightweight intent read of the student's latest message. The prompt does the
// nuance; this just lets us bias the recommended move and surface the signal.
const INTENT_PATTERNS: { intent: string; re: RegExp }[] = [
  {
    intent: "frustrated",
    re: /(did\s?n'?t we|already (said|asked|discussed|covered|went over)|keep asking|going in circles|same (thing|question))/i,
  },
  {
    intent: "wants_summary",
    re: /(summar(y|ize|ise)|recap|go over (what|everything|it again)|what (did|have) we (do|cover|discuss|go))/i,
  },
  {
    intent: "confused",
    re: /(not sure|do\s?n'?t (get|understand|know)|confus(ed|ing)|i'?m lost|no idea|makes no sense|what do you mean)/i,
  },
  {
    intent: "breakthrough",
    re: /(\boh+!+|\bi (get|got) it\b|makes sense now|now i (see|get|understand)|\bi see\b|aha\b)/i,
  },
];

function detectIntent(text: string): string {
  const t = (text || "").trim();
  if (!t) return "none";
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(t)) return intent;
  }
  return "none";
}

// The mentor's own recent questions (most-recent first) so the prompt can tell it
// NOT to repeat them — the single biggest cause of the rigid re-asking.
function mentorQuestionsFromTurns(turns: DbRow[]): string[] {
  const out: string[] = [];
  for (const turn of turns) {
    if (String(turn.role) !== "mentor") continue;
    const content = String(turn.content || "").trim();
    if (!content) continue;
    const questions = content.match(/[^.!?\n]*\?/g);
    const text = (questions && questions.length ? questions[questions.length - 1] : content)
      .trim()
      .slice(0, 160);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= 4) break;
  }
  return out;
}

function pedagogyPromptBlock(
  move: TeachingMove,
  diagnosis: StudentDiagnosis,
  policy: HelpPolicy,
  mode: string,
  hintRung: number,
  answersForbidden: boolean,
  misconceptions: DbRow[],
  recentQuestions: string[],
  intent: string,
): string {
  const integrity = answersForbidden
    ? "INTEGRITY (hard): do NOT provide the full or final answer / complete solution to the assigned task this turn — guide only."
    : "INTEGRITY: reveal a full solution only if it genuinely helps after the student's own attempt; otherwise prefer guidance.";
  const known = misconceptions.length
    ? `This student has previously shown these misconceptions: ${misconceptions
        .map((m) => `${String(m.skill_key)} — ${String(m.pattern)}`)
        .join("; ")}. If it resurfaces, correct it directly.`
    : "";
  const askedBefore = recentQuestions.length
    ? `You have ALREADY asked these recently — do NOT ask them again; either accept the student's answer and move on, or ask something genuinely new:\n${recentQuestions
        .map((q) => `  • ${q}`)
        .join("\n")}`
    : "";
  const intentLine =
    intent && intent !== "none"
      ? `Detected student intent: ${intent}. Respond to THIS first (see the intent rules above) before any recommended move.`
      : "";
  return [
    "PEDAGOGY GUIDANCE (a recommendation — adapt to the student's actual message):",
    `Recommended move: ${move}. ${MOVE_GUIDANCE[move]}`,
    move === "hint"
      ? `This is hint rung ${hintRung} of 4 (1 = gentle nudge, 4 = very revealing but still not the full answer). Make it MORE revealing than any earlier hint this session.`
      : "",
    intentLine,
    `Student: level=${diagnosis.level}, likely difficulty=${diagnosis.difficulty}, grade band=${diagnosis.gradeBand}. Calibrate vocabulary and sentence length to the grade band.`,
    `Mentor mode: ${mode}. Help ceiling: ${policy.helpCeiling} — never exceed it.`,
    integrity,
    known,
    askedBefore,
    'Set "understanding".demonstrated=true the moment the student\'s answer is essentially correct and complete, then confirm and move on instead of asking again. If you spot a recurring conceptual error, add a top-level "misconception": { "skill_key": "...", "pattern": "...", "hint": "..." } to your JSON.',
  ]
    .filter(Boolean)
    .join("\n");
}

function confidenceFor(
  assessment: Assessment | null,
  session: DbRow,
  hintRung: number,
): number {
  if (!assessment) return 0.5;
  const retry = Number(session.retry_count || 0);
  const rescue = Number(session.rescue_count || 0);
  if (assessment.passed === true) {
    return Math.max(
      0.55,
      Math.min(0.95, 0.9 - 0.12 * retry - 0.18 * rescue - 0.05 * hintRung),
    );
  }
  return Math.max(0.2, Math.min(0.5, 0.45 - 0.05 * retry));
}

function independenceFor(
  assessment: Assessment | null,
  attemptedBeforeHelp: boolean,
  hintRung: number,
): number {
  const solved = assessment?.passed === true ? 1 : 0;
  const ownSteam = attemptedBeforeHelp ? 1 : 0;
  const lowHelp = 1 - Math.min(1, hintRung / 4);
  return Math.max(0, Math.min(1, 0.5 * solved + 0.3 * ownSteam + 0.2 * lowHelp));
}

function gateFinalAnswer(
  reply: string,
  answersForbidden: boolean,
  expectedOutput: string,
): string {
  if (!answersForbidden) return reply;
  const needle = (expectedOutput || "").trim();
  // Narrow, conservative backstop: only act on a DISTINCTIVE expected output (a
  // multi-line program output block) so we never corrupt legitimate guidance that
  // merely mentions a short value like "4" or "True". The prompt-level move gating
  // is the primary integrity mechanism; this only catches a blatant verbatim leak.
  const distinctive = needle.length >= 12 && needle.includes("\n");
  if (!distinctive || !reply.includes(needle)) return reply;
  // Replace the whole verbatim block (handles multi-line, which a per-line filter missed).
  const redacted = reply.split(needle).join("…").trim();
  if (redacted.length < 12) {
    // Redaction would gut the reply — send a clean nudge instead of a corrupted message.
    return "Let's not jump to the full answer yet — make your own attempt and I'll check it with you.";
  }
  return `${redacted}\n\nTry it yourself first — make an attempt and I'll check it with you.`.trim();
}

async function upsertMisconception(
  config: SupabaseConfig,
  userId: string,
  organizationId: string | null,
  raw: unknown,
): Promise<void> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const m = raw as DbRow;
  const skillKey = String(m.skill_key || "").trim();
  const pattern = String(m.pattern || "")
    .trim()
    .slice(0, 280);
  if (!skillKey || !pattern) return;
  const hint = typeof m.hint === "string" ? m.hint.slice(0, 280) : null;
  const existing = await loadFirst(
    config,
    `student_misconceptions?user_id=eq.${encodeURIComponent(userId)}&skill_key=eq.${encodeURIComponent(skillKey)}&pattern=eq.${encodeURIComponent(pattern)}&select=id,occurrences&limit=1`,
  );
  const now = new Date().toISOString();
  if (existing && typeof existing.id === "string") {
    await patchRows(
      config,
      `student_misconceptions?id=eq.${encodeURIComponent(existing.id)}`,
      {
        occurrences: Number(existing.occurrences || 1) + 1,
        hint: hint ?? undefined,
        status: "active",
        last_seen_at: now,
        updated_at: now,
      },
    );
  } else {
    await insertRow(config, "student_misconceptions", {
      user_id: userId,
      organization_id: organizationId,
      skill_key: skillKey,
      pattern,
      hint,
      occurrences: 1,
      status: "active",
      first_seen_at: now,
      last_seen_at: now,
      updated_at: now,
    });
  }
}

function flowFor(
  currentStage: Stage,
  session: DbRow,
  activity: DbRow | null,
  quiz: DbRow | null,
  answer: DbRow | null,
  assessment: Assessment | null,
  understanding: Understanding | null,
  conversationDepth: number,
): FlowDecision {
  const activityMode = responseMode(activity?.response_mode, "code");
  const quizChoices = Array.isArray(quiz?.choices)
    ? (quiz.choices as unknown[])
    : [];
  const retryCount = Number(session.retry_count || 0);
  const rescueCount = Number(session.rescue_count || 0);
  const weakAction: NextAction =
    retryCount > 0 || rescueCount > 0 ? "rescue" : "retry";

  // Stage "intro" means this activity has not been presented yet: present it and move to
  // practice, never grade — whether or not this turn carried an answer. This keeps a fresh
  // session and a session that just advanced to the next step symmetric (the advancing
  // turn tells the student to "send a message", and that message lands here at intro).
  if (currentStage === "intro") {
    return {
      stage: "practice",
      responseMode: activityMode,
      nextAction:
        activityMode === "code"
          ? "run_code"
          : activityMode === "multiple_choice"
            ? "choose"
            : "reply",
      choices: activityMode === "multiple_choice" ? quizChoices : [],
    };
  }

  if (!answer) {
    const mode = activityMode;
    return {
      stage: currentStage === "intro" ? "practice" : currentStage,
      responseMode: mode,
      nextAction:
        mode === "code"
          ? "run_code"
          : mode === "multiple_choice"
            ? "choose"
            : "reply",
      choices: mode === "multiple_choice" ? quizChoices : [],
    };
  }

  if (answer.mode === "code") {
    if (assessment?.passed === true) {
      return quiz
        ? {
            stage: "assessment",
            responseMode: "multiple_choice",
            nextAction: "choose",
            choices: quizChoices,
          }
        : {
            stage: "complete",
            responseMode: "text",
            nextAction: "complete",
            choices: [],
          };
    }
    return {
      stage: "practice",
      responseMode: "code",
      nextAction: weakAction,
      choices: [],
    };
  }

  if (answer.mode === "multiple_choice") {
    if (assessment?.passed === true) {
      return {
        stage: "complete",
        responseMode: "text",
        nextAction: "complete",
        choices: [],
      };
    }
    return {
      stage: "review",
      responseMode: "multiple_choice",
      nextAction: weakAction,
      choices: quizChoices,
    };
  }

  if (assessment?.passed === true && currentStage === "review") {
    return {
      stage: "complete",
      responseMode: "text",
      nextAction: "complete",
      choices: [],
    };
  }

  if (answer.mode === "text" || answer.mode === "file") {
    if (quiz) {
      return {
        stage: "assessment",
        responseMode: "multiple_choice",
        nextAction: "choose",
        choices: quizChoices,
      };
    }
    // If the activity is already complete (e.g. a code activity whose code passed
    // earlier), a further text turn is a wrap-up chat — stay complete.
    if (currentStage === "complete") {
      return { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
    }
    // Explanation/discussion activity: complete only when the mentor judges the
    // student has demonstrated understanding (or after a stuck cap), instead of the
    // old behavior of blind-completing on the first text turn or looping forever.
    if (activityMode === "text") {
      const demonstrated = understanding?.demonstrated === true;
      // conversationDepth = prior attempts on THIS activity, so >=4 means the student
      // has gone several rounds here without demonstrating — conclude rather than loop.
      const stuck = conversationDepth >= 4;
      if (demonstrated || stuck) {
        return { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
      }
      return { stage: "practice", responseMode: "text", nextAction: "reply", choices: [] };
    }
    // Text side-message on a code/multiple-choice activity: keep guiding the student
    // toward the real attempt (do NOT blind-complete the activity).
    return {
      stage: currentStage === "intro" ? "practice" : currentStage,
      responseMode: activityMode,
      nextAction:
        activityMode === "multiple_choice" ? "choose" : activityMode === "code" ? "run_code" : "reply",
      choices: activityMode === "multiple_choice" ? quizChoices : [],
    };
  }

  return {
    stage: currentStage === "intro" ? "practice" : currentStage,
    responseMode: activityMode,
    nextAction: activityMode === "code" ? "run_code" : "reply",
    choices: [],
  };
}

function fallbackReply(
  flow: FlowDecision,
  assessment: Assessment | null,
  activity: DbRow | null,
  quiz: DbRow | null,
): string {
  if (flow.nextAction === "complete")
    return "Nice work. This lesson is complete.";
  if (flow.nextAction === "choose")
    return String(
      quiz?.prompt ||
        "Choose the answer that best matches what you just practiced.",
    );
  if (flow.nextAction === "retry")
    return (
      assessment?.feedback || "Try one more time. Focus on the current step."
    );
  if (flow.nextAction === "rescue")
    return "Let's rescue this together. Say what part feels stuck, or try the smallest next change.";
  if (flow.nextAction === "run_code")
    return String(
      activity?.prompt || "Run the starter code and tell me what it does.",
    );
  return String(activity?.prompt || "Tell me your next thought.");
}

function skillKeysFor(
  activity: DbRow | null,
  milestone: DbRow | null,
  quiz: DbRow | null,
): string[] {
  return uniqueStrings([
    ...stringArray(activity?.skill_keys),
    ...stringArray(milestone?.skill_keys),
    ...stringArray(quiz?.skill_keys),
  ]);
}

async function loadContext(
  config: SupabaseConfig,
  userId: string,
  lessonId: string,
  session: DbRow,
): Promise<{
  lesson: DbRow | null;
  activity: DbRow | null;
  milestone: DbRow | null;
  quiz: DbRow | null;
  recentTurns: DbRow[];
  recentAttempts: DbRow[];
  mastery: DbRow[];
  resources: DbRow[];
  resourceChunks: DbRow[];
  resourceInteractions: DbRow[];
  profile: DbRow | null;
  misconceptions: DbRow[];
}> {
  const lesson = await loadFirst(
    config,
    `lessons?id=eq.${encodeURIComponent(lessonId)}&publication_status=eq.published&select=id,title,module,level,tutor_prompt,sample_code,expected_output,unit_id,help_ceiling,require_attempt_first,final_answer_policy,tutor_tone,tutor_pace,grade_band`,
  );

  let activity: DbRow | null = null;
  if (
    typeof session.current_activity_id === "string" &&
    session.current_activity_id
  ) {
    activity = await loadFirst(
      config,
      `lesson_activities?id=eq.${encodeURIComponent(session.current_activity_id)}&lesson_id=eq.${encodeURIComponent(lessonId)}&select=*`,
    );
  }
  if (!activity) {
    activity = await loadFirst(
      config,
      `lesson_activities?lesson_id=eq.${encodeURIComponent(lessonId)}&order=position.asc&limit=1&select=*`,
    );
  }

  const milestoneId =
    typeof activity?.milestone_id === "string" ? activity.milestone_id : "";
  const milestone = milestoneId
    ? await loadFirst(
        config,
        `milestones?id=eq.${encodeURIComponent(milestoneId)}&select=*`,
      )
    : await loadFirst(
        config,
        `milestones?lesson_id=eq.${encodeURIComponent(lessonId)}&order=position.asc&limit=1&select=*`,
      );

  // Quiz must be scoped to the CURRENT activity. For multi-step lessons a lesson-wide
  // fallback would pull another step's checkpoint onto this step; only fall back to a
  // quiz that isn't bound to any activity (legacy single-activity lessons).
  const quiz = activity?.id
    ? ((await loadFirst(
        config,
        `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}&activity_id=eq.${encodeURIComponent(String(activity.id))}&status=eq.published&order=position.asc&limit=1&select=*`,
      )) ??
      (await loadFirst(
        config,
        `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}&activity_id=is.null&status=eq.published&order=position.asc&limit=1&select=*`,
      )))
    : await loadFirst(
        config,
        `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}&activity_id=is.null&status=eq.published&order=position.asc&limit=1&select=*`,
      );

  const ctxSkills = [...skillKeysFor(activity, milestone, quiz)];
  const [
    recentTurns,
    recentAttempts,
    mastery,
    resources,
    resourceInteractions,
    profile,
    misconceptions,
  ] = await Promise.all([
    loadMany(
      config,
      `learning_turns?session_id=eq.${encodeURIComponent(String(session.id))}&order=created_at.desc&limit=12&select=role,stage,response_mode,content,payload,created_at`,
    ),
    loadMany(
      config,
      `lesson_attempts?session_id=eq.${encodeURIComponent(String(session.id))}&order=created_at.desc&limit=5&select=*`,
    ),
    loadMany(
      config,
      `student_mastery?user_id=eq.${encodeURIComponent(userId)}&select=*`,
    ),
    loadMany(
      config,
      `lesson_resources?lesson_id=eq.${encodeURIComponent(lessonId)}&status=eq.published&order=created_at.asc&limit=5&select=id,title,description,resource_type,source_type,storage_bucket,storage_path,external_url,thumbnail_path,student_instructions,transcript_text,metadata`,
    ),
    loadMany(
      config,
      `resource_interactions?user_id=eq.${encodeURIComponent(userId)}&lesson_id=eq.${encodeURIComponent(lessonId)}&order=created_at.desc&limit=20&select=resource_id,event_type,progress_seconds,progress_percent,created_at`,
    ),
    loadFirst(
      config,
      `profiles?id=eq.${encodeURIComponent(userId)}&select=name,grade&limit=1`,
    ),
    loadMany(
      config,
      `student_misconceptions?user_id=eq.${encodeURIComponent(userId)}&status=eq.active${ctxSkills.length ? `&skill_key=${inFilter(ctxSkills)}` : ""}&order=last_seen_at.desc&limit=8&select=skill_key,pattern,hint,occurrences`,
    ),
  ]);
  const resourceIds = uniqueStrings(
    resources.map((resource) =>
      typeof resource.id === "string" ? resource.id : String(resource.id || ""),
    ),
  );
  const resourceChunks = resourceIds.length
    ? await loadMany(
        config,
        `resource_text_chunks?resource_id=${inFilter(resourceIds)}&status=eq.approved&order=source_kind.asc,start_seconds.asc,page_number.asc,chunk_index.asc&limit=18&select=resource_id,page_number,chunk_index,chunk_text,status,source_kind,start_seconds,end_seconds`,
      )
    : [];

  return {
    lesson,
    activity,
    milestone,
    quiz,
    recentTurns,
    recentAttempts,
    mastery,
    resources,
    resourceChunks,
    resourceInteractions,
    profile,
    misconceptions,
  };
}

function resourceForEnvelope(resource: DbRow): LessonChatResource {
  const sourceType =
    resource.source_type === "external_url" ? "external_url" : "upload";
  const displayMode = ["inline", "modal", "card"].includes(
    String(resource.display_mode),
  )
    ? (String(resource.display_mode) as "inline" | "modal" | "card")
    : "card";
  return {
    id: String(resource.id),
    title: String(resource.title || "Lesson resource"),
    description:
      typeof resource.description === "string" ? resource.description : "",
    resource_type: String(resource.resource_type || "document"),
    display_mode: displayMode,
    source_type: sourceType,
    storage_bucket:
      typeof resource.storage_bucket === "string"
        ? resource.storage_bucket
        : null,
    storage_path:
      typeof resource.storage_path === "string" ? resource.storage_path : null,
    external_url:
      typeof resource.external_url === "string" ? resource.external_url : null,
    thumbnail_bucket:
      typeof resource.storage_bucket === "string"
        ? resource.storage_bucket
        : "lesson-resources",
    thumbnail_path:
      typeof resource.thumbnail_path === "string" ? resource.thumbnail_path : null,
    thumbnail_url: null,
    student_instructions:
      typeof resource.student_instructions === "string"
        ? resource.student_instructions
        : "",
  };
}

function resourcesForResponse(
  resources: DbRow[],
  answer: DbRow | null,
): LessonChatResource[] {
  if (answer || resources.length === 0) return [];
  return [resourceForEnvelope(resources[0])];
}

async function writeEvidenceAndMastery(
  config: SupabaseConfig,
  userId: string,
  lessonId: string,
  sessionId: string,
  attempt: DbRow | null,
  answer: DbRow | null,
  assessment: Assessment | null,
  skills: string[],
  milestone: DbRow | null,
  confidence: number,
  teachingMove: string,
  hintRung: number,
  attemptedBeforeHelp: boolean,
): Promise<void> {
  if (
    !answer ||
    !assessment ||
    typeof assessment.score !== "number" ||
    skills.length === 0
  )
    return;

  const sourceType =
    answer.mode === "code"
      ? "code_run"
      : answer.mode === "multiple_choice"
        ? "quiz"
        : "chat_turn";
  await insertRow(config, "learning_evidence", {
    user_id: userId,
    lesson_id: lessonId,
    milestone_id: typeof milestone?.id === "string" ? milestone.id : null,
    session_id: sessionId,
    source_type: sourceType,
    source_ref: {
      answer_mode: answer.mode,
      lesson_attempt_id: attempt?.id || null,
    },
    skill_keys: skills,
    score: assessment.score,
    confidence,
    rubric_result: assessment,
    notes: assessment.feedback || "",
    created_by: userId,
    teaching_move: teachingMove || null,
    hint_rung: hintRung || null,
    attempted_before_help: attemptedBeforeHelp,
  });

  for (const skill of skills) {
    const current = await loadFirst(
      config,
      `student_mastery?user_id=eq.${encodeURIComponent(userId)}&skill_key=eq.${encodeURIComponent(skill)}&select=*`,
    );
    const evidenceCount = Number(current?.evidence_count || 0);
    const attemptCount = Number(current?.attempt_count || 0);
    const oldScore = Number(current?.score || 0);
    const nextEvidenceCount = evidenceCount + 1;
    const nextAttemptCount = attemptCount + 1;
    const nextScore = Math.max(
      0,
      Math.min(
        1,
        (oldScore * evidenceCount + assessment.score) / nextEvidenceCount,
      ),
    );
    const level =
      nextScore >= 0.85
        ? "secure"
        : nextScore >= 0.55
          ? "developing"
          : "emerging";
    const payload = {
      user_id: userId,
      skill_key: skill,
      level,
      evidence_count: nextEvidenceCount,
      attempt_count: nextAttemptCount,
      score: nextScore,
      latest_score: assessment.score,
      confidence,
      last_seen_at: new Date().toISOString(),
      last_practiced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (current) {
      await patchRows(
        config,
        `student_mastery?user_id=eq.${encodeURIComponent(userId)}&skill_key=eq.${encodeURIComponent(skill)}`,
        payload,
      );
    } else {
      await insertRow(config, "student_mastery", payload);
    }
  }
}

async function maybeWriteRecommendation(
  config: SupabaseConfig,
  userId: string,
  lessonId: string,
  sessionId: string,
  milestone: DbRow | null,
  envelope: Envelope,
): Promise<void> {
  if (envelope.next_action !== "retry" && envelope.next_action !== "rescue")
    return;
  await insertRow(config, "mentor_recommendations", {
    user_id: userId,
    session_id: sessionId,
    lesson_id: lessonId,
    milestone_id: typeof milestone?.id === "string" ? milestone.id : null,
    recommendation_type: envelope.next_action,
    title:
      envelope.next_action === "rescue"
        ? "Rescue support recommended"
        : "Retry recommended",
    rationale:
      envelope.reply ||
      "The learner needs another pass on the current milestone.",
    payload: {
      stage: envelope.stage,
      response_mode: envelope.response_mode,
      next_action: envelope.next_action,
      assessment: envelope.assessment,
    },
    status: "pending",
  });
}

function sessionStatus(flow: FlowDecision): string {
  if (flow.stage === "complete" || flow.nextAction === "complete")
    return "complete";
  if (flow.nextAction === "retry") return "needs_retry";
  if (flow.nextAction === "rescue") return "needs_rescue";
  return "active";
}

async function handleLegacyRequest(
  body: Record<string, unknown>,
): Promise<Response> {
  const chatHistory = Array.isArray(body.messages) ? [...body.messages] : [];
  const hasPersona = chatHistory.some(
    (m) =>
      m &&
      typeof m === "object" &&
      (m as DbRow).role === "system" &&
      typeof (m as DbRow).content === "string" &&
      String((m as DbRow).content).includes("You are the Jargon Mentor"),
  );
  if (!hasPersona)
    chatHistory.unshift({ role: "system", content: SYSTEM_PROMPT });

  try {
    const reply = await callModel(chatHistory, false, "default");
    return json({ reply: reply.content || "No response." });
  } catch (err) {
    return json({ reply: `Error: ${errorMessage(err)}` }, 500);
  }
}

async function handleTypedRequest(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const requestStartedAt = Date.now();
  const lessonId = typeof body.lesson_id === "string" ? body.lesson_id : "";
  if (!lessonId) return typedError("lesson_id is required.", 400);

  let config: SupabaseConfig;
  let user: DbRow;
  let session: DbRow;
  let context: Awaited<ReturnType<typeof loadContext>>;

  try {
    config = restConfig(req);
    user = await fetchCurrentUser(config);
    session = await loadOrCreateSession(
      config,
      String(user.id),
      lessonId,
      body.session_id,
    );
    context = await loadContext(config, String(user.id), lessonId, session);
  } catch (err) {
    const message = errorMessage(err);
    return typedError(message, typedAuthStatus(message), {
      lesson_id: lessonId,
    });
  }

  const userId = String(user.id);
  const sessionId = String(session.id);
  const currentStage = stage(session.stage);
  const answer = normalizeAnswer(body.answer);
  const content = answerContent(answer);
  const mentorPreferences = normalizeMentorPreferences(body.mentor_preferences);
  const skillKeys = skillKeysFor(
    context.activity,
    context.milestone,
    context.quiz,
  );
  const orchestratorAssessment = assessAnswer(
    answer,
    context.lesson,
    context.activity,
    context.quiz,
  );

  // --- Pedagogy decision (diagnose -> policy -> teaching move) ---------------
  const mentorMode = mentorPreferences?.mode || "guide";
  const helpRequest = HELP_REQUEST_OPTIONS.has(String(body.help_request))
    ? String(body.help_request)
    : "";
  const requestedRung = Number(body.hint_rung) || 0;
  const intent = detectIntent(content);
  const recentQuestions = mentorQuestionsFromTurns(context.recentTurns);
  const priorActivityAttempts = context.recentAttempts.filter(
    (a) => String(a.activity_id || "") === String(context.activity?.id || ""),
  ).length;
  const hasAttempt = priorActivityAttempts > 0 || Boolean(answer);
  const attemptedBeforeHelp =
    Boolean(answer) && Number(session.rescue_count || 0) === 0;
  const diagnosis = diagnoseStudent(
    context,
    session,
    skillKeys,
    answer,
    orchestratorAssessment,
  );
  const helpPolicy = resolveHelpPolicy(context.lesson);
  const teaching = selectTeachingMove(
    diagnosis,
    helpPolicy,
    mentorMode,
    answer,
    orchestratorAssessment,
    hasAttempt,
    helpRequest,
    requestedRung,
    currentStage === "intro",
    intent,
  );
  const answersForbidden =
    helpPolicy.finalAnswerPolicy === "never" ||
    (helpPolicy.finalAnswerPolicy === "after_attempt" && !hasAttempt);
  // How many attempts the student has already made ON THIS activity — a backstop so an
  // explanation activity concludes instead of looping. Scoped to the current activity
  // (via activity_id) and it naturally resets when the session advances to the next
  // step, so a prior activity's turns can't prematurely complete a later one.
  const conversationDepth = priorActivityAttempts;

  try {
    if (await isChatRateLimited(config, userId, sessionId)) {
      await recordRuntimeEvent(config, {
        userId,
        sessionId,
        lessonId,
        eventType: "controlled_error",
        status: "error",
        latencyMs: Date.now() - requestStartedAt,
        payload: {
          reason: "chat_rate_limit",
          window_ms: CHAT_RATE_LIMIT_WINDOW_MS,
          max_turns: CHAT_RATE_LIMIT_MAX,
        },
      });
      return typedError("Too many chat turns at once. Pause for a minute and try again.", 429, {
        session_id: sessionId,
        lesson_id: lessonId,
        stage: currentStage,
      });
    }

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

    const draftFlow = flowFor(
      currentStage,
      session,
      context.activity,
      context.quiz,
      answer,
      orchestratorAssessment,
      null,
      conversationDepth,
    );
    const systemContent = `${SYSTEM_PROMPT}\n\n${pedagogyPromptBlock(
      teaching.move,
      diagnosis,
      helpPolicy,
      mentorMode,
      teaching.hintRung,
      answersForbidden,
      context.misconceptions,
      recentQuestions,
      intent,
    )}`;
    const messages = [
      { role: "system", content: systemContent },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Return only the typed JSON envelope. The orchestrator owns records, final stage/action, and resource cards; you own concise student-facing wording. If lesson_resources are present, invite the student to open one. If approved_resource_chunks are present, you may use them as teacher-approved context and cite PDF/document chunks by resource title/page and audio/video chunks by resource title/time range. Do not claim a resource was viewed unless resource_interactions proves it.",
          lesson: context.lesson,
          activity: context.activity,
          milestone: context.milestone,
          quiz_item: context.quiz,
          recent_turns: context.recentTurns,
          recent_attempts: context.recentAttempts,
          mastery_summary: context.mastery,
          lesson_resources: context.resources.map((resource) => ({
            id: resource.id,
            title: resource.title,
            description: resource.description,
            resource_type: resource.resource_type,
            student_instructions: resource.student_instructions,
            transcript_text: resource.transcript_text,
          })),
          approved_resource_chunks: context.resourceChunks.map((chunk) => {
            const resource = context.resources.find(
              (item) => String(item.id) === String(chunk.resource_id),
            );
            return {
              resource_id: chunk.resource_id,
              resource_title: resource?.title || "Lesson resource",
              source_kind: chunk.source_kind || "document",
              page_number: chunk.page_number,
              start_seconds: chunk.start_seconds,
              end_seconds: chunk.end_seconds,
              chunk_index: chunk.chunk_index,
              chunk_text: String(chunk.chunk_text || "").slice(0, 1400),
            };
          }),
          resource_interactions: context.resourceInteractions,
          session: {
            id: sessionId,
            stage: currentStage,
            status: session.status || "active",
            retry_count: session.retry_count || 0,
            rescue_count: session.rescue_count || 0,
          },
          mentor_preferences: mentorPreferences,
          student_model: diagnosis,
          teaching_move: teaching.move,
          hint_rung: teaching.hintRung,
          help_policy: {
            help_ceiling: helpPolicy.helpCeiling,
            final_answer_policy: helpPolicy.finalAnswerPolicy,
            require_attempt_first: helpPolicy.requireAttemptFirst,
            answers_forbidden_this_turn: answersForbidden,
          },
          known_misconceptions: context.misconceptions,
          student_intent: intent,
          recent_mentor_questions: recentQuestions,
          latest_answer: answer,
          deterministic_assessment: orchestratorAssessment,
          orchestrator_flow: draftFlow,
          skill_keys: skillKeys,
          pass_threshold: passThreshold(context.activity, context.quiz),
          required_fields: [
            "status",
            "reply",
            "stage",
            "response_mode",
            "choices",
            "exercise",
            "assessment",
            "understanding",
            "next_action",
            "guardrail",
          ],
        }),
      },
    ];

    const modelRouting = modelRouteFor(
      draftFlow,
      answer,
      orchestratorAssessment,
      context,
    );
    const openAIResult = await callModel(messages, true, modelRouting.route);
    await recordModelUsage(
      config,
      userId,
      sessionId,
      lessonId,
      openAIResult,
      modelRouting.taskType,
    );
    const contentJson = openAIResult.content;
    let parsed: DbRow;
    try {
      parsed = JSON.parse(contentJson);
    } catch {
      await recordRuntimeEvent(config, {
        userId,
        sessionId,
        lessonId,
        eventType: "chat_failure",
        status: "error",
        latencyMs: Date.now() - requestStartedAt,
        payload: { reason: "invalid_mentor_json" },
      });
      return typedError("Mentor returned invalid JSON.", 502, {
        session_id: sessionId,
        lesson_id: lessonId,
        stage: currentStage,
      });
    }

    const assessment = mergeAssessment(
      orchestratorAssessment,
      parsedAssessment(parsed.assessment),
    );
    const understanding = parsedUnderstanding(parsed.understanding);
    const finalFlow = flowFor(
      currentStage,
      session,
      context.activity,
      context.quiz,
      answer,
      assessment,
      understanding,
      conversationDepth,
    );

    // Multi-step lessons: if the current activity is finished but later activities
    // remain (ordered by position), advance the session to the next activity instead
    // of completing the lesson. A single-activity lesson has no next step, so this is
    // a no-op and the runtime behaves exactly as before.
    const finishedCurrentActivity =
      finalFlow.stage === "complete" || finalFlow.nextAction === "complete";
    let advanceToActivityId: string | null = null;
    if (finishedCurrentActivity && context.activity) {
      const currentPosition = Number(context.activity.position ?? 0);
      const nextActivity = await loadFirst(
        config,
        `lesson_activities?lesson_id=eq.${encodeURIComponent(lessonId)}&position=gt.${currentPosition}&order=position.asc&limit=1&select=id`,
      );
      if (nextActivity && typeof nextActivity.id === "string") {
        advanceToActivityId = nextActivity.id;
      }
    }
    const advancing = Boolean(advanceToActivityId);

    const envelope = makeEnvelope({
      ...(parsed as Partial<Envelope>),
      session_id: sessionId,
      lesson_id: lessonId,
      stage: finalFlow.stage,
      response_mode: finalFlow.responseMode,
      choices: finalFlow.choices,
      assessment,
      resources: resourcesForResponse(context.resources, answer),
      next_action: finalFlow.nextAction,
      reply:
        typeof parsed.reply === "string" && parsed.reply.trim()
          ? parsed.reply
          : fallbackReply(
              finalFlow,
              assessment,
              context.activity,
              context.quiz,
            ),
    });

    // Deterministic integrity backstop: if a full answer isn't allowed this turn,
    // redact any verbatim expected output the model may have leaked.
    envelope.reply = gateFinalAnswer(
      envelope.reply,
      answersForbidden,
      expectedOutputFor(context.lesson, context.activity),
    );

    if (advancing) {
      // Turn the completing turn into a "continue to the next part" transition so the
      // client keeps the session open; the student's next message starts the next step.
      envelope.stage = "review";
      envelope.response_mode = "text";
      envelope.next_action = "reply";
      envelope.choices = [];
      envelope.reply =
        `${envelope.reply}\n\nThat completes this part — send a message when you're ready for the next part.`.trim();
    }

    // Misconception memory: persist any recurring conceptual error the mentor flagged.
    if (parsed.misconception) {
      await upsertMisconception(config, userId, null, parsed.misconception);
    }

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

    let attempt: DbRow | null = null;
    if (answer) {
      attempt = await insertRow(config, "lesson_attempts", {
        session_id: sessionId,
        activity_id:
          typeof context.activity?.id === "string" ? context.activity.id : null,
        user_id: userId,
        lesson_id: lessonId,
        answer_mode: answer.mode,
        answer_text: answer.mode === "text" ? answer.text : null,
        answer_code: answer.mode === "code" ? answer.code : null,
        choice_id: answer.mode === "multiple_choice" ? answer.choice_id : null,
        run_result: answer.run_result || null,
        score: typeof assessment?.score === "number" ? assessment.score : null,
        passed:
          typeof assessment?.passed === "boolean" ? assessment.passed : null,
        feedback: assessment?.feedback || envelope.reply,
        input_modality: answer.input_modality || "typed",
        transcript_confidence:
          typeof answer.transcript_confidence === "number"
            ? answer.transcript_confidence
            : null,
      });

      if (answer.mode === "multiple_choice" && context.quiz) {
        await insertRow(config, "quiz_attempts", {
          quiz_item_id: String(context.quiz.id),
          session_id: sessionId,
          user_id: userId,
          lesson_id: lessonId,
          answer_mode: answer.mode,
          choice_id: answer.choice_id || null,
          score:
            typeof assessment?.score === "number" ? assessment.score : null,
          passed:
            typeof assessment?.passed === "boolean" ? assessment.passed : null,
          feedback: assessment?.feedback || envelope.reply,
          graded_by: "system",
        });
      }

      await writeEvidenceAndMastery(
        config,
        userId,
        lessonId,
        sessionId,
        attempt,
        answer,
        assessment,
        skillKeys,
        context.milestone,
        confidenceFor(assessment, session, teaching.hintRung),
        teaching.move,
        teaching.hintRung,
        attemptedBeforeHelp,
      );
      await maybeWriteRecommendation(
        config,
        userId,
        lessonId,
        sessionId,
        context.milestone,
        envelope,
      );
    }

    const retryIncrement = envelope.next_action === "retry" ? 1 : 0;
    const rescueIncrement = envelope.next_action === "rescue" ? 1 : 0;
    const nextStatus = advancing ? "active" : sessionStatus(finalFlow);

    // Rolling independence signal (only updated on real attempts).
    let nextIndependence: number | undefined;
    if (answer) {
      const turnInd = independenceFor(
        assessment,
        attemptedBeforeHelp,
        teaching.hintRung,
      );
      // PostgREST serializes `numeric` as a string, so read it tolerantly (the rest
      // of this file reads numeric session columns via Number() for the same reason).
      const priorRaw = Number(session.independence_score);
      const prior = Number.isFinite(priorRaw) ? priorRaw : null;
      nextIndependence = prior === null ? turnInd : 0.7 * prior + 0.3 * turnInd;
    }
    await patchRows(
      config,
      `learning_sessions?id=eq.${encodeURIComponent(sessionId)}`,
      {
        // When advancing, point the cursor at the next activity and reset to its intro;
        // otherwise keep the current activity (unchanged single-step behavior).
        current_activity_id: advancing
          ? advanceToActivityId
          : typeof context.activity?.id === "string"
            ? context.activity.id
            : null,
        stage: advancing ? "intro" : envelope.stage,
        status: nextStatus,
        score:
          typeof assessment?.score === "number"
            ? Math.max(Number(session.score || 0), assessment.score)
            : Number(session.score || 0),
        retry_count: advancing ? 0 : Number(session.retry_count || 0) + retryIncrement,
        rescue_count: advancing ? 0 : Number(session.rescue_count || 0) + rescueIncrement,
        updated_at: new Date().toISOString(),
        mentor_mode: mentorMode,
        ...(nextIndependence !== undefined
          ? { independence_score: nextIndependence }
          : {}),
      },
    );

    if (currentStage !== envelope.stage) {
      await recordRuntimeEvent(config, {
        userId,
        sessionId,
        lessonId,
        eventType: "stage_transition",
        latencyMs: Date.now() - requestStartedAt,
        payload: { from_stage: currentStage, to_stage: envelope.stage, next_action: envelope.next_action },
      });
    }
    if (!advancing && (envelope.next_action === "complete" || nextStatus === "complete")) {
      await recordRuntimeEvent(config, {
        userId,
        sessionId,
        lessonId,
        eventType: "completion",
        latencyMs: Date.now() - requestStartedAt,
        payload: { stage: envelope.stage, score: assessment?.score ?? null },
      });
    } else if (envelope.next_action === "retry" || envelope.next_action === "rescue") {
      await recordRuntimeEvent(config, {
        userId,
        sessionId,
        lessonId,
        eventType: envelope.next_action,
        latencyMs: Date.now() - requestStartedAt,
        payload: { stage: envelope.stage, assessment },
      });
    }

    return json(envelope);
  } catch (err) {
    await recordRuntimeEvent(config, {
      userId,
      sessionId,
      lessonId,
      eventType: "chat_failure",
      status: "error",
      latencyMs: Date.now() - requestStartedAt,
      payload: { message: errorMessage(err) },
    });
    return typedError(errorMessage(err), 500, {
      session_id: sessionId,
      lesson_id: lessonId,
      stage: currentStage,
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return typedError("Request body must be a JSON object.", 400);
    }

    const record = body as Record<string, unknown>;
    if (isLegacyRequest(record)) return await handleLegacyRequest(record);
    return await handleTypedRequest(req, record);
  } catch (err) {
    return typedError(errorMessage(err), 500);
  }
});
