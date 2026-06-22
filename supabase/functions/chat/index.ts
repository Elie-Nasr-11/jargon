// Jargon Mentor - structured course-session chat edge function.
// Legacy compatibility: { messages } -> { reply } still works.
// Typed contract: { lesson_id, session_id?, answer?, mentor_preferences? } -> learning envelope.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STAGES = new Set(["intro", "teach", "practice", "assessment", "review", "complete"]);
const RESPONSE_MODES = new Set(["text", "code", "multiple_choice", "file"]);
const NEXT_ACTIONS = new Set(["reply", "run_code", "choose", "retry", "rescue", "continue", "complete"]);
const PACE_OPTIONS = new Set(["brief", "balanced", "guided"]);
const TONE_OPTIONS = new Set(["neutral", "encouraging"]);
const HINT_LEVEL_OPTIONS = new Set(["low", "medium", "high"]);

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
- If mentor_preferences are provided, follow them.

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

type Stage = "intro" | "teach" | "practice" | "assessment" | "review" | "complete";
type ResponseMode = "text" | "code" | "multiple_choice" | "file";
type NextAction = "reply" | "run_code" | "choose" | "retry" | "rescue" | "continue" | "complete";

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
  next_action: NextAction;
  guardrail: { redirected: boolean; reason: string | null };
};

type SupabaseConfig = {
  url: string;
  anonKey: string;
  authorization: string;
};

type DbRow = Record<string, unknown>;

type Assessment = {
  score?: number;
  passed?: boolean;
  feedback?: string;
  source: "orchestrator" | "mentor";
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

function stage(value: unknown, fallback: Stage = "intro"): Stage {
  const candidate = String(value || "");
  return STAGES.has(candidate) ? candidate as Stage : fallback;
}

function responseMode(value: unknown, fallback: ResponseMode = "text"): ResponseMode {
  const candidate = String(value || "");
  return RESPONSE_MODES.has(candidate) ? candidate as ResponseMode : fallback;
}

function nextAction(value: unknown, fallback: NextAction = "reply"): NextAction {
  const candidate = String(value || "");
  return NEXT_ACTIONS.has(candidate) ? candidate as NextAction : fallback;
}

function makeEnvelope(partial: Partial<Envelope> = {}): Envelope {
  return {
    status: partial.status === "error" ? "error" : "ok",
    reply: typeof partial.reply === "string" ? partial.reply : "",
    session_id: typeof partial.session_id === "string" ? partial.session_id : null,
    lesson_id: typeof partial.lesson_id === "string" ? partial.lesson_id : null,
    stage: stage(partial.stage),
    response_mode: responseMode(partial.response_mode),
    choices: Array.isArray(partial.choices) ? partial.choices : [],
    exercise: partial.exercise ?? null,
    assessment: partial.assessment ?? null,
    next_action: nextAction(partial.next_action),
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

function typedAuthStatus(message: string): number {
  if (message.includes("Authentication is required") || message.includes("authenticated")) return 401;
  if (message.includes("identify authenticated user") || message.includes("JWT")) return 403;
  return 500;
}

function isLegacyRequest(body: Record<string, unknown>): boolean {
  return Array.isArray(body.messages) && !body.lesson_id && !body.session_id && !body.answer;
}

function normalizeAnswer(answer: unknown): DbRow | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const raw = answer as DbRow;
  const mode = responseMode(raw.mode, "text");
  return {
    mode,
    text: typeof raw.text === "string" ? raw.text : "",
    code: typeof raw.code === "string" ? raw.code : "",
    choice_id: typeof raw.choice_id === "string" ? raw.choice_id : "",
    run_result: raw.run_result && typeof raw.run_result === "object" ? raw.run_result : null,
  };
}

function answerContent(answer: DbRow | null): string {
  if (!answer) return "";
  if (answer.mode === "code") return String(answer.code || "");
  if (answer.mode === "multiple_choice") return String(answer.choice_id || "");
  if (answer.mode === "file") return "[file answer placeholder]";
  return String(answer.text || "");
}

function normalizeMentorPreferences(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const prefs = raw as DbRow;
  const pace = PACE_OPTIONS.has(String(prefs.pace)) ? String(prefs.pace) : "balanced";
  const tone = TONE_OPTIONS.has(String(prefs.tone)) ? String(prefs.tone) : "neutral";
  const hintLevel = HINT_LEVEL_OPTIONS.has(String(prefs.hint_level))
    ? String(prefs.hint_level)
    : "medium";
  return { pace, tone, hint_level: hintLevel };
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
  if (!res.ok || !data?.id) throw new Error("Could not identify authenticated user.");
  return data;
}

async function insertRow(config: SupabaseConfig, table: string, row: DbRow): Promise<DbRow> {
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

async function patchRows(config: SupabaseConfig, path: string, row: DbRow): Promise<void> {
  await supabaseFetch(config, path, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
}

async function loadFirst(config: SupabaseConfig, path: string): Promise<DbRow | null> {
  const data = await supabaseFetch(config, path);
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") return null;
  return data[0] as DbRow;
}

async function loadMany(config: SupabaseConfig, path: string): Promise<DbRow[]> {
  const data = await supabaseFetch(config, path);
  return Array.isArray(data) ? data.filter((row) => row && typeof row === "object") as DbRow[] : [];
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

async function callOpenAI(messages: unknown[], jsonMode: boolean): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const body: DbRow = {
    model: "gpt-4o",
    messages,
    temperature: 0.35,
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
  if (!res.ok) throw new Error(data?.error?.message || res.statusText);
  return data?.choices?.[0]?.message?.content || "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") as string[] : [];
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

function outputLines(runResult: unknown): string[] {
  if (!runResult || typeof runResult !== "object") return [];
  const raw = runResult as DbRow;
  const direct = Array.isArray(raw.output) ? raw.output : Array.isArray(raw.result) ? raw.result : null;
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

function expectedOutputFor(lesson: DbRow | null, activity: DbRow | null): string {
  return String(activity?.expected_output || lesson?.expected_output || "").trim();
}

function passThreshold(activity: DbRow | null, quiz: DbRow | null): number {
  const activityThreshold = numberOrNull(activity?.pass_score);
  if (activityThreshold !== null) return activityThreshold;
  const rubric = quiz?.rubric && typeof quiz.rubric === "object" ? quiz.rubric as DbRow : null;
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
  if (score === null && passed === null && typeof raw.feedback !== "string") return null;
  return {
    score: score ?? undefined,
    passed: passed ?? undefined,
    feedback: typeof raw.feedback === "string" ? raw.feedback : undefined,
    source: "mentor",
  };
}

function mergeAssessment(orchestrator: Assessment | null, mentor: Assessment | null): Assessment | null {
  if (!orchestrator && !mentor) return null;
  if (!orchestrator) return mentor;
  if (!mentor) return orchestrator;
  return {
    ...mentor,
    ...orchestrator,
    feedback: mentor.feedback || orchestrator.feedback,
  };
}

function flowFor(
  currentStage: Stage,
  session: DbRow,
  activity: DbRow | null,
  quiz: DbRow | null,
  answer: DbRow | null,
  assessment: Assessment | null,
): FlowDecision {
  const activityMode = responseMode(activity?.response_mode, "code");
  const quizChoices = Array.isArray(quiz?.choices) ? quiz.choices as unknown[] : [];
  const retryCount = Number(session.retry_count || 0);
  const rescueCount = Number(session.rescue_count || 0);
  const weakAction: NextAction = retryCount > 0 || rescueCount > 0 ? "rescue" : "retry";

  if (!answer) {
    const mode = activityMode;
    return {
      stage: currentStage === "intro" ? "practice" : currentStage,
      responseMode: mode,
      nextAction: mode === "code" ? "run_code" : mode === "multiple_choice" ? "choose" : "reply",
      choices: mode === "multiple_choice" ? quizChoices : [],
    };
  }

  if (answer.mode === "code") {
    if (assessment?.passed === true) {
      return quiz
        ? { stage: "assessment", responseMode: "multiple_choice", nextAction: "choose", choices: quizChoices }
        : { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
    }
    return { stage: "practice", responseMode: "code", nextAction: weakAction, choices: [] };
  }

  if (answer.mode === "multiple_choice") {
    if (assessment?.passed === true) {
      return { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
    }
    return { stage: "review", responseMode: "multiple_choice", nextAction: weakAction, choices: quizChoices };
  }

  if (assessment?.passed === true && currentStage === "review") {
    return { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
  }

  return {
    stage: currentStage === "intro" ? "practice" : currentStage,
    responseMode: activityMode,
    nextAction: activityMode === "code" ? "run_code" : "reply",
    choices: [],
  };
}

function fallbackReply(flow: FlowDecision, assessment: Assessment | null, activity: DbRow | null, quiz: DbRow | null): string {
  if (flow.nextAction === "complete") return "Nice work. This lesson is complete.";
  if (flow.nextAction === "choose") return String(quiz?.prompt || "Choose the answer that best matches what you just practiced.");
  if (flow.nextAction === "retry") return assessment?.feedback || "Try one more time. Focus on the current step.";
  if (flow.nextAction === "rescue") return "Let's rescue this together. Say what part feels stuck, or try the smallest next change.";
  if (flow.nextAction === "run_code") return String(activity?.prompt || "Run the starter code and tell me what it does.");
  return String(activity?.prompt || "Tell me your next thought.");
}

function skillKeysFor(activity: DbRow | null, milestone: DbRow | null, quiz: DbRow | null): string[] {
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
}> {
  const lesson = await loadFirst(
    config,
    `lessons?id=eq.${encodeURIComponent(lessonId)}&select=id,title,module,level,tutor_prompt,sample_code,expected_output,unit_id`,
  );

  let activity: DbRow | null = null;
  if (typeof session.current_activity_id === "string" && session.current_activity_id) {
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

  const milestoneId = typeof activity?.milestone_id === "string"
    ? activity.milestone_id
    : "";
  const milestone = milestoneId
    ? await loadFirst(config, `milestones?id=eq.${encodeURIComponent(milestoneId)}&select=*`)
    : await loadFirst(
      config,
      `milestones?lesson_id=eq.${encodeURIComponent(lessonId)}&order=position.asc&limit=1&select=*`,
    );

  const quiz = activity?.id
    ? await loadFirst(
      config,
      `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}&activity_id=eq.${encodeURIComponent(String(activity.id))}&status=eq.published&order=position.asc&limit=1&select=*`,
    ) ??
      await loadFirst(
        config,
        `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}&status=eq.published&order=position.asc&limit=1&select=*`,
      )
    : await loadFirst(
      config,
      `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}&status=eq.published&order=position.asc&limit=1&select=*`,
    );

  const [recentTurns, recentAttempts, mastery] = await Promise.all([
    loadMany(
      config,
      `learning_turns?session_id=eq.${encodeURIComponent(String(session.id))}&order=created_at.desc&limit=8&select=role,stage,response_mode,content,payload,created_at`,
    ),
    loadMany(
      config,
      `lesson_attempts?session_id=eq.${encodeURIComponent(String(session.id))}&order=created_at.desc&limit=5&select=*`,
    ),
    loadMany(
      config,
      `student_mastery?user_id=eq.${encodeURIComponent(userId)}&select=*`,
    ),
  ]);

  return { lesson, activity, milestone, quiz, recentTurns, recentAttempts, mastery };
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
): Promise<void> {
  if (!answer || !assessment || typeof assessment.score !== "number" || skills.length === 0) return;

  const sourceType = answer.mode === "code" ? "code_run" : answer.mode === "multiple_choice" ? "quiz" : "chat_turn";
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
    confidence: assessment.passed === true ? 0.85 : 0.45,
    rubric_result: assessment,
    notes: assessment.feedback || "",
    created_by: userId,
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
    const nextScore = Math.max(0, Math.min(1, ((oldScore * evidenceCount) + assessment.score) / nextEvidenceCount));
    const level = nextScore >= 0.85 ? "secure" : nextScore >= 0.55 ? "developing" : "emerging";
    const payload = {
      user_id: userId,
      skill_key: skill,
      level,
      evidence_count: nextEvidenceCount,
      attempt_count: nextAttemptCount,
      score: nextScore,
      latest_score: assessment.score,
      confidence: assessment.passed === true ? 0.85 : 0.45,
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
  if (envelope.next_action !== "retry" && envelope.next_action !== "rescue") return;
  await insertRow(config, "mentor_recommendations", {
    user_id: userId,
    session_id: sessionId,
    lesson_id: lessonId,
    milestone_id: typeof milestone?.id === "string" ? milestone.id : null,
    recommendation_type: envelope.next_action,
    title: envelope.next_action === "rescue" ? "Rescue support recommended" : "Retry recommended",
    rationale: envelope.reply || "The learner needs another pass on the current milestone.",
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
  if (flow.stage === "complete" || flow.nextAction === "complete") return "complete";
  if (flow.nextAction === "retry") return "needs_retry";
  if (flow.nextAction === "rescue") return "needs_rescue";
  return "active";
}

async function handleLegacyRequest(body: Record<string, unknown>): Promise<Response> {
  const chatHistory = Array.isArray(body.messages) ? [...body.messages] : [];
  const hasPersona = chatHistory.some(
    (m) =>
      m && typeof m === "object" &&
      (m as DbRow).role === "system" &&
      typeof (m as DbRow).content === "string" &&
      String((m as DbRow).content).includes("You are the Jargon Mentor"),
  );
  if (!hasPersona) chatHistory.unshift({ role: "system", content: SYSTEM_PROMPT });

  try {
    const reply = await callOpenAI(chatHistory, false);
    return json({ reply: reply || "No response." });
  } catch (err) {
    return json({ reply: `Error: ${errorMessage(err)}` }, 500);
  }
}

async function handleTypedRequest(req: Request, body: Record<string, unknown>): Promise<Response> {
  const lessonId = typeof body.lesson_id === "string" ? body.lesson_id : "";
  if (!lessonId) return typedError("lesson_id is required.", 400);

  let config: SupabaseConfig;
  let user: DbRow;
  let session: DbRow;
  let context: Awaited<ReturnType<typeof loadContext>>;

  try {
    config = restConfig(req);
    user = await fetchCurrentUser(config);
    session = await loadOrCreateSession(config, String(user.id), lessonId, body.session_id);
    context = await loadContext(config, String(user.id), lessonId, session);
  } catch (err) {
    const message = errorMessage(err);
    return typedError(message, typedAuthStatus(message), { lesson_id: lessonId });
  }

  const userId = String(user.id);
  const sessionId = String(session.id);
  const currentStage = stage(session.stage);
  const answer = normalizeAnswer(body.answer);
  const content = answerContent(answer);
  const mentorPreferences = normalizeMentorPreferences(body.mentor_preferences);
  const skillKeys = skillKeysFor(context.activity, context.milestone, context.quiz);
  const orchestratorAssessment = assessAnswer(answer, context.lesson, context.activity, context.quiz);

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

    const draftFlow = flowFor(currentStage, session, context.activity, context.quiz, answer, orchestratorAssessment);
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Return only the typed JSON envelope. The orchestrator owns records and final stage/action; you own concise student-facing wording.",
          lesson: context.lesson,
          activity: context.activity,
          milestone: context.milestone,
          quiz_item: context.quiz,
          recent_turns: context.recentTurns,
          recent_attempts: context.recentAttempts,
          mastery_summary: context.mastery,
          session: {
            id: sessionId,
            stage: currentStage,
            status: session.status || "active",
            retry_count: session.retry_count || 0,
            rescue_count: session.rescue_count || 0,
          },
          mentor_preferences: mentorPreferences,
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
            "next_action",
            "guardrail",
          ],
        }),
      },
    ];

    const contentJson = await callOpenAI(messages, true);
    let parsed: DbRow;
    try {
      parsed = JSON.parse(contentJson);
    } catch {
      return typedError("Mentor returned invalid JSON.", 502, {
        session_id: sessionId,
        lesson_id: lessonId,
        stage: currentStage,
      });
    }

    const assessment = mergeAssessment(orchestratorAssessment, parsedAssessment(parsed.assessment));
    const finalFlow = flowFor(currentStage, session, context.activity, context.quiz, answer, assessment);
    const envelope = makeEnvelope({
      ...(parsed as Partial<Envelope>),
      session_id: sessionId,
      lesson_id: lessonId,
      stage: finalFlow.stage,
      response_mode: finalFlow.responseMode,
      choices: finalFlow.choices,
      assessment,
      next_action: finalFlow.nextAction,
      reply: typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply
        : fallbackReply(finalFlow, assessment, context.activity, context.quiz),
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

    let attempt: DbRow | null = null;
    if (answer) {
      attempt = await insertRow(config, "lesson_attempts", {
        session_id: sessionId,
        activity_id: typeof context.activity?.id === "string" ? context.activity.id : null,
        user_id: userId,
        lesson_id: lessonId,
        answer_mode: answer.mode,
        answer_text: answer.mode === "text" ? answer.text : null,
        answer_code: answer.mode === "code" ? answer.code : null,
        choice_id: answer.mode === "multiple_choice" ? answer.choice_id : null,
        run_result: answer.run_result || null,
        score: typeof assessment?.score === "number" ? assessment.score : null,
        passed: typeof assessment?.passed === "boolean" ? assessment.passed : null,
        feedback: assessment?.feedback || envelope.reply,
      });

      if (answer.mode === "multiple_choice" && context.quiz) {
        await insertRow(config, "quiz_attempts", {
          quiz_item_id: String(context.quiz.id),
          session_id: sessionId,
          user_id: userId,
          lesson_id: lessonId,
          answer_mode: answer.mode,
          choice_id: answer.choice_id || null,
          score: typeof assessment?.score === "number" ? assessment.score : null,
          passed: typeof assessment?.passed === "boolean" ? assessment.passed : null,
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
      );
      await maybeWriteRecommendation(config, userId, lessonId, sessionId, context.milestone, envelope);
    }

    const retryIncrement = envelope.next_action === "retry" ? 1 : 0;
    const rescueIncrement = envelope.next_action === "rescue" ? 1 : 0;
    await patchRows(config, `learning_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
      current_activity_id: typeof context.activity?.id === "string" ? context.activity.id : null,
      stage: envelope.stage,
      status: sessionStatus(finalFlow),
      score: typeof assessment?.score === "number"
        ? Math.max(Number(session.score || 0), assessment.score)
        : Number(session.score || 0),
      retry_count: Number(session.retry_count || 0) + retryIncrement,
      rescue_count: Number(session.rescue_count || 0) + rescueIncrement,
      updated_at: new Date().toISOString(),
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
