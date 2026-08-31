// Jargon cognition scorer (R90, docs/COGNITION.md).
//
// Reads the transcript the chat function already writes and scores each constructed
// student response against the Independent Cognitive Production Rubric — in the
// context of the assistance given immediately before it. Writes the cognition
// ledger (cognition_turn_scores) and the per-lesson rollup (cognition_profiles).
//
// The mentor teaches; this function judges. It is deliberately SEPARATE from chat:
// scoring can re-run and re-version without touching the lesson loop, costs nothing
// on the student's turn latency, and the rubric's delayed measures never fit a live
// turn anyway. It never writes to the transcript, never talks to the student, and
// no column it writes holds a single composite percentage.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sweep-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbRow = Record<string, unknown>;

type Config = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  authorization: string;
};

const RUBRIC_VERSION = 1;
// R92: eight responses of dimensions + evidence quotes + signals + a note is a
// comfortable call — smaller than the twelve R90 shipped, with a much larger output
// budget behind it, so the JSON has room to finish.
const MAX_SCORED_PER_CALL = 8;
// R92 sweep: how many (student, lesson) pairs one scheduled tick may take, and the
// wall clock the whole tick must fit inside. The edge gateway cuts a request around
// 150s; 130s leaves room to write the log before it does.
const SWEEP_BATCH_DEFAULT = 2;
const SWEEP_BATCH_MAX = 10;
const SWEEP_BUDGET_MS = 130_000;
// One scoring call, and the shorter budget its retry gets. Two full-length attempts
// on one pair would eat the tick.
const JUDGE_TIMEOUT_MS = 80_000;
const JUDGE_RETRY_TIMEOUT_MS = 45_000;
// The one failure worth another attempt. Shared so the thrower and the catcher can
// never drift apart.
const UNPARSEABLE = "The scoring model returned invalid JSON.";
const DIMENSIONS = [
  "retrieval",
  "organization",
  "reasoning",
  "elaboration",
  "vocabulary",
  "expression",
  "independence",
  "metacognition",
] as const;
type Dimension = (typeof DIMENSIONS)[number];

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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  if (!authorization) throw new Error("Authentication is required.");
  return { url, anonKey, serviceRoleKey, authorization };
}

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function clampText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

const enc = (value: string) => encodeURIComponent(value);

// The live chat function's JSON recipe: no assistant prefill (the Claude 5 family
// rejects it — the R90 probe's second live find), just firm instructions and a
// fence-tolerant extraction from the first "{" to the last "}".
function extractJsonObject(text: string): string {
  const t = (text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const inner = fenced ? fenced[1].trim() : t;
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  return start >= 0 && end > start ? inner.slice(start, end + 1) : inner;
}

async function fetchJson(
  config: Config,
  path: string,
  init: RequestInit,
  serviceRole: boolean,
): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  const key = serviceRole ? config.serviceRoleKey : config.anonKey;
  headers.set("apikey", key);
  headers.set("Authorization", serviceRole ? `Bearer ${config.serviceRoleKey}` : config.authorization);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${config.url}${path}`, { ...init, headers });
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

function userFetch(config: Config, path: string, init: RequestInit = {}) {
  return fetchJson(config, path, init, false);
}

function serviceFetch(config: Config, path: string, init: RequestInit = {}) {
  return fetchJson(config, path, init, true);
}

async function fetchCurrentUser(config: Config): Promise<DbRow> {
  const data = await userFetch(config, "/auth/v1/user");
  if (!data || typeof data !== "object" || typeof (data as DbRow).id !== "string") {
    throw new Error("Could not identify authenticated user.");
  }
  return data as DbRow;
}

async function selectFirst(config: Config, path: string): Promise<DbRow | null> {
  const data = await serviceFetch(config, `/rest/v1/${path}`);
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") return null;
  return data[0] as DbRow;
}

async function selectAll(config: Config, path: string): Promise<DbRow[]> {
  const data = await serviceFetch(config, `/rest/v1/${path}`);
  return Array.isArray(data)
    ? (data.filter((item) => item && typeof item === "object") as DbRow[])
    : [];
}

// Mirrors the ledger's RLS policy exactly: a teacher sharing an ACTIVE class with the
// student, an org admin of an organization the student is an active member of, or a
// platform admin. Nobody else can ask for a student's cognition.
async function assertCanViewStudent(
  config: Config,
  actorId: string,
  studentId: string,
): Promise<void> {
  const platformAdmin = await selectFirst(
    config,
    `platform_admins?user_id=eq.${enc(actorId)}&select=user_id&limit=1`,
  );
  if (platformAdmin) return;

  const teacherClasses = await selectAll(
    config,
    `class_memberships?user_id=eq.${enc(actorId)}&role=eq.teacher&status=eq.active&select=class_id`,
  );
  const classIds = teacherClasses.map((row) => cleanText(row.class_id)).filter(Boolean);
  if (classIds.length) {
    const shared = await selectFirst(
      config,
      `class_memberships?class_id=in.(${classIds.map(enc).join(",")})&user_id=eq.${enc(studentId)}&role=eq.student&status=eq.active&select=id&limit=1`,
    );
    if (shared) return;
  }

  const adminOrgs = await selectAll(
    config,
    `organization_memberships?user_id=eq.${enc(actorId)}&role=eq.org_admin&status=eq.active&select=organization_id`,
  );
  const orgIds = adminOrgs.map((row) => cleanText(row.organization_id)).filter(Boolean);
  if (orgIds.length) {
    const member = await selectFirst(
      config,
      `organization_memberships?organization_id=in.(${orgIds.map(enc).join(",")})&user_id=eq.${enc(studentId)}&status=eq.active&select=id&limit=1`,
    );
    if (member) return;
  }

  throw new Error("Access to this student's work is required.");
}

// R92: the SCHEDULER's door. A cron tick has no user behind it, so it cannot pass
// assertCanViewStudent — and it does not need to: a sweep returns COUNTS ONLY and
// never student content, so there is no one to authorize a view for. It presents a
// secret that lives in a table only the service role and postgres can read.
//
// The comparison is length-first then full-width XOR: no early exit on the first
// differing byte, so a caller cannot walk the key one character at a time.
function secretsMatch(presented: string, expected: string): boolean {
  if (!presented || !expected || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function isSweepCaller(config: Config, req: Request): Promise<boolean> {
  const presented = cleanText(req.headers.get("x-sweep-key"));
  if (!presented) return false;
  const row = await selectFirst(
    config,
    "cognition_sweep_auth?id=eq.true&select=sweep_key&limit=1",
  ).catch(() => null);
  return secretsMatch(presented, cleanText(row?.sweep_key));
}

// ---------------------------------------------------------------------------
// What counts as a constructed response.
//
// The rubric applies to constructed responses only: written, typed or transcribed
// speech (and code). An MCQ click is an answer, not production; "ok" is politeness,
// not cognition. Skipped turns are NOT zero-scored — they simply are not evidence.
// ---------------------------------------------------------------------------

const MIN_CONSTRUCTED_CHARS = 25;

function studentText(turn: DbRow): string {
  const payload = turn.payload && typeof turn.payload === "object" ? (turn.payload as DbRow) : {};
  const text = cleanText(payload.text) || cleanText(turn.content);
  const code = cleanText(payload.code);
  if (code) return text ? `${text}\n\nCODE:\n${code}` : `CODE:\n${code}`;
  return text;
}

function isConstructedResponse(turn: DbRow): boolean {
  const payload = turn.payload && typeof turn.payload === "object" ? (turn.payload as DbRow) : {};
  if (cleanText(payload.code)) return true;
  const text = cleanText(payload.text) || cleanText(turn.content);
  if (cleanText(payload.choice_id) && !text) return false;
  return text.length >= MIN_CONSTRUCTED_CHARS;
}

function mentorText(turn: DbRow): string {
  const payload = turn.payload && typeof turn.payload === "object" ? (turn.payload as DbRow) : {};
  return cleanText(payload.reply) || cleanText(turn.content);
}

// ---------------------------------------------------------------------------
// The rubric, as the judge's instructions. Compressed but faithful to the owner's
// document — the pins in tests/test_r90_cognition.py hold this text to the rules
// that carry the design (§1 context, NULL over guessing, §5/§6/§7 cautions, §13
// scaffold scale, §15 no single number, §17 normalization).
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM = `You are a learning scientist scoring a student's INDEPENDENT COGNITIVE PRODUCTION during an AI-tutored lesson. You are NOT grading correctness of the final answer; you are estimating how much thinking the student did themselves.

CORE PRINCIPLE. Always judge each response IN THE CONTEXT OF THE ASSISTANCE GIVEN IMMEDIATELY BEFORE IT. A polished answer that reproduces what the tutor just said is not the same as the same answer produced independently. When the tutor's preceding turns supplied concepts, reasoning, vocabulary or sentence frames that reappear in the response, attribute them to the tutor, not the student.

For EVERY response you are given, first classify the assistance immediately before it (scaffold_level):
S0 no assistance; S1 motivational or retrieval prompt, no content ("what do you remember?"); S2 strategic prompt directing attention, no answer content; S3 conceptual hint naming a relevant concept or strategy; S4 partial solution carrying a significant share of the reasoning; S5 worked answer — the tutor supplied the substantive reasoning or final response.

Then score these dimensions, each 0-4, or null when this response gives no evidence for the dimension (null is NOT a zero — a short factual answer may simply not exercise organization):
- retrieval: how much relevant knowledge the student pulled up themselves. 0 none/all supplied; 2 several relevant facts with gaps; 4 comprehensive, accurate, uncued.
- organization: connecting ideas vs listing them. 0 incoherent; 2 some sequence/grouping/causal links; 4 a coherent structure (hierarchy, sequence, comparison, causation).
- reasoning: what they DID with the knowledge. 0 copied; 1 bare assertion; 2 a simple reason; 3 connects principles/evidence to justify; 4 generalizes, evaluates, predicts, or draws a new inference.
- elaboration: whether added language adds intellectual content. NEVER equate word count with elaboration — repetition and filler score low.
- vocabulary: independent use of subject terms at the student's level. Precision matters more than sophistication; do not reward needlessly difficult words. Terms the tutor just supplied count less than terms the student produced unprompted.
- expression: how successfully thought became communication (clarity, sequencing, connectives, referential clarity). This is the ONLY dimension where language mechanics belong.
- independence: how much of the cognitive content originated with the student given the assistance above. 0 reproduces supplied content; 2 meaningful additional reasoning on heavy scaffolding; 4 substantive response with no meaningful content supplied beforehand.
- metacognition: monitoring their own thinking. 1 bare (un)certainty; 2 names an uncertainty/error/gap; 3 explains why an answer may be wrong or revises from evidence; 4 evaluates and independently repairs their own reasoning.

RULES.
- Grammar, spelling and accent NEVER lower any dimension except expression, and even expression is about communication, not correctness cosmetics. Strong reasoning in broken sentences is strong reasoning.
- Normalize every judgment to the student's grade band, the subject, and the response modality given in the context. A short, mathematically precise explanation is not weaker than a long humanities paragraph.
- Evidence over vibes: for each dimension you score, quote 3-12 words from the response (or the tutor's preceding turn, for independence) that ground the score.
- signals: count what is countable in the response — words, relevant propositions, subject terms used, causal links, comparisons, conditionals, examples, self-corrections, and hints_before (tutor turns since the student's last substantive attempt).
- note: ONE sentence a teacher reads about this response — what the thinking showed, in plain language, naming any confusion precisely (e.g. "confuses the term for the concept with the term for its opposite"). Never a percentage, never generic praise.
- narrative: across everything you have seen of this student on this lesson (including the earlier scored work in the context), write 2-4 sentences for the teacher: what they now understand, what they confuse or lean on the tutor for, whether their independence is rising or falling, and ONE concrete next move (e.g. "ready to progress after one more retrieval-practice pass without hints"). No scores, no percentages, no filler.

Return ONLY JSON:
{"turns":[{"turn_id":string,"scaffold_level":0-5,"dims":{"retrieval":int|null,"organization":int|null,"reasoning":int|null,"elaboration":int|null,"vocabulary":int|null,"expression":int|null,"independence":int|null,"metacognition":int|null},"evidence":{"<dimension>":"short quote",...,"ai_supplied":string,"student_originated":string},"signals":{"words":int,"propositions":int,"subject_terms":int,"causal_links":int,"comparisons":int,"conditionals":int,"examples":int,"self_corrections":int,"hints_before":int},"note":string}],"narrative":string}`;

function scorerModel(): string {
  return (
    Deno.env.get("ANTHROPIC_MODEL_SCORER")?.trim() ||
    Deno.env.get("ANTHROPIC_MODEL_AUTHORING")?.trim() ||
    "claude-opus-5"
  );
}

async function callJudge(userPrompt: string, timeoutMs: number): Promise<DbRow> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Scoring is not configured (ANTHROPIC_API_KEY missing).");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: scorerModel(),
        max_tokens: 16000,
        // No sampling params: current Claude models reject temperature (the live chat
        // function documents the same rule). Found by the R90 live probe, not review.
        system: `${JUDGE_SYSTEM}\n\nReply with a single JSON object and nothing else. No prose, no code fences.`,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch (err) {
    throw new Error(
      (err as Error)?.name === "AbortError"
        ? "Scoring took too long. Try again."
        : "Scoring model request failed.",
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json();
  if (!res.ok) {
    const message =
      data && typeof data === "object" && data.error && typeof data.error === "object"
        ? String((data.error as DbRow).message || "Scoring model request failed.")
        : "Scoring model request failed.";
    throw new Error(message);
  }
  // Truncation is the one failure that LOOKS like a bad model: the JSON is perfect
  // right up to where it stops. Name it, so a run log reads as a budget problem
  // rather than a mystery.
  if (cleanText(data?.stop_reason) === "max_tokens") {
    throw new Error("Scoring ran past its output budget on this lesson. Try again.");
  }
  const parts = Array.isArray(data?.content) ? data.content : [];
  const text = parts
    .filter((part: DbRow) => part && part.type === "text")
    .map((part: DbRow) => String(part.text || ""))
    .join("");
  try {
    const parsed = JSON.parse(extractJsonObject(text));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as DbRow) : {};
  } catch (error) {
    // "invalid JSON" on its own bought a wrong diagnosis and a wasted deploy. These
    // four facts separate the real causes — an empty reply (blocks=0), a refusal
    // (stop=refusal), a prose preamble (json=false), a broken string (the parser's
    // own complaint) — and none of them is student text: the parser's message is cut
    // at the first comma, which is exactly where V8 starts quoting the document back.
    throw new Error(`${UNPARSEABLE} ${judgeShape(data, parts, text, error)} Try again.`);
  }
}

// R92: the judge is INTERMITTENTLY unparseable. One pair failed the first two
// scheduled ticks and then scored cleanly on the third from byte-identical input —
// so the cause was never transcript size (that was the first, wrong theory, and a
// bigger output budget did not fix it); the reply is simply not always the JSON it
// was asked for. Without a second attempt such a pair sits in the queue failing the
// same way every fifteen minutes forever.
//
// Only an unparseable reply retries. A refusal, a budget overrun, a timeout or an
// API error would come back identically and the retry would only cost money.
async function judgeWithRetry(userPrompt: string): Promise<DbRow> {
  try {
    return await callJudge(userPrompt, JUDGE_TIMEOUT_MS);
  } catch (error) {
    if (!errorMessage(error).startsWith(UNPARSEABLE)) throw error;
    return await callJudge(
      `${userPrompt}\n\n---\n\nYour previous reply was not parseable JSON. Answer again with the single JSON object your instructions describe: the first character "{", the last character "}", and nothing before or after it.`,
      JUDGE_RETRY_TIMEOUT_MS,
    );
  }
}

// Structural facts about a reply that would not parse. Deliberately carries no
// content: counts, the stop reason, and the parser's complaint without its snippet.
function judgeShape(data: DbRow, parts: DbRow[], text: string, error: unknown): string {
  const why = String((error as Error)?.message || error).split(",")[0].slice(0, 90);
  return (
    `[stop=${cleanText(data?.stop_reason) || "?"} blocks=${parts.length} ` +
    `chars=${text.length} json=${text.trimStart().startsWith("{") || text.includes("```")} ${why}]`
  );
}

function cleanDim(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= 4 ? n : null;
}

function cleanScaffold(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 0;
}

// ---------------------------------------------------------------------------
// Profile rollup: per dimension, the median of the last (up to) 10 non-null turn
// scores — recency-weighted enough to move, robust enough not to whiplash on one
// bad afternoon. Scaffold trend = mean S-level of the earlier vs the recent half.
// ---------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function buildProfile(rows: DbRow[]): DbRow {
  const chronological = [...rows].sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || "")),
  );
  const profile: DbRow = {};
  for (const dim of DIMENSIONS) {
    const values = chronological
      .map((row) => row[dim])
      .filter((v): v is number => typeof v === "number")
      .slice(-10);
    profile[dim] = median(values);
  }
  const scaffolds = chronological
    .map((row) => Number(row.scaffold_level))
    .filter((n) => Number.isFinite(n));
  if (scaffolds.length >= 2) {
    const half = Math.floor(scaffolds.length / 2);
    const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
    profile.scaffold_earlier = Number(mean(scaffolds.slice(0, half)).toFixed(2));
    profile.scaffold_recent = Number(mean(scaffolds.slice(half)).toFixed(2));
  } else if (scaffolds.length === 1) {
    profile.scaffold_earlier = null;
    profile.scaffold_recent = scaffolds[0];
  }
  profile.turns_scored = chronological.length;
  return profile;
}

const SCORE_COLUMNS =
  "id,turn_id,session_id,lesson_id,user_id,stage,objective," +
  DIMENSIONS.join(",") +
  ",scaffold_level,evidence,signals,note,model,rubric_version,created_at";

async function storedScores(config: Config, userId: string, lessonId: string): Promise<DbRow[]> {
  return await selectAll(
    config,
    `cognition_turn_scores?user_id=eq.${enc(userId)}&lesson_id=eq.${enc(lessonId)}&rubric_version=eq.${RUBRIC_VERSION}&order=created_at.asc&select=${SCORE_COLUMNS}&limit=300`,
  );
}

async function storedProfile(config: Config, userId: string, lessonId: string): Promise<DbRow | null> {
  return await selectFirst(
    config,
    `cognition_profiles?user_id=eq.${enc(userId)}&lesson_id=eq.${enc(lessonId)}&select=*&limit=1`,
  );
}

async function lessonFraming(config: Config, userId: string, lessonId: string) {
  const [lesson, milestone, profile] = await Promise.all([
    selectFirst(config, `lessons?id=eq.${enc(lessonId)}&select=title,level,grade_band&limit=1`),
    selectFirst(
      config,
      `milestones?lesson_id=eq.${enc(lessonId)}&order=position.asc&select=objective&limit=1`,
    ),
    selectFirst(config, `profiles?id=eq.${enc(userId)}&select=grade&limit=1`),
  ]);
  return {
    title: cleanText(lesson?.title),
    level: cleanText(lesson?.grade_band) || cleanText(lesson?.level),
    objective: cleanText(milestone?.objective),
    grade: cleanText(profile?.grade),
  };
}

async function scoreLesson(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const userId = cleanText(body.user_id);
  const lessonId = cleanText(body.lesson_id);
  if (!userId || !lessonId) throw new Error("user_id and lesson_id are required.");
  await assertCanViewStudent(config, actorId, userId);
  const result = await runScoring(config, userId, lessonId);
  return json({
    status: "ok",
    scored: result.scored,
    remaining: result.remaining,
    profile: await storedProfile(config, userId, lessonId),
    turns: result.rows.slice(-50).reverse(),
  });
}

// R92: the scoring itself, with NO authorization of its own — the two callers each
// bring their own (a teacher's shared-class check, or the scheduler's key). One body
// so a swept profile and a pressed one can never be judged differently.
async function runScoring(
  config: Config,
  userId: string,
  lessonId: string,
): Promise<{ scored: number; remaining: number; rows: DbRow[] }> {
  const [turns, existing, framing] = await Promise.all([
    selectAll(
      config,
      `learning_turns?user_id=eq.${enc(userId)}&lesson_id=eq.${enc(lessonId)}&order=created_at.asc&select=id,session_id,role,stage,content,payload,created_at&limit=400`,
    ),
    storedScores(config, userId, lessonId),
    lessonFraming(config, userId, lessonId),
  ]);

  const scoredTurnIds = new Set(existing.map((row) => cleanText(row.turn_id)));
  const candidates: Array<{ turn: DbRow; index: number }> = [];
  turns.forEach((turn, index) => {
    if (cleanText(turn.role) !== "student") return;
    if (scoredTurnIds.has(cleanText(turn.id))) return;
    if (!isConstructedResponse(turn)) return;
    candidates.push({ turn, index });
  });

  const batch = candidates.slice(0, MAX_SCORED_PER_CALL);
  const remaining = candidates.length - batch.length;
  // Nothing new to judge — the caller still gets the stored truth back.
  if (!batch.length) return { scored: 0, remaining: 0, rows: existing };

  // The judge sees, per response: which tutor turns came immediately before it
  // (the §1 context), then the response itself. Plus the lesson framing and a
  // recap of already-scored work so the narrative covers the whole run.
  const sections: string[] = [];
  sections.push(
    `LESSON: ${framing.title || lessonId}` +
      (framing.level ? ` (level: ${framing.level})` : "") +
      (framing.grade ? `\nSTUDENT GRADE: ${framing.grade}` : "") +
      (framing.objective ? `\nOBJECTIVE: ${framing.objective}` : ""),
  );
  if (existing.length) {
    const recap = existing
      .slice(-8)
      .map((row) => `- ${cleanText(row.note) || "(scored, no note)"}`)
      .join("\n");
    sections.push(`EARLIER SCORED WORK ON THIS LESSON (for the narrative):\n${recap}`);
  }
  for (const { turn, index } of batch) {
    const before: string[] = [];
    let hintsBefore = 0;
    for (let i = index - 1; i >= 0 && before.length < 3; i--) {
      const prev = turns[i];
      const role = cleanText(prev.role);
      if (role === "student" && isConstructedResponse(prev)) break;
      if (role === "mentor") {
        before.unshift(`TUTOR: ${clampText(mentorText(prev), 700)}`);
        hintsBefore += 1;
      }
    }
    const modality =
      turn.payload && typeof turn.payload === "object"
        ? cleanText((turn.payload as DbRow).input_modality)
        : "";
    sections.push(
      `RESPONSE turn_id=${cleanText(turn.id)}` +
        (cleanText(turn.stage) ? ` stage=${cleanText(turn.stage)}` : "") +
        (modality ? ` modality=${modality}` : "") +
        ` tutor_turns_since_last_attempt=${hintsBefore}\n` +
        (before.length ? `${before.join("\n")}\n` : "(no tutor turn before this — S0)\n") +
        `STUDENT: ${clampText(studentText(turn), 1600)}`,
    );
  }

  const verdict = await judgeWithRetry(sections.join("\n\n---\n\n"));
  const judged = Array.isArray(verdict.turns) ? (verdict.turns as DbRow[]) : [];
  const byTurnId = new Map(judged.map((row) => [cleanText(row.turn_id), row]));

  const now = new Date().toISOString();
  const model = scorerModel();
  const inserts: DbRow[] = [];
  for (const { turn } of batch) {
    const row = byTurnId.get(cleanText(turn.id));
    if (!row) continue;
    const dims = row.dims && typeof row.dims === "object" ? (row.dims as DbRow) : {};
    const insert: DbRow = {
      turn_id: cleanText(turn.id),
      session_id: cleanText(turn.session_id),
      user_id: userId,
      lesson_id: lessonId,
      stage: cleanText(turn.stage) || null,
      objective: framing.objective,
      scaffold_level: cleanScaffold(row.scaffold_level),
      evidence:
        row.evidence && typeof row.evidence === "object" ? (row.evidence as DbRow) : {},
      signals: row.signals && typeof row.signals === "object" ? (row.signals as DbRow) : {},
      note: clampText(cleanText(row.note), 400),
      model,
      rubric_version: RUBRIC_VERSION,
      created_at: now,
    };
    for (const dim of DIMENSIONS) insert[dim] = cleanDim(dims[dim]);
    inserts.push(insert);
  }
  if (!inserts.length) throw new Error("The scoring model returned nothing usable. Try again.");

  await serviceFetch(config, "/rest/v1/cognition_turn_scores?on_conflict=turn_id,rubric_version", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(inserts),
  });

  const allRows = await storedScores(config, userId, lessonId);
  const profile = buildProfile(allRows);
  profile.user_id = userId;
  profile.lesson_id = lessonId;
  profile.narrative = clampText(cleanText(verdict.narrative), 1200);
  profile.model = model;
  profile.rubric_version = RUBRIC_VERSION;
  profile.updated_at = now;
  await serviceFetch(config, "/rest/v1/cognition_profiles?on_conflict=user_id,lesson_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(profile),
  });

  return { scored: inserts.length, remaining, rows: allRows };
}

// R92: the run log, opened at the start and closed at the end (see sweep). Both
// halves swallow their own failures — a scheduler that fell over because its own
// bookkeeping failed would be worse than one that lost a row.
async function openRunLog(config: Config, startedAt: number): Promise<string> {
  const rows = await serviceFetch(config, "/rest/v1/cognition_sweep_runs?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ started_at: new Date(startedAt).toISOString() }),
  }).catch(() => null);
  const row = Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? (rows[0] as DbRow) : null;
  return cleanText(row?.id);
}

async function closeRunLog(config: Config, runId: string, counts: DbRow): Promise<void> {
  if (!runId) return;
  await serviceFetch(config, `/rest/v1/cognition_sweep_runs?id=eq.${enc(runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...counts, finished_at: new Date().toISOString() }),
  }).catch(() => {});
}

// R92: one scheduled tick. Takes the pairs with the most waiting work, scores them
// through the SAME runScoring the teacher button uses, and logs counts. It returns
// counts only — never a student's words — because the caller is a cron job, not a
// person with a right to read them.
async function sweep(config: Config, body: DbRow): Promise<Response> {
  const startedAt = Date.now();
  const requested = Number(body.limit);
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(SWEEP_BATCH_MAX, Math.round(requested)))
    : SWEEP_BATCH_DEFAULT;

  // The log row is opened BEFORE any scoring and patched when the run ends, so a
  // tick the gateway kills mid-flight still leaves a row — one with no finished_at.
  // "Started and never came back" is a fact worth having; silence is not.
  const runId = await openRunLog(config, startedAt);

  const queue = await selectAll(
    config,
    `cognition_sweep_queue?order=last_activity.desc&limit=${limit}&select=user_id,lesson_id,unscored`,
  );

  let pairsScored = 0;
  let responsesScored = 0;
  let errors = 0;
  let slowestPairMs = 0;
  const detail: DbRow[] = [];
  for (const row of queue) {
    // Only start another pair if there is room for one as expensive as the priciest
    // so far. A fixed cut-off cannot know whether the last pair took forty seconds
    // or needed a retry; this does.
    if (Date.now() - startedAt + slowestPairMs > SWEEP_BUDGET_MS) break;
    const userId = cleanText(row.user_id);
    const lessonId = cleanText(row.lesson_id);
    if (!userId || !lessonId) continue;
    const pairStartedAt = Date.now();
    try {
      const result = await runScoring(config, userId, lessonId);
      if (result.scored > 0) pairsScored += 1;
      responsesScored += result.scored;
      detail.push({ lesson_id: lessonId, scored: result.scored, remaining: result.remaining });
    } catch (error) {
      // One bad pair must never end the run — the rest of the queue is still work.
      errors += 1;
      detail.push({ lesson_id: lessonId, error: clampText(errorMessage(error), 200) });
    }
    slowestPairMs = Math.max(slowestPairMs, Date.now() - pairStartedAt);
  }

  await closeRunLog(config, runId, {
    pairs_seen: queue.length,
    pairs_scored: pairsScored,
    responses_scored: responsesScored,
    errors,
    detail: { pairs: detail.slice(0, 20) },
  });

  return json({
    status: "ok",
    pairs_seen: queue.length,
    pairs_scored: pairsScored,
    responses_scored: responsesScored,
    errors,
    took_ms: Date.now() - startedAt,
  });
}

async function readProfile(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const userId = cleanText(body.user_id);
  const lessonId = cleanText(body.lesson_id);
  if (!userId || !lessonId) throw new Error("user_id and lesson_id are required.");
  await assertCanViewStudent(config, actorId, userId);
  const [profile, rows] = await Promise.all([
    storedProfile(config, userId, lessonId),
    storedScores(config, userId, lessonId),
  ]);
  return json({ status: "ok", profile, turns: rows.slice(-50).reverse() });
}

// Which lessons have anything to say for this student — the console's entry list.
async function listLessons(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const userId = cleanText(body.user_id);
  if (!userId) throw new Error("user_id is required.");
  await assertCanViewStudent(config, actorId, userId);
  const [profiles, sessions] = await Promise.all([
    selectAll(
      config,
      `cognition_profiles?user_id=eq.${enc(userId)}&order=updated_at.desc&select=lesson_id,narrative,turns_scored,updated_at&limit=50`,
    ),
    selectAll(
      config,
      `learning_sessions?user_id=eq.${enc(userId)}&order=updated_at.desc&select=lesson_id,updated_at&limit=50`,
    ),
  ]);
  const seen = new Set<string>();
  const lessons: DbRow[] = [];
  for (const row of [...profiles, ...sessions]) {
    const lessonId = cleanText(row.lesson_id);
    if (!lessonId || seen.has(lessonId)) continue;
    seen.add(lessonId);
    lessons.push({
      lesson_id: lessonId,
      turns_scored: Number(row.turns_scored) || 0,
      updated_at: row.updated_at || null,
    });
  }
  return json({ status: "ok", lessons: lessons.slice(0, 30) });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

  let config: Config;
  try {
    config = envConfig(req);
  } catch (error) {
    const status = errorMessage(error).includes("Authentication") ? 401 : 500;
    return errorResponse(errorMessage(error), status);
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Request body must be a JSON object.", 400);
    }
    const record = body as DbRow;
    const action = cleanText(record.action);

    // R92: the scheduler is the ONLY caller with no user, and it may do exactly one
    // thing — sweep. Every other action still resolves a real person first.
    if (action === "sweep") {
      if (!(await isSweepCaller(config, req))) {
        return errorResponse("Access to this student's work is required.", 403);
      }
      return await sweep(config, record);
    }

    const actor = await fetchCurrentUser(config);
    const actorId = String(actor.id);
    if (action === "score_lesson") return await scoreLesson(config, actorId, record);
    if (action === "profile") return await readProfile(config, actorId, record);
    if (action === "list_lessons") return await listLessons(config, actorId, record);
    return errorResponse("Unsupported cognition-scorer action.", 400);
  } catch (error) {
    const message = errorMessage(error);
    const lower = message.toLowerCase();
    const status = lower.includes("access") || lower.includes("forbidden")
      ? 403
      : lower.includes("authentication") || lower.includes("authenticated")
        ? 401
        : lower.includes("required") ||
            lower.includes("unsupported") ||
            lower.includes("try again")
          ? 400
          : 500;
    return errorResponse(message, status);
  }
});
