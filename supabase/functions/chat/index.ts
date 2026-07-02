// Jargon Mentor - structured course-session chat edge function.
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

You teach through a real back-and-forth conversation — diagnosing what the student needs and adapting — never
by reading a script. The lesson teaches logical thinking through a language bridge:
natural speech -> baby Jargon -> Jargon pseudocode -> Python bridge when the learner is ready.
Code runs deterministically through the Jargon engine; Python is a comparison bridge only — never claim to
execute it, and never ask the student to upload files.

Each turn you receive one JSON payload: "directive" is the orchestrator's authoritative read of this turn —
follow it, adapting its wording to the conversation. "turn" is the student's latest message plus grading
facts; "policy" is the teacher's help policy; "student" is who you're teaching; "history" is the recent
conversation, oldest first.

CONVERSATION CRAFT — every turn:
- Read the student's latest message FIRST and respond to what it actually says. Credit ONLY this latest
  message — never attribute an earlier turn's answer to it (if they now said "a wheel moves a car", do not
  congratulate them for "scissors and cutting").
- If they already answered correctly or completely, CONFIRM it, add one sentence of consolidation, and move
  forward — recognizing understanding and progressing is required.
- Never repeat a question you already asked, in ANY rewording (student.recent_questions lists them), and
  never re-ask what they already answered correctly. Vary your openings; do not open every turn with praise —
  praise briefly and only when earned, and prefer building on their idea over complimenting it.
- Confusion in ANY wording ("not really", "no clue", "I'm lost", "I didn't figure it out"): do NOT praise or
  ask a new question — FIRST explain the specific sticking point plainly with one concrete example, then
  check in.
- A summary request -> summarize what you've covered. Frustration ("didn't we discuss this") -> acknowledge
  it and change tactic. A breakthrough ("oh, I get it") -> affirm briefly and move on.
- If they say something incorrect, correct that specific point clearly and kindly. If a known misconception
  from student.misconceptions resurfaces, correct it directly.
- Shape: acknowledge their message -> do this step's work -> situate in the arc when it helps -> end with
  exactly ONE clear next action.

TEACHING METHOD — always the LIGHTEST help that unblocks, escalating in this order:
1. One pointed question that exposes the student's thinking.
2. ONE hint at the given rung (turn.hint_rung, 1-4): each rung strictly more revealing than the last; rung 4
   is very revealing but still never the full answer.
3. Name the next single step and ask them to do just that.
4. A worked example on a SIMILAR item — never the assigned one — then they try the assigned one themselves.
Never exceed policy.help_ceiling (clarify < hints < guided < worked_example < feedback < study). When
policy.require_attempt_first is true, give no substantive help before a real attempt — a help request is NOT
an attempt; ask one short question that gets an attempt going. When policy.answers_forbidden_this_turn is
true, never give the final answer or complete solution this turn.

Explanation / reflection steps: the STUDENT must produce the conclusion in their own words. Never answer your
own reflection question, and never hand them the target answer — not directly, not as a "model answer", not
as a thin analogy they can restate. You MAY correct a wrong claim, explain what the question is really
asking, narrow it, or offer a sentence starter ("One reason is ..."). If a genuinely lost student still can't
get there, teach the underlying idea with a fresh concrete example — but let THEM form the conclusion.
(Worked examples for CODE mechanics stay fine under the help policy; this rule is about the reflection
itself.) Only when the directive says the step is concluding after a struggle do you state the idea plainly
ONCE, then close warmly.

Quiz steps: while options are on screen the student answers by tapping them — point at the options, do not
re-read or re-narrate them (introduce the question briefly only when the directive says it is the first
presentation). Wrong choice -> brief targeted feedback on why that choice fails, then point back at the
options.

Code steps: a failed run gets the lightest help that unblocks the ONE thing to fix. A runtime timeout is our
infrastructure hiccup, never the student's mistake — reassure them it's on us and ask them to run it again;
never grade or critique timed-out code. When the grade says the code accomplishes the objective, affirm once
and conclude — do not demand rewording, a specific topic, or a match to a shown example.

Never invent requirements the task does not state. When a task asks for the student's OWN example, ANY
correct on-topic answer is acceptable — accept it and move on; a shown example is one model answer, never the
only one. If the student correctly points out their answer already met the task, acknowledge that plainly and
progress — do not restate the same demand.

GOVERNANCE:
- The lesson arc ("arc": step N of M, done, next): situate naturally ("now that you've got loops, ..."),
  connect steps at hand-offs, and preview only the NEXT step's title — never do a later step's work or reveal
  its answer early. Don't recite the whole list or announce the step number every turn.
- "checkpoints" lists unfinished assignments/assessments docked above the message box. When relevant (the
  lesson wraps, or they ask what's next) point the student to one warmly by title — they open it from the
  panel above the message box; mention a due date if present. Nudge, don't block; never invent one.
- "resources": when the directive says card(s) are attached below your reply, tell the student to tap Open on
  the card — never say you can't share it. Never claim a resource was viewed unless resource_interactions
  proves it. Cite document chunks by resource title/page and audio/video chunks by title/time range.
- After the lesson is complete, answer follow-ups directly and briefly; never repeat congratulations.
- Stay on the current lesson goal; if the student drifts, briefly acknowledge and redirect.
- policy.mentor_mode, policy.tone and policy.pace bias your approach; the directive always wins.

STYLE: short, concrete replies with vocabulary matched to student.grade_band. No emojis. When you affirm,
open with a short punchy sentence ending in "!" ("Exactly right!") — it renders as a headline; skip it when
nothing is earned. Emphasize 1-3 key concept words with **double asterisks**; most words stay plain.

OUTPUT — return ONLY this JSON object, nothing else:
{
  "reply": "student-facing mentor message",
  "understanding": { "demonstrated": false, "level": "none | partial | solid", "note": "" },
  "misconception": null
}
Set understanding.demonstrated=true ONLY when the student's own words in the LATEST message are essentially
correct and complete for THIS step's objective. When you spot a recurring conceptual error worth remembering,
set "misconception" to { "skill_key": "...", "pattern": "...", "hint": "..." }; otherwise keep it null.`;

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
  lesson_arc?: LessonArc | null;
  next_action: NextAction;
  guardrail: { redirected: boolean; reason: string | null };
  // Authoritative session snapshot so the client can stay in sync without refetching
  // (status, cursor, sticky activities-done flag). Assigned by the orchestrator only.
  session?: EnvelopeSession | null;
};

type EnvelopeSession = {
  status: string;
  current_activity_id: string | null;
  activities_complete: boolean;
};

function envelopeSession(value: unknown): EnvelopeSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as DbRow;
  if (typeof raw.status !== "string" || !raw.status) return null;
  return {
    status: raw.status,
    current_activity_id:
      typeof raw.current_activity_id === "string"
        ? raw.current_activity_id
        : null,
    activities_complete: raw.activities_complete === true,
  };
}

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

type ModelRoute = "default" | "understanding";
type ModelUsageTaskType = "mentor_turn" | "grading";

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
    lesson_arc: partial.lesson_arc ?? null,
    next_action: nextAction(partial.next_action),
    guardrail: {
      redirected: partial.guardrail?.redirected === true,
      reason:
        typeof partial.guardrail?.reason === "string"
          ? partial.guardrail.reason
          : null,
    },
    // Shape-validated passthrough (needed so a dedup replay of a stored envelope keeps
    // its session snapshot); the live path always overwrites this before persisting.
    session: envelopeSession(partial.session),
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
    // Client-generated per-send id, persisted in the turn payload so duplicate deliveries
    // (voice retries, double taps) can be detected server-side.
    client_msg_id:
      typeof raw.client_msg_id === "string" && raw.client_msg_id.length <= 64
        ? raw.client_msg_id
        : "",
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

// PostgREST upsert: one POST for many rows, merged on the given unique columns.
async function upsertRows(
  config: SupabaseConfig,
  table: string,
  rows: DbRow[],
  onConflict: string,
): Promise<void> {
  if (!rows.length) return;
  await supabaseFetch(
    config,
    `${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    },
  );
}

// Best-effort background work (telemetry) runs OFF the critical path: on the Supabase
// edge runtime, waitUntil keeps the isolate alive past the response; elsewhere the
// promise simply runs un-awaited. Callers must pass self-catching promises
// (recordRuntimeEvent/recordModelUsage swallow their own errors).
function scheduleBackground(task: Promise<unknown>): void {
  const runtime = (
    globalThis as {
      EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void };
    }
  ).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(task);
  }
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
  // Count only the STUDENT'S sends — mentor rows would silently halve the real ceiling.
  const count = await recentRowCount(
    config,
    `learning_turns?user_id=eq.${encodeURIComponent(userId)}&session_id=eq.${encodeURIComponent(sessionId)}&role=eq.student&created_at=gte.${since}&select=id&limit=${CHAT_RATE_LIMIT_MAX + 1}`,
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

// Two routes only (v2.0): the student-facing conversation runs on a STRONG model (it
// writes every word the student reads); the understanding-check graders stay pinned to a
// cheap literal so flipping the conversation model can never silently make the
// high-volume graders expensive.
function modelFor(route: ModelRoute): string {
  if (route === "understanding") {
    return envText("TUTOR_MODEL_UNDERSTANDING", "gpt-4o-mini");
  }
  return envText(
    "TUTOR_MODEL_CONVERSATION",
    envText("TUTOR_MODEL_DEFAULT", envText("OPENAI_MODEL_DEFAULT", "gpt-4o")),
  );
}

function temperatureFor(route: ModelRoute): number {
  // Conversation wants variety (a key fix for the flat re-asking); grading wants determinism.
  if (route === "understanding") return 0.2;
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

// A runtime TIMEOUT is an infrastructure hiccup, not the student's mistake. We detect it
// so the tutor can reassure and ask for a re-run instead of grading it as a failed attempt.
// Three shapes reach us: (a) the run edge fn's engine/wake timeout — status "error" with an
// "Engine request timed out…" error; (b) the client fetch-abort fallback object whose output
// says "took too long to answer"; (c) the engine's `limit_exceeded` — that one is the
// STUDENT'S runaway loop and must be graded normally, never excused as infra.
function runTimedOut(runResult: unknown): boolean {
  if (!runResult || typeof runResult !== "object") return false;
  const raw = runResult as DbRow;
  // A timeout is always a FAILED run — a successful run whose output merely contains the
  // word "timeout" (e.g. a program that prints it) must never be misread as an infra hiccup.
  // Engine-shaped results carry status ("ok") instead of ok:true, so check both.
  if (raw.ok === true) return false;
  // The run fn marks its own engine/wake timeouts explicitly (v2.0 Phase D) — prefer the
  // flag; every check below stays as a fallback for older cached clients.
  if (raw.timeout === true) return true;
  if (typeof raw.status === "string") {
    const status = raw.status.trim().toLowerCase();
    if (status === "ok") return false;
    // The student's own runaway loop hit the engine step/op limits — a real mistake, not infra.
    if (status === "limit_exceeded") return false;
    if (/^(timeout|timed[_ ]out)$/.test(status)) return true;
  }
  // The engine's wall-clock sandbox kill reports limits_hit: ["sandbox_timeout"] — treated
  // as infra (matches pre-v2 behavior), unlike limit_exceeded above.
  if (
    Array.isArray(raw.limits_hit) &&
    raw.limits_hit.some((entry) => String(entry) === "sandbox_timeout")
  ) {
    return true;
  }
  const errors = Array.isArray(raw.errors)
    ? raw.errors.filter((entry) => typeof entry === "string").join("\n")
    : "";
  const out =
    typeof raw.output === "string"
      ? raw.output
      : Array.isArray(raw.output)
        ? raw.output.join("\n")
        : "";
  // Match only the real infra sentinels — the run fn's "Engine request timed out after …ms",
  // the engine's "Sandbox timed out after 2.0 seconds." (float!), and the client abort's
  // "took too long to answer". A loose `time.?out` would wrongly catch failed runs whose
  // output merely mentions time.
  return /engine request timed out|took too long to answer|timed out after \d+(\.\d+)?\s*(ms|seconds?)/i.test(
    `${errors}\n${out}`,
  );
}

function expectedOutputFor(
  lesson: DbRow | null,
  activity: DbRow | null,
): string {
  return String(
    activity?.expected_output || lesson?.expected_output || "",
  ).trim();
}

function assessAnswer(
  answer: DbRow | null,
  lesson: DbRow | null,
  activity: DbRow | null,
  quiz: DbRow | null,
): Assessment | null {
  if (!answer) return null;
  if (answer.mode === "code") {
    // A timeout is infra, not the student — don't record it as a failed attempt. Returning
    // null leaves the turn ungraded (no mastery ding); the prompt reassures + asks to re-run.
    if (runTimedOut(answer.run_result)) return null;
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

  if (answer.mode === "multiple_choice") {
    // Legacy MCQ activity with no bound (published) quiz row: no correct-answer data is
    // available, so deterministic-only grading would brick the step. Record the tap as a
    // pass so the step can conclude — but only when the tapped choice actually belongs
    // to this activity's own choices (junk or foreign choice ids stay ungraded).
    const ownChoices = Array.isArray(activity?.choices)
      ? (activity.choices as unknown[])
      : [];
    const tapped = String(answer.choice_id || "");
    const known = ownChoices.some(
      (choice) =>
        choice &&
        typeof choice === "object" &&
        String((choice as DbRow).id || "") === tapped,
    );
    if (tapped && known) {
      return {
        score: 1,
        passed: true,
        feedback: "Answer recorded.",
        source: "orchestrator",
      };
    }
    return null;
  }

  return null;
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

// Dedicated understanding grader for free-text explanation activities. A SEPARATE,
// deterministic model call that ONLY judges whether the student's words demonstrate the
// step's objective — decoupled from the conversation so the tutor can't loop by affirming
// but never setting demonstrated. Its verdict hard-gates completion. Returns null on any
// error, so the caller falls back to the mentor's self-report + the stuck cap.
async function checkUnderstanding(
  config: SupabaseConfig,
  userId: string,
  sessionId: string,
  lessonId: string,
  activity: DbRow | null,
  milestone: DbRow | null,
  studentText: string,
  recentTurns: DbRow[],
): Promise<Understanding | null> {
  const text = (studentText || "").trim();
  if (!text) return null;
  const objective = [
    milestone?.objective ? `Objective: ${String(milestone.objective)}` : "",
    activity?.prompt ? `Task/prompt: ${String(activity.prompt)}` : "",
    activity?.expected_output
      ? `Expected idea: ${String(activity.expected_output)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const recent = recentTurns
    .slice(0, 4)
    .reverse()
    .map((t) => `${String(t.role)}: ${String(t.content || "").slice(0, 200)}`)
    .join("\n");
  const system =
    "You are a strict but fair grader for a children's tutoring app. Given the step's " +
    "objective and the student's latest explanation, judge ONLY whether the student's own " +
    "words demonstrate understanding of THIS objective. Do not credit vague, circular, or " +
    "off-topic answers. Return ONLY a JSON object: " +
    '{"demonstrated": boolean, "level": "none|partial|solid", "note": "one short phrase ' +
    'naming what is still missing, or empty when solid"}.';
  const userMsg = `${objective || "Objective: explain the concept in the student's own words."}\n\nRecent conversation:\n${recent}\n\nStudent's latest explanation:\n${text}`;
  try {
    const result = await callModel(
      [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      true,
      "understanding",
    );
    // Record the extra grader call so cost/usage telemetry isn't undercounted (best-effort).
    scheduleBackground(
      recordModelUsage(config, userId, sessionId, lessonId, result, "grading"),
    );
    return parsedUnderstanding(JSON.parse(extractJsonObject(result.content)));
  } catch {
    return null;
  }
}

// Semantic grader for CODE activities: when a run is clean but doesn't match the (possibly
// wrong or starter-derived) expected_output, judge whether the code accomplishes the
// OBJECTIVE. The judge decides open-ended vs. exact from the task text (it reads intent far
// better than a keyword gate) and is told to lean STRICT when unsure, so exact-output tasks
// aren't leniently passed. This lets open-ended "write your own …" tasks complete instead of
// looping forever on an exact-output gate. Returns null on error (falls back to strict match).
async function checkCodeObjective(
  config: SupabaseConfig,
  userId: string,
  sessionId: string,
  lessonId: string,
  activity: DbRow | null,
  milestone: DbRow | null,
  code: string,
  output: string,
  recentTurns: DbRow[],
): Promise<Understanding | null> {
  const src = (code || "").trim();
  const out = (output || "").trim();
  if (!src && !out) return null;
  const objective = [
    milestone?.objective ? `Objective: ${String(milestone.objective)}` : "",
    activity?.prompt ? `Task/prompt: ${String(activity.prompt)}` : "",
    activity?.expected_output
      ? `Target/expected output (this may be either the REQUIRED result, or just a starter example — decide from the task wording): ${String(activity.expected_output)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const recent = recentTurns
    .slice(0, 4)
    .reverse()
    .map((t) => `${String(t.role)}: ${String(t.content || "").slice(0, 160)}`)
    .join("\n");
  const system =
    "You are a strict but fair grader for a children's coding exercise. Decide whether the " +
    "student's code ACCOMPLISHES THE OBJECTIVE. First judge the task's TYPE from its wording:\n" +
    "- OPEN-ENDED (invites the student's OWN or a DIFFERENT answer, e.g. 'write your own three " +
    "ordered steps', 'change it to another process', 'make up an example'): ANY correct, on-topic " +
    "answer counts — do NOT require a specific topic, wording, or that it match the target output.\n" +
    "- EXACT (asks for a SPECIFIC result / a particular output): the student's output must match " +
    "that target output.\n" +
    "- If you are UNSURE which, and a target output is provided, LEAN STRICT: require the output " +
    "to match it. Return ONLY a JSON object: " +
    '{"demonstrated": boolean, "level": "none|partial|solid", "note": "one short phrase naming ' +
    'what is missing, or empty when it meets the objective"}.';
  const userMsg = `${objective || "Objective: write code that accomplishes the task."}\n\nRecent conversation:\n${recent}\n\nStudent's code:\n${src.slice(0, 1200)}\n\nProgram output:\n${out.slice(0, 800)}`;
  try {
    const result = await callModel(
      [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      true,
      "understanding",
    );
    scheduleBackground(
      recordModelUsage(config, userId, sessionId, lessonId, result, "grading"),
    );
    return parsedUnderstanding(JSON.parse(extractJsonObject(result.content)));
  } catch {
    return null;
  }
}

// --- Pedagogy signals --------------------------------------------------------
// Pure + deterministic signals fed to the model: who the student is (diagnosis),
// the teacher's help policy, detected intent/help requests, and the mentor's own
// recent questions. The per-turn teaching instruction itself is composed by
// turnDirective(); the method (lightest-help ladder) lives in the SYSTEM_PROMPT.

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

// Lightweight intent read of the student's latest message, surfaced to the prompt
// (turn.intent); the model does the nuance.
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
    re: /(not sure|do\s?n'?t (get|understand|know|follow)|did\s?n'?t (get|understand|figure|follow)|can'?t (figure|understand)|confus(ed|ing)|i'?m lost|lost me|no idea|no clue|over my head|makes no sense|still (do\s?n'?t|dont)|what do you mean)/i,
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

// The student no longer has Hint / "Show me how" buttons; instead the tutor infers a help
// request from what they type, so the hint-ladder and worked-example paths still fire.
const SHOW_ME_HOW_RE =
  /(show me how|walk me through|do it for me|just tell me|give me the answer|how (do|would) i (start|do this|write this)|can you (do|write) it)/i;
const HINT_RE =
  /\b((a|another|any|one|the next|more) hints?|give me a hint|need a hint|can i get a hint|a clue|nudge|point me|get me started|where (do|should) i (start|begin)|i'?m stuck|i am stuck|feeling stuck|a bit stuck|help me start)\b/i;

function detectHelpRequest(text: string): string {
  const t = (text || "").trim();
  if (!t) return "";
  if (SHOW_ME_HOW_RE.test(t)) return "show_me_how";
  if (HINT_RE.test(t)) return "hint";
  return "";
}

// Escalate the hint rung from the conversation itself (no client-sent rung anymore): each
// prior help-ish student turn on the record makes the next hint one notch more revealing.
function deriveHintRung(turns: DbRow[]): number {
  let priorHelp = 0;
  for (const turn of turns) {
    if (String(turn.role) !== "student") continue;
    if (detectHelpRequest(String(turn.content || ""))) priorHelp += 1;
  }
  return Math.min(4, priorHelp + 1);
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

// --- Flow core (v2) -----------------------------------------------------------
// A step is defined by REQUIREMENTS derived from its shape, and by persisted PROGRESS
// in learning_sessions.step_state. The old flowFor derived control from the current
// turn's answer.mode with no memory, which is what produced the practice<->assessment
// ping-pong, quizzes re-attached to every reply, and voice/text turns tripping quiz
// branches. Control now lives in three pure functions: requirementsFor (what this step
// needs), applyTurn (fold one turn into progress), deriveTurn (progress -> FlowDecision).
// The FlowDecision shape is unchanged so every downstream consumer still works.

type StepRequirements = {
  code: boolean;
  quiz: boolean;
  understanding: boolean;
  quizChoices: unknown[];
};

// Requirements come from the step's SHAPE, never from the turn: a code step must pass a
// run; a quiz-bearing step must pass its quiz; a free-text/file step must demonstrate
// understanding. An MCQ-mode activity without a bound quiz row still counts as a quiz
// step (its choices live on the activity itself; the mentor's assessment grades it).
function requirementsFor(
  activity: DbRow | null,
  quiz: DbRow | null,
): StepRequirements {
  const mode = responseMode(activity?.response_mode, "code");
  const needsCode = mode === "code";
  const needsQuiz = Boolean(quiz) || mode === "multiple_choice";
  const quizChoices = Array.isArray(quiz?.choices)
    ? (quiz.choices as unknown[])
    : Array.isArray(activity?.choices)
      ? (activity.choices as unknown[])
      : [];
  return {
    code: needsCode,
    quiz: needsQuiz,
    understanding: (mode === "text" || mode === "file") && !needsQuiz,
    quizChoices,
  };
}

// Persisted per-step progress (learning_sessions.step_state jsonb). The stage column is
// now a display label for the teacher transcript; CONTROL lives here. Pass timestamps are
// monotonic — once a gate is passed it stays passed for the life of the step.
type StepState = {
  activity_id: string | null;
  presented_at: string | null;
  code_passed_at: string | null;
  quiz_presented_at: string | null;
  quiz_passed_at: string | null;
  understanding_at: string | null;
  // Contentful turns on this step (drives the text-step stuck cap — conversational
  // rounds, matching the old conversationDepth semantics).
  attempts: number;
  // Deterministically GRADED failures only (code run failed, eligible quiz answer
  // wrong). Teacher-facing struggle signals key on this, never on raw attempts —
  // side questions and help requests must not look like failing.
  graded_fails: number;
};

function emptyStepState(activityId: string | null): StepState {
  return {
    activity_id: activityId,
    presented_at: null,
    code_passed_at: null,
    quiz_presented_at: null,
    quiz_passed_at: null,
    understanding_at: null,
    attempts: 0,
    graded_fails: 0,
  };
}

// A mismatched activity_id means the session advanced since the state was written —
// treat it as empty (this is the reset-on-advance mechanism; the advance patch also
// writes {} explicitly, so the two agree).
function parseStepState(session: DbRow, activityId: string | null): StepState {
  const raw =
    session.step_state &&
    typeof session.step_state === "object" &&
    !Array.isArray(session.step_state)
      ? (session.step_state as DbRow)
      : null;
  const storedKey =
    raw && typeof raw.activity_id === "string" ? raw.activity_id : "";
  if (!raw || storedKey !== (activityId ?? "")) {
    return emptyStepState(activityId);
  }
  const iso = (value: unknown) =>
    typeof value === "string" && value ? value : null;
  const count = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };
  return {
    activity_id: activityId,
    presented_at: iso(raw.presented_at),
    code_passed_at: iso(raw.code_passed_at),
    quiz_presented_at: iso(raw.quiz_presented_at),
    quiz_passed_at: iso(raw.quiz_passed_at),
    understanding_at: iso(raw.understanding_at),
    attempts: count(raw.attempts),
    graded_fails: count(raw.graded_fails),
  };
}

// Load progress for the current step, lazily backfilling students who were mid-step when
// v2 landed (their sessions have no step_state yet). One scoped lesson_attempts read seeds
// the pass gates and attempt counts; a session that already finished its activities under
// the old code gets every required gate seeded, so a completed lesson doesn't reopen.
// seedFailed=true means the backfill read failed: the turn proceeds on the unseeded state,
// but the caller MUST NOT persist it — leaving step_state empty re-runs the backfill next
// turn instead of permanently erasing gates the student already passed.
async function loadStepState(
  config: SupabaseConfig,
  session: DbRow,
  activity: DbRow | null,
  req: StepRequirements,
): Promise<{ state: StepState; seedFailed: boolean }> {
  const activityId = typeof activity?.id === "string" ? activity.id : null;
  const state = parseStepState(session, activityId);
  // Stage intro = the step genuinely hasn't been presented (fresh session or just
  // advanced) — an empty state is correct, not missing.
  if (state.presented_at || state.attempts > 0 || stage(session.stage) === "intro") {
    return { state, seedFailed: false };
  }
  const nowIso = new Date().toISOString();
  const seeded: StepState = { ...state, presented_at: nowIso };
  if (
    session.activities_complete === true ||
    session.status === "complete" ||
    stage(session.stage) === "complete"
  ) {
    return {
      state: {
        ...seeded,
        code_passed_at: req.code ? nowIso : null,
        quiz_presented_at: req.quiz ? nowIso : null,
        quiz_passed_at: req.quiz ? nowIso : null,
        understanding_at: req.understanding ? nowIso : null,
      },
      seedFailed: false,
    };
  }
  try {
    const attempts = await loadMany(
      config,
      `lesson_attempts?session_id=eq.${encodeURIComponent(String(session.id))}&activity_id=${activityId ? `eq.${encodeURIComponent(activityId)}` : "is.null"}&select=answer_mode,passed&limit=50`,
    );
    seeded.attempts = attempts.length;
    seeded.graded_fails = attempts.filter((a) => a.passed === false).length;
    if (attempts.some((a) => a.answer_mode === "code" && a.passed === true)) {
      seeded.code_passed_at = nowIso;
    }
    if (
      attempts.some(
        (a) => a.answer_mode === "multiple_choice" && a.passed === true,
      )
    ) {
      seeded.quiz_passed_at = nowIso;
      seeded.quiz_presented_at = nowIso;
    }
    // Pre-v2 code attached quiz choices on every eligible turn, so if the quiz was
    // already live for this student it was already on screen — seed the presentation
    // flag so the first post-deploy turn doesn't re-introduce it as new.
    if (
      req.quiz &&
      !seeded.quiz_presented_at &&
      (!req.code || seeded.code_passed_at)
    ) {
      seeded.quiz_presented_at = nowIso;
    }
  } catch {
    return { state: seeded, seedFailed: true };
  }
  return { state: seeded, seedFailed: false };
}

function stepDone(state: StepState, req: StepRequirements): boolean {
  return (
    (!req.code || Boolean(state.code_passed_at)) &&
    (!req.quiz || Boolean(state.quiz_passed_at)) &&
    (!req.understanding || Boolean(state.understanding_at))
  );
}

// The quiz is live only after its prerequisites: never before a required code gate has
// passed, and never again once passed. Because a quiz can ONLY pass via a
// multiple_choice answer while eligible, a text or voice turn can never trip it.
function quizEligible(state: StepState, req: StepRequirements): boolean {
  return (
    req.quiz &&
    !state.quiz_passed_at &&
    (!req.code || Boolean(state.code_passed_at))
  );
}

// Fold one turn into the step's persisted progress. A presentation turn (the step hasn't
// been shown yet) only records the presentation — it NEVER grades, so an answer sent
// before the step appears can't score against it (this replaces stage "intro" as control).
function applyTurn(
  before: StepState,
  req: StepRequirements,
  answer: DbRow | null,
  assessment: Assessment | null,
  understanding: Understanding | null,
  nowIso: string,
): StepState {
  if (!before.presented_at) {
    return { ...before, presented_at: nowIso };
  }
  const after = { ...before };
  if (answer && answerContent(answer)) {
    after.attempts = before.attempts + 1;
  }
  // Deterministically graded failure (orchestrator source only — a mentor's free-form
  // assessment must never look like a failed graded attempt).
  if (
    answer &&
    assessment?.source === "orchestrator" &&
    assessment.passed === false
  ) {
    after.graded_fails = before.graded_fails + 1;
  }
  if (
    req.code &&
    !after.code_passed_at &&
    answer?.mode === "code" &&
    assessment?.passed === true
  ) {
    after.code_passed_at = nowIso;
  }
  if (
    quizEligible(before, req) &&
    answer?.mode === "multiple_choice" &&
    assessment?.passed === true
  ) {
    after.quiz_passed_at = nowIso;
    if (!after.quiz_presented_at) after.quiz_presented_at = nowIso;
  }
  if (
    req.understanding &&
    !after.understanding_at &&
    answer &&
    (answer.mode === "text" || answer.mode === "file") &&
    // Demonstrated understanding, or the stuck cap: >=4 prior attempts on this step means
    // several rounds without landing it — conclude gracefully rather than loop forever.
    (understanding?.demonstrated === true || before.attempts >= 4)
  ) {
    after.understanding_at = nowIso;
  }
  return after;
}

// Derive the turn's flow from persisted progress. Choices are attached on EVERY turn
// while the quiz is eligible (the prompt tells the mentor they're already on screen), so
// the quiz can't be dismissed by a side conversation and never re-attaches after passing.
function deriveTurn(
  state: StepState,
  req: StepRequirements,
  presentedBefore: boolean,
  activityMode: ResponseMode,
): FlowDecision {
  if (!presentedBefore) {
    return {
      stage: "practice",
      responseMode: activityMode,
      nextAction:
        activityMode === "code"
          ? "run_code"
          : activityMode === "multiple_choice"
            ? "choose"
            : "reply",
      choices: activityMode === "multiple_choice" ? req.quizChoices : [],
    };
  }
  if (stepDone(state, req)) {
    return {
      stage: "complete",
      responseMode: "text",
      nextAction: "complete",
      choices: [],
    };
  }
  if (quizEligible(state, req)) {
    return {
      stage: "assessment",
      responseMode: "multiple_choice",
      nextAction: "choose",
      choices: req.quizChoices,
    };
  }
  if (req.code && !state.code_passed_at) {
    return {
      stage: "practice",
      responseMode: "code",
      nextAction: "run_code",
      choices: [],
    };
  }
  return { stage: "practice", responseMode: "text", nextAction: "reply", choices: [] };
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
  if (flow.nextAction === "run_code")
    return String(
      activity?.prompt || "Run the starter code and tell me what it does.",
    );
  return String(
    assessment?.feedback || activity?.prompt || "Tell me your next thought.",
  );
}

type TurnDirective = { key: string; text: string };

// ONE composed per-turn instruction replacing the old teaching-move selector, pedagogy
// prompt block, and six ad-hoc directive strings. Priority ladder: first match wins; the
// resource clause is appended whenever card(s) ride along with this reply. The key doubles
// as the learning_evidence.teaching_move label.
function turnDirective(args: {
  currentStage: Stage;
  answer: DbRow | null;
  presentedBefore: boolean;
  stepStateBefore: StepState;
  draftState: StepState;
  draftFlow: FlowDecision;
  requirements: StepRequirements;
  activityMode: ResponseMode;
  gradedUnderstanding: Understanding | null;
  gradedCode: Understanding | null;
  runtimeTimedOut: boolean;
  assessment: Assessment | null;
  attachedResources: LessonChatResource[];
}): TurnDirective {
  const {
    currentStage,
    answer,
    presentedBefore,
    stepStateBefore,
    draftState,
    draftFlow,
    requirements,
    activityMode,
    gradedUnderstanding,
    gradedCode,
    runtimeTimedOut,
    assessment,
    attachedResources,
  } = args;

  const quizActive = draftFlow.nextAction === "choose";
  const textStep = activityMode === "text" && requirements.understanding;
  const stepConcluding =
    draftFlow.nextAction === "complete" || draftFlow.stage === "complete";

  const pick = (): TurnDirective => {
    if (currentStage === "complete" && answer) {
      return {
        key: "post_completion",
        text: "This lesson is already complete; the student's message is follow-up conversation. Answer it directly and briefly — do not repeat your earlier congratulations or closing summary.",
      };
    }
    if (runtimeTimedOut) {
      return {
        key: "runtime_timeout",
        text: "The code runner TIMED OUT — an infrastructure hiccup on our side, NOT the student's mistake. Reassure them briefly that it's on us and ask them to run it again; do not grade or critique their code.",
      };
    }
    if (gradedUnderstanding?.demonstrated) {
      return {
        key: "understanding_demonstrated",
        text: `The student HAS just demonstrated understanding of this step (grader level=${gradedUnderstanding.level}). Affirm warmly in one sentence and conclude the step — do not ask another question about it or offer more help.`,
      };
    }
    const codePassedThisTurn =
      gradedCode?.demonstrated === true ||
      (answer?.mode === "code" && assessment?.passed === true);
    // A code pass whose step still has a live quiz must NOT say "conclude" — the
    // quiz-first branch below owns that turn (and introduces the newly shown options).
    if (codePassedThisTurn && !quizActive) {
      return {
        key: "code_objective_met",
        text: "The student's code runs and accomplishes this step's objective. Affirm once and conclude the step — do not demand a specific wording, topic, or a match to a shown example.",
      };
    }
    if (
      textStep &&
      stepConcluding &&
      currentStage !== "complete" &&
      !stepStateBefore.understanding_at &&
      Boolean(draftState.understanding_at)
    ) {
      // Stuck-cap conclusion: the step is wrapping without a demonstrated understanding.
      return {
        key: "step_concluding_stuck",
        text: "The student has worked at this several times without fully landing it and the step is now wrapping up. State the step's idea plainly in one or two sentences — this is the ONE time you give it — then close warmly.",
      };
    }
    if (quizActive && !stepStateBefore.quiz_presented_at) {
      return {
        key: "quiz_first_presentation",
        text: `${
          codePassedThisTurn
            ? "The student's code just passed — affirm that in one sentence. "
            : ""
        }The quiz options for this step are being shown on screen below your reply for the FIRST time. Introduce the question briefly and tell the student to tap the best answer — do not enumerate the options in your text.`,
      };
    }
    if (answer?.mode === "multiple_choice" && assessment?.passed === true) {
      return {
        key: "quiz_passed",
        text: "The student tapped the correct answer (deterministically graded — see turn.grade and turn.message). Affirm briefly, reinforce in one sentence WHY it's right, and conclude the step — do not re-read the options or ask another question about it.",
      };
    }
    if (answer?.mode === "multiple_choice" && assessment?.passed === false) {
      return {
        key: "quiz_wrong",
        text: "The student tapped a wrong choice (deterministically graded — see turn.grade). Give brief, targeted feedback on why that specific choice doesn't work, then point them back at the options still on screen; do not re-read the full option list.",
      };
    }
    if (quizActive && answer && answer.mode !== "multiple_choice") {
      return {
        key: "quiz_active_chat",
        text: "The quiz options are already on screen and the student sent a chat message instead of tapping one. Respond to their message, then steer them back to tapping an answer — do not re-read or re-narrate the options.",
      };
    }
    if (answer?.mode === "code" && assessment?.passed === false) {
      return {
        key: "run_failed",
        text: "The student's code run did not pass (see turn.run_summary and turn.grade). Give the lightest help that unblocks the ONE thing to fix — a pointed question or a single hint at turn.hint_rung — then ask them to run it again.",
      };
    }
    if (textStep && presentedBefore && !draftState.understanding_at) {
      const gap = gradedUnderstanding?.note
        ? ` The grader says what's still missing: ${gradedUnderstanding.note}.`
        : "";
      return {
        key: "explanation_pending",
        text: `This step needs the STUDENT to articulate the idea in their own words, and they have not yet.${gap} Work toward that without handing them the conclusion — address the specific gap; do not merely re-ask a question they already answered.`,
      };
    }
    if (!presentedBefore) {
      return {
        key: "present_step",
        text: "This step has not been shown to the student yet. Present it: introduce the task in a sentence or two at their grade level and invite a first attempt — do not pre-empt their thinking, give anything away, or interrogate them.",
      };
    }
    return {
      key: "converse",
      text: "Continue the conversation toward this step's goal. Respond to what the student actually said and use the lightest teaching move that advances them.",
    };
  };

  const directive = pick();
  if (attachedResources.length) {
    const titles = attachedResources
      .map((resource) => `"${resource.title}"`)
      .join(", ");
    directive.text += ` The resource card(s) ${titles} are attached below your reply — tell the student to tap Open on the card; never say you can't share it.`;
  }
  return directive;
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

type PendingCheckpoint = {
  kind: "assignment" | "assessment";
  title: string;
  due_at: string | null;
  required: boolean;
};

// Assignments/assessments live in separate UI docks the mentor never sees. Load the ones
// assigned to THIS student for THIS lesson that they haven't finished, so the mentor can
// point them there. Reads the UNIFIED `checkpoints` table (checkpoint unification Phase 4):
// dual-write triggers keep it in sync with assignments + assessments, so one query replaces
// the old two-table read. The per-kind status filters (assignment 'assigned', assessment
// 'published') and recipient 'assigned' filter are identical to the legacy gate — the mirror
// preserves status verbatim. Returns null (not []) on any load failure, so the completion gate
// stays fail-closed (don't complete a gated lesson when we couldn't confirm remaining work).
async function loadPendingCheckpoints(
  config: SupabaseConfig,
  userId: string,
  lessonId: string,
): Promise<PendingCheckpoint[] | null> {
  try {
    const lid = encodeURIComponent(lessonId);
    const uid = encodeURIComponent(userId);
    const checkpoints = await loadMany(
      config,
      `checkpoints?lesson_id=eq.${lid}&select=id,kind,title,due_at,required,status&limit=60`,
    );
    // Live/assignable per kind: assignment status 'assigned', assessment status 'published'
    // (filtered in code rather than a PostgREST `or` filter — a lesson has few checkpoints).
    const live = checkpoints.filter(
      (c) =>
        (c.kind === "assignment" && c.status === "assigned") ||
        (c.kind === "assessment" && c.status === "published"),
    );
    const ids = uniqueStrings(live.map((c) => String(c.id || "")));
    if (!ids.length) return [];
    // A student only has a recipient row for work assigned to them. A required checkpoint gates
    // the lesson until the student COMPLETES it: any recipient status other than "complete"
    // (assigned/started/submitted/returned) is still pending — so merely opening a required quiz
    // no longer un-gates the lesson.
    const recips = await loadMany(
      config,
      `checkpoint_recipients?user_id=eq.${uid}&checkpoint_id=${inFilter(ids)}&status=neq.complete&select=checkpoint_id`,
    );
    const pending = new Set(recips.map((r) => String(r.checkpoint_id)));
    const out: PendingCheckpoint[] = [];
    for (const c of live) {
      if (pending.has(String(c.id))) {
        const kind = c.kind === "assessment" ? "assessment" : "assignment";
        out.push({
          kind,
          title: String(c.title || (kind === "assessment" ? "Assessment" : "Assignment")),
          due_at: typeof c.due_at === "string" ? c.due_at : null,
          required: c.required === true,
        });
      }
    }
    // Required-first so the display cap can never drop a required item ahead of a non-required
    // one (which would wrongly open the completion gate).
    out.sort((a, b) => Number(b.required) - Number(a.required));
    return out.slice(0, 6);
  } catch {
    return null;
  }
}

async function loadContext(
  config: SupabaseConfig,
  userId: string,
  lessonId: string,
  session: DbRow,
): Promise<{
  lesson: DbRow | null;
  activity: DbRow | null;
  activities: DbRow[];
  milestone: DbRow | null;
  quiz: DbRow | null;
  recentTurns: DbRow[];
  mastery: DbRow[];
  resources: DbRow[];
  resourceChunks: DbRow[];
  resourceInteractions: DbRow[];
  profile: DbRow | null;
  misconceptions: DbRow[];
  pendingCheckpoints: PendingCheckpoint[];
  pendingCheckpointsOk: boolean;
}> {
  // Reads run in TWO parallel waves (wave 2 holds only the queries that genuinely
  // depend on a wave-1 result), with the checkpoints chain overlapping both.
  const checkpointsPromise = loadPendingCheckpoints(config, userId, lessonId);

  // WAVE 1 — everything derivable from the entry params alone. The current activity is
  // no longer its own query: allActivities is widened to select=* (a lesson has at most
  // a handful of steps) and the cursor row is picked from it in code.
  const [
    lesson,
    allActivities,
    recentTurns,
    mastery,
    resources,
    resourceInteractions,
    profile,
  ] = await Promise.all([
    loadFirst(
      config,
      `lessons?id=eq.${encodeURIComponent(lessonId)}&publication_status=eq.published&select=id,title,module,level,tutor_prompt,sample_code,expected_output,unit_id,help_ceiling,require_attempt_first,final_answer_policy,tutor_tone,tutor_pace,grade_band`,
    ),
    loadMany(
      config,
      `lesson_activities?lesson_id=eq.${encodeURIComponent(lessonId)}&order=position.asc&select=*`,
    ),
    loadMany(
      config,
      `learning_turns?session_id=eq.${encodeURIComponent(String(session.id))}&order=created_at.desc&limit=12&select=role,stage,response_mode,content,payload,created_at`,
    ),
    loadMany(
      config,
      `student_mastery?user_id=eq.${encodeURIComponent(userId)}&select=skill_key,level,score`,
    ),
    loadMany(
      config,
      `lesson_resources?lesson_id=eq.${encodeURIComponent(lessonId)}&status=eq.published&order=created_at.asc&limit=5&select=id,title,description,resource_type,display_mode,source_type,storage_bucket,storage_path,external_url,thumbnail_path,student_instructions,metadata`,
    ),
    loadMany(
      config,
      `resource_interactions?user_id=eq.${encodeURIComponent(userId)}&lesson_id=eq.${encodeURIComponent(lessonId)}&order=created_at.desc&limit=20&select=resource_id,event_type,progress_seconds,progress_percent,created_at`,
    ),
    loadFirst(
      config,
      `profiles?id=eq.${encodeURIComponent(userId)}&select=name,grade&limit=1`,
    ),
  ]);

  const currentActivityId =
    typeof session.current_activity_id === "string"
      ? session.current_activity_id
      : "";
  const activity =
    (currentActivityId
      ? allActivities.find((row) => String(row.id) === currentActivityId)
      : null) ??
    allActivities[0] ??
    null;

  const milestoneId =
    typeof activity?.milestone_id === "string" ? activity.milestone_id : "";
  const activitySkills = stringArray(activity?.skill_keys);
  const resourceIds = uniqueStrings(
    resources.map((resource) =>
      typeof resource.id === "string" ? resource.id : String(resource.id || ""),
    ),
  );

  // WAVE 2 — queries keyed on wave-1 results. Quiz must be scoped to the CURRENT
  // activity; the lesson-level (activity_id null) fallback exists ONLY for legacy
  // single-activity lessons — on a multi-step lesson it would glue one unbound quiz onto
  // EVERY step. Misconceptions are filtered by the ACTIVITY's skills (milestone/quiz
  // skills resolve in this same wave; empty → unfiltered, and the prompt caps at 3).
  const [milestone, activityQuiz, fallbackQuiz, misconceptions, resourceChunks] =
    await Promise.all([
      milestoneId
        ? loadFirst(
            config,
            `milestones?id=eq.${encodeURIComponent(milestoneId)}&select=*`,
          )
        : loadFirst(
            config,
            `milestones?lesson_id=eq.${encodeURIComponent(lessonId)}&order=position.asc&limit=1&select=*`,
          ),
      activity?.id
        ? loadFirst(
            config,
            `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}&activity_id=eq.${encodeURIComponent(String(activity.id))}&status=eq.published&order=position.asc&limit=1&select=*`,
          )
        : Promise.resolve(null),
      allActivities.length <= 1
        ? loadFirst(
            config,
            `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}&activity_id=is.null&status=eq.published&order=position.asc&limit=1&select=*`,
          )
        : Promise.resolve(null),
      loadMany(
        config,
        `student_misconceptions?user_id=eq.${encodeURIComponent(userId)}&status=eq.active${activitySkills.length ? `&skill_key=${inFilter(activitySkills)}` : ""}&order=last_seen_at.desc&limit=8&select=skill_key,pattern,hint,occurrences`,
      ),
      resourceIds.length
        ? loadMany(
            config,
            `resource_text_chunks?resource_id=${inFilter(resourceIds)}&status=eq.approved&order=source_kind.asc,start_seconds.asc,page_number.asc,chunk_index.asc&limit=18&select=resource_id,page_number,chunk_index,chunk_text,status,source_kind,start_seconds,end_seconds`,
          )
        : Promise.resolve([] as DbRow[]),
    ]);
  const quiz = activityQuiz ?? fallbackQuiz;

  const pendingResult = await checkpointsPromise;

  return {
    lesson,
    activity,
    activities: allActivities,
    milestone,
    quiz,
    recentTurns,
    mastery,
    resources,
    resourceChunks,
    resourceInteractions,
    profile,
    misconceptions,
    pendingCheckpoints: pendingResult ?? [],
    pendingCheckpointsOk: pendingResult !== null,
  };
}

type ArcStep = { step: number; title: string };
type LessonArc = {
  step: number;
  total: number;
  current: { title: string; prompt: string } | null;
  completed: ArcStep[];
  upcoming: ArcStep[];
  next: ArcStep | null;
};

// Build the lesson-arc view (step N of M, what's done, what's next) so the mentor can
// situate each turn instead of treating the current activity in isolation. Null for
// single-step lessons (no arc to narrate). Upcoming steps expose TITLES only — not their
// full prompts/answers — so the mentor can preview without jumping ahead or leaking.
function buildLessonArc(
  activities: DbRow[],
  currentActivity: DbRow | null,
): LessonArc | null {
  if (!Array.isArray(activities) || activities.length <= 1) return null;
  const sorted = [...activities].sort(
    (a, b) => Number(a.position ?? 0) - Number(b.position ?? 0),
  );
  const titleOf = (a: DbRow, i: number) =>
    String(a.title || `Step ${i + 1}`);
  const currentId = currentActivity?.id ? String(currentActivity.id) : "";
  let idx = sorted.findIndex((a) => String(a.id) === currentId);
  if (idx < 0) idx = 0;
  const completed = sorted
    .slice(0, idx)
    .map((a, i) => ({ step: i + 1, title: titleOf(a, i) }));
  const upcoming = sorted
    .slice(idx + 1)
    .map((a, i) => ({ step: idx + 2 + i, title: titleOf(a, idx + 1 + i) }));
  return {
    step: idx + 1,
    total: sorted.length,
    current: currentActivity
      ? {
          title: titleOf(currentActivity, idx),
          prompt: String(currentActivity.prompt || ""),
        }
      : null,
    completed,
    upcoming,
    next: upcoming[0] || null,
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

// Students ask for resources mid-conversation ("can you show the PDF?") — detect the request and
// attach the matching card(s), instead of the old behavior of only attaching one on the opening turn
// (which left the mentor advertising resources it could never hand over).
const RESOURCE_REQUEST_RE =
  /\b(open|show|give|send|share|see|view|find|where|link|pull up|watch|read)\b[\s\S]{0,60}\b(pdf|video|resource|file|worksheet|slides?|doc(ument)?|card|link)\b|\b(pdf|video|worksheet|resource)\b/i;

function resourcesForResponse(
  resources: DbRow[],
  answer: DbRow | null,
  studentText = "",
): LessonChatResource[] {
  if (resources.length === 0) return [];
  // Opening turn (no answer yet): surface the first resource, as before.
  if (!answer) return [resourceForEnvelope(resources[0])];
  const text = studentText.toLowerCase();
  if (!text || !RESOURCE_REQUEST_RE.test(text)) return [];
  // Prefer a title match ("the Smoke Purpose PDF"), then a type match ("the video"), else all.
  const titleMatches = resources.filter((resource) => {
    const title = String(resource.title || "").toLowerCase();
    if (!title) return false;
    if (text.includes(title)) return true;
    return title
      .split(/\s+/)
      .some((word) => word.length >= 5 && text.includes(word));
  });
  const typeMatches = resources.filter((resource) => {
    const type = String(resource.resource_type || "").toLowerCase();
    return type.length > 2 && text.includes(type);
  });
  const chosen = titleMatches.length
    ? titleMatches
    : typeMatches.length
      ? typeMatches
      : resources;
  return chosen.slice(0, 3).map(resourceForEnvelope);
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

  // One read for ALL skills, then one upsert POST — replaces the per-skill
  // read-then-write loop (2N round trips -> 2). Same field math; the same
  // read-modify-write race as before (no worse), resolved per-row by the
  // (user_id, skill_key) primary key at merge time.
  const currentRows = await loadMany(
    config,
    `student_mastery?user_id=eq.${encodeURIComponent(userId)}&skill_key=${inFilter(skills)}&select=*`,
  );
  const currentBySkill = new Map(
    currentRows.map((row) => [String(row.skill_key), row]),
  );
  const nowIso = new Date().toISOString();
  const nextRows = skills.map((skill) => {
    const current = currentBySkill.get(skill) ?? null;
    const evidenceCount = Number(current?.evidence_count || 0);
    const attemptCount = Number(current?.attempt_count || 0);
    const oldScore = Number(current?.score || 0);
    const nextEvidenceCount = evidenceCount + 1;
    const nextScore = Math.max(
      0,
      Math.min(
        1,
        (oldScore * evidenceCount + assessment.score) / nextEvidenceCount,
      ),
    );
    return {
      user_id: userId,
      skill_key: skill,
      level:
        nextScore >= 0.85
          ? "secure"
          : nextScore >= 0.55
            ? "developing"
            : "emerging",
      evidence_count: nextEvidenceCount,
      attempt_count: attemptCount + 1,
      score: nextScore,
      latest_score: assessment.score,
      confidence,
      last_seen_at: nowIso,
      last_practiced_at: nowIso,
      updated_at: nowIso,
    };
  });
  await upsertRows(config, "student_mastery", nextRows, "user_id,skill_key");
}

// Teacher-facing support signal. Fires exactly once per step — on the turn of the 3rd
// GRADED failure without the step passing (the caller additionally requires that THIS
// turn produced a graded failure, so sitting at 3 fails can't re-fire it on chat turns).
async function maybeWriteRecommendation(
  config: SupabaseConfig,
  userId: string,
  lessonId: string,
  sessionId: string,
  milestone: DbRow | null,
  envelope: Envelope,
  gradedFails: number,
  stepIsDone: boolean,
): Promise<void> {
  if (gradedFails !== 3 || stepIsDone) return;
  await insertRow(config, "mentor_recommendations", {
    user_id: userId,
    session_id: sessionId,
    lesson_id: lessonId,
    milestone_id: typeof milestone?.id === "string" ? milestone.id : null,
    recommendation_type: "rescue",
    title: "Rescue support recommended",
    rationale:
      envelope.reply ||
      "The learner needs another pass on the current milestone.",
    payload: {
      stage: envelope.stage,
      response_mode: envelope.response_mode,
      next_action: envelope.next_action,
      assessment: envelope.assessment,
      graded_fails: gradedFails,
    },
    status: "pending",
  });
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

  // Everything from answer-normalization onward runs inside the context-aware try so a
  // throw in the pedagogy computation returns a typed error with session/stage instead of
  // falling through to the bare outer catch.
  try {
  const answer = normalizeAnswer(body.answer);
  const content = answerContent(answer);
  const mentorPreferences = normalizeMentorPreferences(body.mentor_preferences);
  const skillKeys = skillKeysFor(
    context.activity,
    context.milestone,
    context.quiz,
  );
  // --- Flow core (v2): step requirements + persisted progress -----------------
  const activityMode = responseMode(context.activity?.response_mode, "code");
  const requirements = requirementsFor(context.activity, context.quiz);
  const { state: stepStateBefore, seedFailed: stepSeedFailed } =
    await loadStepState(config, session, context.activity, requirements);
  const presentedBefore = Boolean(stepStateBefore.presented_at);
  const quizEligibleBefore = quizEligible(stepStateBefore, requirements);
  const turnStartedIso = new Date().toISOString();
  // Grading eligibility: a presentation turn never grades (the step hasn't been shown
  // yet), and an MCQ answer grades only while its quiz is actually live — a stale tap on
  // an old choice block, or a choice sent before a required code gate passed, grades
  // nothing and writes nothing.
  const staleQuizAnswer =
    answer?.mode === "multiple_choice" && !quizEligibleBefore;
  const orchestratorAssessment =
    !presentedBefore || staleQuizAnswer
      ? null
      : assessAnswer(answer, context.lesson, context.activity, context.quiz);

  // --- Pedagogy decision (diagnose -> policy -> teaching move) ---------------
  const mentorMode = mentorPreferences?.mode || "guide";
  // Prefer an explicit client help_request (legacy), else infer it from the student's words
  // now that the Hint / "Show me how" buttons are gone.
  const clientHelpRequest = HELP_REQUEST_OPTIONS.has(String(body.help_request))
    ? String(body.help_request)
    : "";
  // Infer a help request from a typed message only (code/MCQ answers are real attempts).
  const inferredHelp =
    !clientHelpRequest && answer?.mode === "text" ? detectHelpRequest(content) : "";
  const helpRequest = clientHelpRequest || inferredHelp;
  const requestedRung =
    Number(body.hint_rung) ||
    (helpRequest === "hint" ? deriveHintRung(context.recentTurns) : 0);
  const intent = detectIntent(content);
  const recentQuestions = mentorQuestionsFromTurns(context.recentTurns);
  // Prior attempts on THIS step — persisted in step_state (resets on advance), replacing
  // the old count of recent lesson_attempts rows.
  const priorActivityAttempts = stepStateBefore.attempts;
  // A typed help request is NOT itself an attempt — otherwise "just tell me the answer" as a
  // first message would satisfy attempt-first and switch off the no-final-answer gate.
  const hasAttempt =
    priorActivityAttempts > 0 || (Boolean(answer) && !inferredHelp);
  const attemptedBeforeHelp =
    Boolean(answer) && !inferredHelp && Number(session.rescue_count || 0) === 0;
  const diagnosis = diagnoseStudent(
    context,
    session,
    skillKeys,
    answer,
    orchestratorAssessment,
  );
  const helpPolicy = resolveHelpPolicy(context.lesson);
  // The hint rung the mentor may reveal at this turn (1-4; 0 = no hint asked). "Show me
  // how" starts at rung 2. Clamped: body.hint_rung is client-supplied and unvalidated —
  // an out-of-range rung would leak past the 1-4 ladder into the prompt and telemetry.
  const hintRung = Math.max(
    0,
    Math.min(
      4,
      helpRequest === "show_me_how" ? Math.max(2, requestedRung) : requestedRung,
    ),
  );
  const answersForbidden =
    helpPolicy.finalAnswerPolicy === "never" ||
    (helpPolicy.finalAnswerPolicy === "after_attempt" && !hasAttempt);

    if (await isChatRateLimited(config, userId, sessionId)) {
      scheduleBackground(
        recordRuntimeEvent(config, {
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
        }),
      );
      return typedError("Too many chat turns at once. Pause for a minute and try again.", 429, {
        session_id: sessionId,
        lesson_id: lessonId,
        stage: currentStage,
      });
    }

    // Server-side turn idempotency (B4): a retried/double-submitted answer replays the
    // stored mentor reply instead of running (and persisting) the whole turn again. The
    // client stamps every answer with a client_msg_id; recent turns are already loaded,
    // so the duplicate scan is free.
    const clientMsgId =
      typeof answer?.client_msg_id === "string" ? answer.client_msg_id : "";
    if (clientMsgId) {
      const turns = context.recentTurns; // newest first
      const dupIndex = turns.findIndex((turn) => {
        if (turn.role !== "student") return false;
        const payload =
          turn.payload && typeof turn.payload === "object"
            ? (turn.payload as DbRow)
            : null;
        return payload?.client_msg_id === clientMsgId;
      });
      if (dupIndex >= 0) {
        // The mentor row that followed the original submission holds the full envelope
        // as its payload — replay it verbatim (scan newer rows, oldest-first). Hitting
        // ANOTHER student row first means the original's reply never landed — fall
        // through to the benign acknowledgment rather than replaying a later exchange.
        for (let i = dupIndex - 1; i >= 0; i--) {
          if (turns[i].role === "student") break;
          if (turns[i].role !== "mentor") continue;
          const payload = turns[i].payload;
          if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            const replay = makeEnvelope(payload as Partial<Envelope>);
            replay.session_id = sessionId;
            replay.lesson_id = lessonId;
            return json(replay);
          }
          break;
        }
        // Original still in flight (or its reply never landed): acknowledge benignly
        // without writing anything — the in-flight request owns this turn.
        return json(
          makeEnvelope({
            session_id: sessionId,
            lesson_id: lessonId,
            stage: currentStage,
            response_mode: "text",
            next_action: "reply",
            reply: "One moment — I'm still working on your last message.",
          }),
        );
      }
    }

    // The student-turn insert runs CONCURRENTLY with the grader below — nothing this
    // request reads the row (recentTurns is already loaded). It is joined into the
    // grader Promise.all so a failure still fails the turn before the mentor call.
    const studentTurnPromise =
      answer && content
        ? insertRow(config, "learning_turns", {
            session_id: sessionId,
            user_id: userId,
            lesson_id: lessonId,
            role: "student",
            stage: currentStage,
            response_mode: answer.mode,
            content,
            payload: answer,
          })
        : Promise.resolve(null);

    // v1.2 loop-closer: for a free-text explanation turn, a dedicated grader judges whether
    // the student demonstrated the objective; its verdict hard-gates completion below and is
    // surfaced to the mentor so the reply matches. Skipped for pure confusion/meta messages
    // (not an explanation attempt) and whenever there is no gradeable text.
    // Only true text answers carry the student's words; a "file" answer's content is a
    // placeholder, so grading it would judge garbage — leave those to the mentor path.
    const isTextExplanation =
      answer?.mode === "text" &&
      activityMode === "text" &&
      requirements.understanding &&
      presentedBefore &&
      !stepStateBefore.understanding_at &&
      // Only skip an explicit summary request; do NOT gate on confused/frustrated, so a
      // misread intent can never suppress grading a genuinely correct explanation.
      intent !== "wants_summary";
    const runtimeTimedOut = Boolean(
      answer?.mode === "code" && runTimedOut(answer.run_result),
    );

    // Semantic code grading: if a code run ran cleanly but the orchestrator's exact-output
    // match failed (e.g. an open-ended "write your own …" task whose expected_output is just
    // the starter example), judge whether the code meets the OBJECTIVE. A "met" verdict
    // upgrades the strict-match failure to a pass so the activity can complete instead of
    // looping on the fixed output forever.
    const codeRanClean = Boolean(
      answer?.mode === "code" &&
        !runtimeTimedOut &&
        !runHasErrors(answer.run_result),
    );
    const codeNeedsJudge =
      codeRanClean &&
      orchestratorAssessment?.passed === false &&
      requirements.code &&
      presentedBefore &&
      !stepStateBefore.code_passed_at;
    // The two graders are mutually exclusive (text explanation vs clean code); either one
    // runs alongside the student-turn insert. The insert promise MUST be a member of this
    // same Promise.all — that attaches its rejection handler immediately (an unhandled
    // rejection would kill the isolate mid-request) and keeps fail-fast: an insert failure
    // rejects the batch straight into the typed-500 catch before the mentor call.
    const [gradedUnderstanding, gradedCode] = await Promise.all([
      isTextExplanation
        ? checkUnderstanding(
            config,
            userId,
            sessionId,
            lessonId,
            context.activity,
            context.milestone,
            content,
            context.recentTurns,
          )
        : Promise.resolve(null),
      codeNeedsJudge
        ? checkCodeObjective(
            config,
            userId,
            sessionId,
            lessonId,
            context.activity,
            context.milestone,
            typeof answer?.code === "string" ? answer.code : "",
            outputLines(answer?.run_result).join("\n"),
            context.recentTurns,
          )
        : Promise.resolve(null),
      studentTurnPromise,
    ]);
    // A judge-based pass COMPLETES the activity (unblocks the loop) but is capped below the
    // "secure" mastery tier (< 0.85): the server never re-executed the code and run_result is
    // client-supplied, so an open-ended judgement earns solid-but-not-verified credit only.
    const effectiveOrchestratorAssessment: Assessment | null =
      gradedCode?.demonstrated
        ? {
            score: 0.8,
            passed: true,
            feedback: "Your code accomplishes the task.",
            source: "orchestrator",
          }
        : orchestratorAssessment;

    // Lesson-arc view (step N of M, done, next) so the mentor can situate this turn.
    const lessonArc = buildLessonArc(context.activities, context.activity);

    const draftState = applyTurn(
      stepStateBefore,
      requirements,
      answer,
      effectiveOrchestratorAssessment,
      gradedUnderstanding,
      turnStartedIso,
    );
    const draftFlow = deriveTurn(
      draftState,
      requirements,
      presentedBefore,
      activityMode,
    );
    // Resource cards attached to THIS reply (opening turn, or the student asked for one).
    const attachedResources = resourcesForResponse(
      context.resources,
      answer,
      content,
    );
    const attachedResourceIds = new Set(
      attachedResources.map((resource) => String(resource.id)),
    );
    // ONE composed per-turn instruction (priority ladder) replacing the old pedagogy
    // block and the six ad-hoc directive strings.
    const directive = turnDirective({
      currentStage,
      answer,
      presentedBefore,
      stepStateBefore,
      draftState,
      draftFlow,
      requirements,
      activityMode,
      gradedUnderstanding,
      gradedCode,
      runtimeTimedOut,
      assessment: effectiveOrchestratorAssessment,
      attachedResources,
    });
    const runSummary =
      answer?.mode === "code" && answer.run_result
        ? [
            ...outputLines(answer.run_result),
            ...(Array.isArray((answer.run_result as DbRow).errors)
              ? ((answer.run_result as DbRow).errors as unknown[]).map(
                  (entry) => `ERROR: ${String(entry)}`,
                )
              : []),
          ]
            .join("\n")
            .slice(0, 400)
        : null;
    const relevantMastery = context.mastery.filter((row) =>
      skillKeys.includes(String(row.skill_key)),
    );
    // A quiz tap's content is just the choice id — resolve its text so the mentor knows
    // WHAT the student picked, not only that "b" was tapped.
    const tappedChoice =
      answer?.mode === "multiple_choice"
        ? requirements.quizChoices.find(
            (choice) =>
              choice &&
              typeof choice === "object" &&
              String((choice as DbRow).id || "") ===
                String(answer.choice_id || ""),
          )
        : null;
    const tappedChoiceText = tappedChoice
      ? String(
          (tappedChoice as DbRow).text ||
            (tappedChoice as DbRow).label ||
            (tappedChoice as DbRow).value ||
            "",
        )
      : "";
    // Key order is STABLE -> VOLATILE: the static system prompt plus the session-stable
    // keys (lesson/activity/milestone/arc/resources/policy) form a cacheable prefix
    // across the turns of a step, and the per-turn keys sit last — with `directive` at
    // the very end, closest to generation.
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "One tutoring turn: follow `directive` under `policy` and return ONLY the JSON output contract from your system message.",
          lesson: context.lesson
            ? {
                id: context.lesson.id,
                title: context.lesson.title,
                module: context.lesson.module,
                level: context.lesson.level,
                tutor_prompt: context.lesson.tutor_prompt,
                sample_code: context.lesson.sample_code,
                expected_output: context.lesson.expected_output,
              }
            : null,
          activity: context.activity
            ? {
                id: context.activity.id,
                title: context.activity.title,
                stage: context.activity.stage,
                response_mode: context.activity.response_mode,
                prompt: context.activity.prompt,
                starter_code: context.activity.starter_code,
                expected_output: context.activity.expected_output,
              }
            : null,
          milestone: context.milestone
            ? {
                objective: context.milestone.objective,
                skill_keys: stringArray(context.milestone.skill_keys),
              }
            : null,
          arc: lessonArc,
          resources: context.resources.map((resource) => ({
            id: resource.id,
            title: resource.title,
            description: resource.description,
            resource_type: resource.resource_type,
            student_instructions: resource.student_instructions,
          })),
          policy: {
            help_ceiling: helpPolicy.helpCeiling,
            final_answer_policy: helpPolicy.finalAnswerPolicy,
            require_attempt_first: helpPolicy.requireAttemptFirst,
            answers_forbidden_this_turn: answersForbidden,
            tone: helpPolicy.tone || null,
            pace: helpPolicy.pace || null,
            mentor_mode: mentorMode,
          },
          student: {
            level: diagnosis.level,
            difficulty: diagnosis.difficulty,
            grade_band: diagnosis.gradeBand,
            mastery: (relevantMastery.length ? relevantMastery : context.mastery)
              .slice(0, 5)
              .map((row) => ({
                skill_key: row.skill_key,
                level: row.level,
                score: row.score,
              })),
            misconceptions: context.misconceptions.slice(0, 3).map((row) => ({
              skill_key: row.skill_key,
              pattern: row.pattern,
              hint: row.hint,
            })),
            recent_questions: recentQuestions.slice(0, 4),
          },
          checkpoints: context.pendingCheckpoints.slice(0, 3),
          resource_interactions: context.resourceInteractions
            .slice(0, 8)
            .map((interaction) => ({
              resource_id: interaction.resource_id,
              event_type: interaction.event_type,
              created_at: interaction.created_at,
            })),
          // The step's contract: what this step requires, what's already passed, and
          // whether its quiz is live on screen right now (quiz_presented means the
          // options are already visible — point at them, don't re-read them).
          step_contract: {
            step: lessonArc ? lessonArc.step : 1,
            of: lessonArc ? lessonArc.total : Math.max(context.activities.length, 1),
            title: String(context.activity?.title || context.lesson?.title || ""),
            kind: activityMode,
            requirements: {
              code: requirements.code
                ? draftState.code_passed_at
                  ? "passed"
                  : "pending"
                : "not_required",
              quiz: requirements.quiz
                ? draftState.quiz_passed_at
                  ? "passed"
                  : "pending"
                : "not_required",
              understanding: requirements.understanding
                ? draftState.understanding_at
                  ? "demonstrated"
                  : "pending"
                : "not_required",
            },
            presented: presentedBefore,
            quiz_presented: Boolean(stepStateBefore.quiz_presented_at),
            attempts: draftState.attempts,
            quiz_active: draftFlow.nextAction === "choose",
          },
          // The live quiz, only while its choices are on screen — and never the answer key.
          quiz:
            draftFlow.nextAction === "choose"
              ? {
                  prompt: String(
                    context.quiz?.prompt || context.activity?.prompt || "",
                  ),
                  choices: requirements.quizChoices,
                }
              : null,
          // Teacher-approved source material: only on the step's opening turn or when a
          // resource rides along with this reply (a request or the lesson opener). When
          // specific card(s) are attached, their chunks come first so the cap can't
          // starve the resource the student actually asked about (stable sort — the
          // original page/time order is preserved within each group).
          resource_chunks:
            !presentedBefore || attachedResources.length > 0
              ? [...context.resourceChunks]
                  .sort(
                    (a, b) =>
                      Number(attachedResourceIds.has(String(b.resource_id))) -
                      Number(attachedResourceIds.has(String(a.resource_id))),
                  )
                  .slice(0, 6)
                  .map((chunk) => {
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
                    chunk_text: String(chunk.chunk_text || "").slice(0, 1000),
                  };
                })
              : [],
          // Fresh arrays only (slice/map) — context.recentTurns is read newest-first by
          // the dedup replay and the graders; the model reads oldest-first.
          history: context.recentTurns
            .slice(0, 8)
            .map((turn) => ({
              role: turn.role,
              content: String(turn.content || "").slice(0, 400),
            }))
            .reverse(),
          turn: {
            message:
              answer?.mode === "multiple_choice" && tappedChoiceText
                ? `${content}: ${tappedChoiceText}`.slice(0, 600)
                : content.slice(0, answer?.mode === "code" ? 1200 : 600),
            kind: answer ? String(answer.mode) : "none",
            input_modality: String(answer?.input_modality || "typed"),
            transcript_confidence:
              typeof answer?.transcript_confidence === "number"
                ? answer.transcript_confidence
                : null,
            run_summary: runSummary,
            grade: effectiveOrchestratorAssessment
              ? {
                  passed: effectiveOrchestratorAssessment.passed === true,
                  feedback: effectiveOrchestratorAssessment.feedback || "",
                }
              : null,
            understanding_check: gradedUnderstanding,
            help_request: helpRequest || null,
            hint_rung: hintRung,
            intent,
            runtime_timeout: runtimeTimedOut,
          },
          directive: directive.text,
        }),
      },
    ];

    const openAIResult = await callModel(messages, true, "default");
    scheduleBackground(
      recordModelUsage(
        config,
        userId,
        sessionId,
        lessonId,
        openAIResult,
        "mentor_turn",
      ),
    );
    const contentJson = openAIResult.content;
    let parsed: DbRow;
    try {
      parsed = JSON.parse(contentJson);
    } catch {
      scheduleBackground(
        recordRuntimeEvent(config, {
          userId,
          sessionId,
          lessonId,
          eventType: "chat_failure",
          status: "error",
          latencyMs: Date.now() - requestStartedAt,
          payload: { reason: "invalid_mentor_json" },
        }),
      );
      return typedError("Mentor returned invalid JSON.", 502, {
        session_id: sessionId,
        lesson_id: lessonId,
        stage: currentStage,
      });
    }

    // Grading is deterministic-only: the orchestrator's assessment (incl. the semantic
    // code judge's capped upgrade) is the grade; the mentor no longer emits one.
    const assessment = effectiveOrchestratorAssessment;
    // The dedicated grader is authoritative for text completion (it hard-gates the loop);
    // the mentor's self-reported understanding is only the fallback when no grader ran.
    const understanding =
      gradedUnderstanding ?? parsedUnderstanding(parsed.understanding);
    const finalState = applyTurn(
      stepStateBefore,
      requirements,
      answer,
      assessment,
      understanding,
      turnStartedIso,
    );
    const finalFlow = deriveTurn(
      finalState,
      requirements,
      presentedBefore,
      activityMode,
    );
    // First attach of an eligible quiz: remember it so later prompts can say the options
    // are already on screen (the mentor points at them instead of re-reading them).
    if (finalFlow.nextAction === "choose" && !finalState.quiz_presented_at) {
      finalState.quiz_presented_at = turnStartedIso;
    }
    const finalStepDone = stepDone(finalState, requirements);

    // Multi-step lessons: if the current activity is finished but later activities
    // remain (ordered by position), advance the session to the next activity instead
    // of completing the lesson. A single-activity lesson has no next step, so this is
    // a no-op and the runtime behaves exactly as before.
    const finishedCurrentActivity =
      finalFlow.stage === "complete" || finalFlow.nextAction === "complete";
    let advanceToActivityId: string | null = null;
    if (finishedCurrentActivity && context.activity) {
      // context.activities is already the full position-ordered step list — no query.
      const currentPosition = Number(context.activity.position ?? 0);
      const nextActivity = context.activities.find(
        (row) => Number(row.position ?? 0) > currentPosition,
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
      resources: attachedResources,
      lesson_arc: lessonArc,
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
      // Situate the hand-off in the lesson arc: what just finished, progress, what's next.
      // Use the activity actually being advanced to (advanceToActivityId), so the "next"
      // title and the progress step can't disagree if two steps share a position.
      const nextActivityRow = advanceToActivityId
        ? context.activities.find(
            (a) => String(a.id) === advanceToActivityId,
          ) || null
        : null;
      const nextTitle = nextActivityRow ? String(nextActivityRow.title || "") : "";
      const arcSuffix =
        lessonArc && nextTitle
          ? `That completes ${
              lessonArc.current ? `"${lessonArc.current.title}"` : "this part"
            } — step ${lessonArc.step} of ${lessonArc.total} done. Next up: "${nextTitle}". Send a message when you're ready.`
          : "That completes this part — send a message when you're ready for the next part.";
      envelope.reply = `${envelope.reply}\n\n${arcSuffix}`.trim();
      // Advance the progress indicator in sync with the hand-off (the session cursor just
      // moved to the next activity), so the client shows the new step immediately.
      envelope.lesson_arc =
        buildLessonArc(context.activities, nextActivityRow) ?? envelope.lesson_arc;
    }

    // Unified completion gate (checkpoint unification P1): a lesson is complete only when its
    // activities AND all REQUIRED checkpoints (assignments/assessments the teacher marked
    // required) are done. `activities_complete` (persisted) tracks "activities done" so the
    // gate can hold the lesson open and re-check when the student returns.
    const requiredRemaining = context.pendingCheckpoints.filter((c) => c.required);
    const checkpointsOk = context.pendingCheckpointsOk;
    const activitiesDoneThisTurn =
      !advancing &&
      (finalFlow.stage === "complete" || finalFlow.nextAction === "complete");
    const activitiesComplete =
      activitiesDoneThisTurn || session.activities_complete === true;
    // Complete only with a CONFIDENT read that no required work remains — fail-closed: a
    // transient checkpoint-load failure keeps the lesson open and re-checks next turn.
    const unifiedComplete =
      activitiesComplete && checkpointsOk && requiredRemaining.length === 0;
    if (activitiesDoneThisTurn && !unifiedComplete) {
      // Finished the steps but the lesson isn't done yet — hold it open instead of
      // celebrating completion (required work remains, or we couldn't confirm it's clear).
      // With step completion persisted, this branch now runs on EVERY turn while gated,
      // so the boilerplate nudge is appended only on the turn the activities first finish
      // (later gated turns reply normally; the prompt still carries pending_checkpoints).
      envelope.stage = "review";
      envelope.response_mode = "text";
      envelope.next_action = "reply";
      envelope.choices = [];
      if (requiredRemaining.length > 0 && session.activities_complete !== true) {
        const list = requiredRemaining.map((c) => `"${c.title}"`).join(", ");
        const many = requiredRemaining.length > 1;
        envelope.reply =
          `${envelope.reply}\n\nYou've finished all the steps — great work! To complete the lesson, there ${
            many ? "are still required items" : "is one required item"
          } to do: ${list}. Open ${many ? "them" : "it"} from the panel above the message box.`.trim();
      }
    } else if (
      activitiesComplete &&
      !activitiesDoneThisTurn &&
      unifiedComplete &&
      session.status !== "complete"
    ) {
      // Re-completion: the student finished the required checkpoints since last time.
      envelope.stage = "complete";
      envelope.response_mode = "text";
      envelope.next_action = "complete";
      envelope.choices = [];
      envelope.reply =
        `${envelope.reply}\n\nThat's everything for this lesson — you've completed all the required work. Nicely done!`.trim();
    }

    // A deterministic grade failed this turn (orchestrator-sourced only, so a mentor's
    // free-form assessment can never bump the teacher-facing counters).
    const gradedFail =
      Boolean(answer) && effectiveOrchestratorAssessment?.passed === false;
    const retryIncrement = gradedFail ? 1 : 0;
    const finalGradedFails = finalState.graded_fails;
    // Gate the status: complete only when activities AND required checkpoints are confidently
    // done; if activities are done but something's outstanding (or unconfirmed), stay active.
    // needs_rescue/needs_retry are TeacherConsole's needs-attention signals — the flow no
    // longer emits retry/rescue actions, so they're derived from GRADED failures on this
    // step (never from raw attempts: side questions to the mentor are not struggling).
    const nextStatus = advancing
      ? "active"
      : unifiedComplete
        ? "complete"
        : activitiesComplete
          ? "active"
          : finalGradedFails >= 4 && !finalStepDone
            ? "needs_rescue"
            : gradedFail && finalGradedFails >= 2
              ? "needs_retry"
              : "active";

    // Authoritative session snapshot on the wire, so the client can track status/cursor/
    // completion without refetching. Assigned before the mentor-turn insert so the stored
    // payload (used by the dedup replay and the teacher transcript) carries it too.
    envelope.session = {
      status: nextStatus,
      current_activity_id: advancing
        ? advanceToActivityId
        : typeof context.activity?.id === "string"
          ? context.activity.id
          : null,
      activities_complete: advancing ? false : activitiesComplete,
    };

    // The mentor-turn insert stays strictly BEFORE the batched writes below: this row is
    // the teacher transcript and the dedup-replay source of truth, so the session must
    // never advance past a reply that failed to persist.
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

    // Rolling independence signal (only updated on real graded-eligible attempts).
    let nextIndependence: number | undefined;
    if (answer && presentedBefore && !staleQuizAnswer) {
      const turnInd = independenceFor(
        assessment,
        attemptedBeforeHelp,
        hintRung,
      );
      // PostgREST serializes `numeric` as a string, so read it tolerantly (the rest
      // of this file reads numeric session columns via Number() for the same reason).
      const priorRaw = Number(session.independence_score);
      const prior = Number.isFinite(priorRaw) ? priorRaw : null;
      nextIndependence = prior === null ? turnInd : 0.7 * prior + 0.3 * turnInd;
    }

    // Remaining record writes run as ONE parallel batch — none reads another's result
    // except attempt -> evidence (evidence stores the attempt id), which stays chained
    // inside its own batch member. The session patch is awaited AFTER the batch: the
    // session must never advance past a turn whose graded records failed to persist
    // (a dedup replay after a retried 500 would otherwise skip the records forever,
    // and the step_state backfill relies on lesson_attempts being durable).
    const recordWrites: Promise<unknown>[] = [];
    // Misconception memory: persist any recurring conceptual error the mentor flagged.
    if (parsed.misconception) {
      recordWrites.push(
        upsertMisconception(config, userId, null, parsed.misconception),
      );
    }
    // Record writes gate on grading eligibility (B11): a presentation turn never writes
    // (the step wasn't on screen yet), and a stale/ineligible quiz tap writes nothing.
    if (answer && presentedBefore && !staleQuizAnswer) {
      recordWrites.push(
        (async () => {
          const attempt = await insertRow(config, "lesson_attempts", {
            session_id: sessionId,
            activity_id:
              typeof context.activity?.id === "string"
                ? context.activity.id
                : null,
            user_id: userId,
            lesson_id: lessonId,
            answer_mode: answer.mode,
            answer_text: answer.mode === "text" ? answer.text : null,
            answer_code: answer.mode === "code" ? answer.code : null,
            choice_id:
              answer.mode === "multiple_choice" ? answer.choice_id : null,
            run_result: answer.run_result || null,
            score:
              typeof assessment?.score === "number" ? assessment.score : null,
            passed:
              typeof assessment?.passed === "boolean" ? assessment.passed : null,
            feedback: assessment?.feedback || envelope.reply,
            input_modality: answer.input_modality || "typed",
            transcript_confidence:
              typeof answer.transcript_confidence === "number"
                ? answer.transcript_confidence
                : null,
          });
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
            confidenceFor(assessment, session, hintRung),
            directive.key,
            hintRung,
            attemptedBeforeHelp,
          );
        })(),
      );

      if (answer.mode === "multiple_choice" && context.quiz) {
        recordWrites.push(
          insertRow(config, "quiz_attempts", {
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
          }),
        );
      }

      // Only on the turn that PRODUCED the graded failure — ungraded turns (text chatter
      // while stuck at 3 fails) must not re-fire the recommendation.
      if (gradedFail) {
        recordWrites.push(
          maybeWriteRecommendation(
            config,
            userId,
            lessonId,
            sessionId,
            context.milestone,
            envelope,
            finalGradedFails,
            finalStepDone,
          ),
        );
      }
    }
    await Promise.all(recordWrites);
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
          // Stage stays a teacher-transcript label; the advance still resets it to "intro"
          // for continuity, but control lives in step_state (reset to {} on advance).
          stage: advancing ? "intro" : envelope.stage,
          status: nextStatus,
          // Sticky: once the activities are done it stays done, even while gated on checkpoints.
          activities_complete: advancing ? false : activitiesComplete,
          // When the lazy backfill failed, DON'T persist the unseeded state — leaving
          // step_state empty makes the next turn re-run the backfill instead of
          // permanently erasing gates the student passed before v2 (their graded work
          // this turn is still durable in lesson_attempts and re-seeds from there).
          ...(advancing
            ? { step_state: {} }
            : stepSeedFailed
              ? {}
              : { step_state: finalState }),
          score:
            typeof assessment?.score === "number"
              ? Math.max(Number(session.score || 0), assessment.score)
              : Number(session.score || 0),
          retry_count: advancing
            ? 0
            : Number(session.retry_count || 0) + retryIncrement,
          // Frozen: rescue is no longer a flow action; the count is kept (not reset outside
          // an advance) because TeacherConsole reads it as a historical signal.
          rescue_count: advancing ? 0 : Number(session.rescue_count || 0),
          updated_at: new Date().toISOString(),
          mentor_mode: mentorMode,
          ...(nextIndependence !== undefined
            ? { independence_score: nextIndependence }
            : {}),
        },
      );

    if (currentStage !== envelope.stage) {
      scheduleBackground(
        recordRuntimeEvent(config, {
          userId,
          sessionId,
          lessonId,
          eventType: "stage_transition",
          latencyMs: Date.now() - requestStartedAt,
          payload: { from_stage: currentStage, to_stage: envelope.stage, next_action: envelope.next_action },
        }),
      );
    }
    if (!advancing && (envelope.next_action === "complete" || nextStatus === "complete")) {
      scheduleBackground(
        recordRuntimeEvent(config, {
          userId,
          sessionId,
          lessonId,
          eventType: "completion",
          latencyMs: Date.now() - requestStartedAt,
          payload: { stage: envelope.stage, score: assessment?.score ?? null },
        }),
      );
    } else if (gradedFail) {
      // retry/rescue died as flow actions; keep the telemetry stream keyed on graded
      // failures (rescue = the student is genuinely stuck on this step).
      scheduleBackground(
        recordRuntimeEvent(config, {
          userId,
          sessionId,
          lessonId,
          eventType: finalGradedFails >= 4 && !finalStepDone ? "rescue" : "retry",
          latencyMs: Date.now() - requestStartedAt,
          payload: { stage: envelope.stage, assessment },
        }),
      );
    }

    return json(envelope);
  } catch (err) {
    scheduleBackground(
      recordRuntimeEvent(config, {
        userId,
        sessionId,
        lessonId,
        eventType: "chat_failure",
        status: "error",
        latencyMs: Date.now() - requestStartedAt,
        payload: { message: errorMessage(err) },
      }),
    );
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
    return await handleTypedRequest(req, record);
  } catch (err) {
    return typedError(errorMessage(err), 500);
  }
});
