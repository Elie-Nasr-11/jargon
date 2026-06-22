// Jargon curriculum authoring.
// Privileged write path for teacher/admin structured lesson blueprints.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbRow = Record<string, unknown>;
type Stage = "intro" | "teach" | "practice" | "assessment" | "review";
type ResponseMode = "text" | "code" | "multiple_choice" | "file";
type LessonType = "discussion" | "code" | "reflection" | "multiple_choice" | "file";

type Config = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  authorization: string;
};

type Blueprint = {
  subject: { id?: string; title: string; description?: string };
  course: { id?: string; title: string; description?: string };
  unit: { id?: string; title: string; position: number };
  lesson: {
    id?: string;
    title: string;
    level: string;
    type: LessonType;
    tutor_prompt: string;
    sample_code?: string;
  };
  milestone: {
    title: string;
    objective: string;
    skill_keys: string[];
    allowed_response_modes: ResponseMode[];
  };
  activity: {
    title: string;
    stage: Stage;
    prompt: string;
    response_mode: ResponseMode;
    starter_code?: string;
    expected_output?: string;
    rubric?: DbRow;
  };
  quiz?: {
    prompt: string;
    choices: Array<{ id: string; text: string }>;
    correct_choice_ids: string[];
  };
  resource_ids?: string[];
};

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

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item)).filter(Boolean).slice(0, 24);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function safeId(...parts: string[]): string {
  const joined = parts.map(slugify).filter(Boolean).join("-");
  return (joined || crypto.randomUUID()).slice(0, 180);
}

function isStage(value: unknown): value is Stage {
  return ["intro", "teach", "practice", "assessment", "review"].includes(cleanText(value));
}

function isResponseMode(value: unknown): value is ResponseMode {
  return ["text", "code", "multiple_choice", "file"].includes(cleanText(value));
}

function isLessonType(value: unknown): value is LessonType {
  return ["discussion", "code", "reflection", "multiple_choice", "file"].includes(cleanText(value));
}

async function fetchJson(config: Config, path: string, init: RequestInit, serviceRole: boolean): Promise<unknown> {
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

async function upsertByConflict(config: Config, table: string, conflict: string, row: DbRow): Promise<DbRow> {
  const conflictParam = conflict
    .split(",")
    .map((part) => encodeURIComponent(part.trim()))
    .join(",");
  const data = await serviceFetch(config, `/rest/v1/${table}?on_conflict=${conflictParam}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
    throw new Error(`Upsert into ${table} returned no row.`);
  }
  return data[0] as DbRow;
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

async function patchRows(config: Config, path: string, row: DbRow): Promise<DbRow[]> {
  const data = await serviceFetch(config, `/rest/v1/${path}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return Array.isArray(data) ? data.filter((item) => item && typeof item === "object") as DbRow[] : [];
}

async function assertCanAuthor(
  config: Config,
  actorId: string,
  organizationId: string,
  classId: string,
): Promise<void> {
  const platformAdmin = await selectFirst(
    config,
    `platform_admins?user_id=eq.${encodeURIComponent(actorId)}&select=user_id&limit=1`,
  );
  if (platformAdmin) return;

  const orgAdmin = await selectFirst(
    config,
    `organization_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(actorId)}&role=eq.org_admin&status=eq.active&select=id&limit=1`,
  );
  if (orgAdmin) return;

  const orgTeacher = await selectFirst(
    config,
    `organization_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(actorId)}&role=eq.teacher&status=eq.active&select=id&limit=1`,
  );
  if (orgTeacher && !classId) return;

  if (classId) {
    const classRow = await selectFirst(
      config,
      `classes?id=eq.${encodeURIComponent(classId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=id&limit=1`,
    );
    const classTeacher = await selectFirst(
      config,
      `class_memberships?class_id=eq.${encodeURIComponent(classId)}&user_id=eq.${encodeURIComponent(actorId)}&role=eq.teacher&status=eq.active&select=id&limit=1`,
    );
    if (classRow && classTeacher) return;
  }

  throw new Error("Curriculum author access is required.");
}

async function nextLessonPosition(config: Config): Promise<number> {
  const row = await selectFirst(config, "lessons?select=position&order=position.desc&limit=1");
  const position = Number(row?.position || 0);
  return Number.isFinite(position) ? position + 1 : 1;
}

function normalizeBlueprint(raw: unknown): Blueprint {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as DbRow : {};
  const subject = input.subject && typeof input.subject === "object" ? input.subject as DbRow : {};
  const course = input.course && typeof input.course === "object" ? input.course as DbRow : {};
  const unit = input.unit && typeof input.unit === "object" ? input.unit as DbRow : {};
  const lesson = input.lesson && typeof input.lesson === "object" ? input.lesson as DbRow : {};
  const milestone = input.milestone && typeof input.milestone === "object" ? input.milestone as DbRow : {};
  const activity = input.activity && typeof input.activity === "object" ? input.activity as DbRow : {};
  const quiz = input.quiz && typeof input.quiz === "object" ? input.quiz as DbRow : null;

  const lessonType = isLessonType(lesson.type) ? lesson.type : "discussion";
  const activityStage = isStage(activity.stage) ? activity.stage : "practice";
  const activityMode = isResponseMode(activity.response_mode)
    ? activity.response_mode
    : lessonType === "code"
      ? "code"
      : lessonType === "multiple_choice"
        ? "multiple_choice"
        : "text";
  const allowedModes = cleanStringArray(milestone.allowed_response_modes)
    .filter(isResponseMode) as ResponseMode[];

  const normalized: Blueprint = {
    subject: {
      id: cleanText(subject.id) || undefined,
      title: cleanText(subject.title),
      description: cleanText(subject.description),
    },
    course: {
      id: cleanText(course.id) || undefined,
      title: cleanText(course.title),
      description: cleanText(course.description),
    },
    unit: {
      id: cleanText(unit.id) || undefined,
      title: cleanText(unit.title),
      position: Math.max(1, Math.round(Number(unit.position) || 1)),
    },
    lesson: {
      id: cleanText(lesson.id) || undefined,
      title: cleanText(lesson.title),
      level: cleanText(lesson.level, "Any level"),
      type: lessonType,
      tutor_prompt: cleanText(lesson.tutor_prompt),
      sample_code: cleanText(lesson.sample_code),
    },
    milestone: {
      title: cleanText(milestone.title),
      objective: cleanText(milestone.objective),
      skill_keys: cleanStringArray(milestone.skill_keys),
      allowed_response_modes: allowedModes.length ? allowedModes : [activityMode],
    },
    activity: {
      title: cleanText(activity.title),
      stage: activityStage,
      prompt: cleanText(activity.prompt),
      response_mode: activityMode,
      starter_code: cleanText(activity.starter_code),
      expected_output: cleanText(activity.expected_output),
      rubric: activity.rubric && typeof activity.rubric === "object" && !Array.isArray(activity.rubric)
        ? activity.rubric as DbRow
        : {},
    },
    resource_ids: cleanStringArray(input.resource_ids),
  };

  if (!normalized.subject.title) throw new Error("Subject title is required.");
  if (!normalized.course.title) throw new Error("Course title is required.");
  if (!normalized.unit.title) throw new Error("Unit title is required.");
  if (!normalized.lesson.title) throw new Error("Lesson title is required.");
  if (!normalized.lesson.tutor_prompt) throw new Error("Mentor prompt is required.");
  if (!normalized.milestone.title || !normalized.milestone.objective) {
    throw new Error("Milestone title and objective are required.");
  }
  if (!normalized.activity.title || !normalized.activity.prompt) {
    throw new Error("Activity title and prompt are required.");
  }

  if (quiz) {
    const choices = Array.isArray(quiz.choices)
      ? quiz.choices
          .map((choice) => {
            const row = choice && typeof choice === "object" ? choice as DbRow : {};
            return { id: cleanText(row.id), text: cleanText(row.text) };
          })
          .filter((choice) => choice.id && choice.text)
          .slice(0, 8)
      : [];
    const correct = cleanStringArray(quiz.correct_choice_ids);
    const prompt = cleanText(quiz.prompt);
    if (prompt && choices.length >= 2 && correct.length) {
      normalized.quiz = { prompt, choices, correct_choice_ids: correct };
    }
  }

  return normalized;
}

async function saveLessonBlueprint(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const organizationId = cleanText(body.organization_id);
  const classId = cleanText(body.class_id);
  if (!organizationId) throw new Error("organization_id is required.");
  await assertCanAuthor(config, actorId, organizationId, classId);

  const blueprint = normalizeBlueprint(body.blueprint);
  const organization = await selectFirst(
    config,
    `organizations?id=eq.${encodeURIComponent(organizationId)}&select=id,slug,name&limit=1`,
  );
  if (!organization) throw new Error("Organization was not found.");
  const orgSlug = slugify(cleanText(organization.slug) || cleanText(organization.name) || organizationId.slice(0, 8));
  const subjectId = blueprint.subject.id || safeId(orgSlug, blueprint.subject.title);
  const courseId = blueprint.course.id || safeId(subjectId, blueprint.course.title);
  const courseVersionId = safeId(courseId, "v1");
  const unitId = blueprint.unit.id || safeId(courseVersionId, String(blueprint.unit.position), blueprint.unit.title);
  const lessonId = blueprint.lesson.id || safeId(unitId, blueprint.lesson.title);
  const milestoneId = `${lessonId}-milestone-1`;
  const activityId = `${lessonId}-activity-1`;
  const quizId = `${lessonId}-quiz-1`;

  await upsertByConflict(config, "subjects", "id", {
    id: subjectId,
    organization_id: organizationId,
    title: blueprint.subject.title,
    description: blueprint.subject.description || "",
    status: "draft",
    created_by: actorId,
    updated_at: new Date().toISOString(),
  });
  await upsertByConflict(config, "courses", "id", {
    id: courseId,
    subject_id: subjectId,
    organization_id: organizationId,
    title: blueprint.course.title,
    description: blueprint.course.description || "",
    status: "draft",
    created_by: actorId,
    updated_at: new Date().toISOString(),
  });
  await upsertByConflict(config, "course_versions", "id", {
    id: courseVersionId,
    course_id: courseId,
    version_label: "v1",
    status: "draft",
    is_current: false,
    content_schema_version: 1,
    updated_at: new Date().toISOString(),
  });
  await upsertByConflict(config, "units", "id", {
    id: unitId,
    course_version_id: courseVersionId,
    position: blueprint.unit.position,
    title: blueprint.unit.title,
    description: "",
    updated_at: new Date().toISOString(),
  });

  const existingLesson = await selectFirst(
    config,
    `lessons?id=eq.${encodeURIComponent(lessonId)}&select=id,position,publication_status&limit=1`,
  );
  const lessonPosition = existingLesson ? Number(existingLesson.position || 1) : await nextLessonPosition(config);
  await upsertByConflict(config, "lessons", "id", {
    id: lessonId,
    position: lessonPosition,
    title: blueprint.lesson.title,
    module: blueprint.unit.title,
    level: blueprint.lesson.level,
    tutor_prompt: blueprint.lesson.tutor_prompt,
    sample_code: blueprint.lesson.sample_code || blueprint.activity.starter_code || "",
    expected_output: blueprint.activity.expected_output || null,
    unit_id: unitId,
    author_user_id: actorId,
    publication_status: cleanText(existingLesson?.publication_status) || "draft",
    curriculum_metadata: {
      course_id: courseId,
      course_version_id: courseVersionId,
      lesson_type: blueprint.lesson.type,
      class_id: classId || null,
    },
  });

  await upsertByConflict(config, "milestones", "id", {
    id: milestoneId,
    lesson_id: lessonId,
    position: 1,
    title: blueprint.milestone.title,
    objective: blueprint.milestone.objective,
    level: blueprint.lesson.level,
    skill_keys: blueprint.milestone.skill_keys,
    expected_evidence: {
      student_can: blueprint.milestone.skill_keys,
    },
    completion_rules: {
      requires: blueprint.quiz ? ["activity_complete", "quiz_pass"] : ["activity_complete"],
      min_score: 1,
    },
    allowed_response_modes: blueprint.milestone.allowed_response_modes,
    updated_at: new Date().toISOString(),
  });

  await upsertByConflict(config, "lesson_activities", "id", {
    id: activityId,
    lesson_id: lessonId,
    milestone_id: milestoneId,
    position: 1,
    title: blueprint.activity.title,
    activity_type: blueprint.lesson.type,
    stage: blueprint.activity.stage,
    prompt: blueprint.activity.prompt,
    response_mode: blueprint.activity.response_mode,
    starter_code: blueprint.activity.starter_code || "",
    expected_output: blueprint.activity.expected_output || null,
    choices: blueprint.quiz?.choices || [],
    rubric: blueprint.activity.rubric || {},
    skill_keys: blueprint.milestone.skill_keys,
    pass_score: 1,
  });

  if (blueprint.quiz) {
    await upsertByConflict(config, "quiz_items", "id", {
      id: quizId,
      lesson_id: lessonId,
      milestone_id: milestoneId,
      activity_id: activityId,
      position: 1,
      prompt: blueprint.quiz.prompt,
      question_type: "multiple_choice",
      choices: blueprint.quiz.choices,
      correct_choice_ids: blueprint.quiz.correct_choice_ids,
      rubric: blueprint.activity.rubric || {},
      skill_keys: blueprint.milestone.skill_keys,
      status: "draft",
      updated_at: new Date().toISOString(),
    });
  }

  const existingRule = await selectFirst(
    config,
    `lesson_completion_rules?lesson_id=eq.${encodeURIComponent(lessonId)}&milestone_id=eq.${encodeURIComponent(milestoneId)}&status=eq.active&select=id&limit=1`,
  );
  const rulePayload = {
    lesson_id: lessonId,
    milestone_id: milestoneId,
    rule_type: blueprint.quiz ? "quiz_pass" : "activity_complete",
    required_score: 1,
    config: {
      activity_id: activityId,
      quiz_item_id: blueprint.quiz ? quizId : null,
      allowed_response_modes: blueprint.milestone.allowed_response_modes,
    },
    status: "active",
    created_by: actorId,
    updated_at: new Date().toISOString(),
  };
  if (existingRule) {
    await patchRows(config, `lesson_completion_rules?id=eq.${encodeURIComponent(String(existingRule.id))}`, rulePayload);
  } else {
    await insertRow(config, "lesson_completion_rules", rulePayload);
  }

  for (const resourceId of blueprint.resource_ids || []) {
    await patchRows(config, `lesson_resources?id=eq.${encodeURIComponent(resourceId)}`, {
      organization_id: organizationId,
      class_id: classId || null,
      course_id: courseId,
      course_version_id: courseVersionId,
      unit_id: unitId,
      lesson_id: lessonId,
      milestone_id: milestoneId,
      activity_id: activityId,
      updated_at: new Date().toISOString(),
    });
    const placement = await selectFirst(
      config,
      `lesson_resource_placements?resource_id=eq.${encodeURIComponent(resourceId)}&lesson_id=eq.${encodeURIComponent(lessonId)}&select=id&limit=1`,
    );
    const placementPayload = {
      resource_id: resourceId,
      organization_id: organizationId,
      class_id: classId || null,
      course_id: courseId,
      course_version_id: courseVersionId,
      unit_id: unitId,
      lesson_id: lessonId,
      milestone_id: milestoneId,
      activity_id: activityId,
      position: 0,
      display_mode: "card",
      show_before_stage: "teach",
    };
    if (placement) {
      await patchRows(config, `lesson_resource_placements?id=eq.${encodeURIComponent(String(placement.id))}`, placementPayload);
    } else {
      await insertRow(config, "lesson_resource_placements", placementPayload);
    }
  }

  await patchRows(config, `lessons?id=eq.${encodeURIComponent(lessonId)}`, {
    milestone_id: milestoneId,
  });

  return json({
    status: "ok",
    lesson_id: lessonId,
    subject_id: subjectId,
    course_id: courseId,
    unit_id: unitId,
  });
}

async function courseScopeForLesson(config: Config, lessonId: string): Promise<{
  subjectId: string;
  courseId: string;
  courseVersionId: string;
  unitId: string;
  organizationId: string;
}> {
  const lesson = await selectFirst(
    config,
    `lessons?id=eq.${encodeURIComponent(lessonId)}&select=id,unit_id&limit=1`,
  );
  if (!lesson || !lesson.unit_id) throw new Error("Lesson curriculum scope was not found.");
  const unit = await selectFirst(
    config,
    `units?id=eq.${encodeURIComponent(String(lesson.unit_id))}&select=id,course_version_id&limit=1`,
  );
  if (!unit) throw new Error("Lesson unit was not found.");
  const version = await selectFirst(
    config,
    `course_versions?id=eq.${encodeURIComponent(String(unit.course_version_id))}&select=id,course_id&limit=1`,
  );
  if (!version) throw new Error("Course version was not found.");
  const course = await selectFirst(
    config,
    `courses?id=eq.${encodeURIComponent(String(version.course_id))}&select=id,subject_id,organization_id&limit=1`,
  );
  if (!course || !course.organization_id) throw new Error("Course organization scope was not found.");
  return {
    subjectId: String(course.subject_id),
    courseId: String(course.id),
    courseVersionId: String(version.id),
    unitId: String(unit.id),
    organizationId: String(course.organization_id),
  };
}

async function publishLesson(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const lessonId = cleanText(body.lesson_id);
  const classId = cleanText(body.class_id);
  if (!lessonId) throw new Error("lesson_id is required.");
  const scope = await courseScopeForLesson(config, lessonId);
  const organizationId = cleanText(body.organization_id) || scope.organizationId;
  if (organizationId !== scope.organizationId) throw new Error("organization_id does not match the lesson.");
  await assertCanAuthor(config, actorId, organizationId, classId);

  const now = new Date().toISOString();
  await patchRows(config, `subjects?id=eq.${encodeURIComponent(scope.subjectId)}`, {
    status: "published",
    updated_at: now,
  });
  await patchRows(config, `courses?id=eq.${encodeURIComponent(scope.courseId)}`, {
    status: "published",
    updated_at: now,
  });
  await patchRows(config, `course_versions?id=eq.${encodeURIComponent(scope.courseVersionId)}`, {
    status: "published",
    is_current: true,
    published_at: now,
    updated_at: now,
  });
  await patchRows(config, `lessons?id=eq.${encodeURIComponent(lessonId)}`, {
    publication_status: "published",
  });
  await patchRows(config, `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}`, {
    status: "published",
    updated_at: now,
  });

  return json({
    status: "ok",
    lesson_id: lessonId,
    subject_id: scope.subjectId,
    course_id: scope.courseId,
    unit_id: scope.unitId,
  });
}

async function archiveLesson(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const lessonId = cleanText(body.lesson_id);
  const classId = cleanText(body.class_id);
  if (!lessonId) throw new Error("lesson_id is required.");
  const scope = await courseScopeForLesson(config, lessonId);
  const organizationId = cleanText(body.organization_id) || scope.organizationId;
  if (organizationId !== scope.organizationId) throw new Error("organization_id does not match the lesson.");
  await assertCanAuthor(config, actorId, organizationId, classId);

  await patchRows(config, `lessons?id=eq.${encodeURIComponent(lessonId)}`, {
    publication_status: "archived",
  });
  await patchRows(config, `quiz_items?lesson_id=eq.${encodeURIComponent(lessonId)}`, {
    status: "archived",
    updated_at: new Date().toISOString(),
  });

  return json({
    status: "ok",
    lesson_id: lessonId,
    subject_id: scope.subjectId,
    course_id: scope.courseId,
    unit_id: scope.unitId,
  });
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
    const actor = await fetchCurrentUser(config);
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Request body must be a JSON object.", 400);
    }
    const record = body as DbRow;
    const action = cleanText(record.action);
    if (action === "save_lesson_blueprint") return await saveLessonBlueprint(config, String(actor.id), record);
    if (action === "publish_lesson") return await publishLesson(config, String(actor.id), record);
    if (action === "archive_lesson") return await archiveLesson(config, String(actor.id), record);
    return errorResponse("Unsupported curriculum-admin action.", 400);
  } catch (error) {
    const message = errorMessage(error);
    const status = message.includes("access") || message.includes("author")
      ? 403
      : message.includes("Authentication") || message.includes("authenticated")
        ? 401
        : message.includes("required") || message.includes("not found") || message.includes("does not match")
          ? 400
          : 500;
    return errorResponse(message, status);
  }
});
