// Full lesson assessment orchestration.
// Chat mini-quizzes keep using quiz_attempts; this function manages teacher-assigned
// multi-item assessments and writes final evidence/mastery after grading.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbRow = Record<string, unknown>;
type QuestionType = "multiple_choice" | "text" | "code";
type AnswerMode = "text" | "code" | "multiple_choice" | "file";

type Config = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  authorization: string;
};

type AssessmentItemInput = {
  quiz_item_id?: string;
  prompt?: string;
  question_type?: QuestionType;
  choices?: Array<{ id: string; text: string }>;
  correct_choice_ids?: string[];
  rubric?: DbRow;
  skill_keys?: string[];
  points?: number;
  required?: boolean;
};

type AssessmentAnswer = {
  assessment_item_id?: string;
  answer_mode?: AnswerMode;
  answer_text?: string;
  answer_code?: string;
  choice_id?: string;
  run_result?: DbRow | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function cleanId(value: unknown): string {
  return cleanText(value);
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => cleanText(item)).filter(Boolean))).slice(0, 32);
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function idFilter(ids: string[]): string {
  return `in.(${ids.map((id) => encodeURIComponent(id)).join(",")})`;
}

async function userFetch(config: Config, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.anonKey);
  headers.set("Authorization", config.authorization);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.url}${path}`, { ...init, headers });
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

async function serviceFetch(config: Config, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.url}${path}`, { ...init, headers });
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

async function fetchCurrentUser(config: Config): Promise<DbRow> {
  const data = await userFetch(config, "/auth/v1/user");
  if (!data || typeof data !== "object" || typeof (data as DbRow).id !== "string") {
    throw new Error("Could not identify authenticated user.");
  }
  return data as DbRow;
}

async function loadRows(config: Config, path: string): Promise<DbRow[]> {
  const data = await serviceFetch(config, `/rest/v1/${path}`);
  return Array.isArray(data) ? (data.filter((row) => row && typeof row === "object") as DbRow[]) : [];
}

async function loadFirst(config: Config, path: string): Promise<DbRow | null> {
  return (await loadRows(config, path))[0] || null;
}

async function insertRow(config: Config, table: string, row: DbRow): Promise<DbRow> {
  const data = await serviceFetch(config, `/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
    throw new Error(`Insert into ${table} returned no row.`);
  }
  return data[0] as DbRow;
}

async function upsertRows(config: Config, table: string, conflict: string, rows: DbRow[]): Promise<DbRow[]> {
  if (!rows.length) return [];
  const conflictParam = conflict
    .split(",")
    .map((part) => encodeURIComponent(part.trim()))
    .join(",");
  const data = await serviceFetch(config, `/rest/v1/${table}?on_conflict=${conflictParam}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
  return Array.isArray(data) ? (data.filter((row) => row && typeof row === "object") as DbRow[]) : [];
}

async function patchRows(config: Config, path: string, row: DbRow): Promise<DbRow[]> {
  const data = await serviceFetch(config, `/rest/v1/${path}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return Array.isArray(data) ? (data.filter((item) => item && typeof item === "object") as DbRow[]) : [];
}

async function fetchActorCanManageClass(
  config: Config,
  userId: string,
  classId: string,
  organizationId?: string,
): Promise<boolean> {
  const platform = await loadFirst(
    config,
    `platform_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`,
  );
  if (platform) return true;

  const classRow = classId
    ? await loadFirst(
        config,
        `classes?id=eq.${encodeURIComponent(classId)}&select=id,organization_id&limit=1`,
      )
    : null;
  const orgId = cleanId(organizationId) || cleanId(classRow?.organization_id);
  if (orgId) {
    const orgAdmin = await loadFirst(
      config,
      `organization_memberships?organization_id=eq.${encodeURIComponent(orgId)}&user_id=eq.${encodeURIComponent(userId)}&role=eq.org_admin&status=eq.active&select=id&limit=1`,
    );
    if (orgAdmin) return true;
  }

  if (!classId) return false;
  const teacher = await loadFirst(
    config,
    `class_memberships?class_id=eq.${encodeURIComponent(classId)}&user_id=eq.${encodeURIComponent(userId)}&role=eq.teacher&status=eq.active&select=id&limit=1`,
  );
  return Boolean(teacher);
}

async function requireAssessment(config: Config, assessmentId: string): Promise<DbRow> {
  const assessment = await loadFirst(
    config,
    `assessments?id=eq.${encodeURIComponent(assessmentId)}&select=*`,
  );
  if (!assessment) throw new Error("Assessment not found.");
  return assessment;
}

async function requireManageAssessment(
  config: Config,
  userId: string,
  assessmentId: string,
): Promise<DbRow> {
  const assessment = await requireAssessment(config, assessmentId);
  const canManage = await fetchActorCanManageClass(
    config,
    userId,
    cleanId(assessment.class_id),
    cleanId(assessment.organization_id),
  );
  if (!canManage && cleanId(assessment.created_by) !== userId) {
    throw new Error("Assessment management access is required.");
  }
  return assessment;
}

function normalizeQuestionType(value: unknown): QuestionType {
  const clean = cleanText(value);
  if (clean === "text" || clean === "code" || clean === "multiple_choice") return clean;
  return "multiple_choice";
}

function normalizeAnswerMode(value: unknown, questionType: QuestionType): AnswerMode {
  const clean = cleanText(value);
  if (clean === "text" || clean === "code" || clean === "multiple_choice" || clean === "file") return clean;
  if (questionType === "multiple_choice") return "multiple_choice";
  if (questionType === "code") return "code";
  return "text";
}

function normalizeChoices(value: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((choice, index) => {
      if (!choice || typeof choice !== "object") return null;
      const row = choice as DbRow;
      const id = cleanId(row.id) || `choice-${index + 1}`;
      const text = cleanText(row.text || row.label || row.value);
      return text ? { id, text } : null;
    })
    .filter(Boolean)
    .slice(0, 12) as Array<{ id: string; text: string }>;
}

async function createAssessment(config: Config, userId: string, body: DbRow): Promise<Response> {
  const organizationId = cleanId(body.organization_id);
  const classId = cleanId(body.class_id);
  const lessonId = cleanId(body.lesson_id);
  if (!classId || !lessonId) throw new Error("class_id and lesson_id are required.");
  const canManage = await fetchActorCanManageClass(config, userId, classId, organizationId);
  if (!canManage) throw new Error("Class teacher or admin access is required.");

  const title = cleanText(body.title);
  if (!title) throw new Error("Assessment title is required.");
  const status = cleanText(body.status, "draft") === "published" ? "published" : "draft";
  const gradingMode = ["auto", "teacher", "mixed"].includes(cleanText(body.grading_mode))
    ? cleanText(body.grading_mode)
    : "mixed";
  const releasePolicy = ["immediate", "after_review", "manual"].includes(cleanText(body.result_release_policy))
    ? cleanText(body.result_release_policy)
    : "after_review";
  const attemptLimit = Math.max(1, Math.min(10, Math.floor(numberValue(body.attempt_limit, 1))));
  const rawItems = Array.isArray(body.items) ? (body.items as AssessmentItemInput[]) : [];
  if (!rawItems.length) throw new Error("Add at least one assessment question.");
  const recipientIds = cleanStringArray(body.recipient_ids);
  if (!recipientIds.length) throw new Error("Assign the assessment to at least one student.");
  for (const raw of rawItems) {
    if (cleanId(raw.quiz_item_id)) continue;
    const questionType = normalizeQuestionType(raw.question_type);
    if (!cleanText(raw.prompt)) throw new Error("Each new question needs a prompt.");
    if (questionType === "multiple_choice") {
      const choices = normalizeChoices(raw.choices);
      const correctChoiceIds = cleanStringArray(raw.correct_choice_ids);
      if (choices.length < 2 || !correctChoiceIds.length) {
        throw new Error("Multiple-choice questions need at least two choices and a correct answer.");
      }
    }
  }

  const assessment = await insertRow(config, "assessments", {
    organization_id: organizationId || null,
    class_id: classId,
    lesson_id: lessonId,
    title,
    instructions: cleanText(body.instructions),
    created_by: userId,
    status,
    grading_mode: gradingMode,
    result_release_policy: releasePolicy,
    attempt_limit: attemptLimit,
    required: body.required === true,
    due_at: cleanText(body.due_at) || null,
  });
  const assessmentId = cleanId(assessment.id);
  const itemRows: DbRow[] = [];

  for (const [index, raw] of rawItems.entries()) {
    const existingQuizId = cleanId(raw.quiz_item_id);
    let quizItemId = existingQuizId;
    if (!quizItemId) {
      const questionType = normalizeQuestionType(raw.question_type);
      const prompt = cleanText(raw.prompt);
      if (!prompt) throw new Error("Each new question needs a prompt.");
      const choices = normalizeChoices(raw.choices);
      const correctChoiceIds = cleanStringArray(raw.correct_choice_ids);
      if (questionType === "multiple_choice" && (!choices.length || !correctChoiceIds.length)) {
        throw new Error("Multiple-choice questions need choices and a correct answer.");
      }
      quizItemId = `${assessmentId}-q-${index + 1}`;
      await insertRow(config, "quiz_items", {
        id: quizItemId,
        lesson_id: lessonId,
        milestone_id: null,
        activity_id: null,
        position: 10_000 + index,
        prompt,
        question_type: questionType,
        choices,
        correct_choice_ids: correctChoiceIds,
        rubric: raw.rubric && typeof raw.rubric === "object" && !Array.isArray(raw.rubric)
          ? raw.rubric as DbRow
          : {},
        skill_keys: cleanStringArray(raw.skill_keys),
        status: "published",
      });
    }
    itemRows.push({
      assessment_id: assessmentId,
      quiz_item_id: quizItemId,
      position: index + 1,
      points: Math.max(0.1, numberValue(raw.points, 1)),
      required: raw.required !== false,
      rubric_override:
        raw.rubric && typeof raw.rubric === "object" && !Array.isArray(raw.rubric)
          ? raw.rubric as DbRow
          : {},
    });
  }

  const items = await upsertRows(config, "assessment_items", "assessment_id,quiz_item_id", itemRows);
  const recipients = await upsertRows(
    config,
    "assessment_recipients",
    "assessment_id,user_id",
    recipientIds.map((studentId) => ({
      assessment_id: assessmentId,
      user_id: studentId,
      status: "assigned",
    })),
  );

  return json({ status: "ok", data: { assessment, items, recipients } });
}

async function setAssessmentStatus(config: Config, userId: string, body: DbRow): Promise<Response> {
  const assessmentId = cleanId(body.assessment_id);
  const status = cleanText(body.status);
  if (!["draft", "published", "archived"].includes(status)) throw new Error("Invalid assessment status.");
  await requireManageAssessment(config, userId, assessmentId);
  const [assessment] = await patchRows(
    config,
    `assessments?id=eq.${encodeURIComponent(assessmentId)}`,
    { status, updated_at: new Date().toISOString() },
  );
  return json({ status: "ok", data: { assessment } });
}

async function loadAssessmentBundle(config: Config, assessmentId: string): Promise<{
  assessment: DbRow;
  items: DbRow[];
  quizzes: DbRow[];
}> {
  const assessment = await requireAssessment(config, assessmentId);
  const items = await loadRows(
    config,
    `assessment_items?assessment_id=eq.${encodeURIComponent(assessmentId)}&select=*&order=position.asc`,
  );
  const quizIds = items.map((item) => cleanId(item.quiz_item_id)).filter(Boolean);
  const quizzes = quizIds.length
    ? await loadRows(config, `quiz_items?id=${idFilter(quizIds)}&select=*`)
    : [];
  return { assessment, items, quizzes };
}

async function startAssessment(config: Config, userId: string, body: DbRow): Promise<Response> {
  const assessmentId = cleanId(body.assessment_id);
  const { assessment, items, quizzes } = await loadAssessmentBundle(config, assessmentId);
  if (assessment.status !== "published") throw new Error("This assessment is not published.");

  const recipient = await loadFirst(
    config,
    `assessment_recipients?assessment_id=eq.${encodeURIComponent(assessmentId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  );
  if (!recipient) throw new Error("This assessment is not assigned to you.");

  const attempts = await loadRows(
    config,
    `assessment_attempts?assessment_id=eq.${encodeURIComponent(assessmentId)}&user_id=eq.${encodeURIComponent(userId)}&select=*&order=attempt_number.desc`,
  );
  const inProgress = attempts.find((attempt) => attempt.status === "in_progress");
  const attemptLimit = Math.max(1, numberValue(assessment.attempt_limit, 1));
  if (!inProgress && attempts.length >= attemptLimit) {
    throw new Error("No attempts remain for this assessment.");
  }
  const now = new Date().toISOString();
  const attempt = inProgress || await insertRow(config, "assessment_attempts", {
    assessment_id: assessmentId,
    recipient_id: cleanId(recipient.id),
    user_id: userId,
    attempt_number: attempts.length + 1,
    status: "in_progress",
    started_at: now,
  });
  await patchRows(
    config,
    `assessment_recipients?id=eq.${encodeURIComponent(cleanId(recipient.id))}`,
    { status: "started", started_at: recipient.started_at || now, updated_at: now },
  );
  return json({ status: "ok", data: { assessment, items, quizzes, attempt } });
}

function quizById(quizzes: DbRow[]): Map<string, DbRow> {
  return new Map(quizzes.map((quiz) => [cleanId(quiz.id), quiz]));
}

function scoreMultipleChoice(quiz: DbRow, choiceId: string): { score: number; passed: boolean; feedback: string } {
  const correct = cleanStringArray(quiz.correct_choice_ids);
  const passed = Boolean(choiceId && correct.includes(choiceId));
  return {
    score: passed ? 1 : 0,
    passed,
    feedback: passed ? "Correct." : "Not quite. Review the question and try the reasoning again.",
  };
}

async function submitAssessment(config: Config, userId: string, body: DbRow): Promise<Response> {
  const attemptId = cleanId(body.attempt_id);
  const attempt = await loadFirst(
    config,
    `assessment_attempts?id=eq.${encodeURIComponent(attemptId)}&select=*`,
  );
  if (!attempt || cleanId(attempt.user_id) !== userId) throw new Error("Assessment attempt not found.");
  if (attempt.status !== "in_progress") throw new Error("This assessment attempt is already submitted.");

  const assessmentId = cleanId(attempt.assessment_id);
  const { assessment, items, quizzes } = await loadAssessmentBundle(config, assessmentId);
  const quizzesById = quizById(quizzes);
  const answers = Array.isArray(body.answers) ? (body.answers as AssessmentAnswer[]) : [];
  const answerByItemId = new Map(answers.map((answer) => [cleanId(answer.assessment_item_id), answer]));
  const now = new Date().toISOString();

  const itemAttempts: DbRow[] = [];
  let earnedPoints = 0;
  let totalPoints = 0;
  let hasPendingReview = false;

  for (const item of items) {
    const itemId = cleanId(item.id);
    const quiz = quizzesById.get(cleanId(item.quiz_item_id));
    if (!quiz) continue;
    const answer = answerByItemId.get(itemId) || {};
    const questionType = normalizeQuestionType(quiz.question_type);
    const answerMode = normalizeAnswerMode(answer.answer_mode, questionType);
    const maxScore = Math.max(0.1, numberValue(item.points, 1));
    totalPoints += maxScore;

    let score: number | null = null;
    let passed: boolean | null = null;
    let feedback = "";
    let reviewState = "pending_review";
    let gradedBy = "system";

    if (questionType === "multiple_choice") {
      const scored = scoreMultipleChoice(quiz, cleanId(answer.choice_id));
      score = scored.score * maxScore;
      passed = scored.passed;
      feedback = scored.feedback;
      reviewState = "auto_graded";
      gradedBy = "system";
      earnedPoints += score;
    } else {
      hasPendingReview = true;
    }

    itemAttempts.push({
      assessment_attempt_id: attemptId,
      assessment_item_id: itemId,
      quiz_item_id: cleanId(quiz.id),
      user_id: userId,
      answer_mode: answerMode,
      answer_text: cleanText(answer.answer_text) || null,
      answer_code: cleanText(answer.answer_code) || null,
      choice_id: cleanText(answer.choice_id) || null,
      run_result: answer.run_result || null,
      score,
      max_score: maxScore,
      passed,
      feedback,
      review_state: reviewState,
      graded_by: gradedBy,
      updated_at: now,
    });
  }

  await upsertRows(
    config,
    "assessment_item_attempts",
    "assessment_attempt_id,assessment_item_id",
    itemAttempts,
  );

  const autoScore = totalPoints ? clamp01(earnedPoints / totalPoints) : null;
  const nextAttemptPatch: DbRow = {
    status: hasPendingReview ? "submitted" : "returned",
    auto_score: autoScore,
    final_score: hasPendingReview ? null : autoScore,
    submitted_at: now,
    updated_at: now,
  };
  if (!hasPendingReview) {
    nextAttemptPatch.graded_at = now;
    nextAttemptPatch.returned_at = now;
    nextAttemptPatch.feedback = autoScore !== null && autoScore >= 0.7 ? "Assessment passed." : "Review the feedback and try again if your teacher asks.";
  }
  const [updatedAttempt] = await patchRows(
    config,
    `assessment_attempts?id=eq.${encodeURIComponent(attemptId)}`,
    nextAttemptPatch,
  );

  const recipientId = cleanId(attempt.recipient_id);
  if (recipientId) {
    await patchRows(
      config,
      `assessment_recipients?id=eq.${encodeURIComponent(recipientId)}`,
      hasPendingReview
        ? { status: "submitted", submitted_at: now, updated_at: now }
        : {
            status: "complete",
            final_score: autoScore,
            feedback: nextAttemptPatch.feedback,
            submitted_at: now,
            returned_at: now,
            completed_at: now,
            updated_at: now,
          },
    );
  }

  if (!hasPendingReview && typeof autoScore === "number") {
    await writeEvidenceAndMastery(config, userId, assessment, updatedAttempt || attempt, itemAttempts, quizzes, autoScore, cleanText(nextAttemptPatch.feedback));
  }

  return json({ status: "ok", data: { assessment, attempt: updatedAttempt, item_attempts: itemAttempts } });
}

async function reviewAssessmentItem(config: Config, userId: string, body: DbRow): Promise<Response> {
  const itemAttemptId = cleanId(body.item_attempt_id);
  const itemAttempt = await loadFirst(
    config,
    `assessment_item_attempts?id=eq.${encodeURIComponent(itemAttemptId)}&select=*`,
  );
  if (!itemAttempt) throw new Error("Assessment item attempt not found.");
  const attempt = await loadFirst(
    config,
    `assessment_attempts?id=eq.${encodeURIComponent(cleanId(itemAttempt.assessment_attempt_id))}&select=*`,
  );
  if (!attempt) throw new Error("Assessment attempt not found.");
  await requireManageAssessment(config, userId, cleanId(attempt.assessment_id));

  const maxScore = Math.max(0.1, numberValue(itemAttempt.max_score, 1));
  const scorePercent = Math.max(0, Math.min(100, numberValue(body.score_percent, 0)));
  const score = (scorePercent / 100) * maxScore;
  const [updated] = await patchRows(
    config,
    `assessment_item_attempts?id=eq.${encodeURIComponent(itemAttemptId)}`,
    {
      score,
      passed: scorePercent >= 70,
      feedback: cleanText(body.feedback),
      review_state: "reviewed",
      graded_by: "teacher",
      updated_at: new Date().toISOString(),
    },
  );
  return json({ status: "ok", data: { item_attempt: updated } });
}

async function returnAssessment(config: Config, userId: string, body: DbRow): Promise<Response> {
  const attemptId = cleanId(body.attempt_id);
  const attempt = await loadFirst(
    config,
    `assessment_attempts?id=eq.${encodeURIComponent(attemptId)}&select=*`,
  );
  if (!attempt) throw new Error("Assessment attempt not found.");
  const assessment = await requireManageAssessment(config, userId, cleanId(attempt.assessment_id));
  const itemAttempts = await loadRows(
    config,
    `assessment_item_attempts?assessment_attempt_id=eq.${encodeURIComponent(attemptId)}&select=*`,
  );
  if (!itemAttempts.length) throw new Error("No item attempts were submitted.");
  const pending = itemAttempts.filter((item) => item.review_state === "pending_review");
  if (pending.length) throw new Error("Review all text/code questions before returning results.");

  const total = itemAttempts.reduce((sum, item) => sum + Math.max(0.1, numberValue(item.max_score, 1)), 0);
  const earned = itemAttempts.reduce((sum, item) => sum + numberValue(item.score, 0), 0);
  const finalScore = total ? clamp01(earned / total) : 0;
  const feedback = cleanText(body.feedback) || (finalScore >= 0.7 ? "Assessment complete." : "Review the feedback and keep practicing.");
  const now = new Date().toISOString();

  const [updatedAttempt] = await patchRows(
    config,
    `assessment_attempts?id=eq.${encodeURIComponent(attemptId)}`,
    {
      status: "returned",
      teacher_score: finalScore,
      final_score: finalScore,
      feedback,
      graded_at: now,
      returned_at: now,
      updated_at: now,
    },
  );
  const recipientId = cleanId(attempt.recipient_id);
  if (recipientId) {
    await patchRows(config, `assessment_recipients?id=eq.${encodeURIComponent(recipientId)}`, {
      status: "complete",
      final_score: finalScore,
      feedback,
      returned_at: now,
      completed_at: now,
      updated_at: now,
    });
  }

  const quizIds = itemAttempts.map((item) => cleanId(item.quiz_item_id)).filter(Boolean);
  const quizzes = quizIds.length ? await loadRows(config, `quiz_items?id=${idFilter(quizIds)}&select=*`) : [];
  await writeEvidenceAndMastery(config, cleanId(attempt.user_id), assessment, updatedAttempt || attempt, itemAttempts, quizzes, finalScore, feedback);
  return json({ status: "ok", data: { attempt: updatedAttempt, final_score: finalScore } });
}

async function writeEvidenceAndMastery(
  config: Config,
  userId: string,
  assessment: DbRow,
  attempt: DbRow,
  itemAttempts: DbRow[],
  quizzes: DbRow[],
  finalScore: number,
  feedback: string,
): Promise<void> {
  const quizMap = quizById(quizzes);
  const skillKeys = Array.from(
    new Set(
      itemAttempts.flatMap((item) => cleanStringArray(quizMap.get(cleanId(item.quiz_item_id))?.skill_keys)),
    ),
  );
  if (!skillKeys.length) return;

  await insertRow(config, "learning_evidence", {
    user_id: userId,
    lesson_id: cleanId(assessment.lesson_id) || null,
    milestone_id: null,
    session_id: null,
    source_type: "quiz",
    source_ref: {
      assessment_id: cleanId(assessment.id),
      assessment_attempt_id: cleanId(attempt.id),
    },
    skill_keys: skillKeys,
    score: finalScore,
    confidence: finalScore >= 0.7 ? 0.85 : 0.5,
    rubric_result: {
      assessment_title: assessment.title,
      feedback,
      item_attempt_count: itemAttempts.length,
    },
    notes: feedback,
    created_by: cleanId(assessment.created_by) || null,
  });

  for (const skill of skillKeys) {
    const current = await loadFirst(
      config,
      `student_mastery?user_id=eq.${encodeURIComponent(userId)}&skill_key=eq.${encodeURIComponent(skill)}&select=*`,
    );
    const evidenceCount = numberValue(current?.evidence_count, 0);
    const attemptCount = numberValue(current?.attempt_count, 0);
    const oldScore = numberValue(current?.score, 0);
    const nextEvidenceCount = evidenceCount + 1;
    const nextScore = clamp01((oldScore * evidenceCount + finalScore) / nextEvidenceCount);
    const level = nextScore >= 0.85 ? "secure" : nextScore >= 0.55 ? "developing" : "emerging";
    const payload = {
      user_id: userId,
      skill_key: skill,
      level,
      evidence_count: nextEvidenceCount,
      attempt_count: attemptCount + 1,
      score: nextScore,
      latest_score: finalScore,
      confidence: finalScore >= 0.7 ? 0.85 : 0.5,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

  try {
    const config = envConfig(req);
    const user = await fetchCurrentUser(config);
    const userId = cleanId(user.id);
    const body = await req.json() as DbRow;
    const action = cleanText(body.action);

    if (action === "create_assessment") return await createAssessment(config, userId, body);
    if (action === "set_assessment_status") return await setAssessmentStatus(config, userId, body);
    if (action === "start_assessment") return await startAssessment(config, userId, body);
    if (action === "submit_assessment") return await submitAssessment(config, userId, body);
    if (action === "review_assessment_item") return await reviewAssessmentItem(config, userId, body);
    if (action === "return_assessment") return await returnAssessment(config, userId, body);
    return errorResponse("Unsupported assessment-admin action.", 400);
  } catch (error) {
    const message = errorMessage(error);
    const status = message.includes("Authentication") ? 401 : message.includes("access") ? 403 : 400;
    return errorResponse(message, status);
  }
});
