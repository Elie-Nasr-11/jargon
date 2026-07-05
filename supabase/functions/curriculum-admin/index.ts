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

// v4 learning modes (docs/PLATFORM.md). Mode types are validated HERE, not in the DB,
// so new types never need a migration. A step with mode null is a legacy step.
const LEARNING_MODES = new Set([
  "explanation",
  "media",
  "reflection",
  "practice",
  "assignment",
  "inquiry",
  "assessment",
  "revision",
]);
const MODE_TYPES: Record<string, string[]> = {
  practice: ["code", "applied"],
  assessment: ["mcq", "open_ended"],
  revision: ["recall"],
};
function cleanMode(value: unknown): string | null {
  const raw = cleanText(value);
  return LEARNING_MODES.has(raw) ? raw : null;
}
function cleanModeType(mode: string | null, value: unknown): string {
  if (!mode) return "";
  const allowed = MODE_TYPES[mode] || [];
  const raw = cleanText(value);
  if (allowed.includes(raw)) return raw;
  // Typed modes default to their primary type so a missing subtype can't strand a step.
  return allowed[0] || "";
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
  await patchRows(config, `lesson_resources?lesson_id=eq.${encodeURIComponent(lessonId)}&status=eq.draft`, {
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

// ---------------------------------------------------------------------------
// Structure management (Phase 1 of the curriculum authoring redesign).
// First-class create / rename / reorder / move / archive / delete actions so
// structure is managed directly instead of being back-filled from a lesson save.
// All reuse assertCanAuthor + the service-role helpers; ids are stable once
// created (rename PATCHes by id, never re-derives) so children never orphan.
// ---------------------------------------------------------------------------

const enc = (value: string) => encodeURIComponent(value);

const NODE_TABLES: Record<string, string> = {
  subject: "subjects",
  course: "courses",
  unit: "units",
  lesson: "lessons",
};

async function selectAll(config: Config, path: string): Promise<DbRow[]> {
  const data = await serviceFetch(config, `/rest/v1/${path}`);
  return Array.isArray(data)
    ? (data.filter((item) => item && typeof item === "object") as DbRow[])
    : [];
}

// Next position within a parent (1-based). Highest existing non-null value + 1.
async function nextPosition(
  config: Config,
  table: string,
  filter: string,
  column = "position",
): Promise<number> {
  const row = await selectFirst(
    config,
    `${table}?${filter}&select=${column}&order=${column}.desc.nullslast&limit=1`,
  );
  const current = Number(row?.[column] ?? 0);
  return Number.isFinite(current) ? current + 1 : 1;
}

// Derive a stable id from a title-based base, appending a short suffix on collision
// so a create never silently merges into an existing row.
async function uniqueId(config: Config, table: string, base: string): Promise<string> {
  const candidate = (base || crypto.randomUUID()).slice(0, 180);
  const existing = await selectFirst(config, `${table}?id=eq.${enc(candidate)}&select=id&limit=1`);
  if (!existing) return candidate;
  return `${candidate}-${crypto.randomUUID().slice(0, 6)}`.slice(0, 180);
}

async function orgSlugFor(config: Config, organizationId: string): Promise<string> {
  const organization = await selectFirst(
    config,
    `organizations?id=eq.${enc(organizationId)}&select=id,slug,name&limit=1`,
  );
  if (!organization) throw new Error("Organization was not found.");
  return slugify(
    cleanText(organization.slug) || cleanText(organization.name) || organizationId.slice(0, 8),
  );
}

async function subjectScope(config: Config, subjectId: string) {
  const subject = await selectFirst(
    config,
    `subjects?id=eq.${enc(subjectId)}&select=id,organization_id&limit=1`,
  );
  if (!subject) throw new Error("Subject was not found.");
  return { subjectId: String(subject.id), organizationId: cleanText(subject.organization_id) };
}

async function courseScope(config: Config, courseId: string) {
  const course = await selectFirst(
    config,
    `courses?id=eq.${enc(courseId)}&select=id,subject_id,organization_id&limit=1`,
  );
  if (!course) throw new Error("Course was not found.");
  return {
    courseId: String(course.id),
    subjectId: cleanText(course.subject_id),
    organizationId: cleanText(course.organization_id),
  };
}

async function courseVersionScope(config: Config, courseVersionId: string) {
  const version = await selectFirst(
    config,
    `course_versions?id=eq.${enc(courseVersionId)}&select=id,course_id&limit=1`,
  );
  if (!version) throw new Error("Course version was not found.");
  const course = await courseScope(config, cleanText(version.course_id));
  return { courseVersionId: String(version.id), ...course };
}

async function unitScope(config: Config, unitId: string) {
  const unit = await selectFirst(
    config,
    `units?id=eq.${enc(unitId)}&select=id,title,course_version_id&limit=1`,
  );
  if (!unit) throw new Error("Unit was not found.");
  const version = await courseVersionScope(config, cleanText(unit.course_version_id));
  return { unitId: String(unit.id), unitTitle: cleanText(unit.title), ...version };
}

async function organizationForNode(config: Config, nodeType: string, id: string): Promise<string> {
  if (nodeType === "subject") return (await subjectScope(config, id)).organizationId;
  if (nodeType === "course") return (await courseScope(config, id)).organizationId;
  if (nodeType === "unit") return (await unitScope(config, id)).organizationId;
  if (nodeType === "lesson") return (await courseScopeForLesson(config, id)).organizationId;
  throw new Error("Unsupported node type.");
}

async function createSubject(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const organizationId = cleanText(body.organization_id);
  if (!organizationId) throw new Error("organization_id is required.");
  await assertCanAuthor(config, actorId, organizationId, cleanText(body.class_id));
  const title = cleanText(body.title);
  if (!title) throw new Error("Subject title is required.");
  const orgSlug = await orgSlugFor(config, organizationId);
  const id = await uniqueId(config, "subjects", safeId(orgSlug, title));
  const position = await nextPosition(config, "subjects", `organization_id=eq.${enc(organizationId)}`);
  await insertRow(config, "subjects", {
    id,
    organization_id: organizationId,
    title,
    description: cleanText(body.description),
    status: "draft",
    position,
    created_by: actorId,
    updated_at: new Date().toISOString(),
  });
  return json({ status: "ok", node_type: "subject", id, position, organization_id: organizationId });
}

async function createCourse(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const subjectId = cleanText(body.subject_id);
  if (!subjectId) throw new Error("subject_id is required.");
  const scope = await subjectScope(config, subjectId);
  await assertCanAuthor(config, actorId, scope.organizationId, cleanText(body.class_id));
  const title = cleanText(body.title);
  if (!title) throw new Error("Course title is required.");
  const id = await uniqueId(config, "courses", safeId(subjectId, title));
  const courseVersionId = await uniqueId(config, "course_versions", safeId(id, "v1"));
  const position = await nextPosition(config, "courses", `subject_id=eq.${enc(subjectId)}`);
  const now = new Date().toISOString();
  await insertRow(config, "courses", {
    id,
    subject_id: subjectId,
    organization_id: scope.organizationId || null,
    title,
    description: cleanText(body.description),
    status: "draft",
    position,
    created_by: actorId,
    updated_at: now,
  });
  await insertRow(config, "course_versions", {
    id: courseVersionId,
    course_id: id,
    version_label: "v1",
    status: "draft",
    is_current: true,
    content_schema_version: 1,
    updated_at: now,
  });
  return json({
    status: "ok",
    node_type: "course",
    id,
    position,
    subject_id: subjectId,
    course_version_id: courseVersionId,
  });
}

async function createUnit(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const courseVersionId = cleanText(body.course_version_id);
  if (!courseVersionId) throw new Error("course_version_id is required.");
  const scope = await courseVersionScope(config, courseVersionId);
  await assertCanAuthor(config, actorId, scope.organizationId, cleanText(body.class_id));
  const title = cleanText(body.title);
  if (!title) throw new Error("Unit title is required.");
  const position = await nextPosition(config, "units", `course_version_id=eq.${enc(courseVersionId)}`);
  const id = await uniqueId(config, "units", safeId(courseVersionId, String(position), title));
  await insertRow(config, "units", {
    id,
    course_version_id: courseVersionId,
    position,
    title,
    description: cleanText(body.description),
    updated_at: new Date().toISOString(),
  });
  return json({
    status: "ok",
    node_type: "unit",
    id,
    position,
    course_version_id: courseVersionId,
    course_id: scope.courseId,
  });
}

async function createLessonStub(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const unitId = cleanText(body.unit_id);
  if (!unitId) throw new Error("unit_id is required.");
  const scope = await unitScope(config, unitId);
  await assertCanAuthor(config, actorId, scope.organizationId, cleanText(body.class_id));
  const title = cleanText(body.title) || "Untitled lesson";
  const level = cleanText(body.level, "Any level");
  const lessonType = isLessonType(body.lesson_type) ? body.lesson_type : "discussion";
  const responseMode: ResponseMode = lessonType === "code"
    ? "code"
    : lessonType === "multiple_choice"
      ? "multiple_choice"
      : "text";

  const lessonId = await uniqueId(config, "lessons", safeId(unitId, title));
  const milestoneId = `${lessonId}-milestone-1`;
  const activityId = `${lessonId}-activity-1`;
  const position = await nextLessonPosition(config);
  const unitPosition = await nextPosition(config, "lessons", `unit_id=eq.${enc(unitId)}`, "unit_position");
  const now = new Date().toISOString();

  await insertRow(config, "lessons", {
    id: lessonId,
    position,
    unit_position: unitPosition,
    title,
    module: scope.unitTitle || "Lesson",
    level,
    tutor_prompt:
      cleanText(body.tutor_prompt) || "Introduce this lesson and guide the learner step by step.",
    sample_code: "",
    expected_output: null,
    unit_id: unitId,
    author_user_id: actorId,
    publication_status: "draft",
    curriculum_metadata: {
      course_id: scope.courseId,
      course_version_id: scope.courseVersionId,
      lesson_type: lessonType,
      class_id: cleanText(body.class_id) || null,
    },
    // milestone_id is set after the milestone row exists (lessons_milestone_id_fkey).
  });

  await upsertByConflict(config, "milestones", "id", {
    id: milestoneId,
    lesson_id: lessonId,
    position: 1,
    title,
    objective: "Describe what the learner should be able to do.",
    level,
    skill_keys: [],
    expected_evidence: {},
    completion_rules: { requires: ["activity_complete"], min_score: 1 },
    allowed_response_modes: [responseMode],
    updated_at: now,
  });

  // Point the lesson at its milestone now that the milestone exists.
  await patchRows(config, `lessons?id=eq.${enc(lessonId)}`, { milestone_id: milestoneId });

  await upsertByConflict(config, "lesson_activities", "id", {
    id: activityId,
    lesson_id: lessonId,
    milestone_id: milestoneId,
    position: 1,
    title: "Practice",
    activity_type: lessonType,
    stage: "practice",
    prompt: "Add a prompt for learners.",
    response_mode: responseMode,
    starter_code: "",
    expected_output: null,
    choices: [],
    rubric: {},
    skill_keys: [],
    pass_score: 1,
  });

  return json({
    status: "ok",
    node_type: "lesson",
    id: lessonId,
    lesson_id: lessonId,
    unit_id: unitId,
    milestone_id: milestoneId,
    activity_id: activityId,
    position,
    unit_position: unitPosition,
  });
}

async function renameNode(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const nodeType = cleanText(body.node_type);
  const id = cleanText(body.id);
  const title = cleanText(body.title);
  if (!id) throw new Error("id is required.");
  if (!title) throw new Error("title is required.");
  const table = NODE_TABLES[nodeType];
  if (!table) throw new Error("Unsupported node type.");
  const organizationId = await organizationForNode(config, nodeType, id);
  await assertCanAuthor(config, actorId, organizationId, cleanText(body.class_id));

  const patch: DbRow = { title };
  // lessons carry no updated_at / description columns; the others do.
  if (nodeType !== "lesson") {
    patch.updated_at = new Date().toISOString();
    if (body.description !== undefined) patch.description = cleanText(body.description);
  } else {
    patch.module = cleanText(body.module) || undefined;
  }
  await patchRows(config, `${table}?id=eq.${enc(id)}`, patch);
  return json({ status: "ok", node_type: nodeType, id });
}

function requireAllPresent(rows: DbRow[], ids: string[], label: string): void {
  const found = new Set(rows.map((row) => cleanText(row.id)));
  for (const id of ids) {
    if (!found.has(id)) throw new Error(`${label} list contains an unknown id.`);
  }
}

// Validate that every id in a reorder belongs to the same parent (so a caller can't
// mix in another org's nodes via the service-role write path) and resolve the org.
async function reorderScope(config: Config, nodeType: string, ids: string[]): Promise<string> {
  const idList = ids.map(enc).join(",");
  if (nodeType === "subject") {
    const rows = await selectAll(config, `subjects?id=in.(${idList})&select=id,organization_id`);
    requireAllPresent(rows, ids, "Subject");
    if (new Set(rows.map((r) => cleanText(r.organization_id))).size > 1) {
      throw new Error("Subjects belong to different organizations.");
    }
    return cleanText(rows[0].organization_id);
  }
  if (nodeType === "course") {
    const rows = await selectAll(config, `courses?id=in.(${idList})&select=id,subject_id,organization_id`);
    requireAllPresent(rows, ids, "Course");
    if (new Set(rows.map((r) => cleanText(r.subject_id))).size > 1) {
      throw new Error("Courses belong to different subjects.");
    }
    return cleanText(rows[0].organization_id);
  }
  if (nodeType === "unit") {
    const rows = await selectAll(config, `units?id=in.(${idList})&select=id,course_version_id`);
    requireAllPresent(rows, ids, "Unit");
    if (new Set(rows.map((r) => cleanText(r.course_version_id))).size > 1) {
      throw new Error("Units belong to different course versions.");
    }
    return (await courseVersionScope(config, cleanText(rows[0].course_version_id))).organizationId;
  }
  if (nodeType === "lesson") {
    const rows = await selectAll(config, `lessons?id=in.(${idList})&select=id,unit_id`);
    requireAllPresent(rows, ids, "Lesson");
    if (new Set(rows.map((r) => cleanText(r.unit_id))).size > 1) {
      throw new Error("Lessons belong to different units.");
    }
    return (await unitScope(config, cleanText(rows[0].unit_id))).organizationId;
  }
  throw new Error("Unsupported node type.");
}

async function reorderNodes(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const nodeType = cleanText(body.node_type);
  // Not cleanStringArray: that caps at 24, which would truncate a large reorder and
  // (for units) leave stragglers at colliding positions. Reorders must cover the full set.
  const orderedIds = Array.isArray(body.ordered_ids)
    ? (body.ordered_ids as unknown[]).map((item) => cleanText(item)).filter(Boolean)
    : [];
  if (!NODE_TABLES[nodeType]) throw new Error("Unsupported node type.");
  if (!orderedIds.length) throw new Error("ordered_ids is required.");
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error("ordered_ids contains duplicates.");
  }

  const organizationId = await reorderScope(config, nodeType, orderedIds);
  await assertCanAuthor(config, actorId, organizationId, cleanText(body.class_id));

  const now = new Date().toISOString();
  if (nodeType === "unit") {
    // units have unique(course_version_id, position): two-pass via negative offsets
    // so no transient collision while shuffling. Assumes orderedIds covers the unit set.
    for (let i = 0; i < orderedIds.length; i++) {
      await patchRows(config, `units?id=eq.${enc(orderedIds[i])}`, { position: -(i + 1), updated_at: now });
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await patchRows(config, `units?id=eq.${enc(orderedIds[i])}`, { position: i + 1, updated_at: now });
    }
  } else {
    const column = nodeType === "lesson" ? "unit_position" : "position";
    for (let i = 0; i < orderedIds.length; i++) {
      const patch: DbRow = { [column]: i + 1 };
      if (nodeType !== "lesson") patch.updated_at = now;
      await patchRows(config, `${NODE_TABLES[nodeType]}?id=eq.${enc(orderedIds[i])}`, patch);
    }
  }
  return json({ status: "ok", node_type: nodeType, ordered_ids: orderedIds });
}

async function moveLesson(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const lessonId = cleanText(body.lesson_id);
  const targetUnitId = cleanText(body.target_unit_id);
  if (!lessonId) throw new Error("lesson_id is required.");
  if (!targetUnitId) throw new Error("target_unit_id is required.");

  const sourceScope = await courseScopeForLesson(config, lessonId);
  const targetScope = await unitScope(config, targetUnitId);
  await assertCanAuthor(config, actorId, sourceScope.organizationId, cleanText(body.class_id));
  if (targetScope.organizationId !== sourceScope.organizationId) {
    await assertCanAuthor(config, actorId, targetScope.organizationId, cleanText(body.class_id));
  }

  const unitPosition = body.position !== undefined && body.position !== null
    ? Math.max(1, Math.round(Number(body.position) || 1))
    : await nextPosition(config, "lessons", `unit_id=eq.${enc(targetUnitId)}`, "unit_position");

  const lesson = await selectFirst(
    config,
    `lessons?id=eq.${enc(lessonId)}&select=id,curriculum_metadata&limit=1`,
  );
  const metadata = lesson?.curriculum_metadata && typeof lesson.curriculum_metadata === "object"
    ? lesson.curriculum_metadata as DbRow
    : {};

  await patchRows(config, `lessons?id=eq.${enc(lessonId)}`, {
    unit_id: targetUnitId,
    unit_position: unitPosition,
    module: targetScope.unitTitle || metadata.module || "Lesson",
    curriculum_metadata: {
      ...metadata,
      course_id: targetScope.courseId,
      course_version_id: targetScope.courseVersionId,
    },
  });

  return json({
    status: "ok",
    node_type: "lesson",
    id: lessonId,
    lesson_id: lessonId,
    unit_id: targetUnitId,
    unit_position: unitPosition,
  });
}

async function archiveNode(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const nodeType = cleanText(body.node_type);
  const id = cleanText(body.id);
  if (!id) throw new Error("id is required.");
  const organizationId = await organizationForNode(config, nodeType, id);
  await assertCanAuthor(config, actorId, organizationId, cleanText(body.class_id));

  const now = new Date().toISOString();
  if (nodeType === "subject" || nodeType === "course") {
    await patchRows(config, `${NODE_TABLES[nodeType]}?id=eq.${enc(id)}`, {
      status: "archived",
      updated_at: now,
    });
  } else if (nodeType === "lesson") {
    await patchRows(config, `lessons?id=eq.${enc(id)}`, { publication_status: "archived" });
    await patchRows(config, `quiz_items?lesson_id=eq.${enc(id)}`, { status: "archived", updated_at: now });
  } else {
    throw new Error("Only subjects, courses, and lessons can be archived.");
  }
  return json({ status: "ok", node_type: nodeType, id });
}

async function deleteNode(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const nodeType = cleanText(body.node_type);
  const id = cleanText(body.id);
  if (!id) throw new Error("id is required.");
  const organizationId = await organizationForNode(config, nodeType, id);
  await assertCanAuthor(config, actorId, organizationId, cleanText(body.class_id));

  // Leaf-only + history-safe deletes: refuse anything that would orphan published
  // lessons or cascade away learner activity. Populated nodes use archive instead.
  if (nodeType === "subject") {
    const child = await selectFirst(config, `courses?subject_id=eq.${enc(id)}&select=id&limit=1`);
    if (child) throw new Error("Remove this subject's courses before deleting it.");
    await serviceFetch(config, `/rest/v1/subjects?id=eq.${enc(id)}`, { method: "DELETE" });
  } else if (nodeType === "course") {
    const versions = await selectAll(config, `course_versions?course_id=eq.${enc(id)}&select=id`);
    const versionIds = versions.map((row) => cleanText(row.id)).filter(Boolean);
    if (versionIds.length) {
      const unit = await selectFirst(
        config,
        `units?course_version_id=in.(${versionIds.map(enc).join(",")})&select=id&limit=1`,
      );
      if (unit) throw new Error("Remove this course's units before deleting it.");
    }
    await serviceFetch(config, `/rest/v1/courses?id=eq.${enc(id)}`, { method: "DELETE" });
  } else if (nodeType === "unit") {
    const lesson = await selectFirst(config, `lessons?unit_id=eq.${enc(id)}&select=id&limit=1`);
    if (lesson) throw new Error("Remove this unit's lessons before deleting it.");
    await serviceFetch(config, `/rest/v1/units?id=eq.${enc(id)}`, { method: "DELETE" });
  } else if (nodeType === "lesson") {
    const session = await selectFirst(config, `learning_sessions?lesson_id=eq.${enc(id)}&select=id&limit=1`);
    if (session) throw new Error("This lesson has learner activity. Archive it instead of deleting.");
    await serviceFetch(config, `/rest/v1/lessons?id=eq.${enc(id)}`, { method: "DELETE" });
  } else {
    throw new Error("Unsupported node type.");
  }
  return json({ status: "ok", node_type: nodeType, id });
}

// ---------------------------------------------------------------------------
// Multi-step lessons (Phase 3 of the curriculum authoring redesign).
// A lesson's content is an ordered sequence of steps; each step is a
// `lesson_activities` row (ordered by position), and a checkpoint step also gets a
// `quiz_items` row. The lesson keeps ONE milestone (lesson-level goal). These run
// alongside the legacy `save_lesson_blueprint`; the runtime walks the ordered
// activities (see the `chat` edge function).
// ---------------------------------------------------------------------------

function parseChoices(value: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((choice) => {
      const row = choice && typeof choice === "object" ? (choice as DbRow) : {};
      return { id: cleanText(row.id), text: cleanText(row.text) };
    })
    .filter((choice) => choice.id && choice.text)
    .slice(0, 8);
}

async function lessonMilestoneId(config: Config, lessonId: string): Promise<string | null> {
  const existing = await selectFirst(
    config,
    `milestones?lesson_id=eq.${enc(lessonId)}&order=position.asc&limit=1&select=id`,
  );
  return existing ? String(existing.id) : null;
}

async function saveLessonMeta(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const lessonId = cleanText(body.lesson_id);
  if (!lessonId) throw new Error("lesson_id is required.");
  const scope = await courseScopeForLesson(config, lessonId);
  await assertCanAuthor(config, actorId, scope.organizationId, cleanText(body.class_id));

  const meta = body.meta && typeof body.meta === "object" ? (body.meta as DbRow) : {};
  const title = cleanText(meta.title);
  const tutorPrompt = cleanText(meta.tutor_prompt);
  if (!title) throw new Error("Lesson title is required.");
  if (!tutorPrompt) throw new Error("Mentor prompt is required.");
  const level = cleanText(meta.level, "Any level");
  const lessonType = isLessonType(meta.lesson_type) ? meta.lesson_type : "discussion";

  // Tutor-behavior policy (the school-governance controls). Only written when the
  // client sends a field, so clients that don't yet know about these leave them as-is.
  const HELP_CEILINGS = ["clarify", "hints", "guided", "worked_example", "feedback", "study"];
  const FINAL_ANSWER_POLICIES = ["never", "after_attempt", "allowed"];
  const policyPatch: DbRow = {};
  if (HELP_CEILINGS.includes(String(meta.help_ceiling))) {
    policyPatch.help_ceiling = String(meta.help_ceiling);
  }
  if (FINAL_ANSWER_POLICIES.includes(String(meta.final_answer_policy))) {
    policyPatch.final_answer_policy = String(meta.final_answer_policy);
  }
  if (typeof meta.require_attempt_first === "boolean") {
    policyPatch.require_attempt_first = meta.require_attempt_first;
  }
  if (meta.tutor_tone !== undefined) policyPatch.tutor_tone = cleanText(meta.tutor_tone) || null;
  if (meta.tutor_pace !== undefined) policyPatch.tutor_pace = cleanText(meta.tutor_pace) || null;
  if (meta.grade_band !== undefined) policyPatch.grade_band = cleanText(meta.grade_band) || null;

  const lessonRow = await selectFirst(
    config,
    `lessons?id=eq.${enc(lessonId)}&select=id,curriculum_metadata&limit=1`,
  );
  const metadata =
    lessonRow?.curriculum_metadata && typeof lessonRow.curriculum_metadata === "object"
      ? (lessonRow.curriculum_metadata as DbRow)
      : {};

  // Patch lesson-level fields only — never touches subject/course status or activities.
  await patchRows(config, `lessons?id=eq.${enc(lessonId)}`, {
    title,
    level,
    tutor_prompt: tutorPrompt,
    sample_code: cleanText(meta.sample_code),
    curriculum_metadata: { ...metadata, lesson_type: lessonType },
    ...policyPatch,
  });

  // Single lesson-level milestone (update existing or create milestone-1).
  const milestone = body.milestone && typeof body.milestone === "object" ? (body.milestone as DbRow) : {};
  const existingMilestoneId = await lessonMilestoneId(config, lessonId);
  const milestoneId = existingMilestoneId || `${lessonId}-milestone-1`;
  const allowedModes = cleanStringArray(milestone.allowed_response_modes).filter(isResponseMode) as ResponseMode[];
  await upsertByConflict(config, "milestones", "id", {
    id: milestoneId,
    lesson_id: lessonId,
    position: 1,
    title: cleanText(milestone.title) || title,
    objective: cleanText(milestone.objective) || "Describe what the learner should be able to do.",
    level,
    skill_keys: cleanStringArray(milestone.skill_keys),
    allowed_response_modes: allowedModes.length ? allowedModes : ["text"],
    updated_at: new Date().toISOString(),
  });
  await patchRows(config, `lessons?id=eq.${enc(lessonId)}`, { milestone_id: milestoneId });

  return json({ status: "ok", lesson_id: lessonId, milestone_id: milestoneId });
}

async function upsertStep(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const lessonId = cleanText(body.lesson_id);
  if (!lessonId) throw new Error("lesson_id is required.");
  const scope = await courseScopeForLesson(config, lessonId);
  await assertCanAuthor(config, actorId, scope.organizationId, cleanText(body.class_id));

  const step = body.step && typeof body.step === "object" ? (body.step as DbRow) : {};
  const title = cleanText(step.title) || "Step";
  const stage = isStage(step.stage) ? step.stage : "practice";
  // v4 mode (docs/PLATFORM.md): when set, the mode PINS response_mode so the stored shape
  // can't drift from the mode's runtime contract; activity_type is derived for legacy
  // compat (deprecated — the runtime keys on mode). When absent, everything is legacy.
  const stepMode = cleanMode(step.mode);
  const stepModeType = cleanModeType(stepMode, step.mode_type);
  const responseMode: ResponseMode = stepMode
    ? stepMode === "practice" && stepModeType !== "applied"
      ? "code"
      : stepMode === "assessment" && stepModeType !== "open_ended"
        ? "multiple_choice"
        : "text"
    : isResponseMode(step.response_mode)
      ? step.response_mode
      : "text";
  const activityType: LessonType = stepMode
    ? stepMode === "practice" && stepModeType !== "applied"
      ? "code"
      : stepMode === "assessment" && stepModeType !== "open_ended"
        ? "multiple_choice"
        : stepMode === "reflection"
          ? "reflection"
          : "discussion"
    : isLessonType(step.activity_type)
      ? step.activity_type
      : responseMode === "code"
        ? "code"
        : responseMode === "multiple_choice"
          ? "multiple_choice"
          : "discussion";

  const milestoneId = await lessonMilestoneId(config, lessonId);

  let activityId = cleanText(step.id);
  let position: number;
  if (activityId) {
    const existing = await selectFirst(
      config,
      `lesson_activities?id=eq.${enc(activityId)}&lesson_id=eq.${enc(lessonId)}&select=id,position&limit=1`,
    );
    if (!existing) throw new Error("Step was not found.");
    position = Number(existing.position) || 1;
  } else {
    position = await nextPosition(config, "lesson_activities", `lesson_id=eq.${enc(lessonId)}`);
    activityId = await uniqueId(config, "lesson_activities", safeId(lessonId, "step", String(position)));
  }

  const passScore = Number(step.pass_score) > 0 ? Number(step.pass_score) : 1;
  await upsertByConflict(config, "lesson_activities", "id", {
    id: activityId,
    lesson_id: lessonId,
    milestone_id: milestoneId,
    position,
    title,
    activity_type: activityType,
    stage,
    prompt: cleanText(step.prompt) || "Add a prompt for learners.",
    response_mode: responseMode,
    starter_code: cleanText(step.starter_code),
    expected_output: cleanText(step.expected_output) || null,
    choices: parseChoices(step.choices),
    rubric:
      step.rubric && typeof step.rubric === "object" && !Array.isArray(step.rubric)
        ? (step.rubric as DbRow)
        : {},
    skill_keys: cleanStringArray(step.skill_keys),
    pass_score: passScore,
    // Only touch the mode columns when the payload carries the key: an explicit value
    // (or explicit null/"none") sets or clears it; an old client that doesn't know about
    // modes can never clobber one back to legacy.
    ...("mode" in step ? { mode: stepMode, mode_type: stepModeType || null } : {}),
  });

  // Checkpoint step: upsert its quiz_item. Otherwise archive any quiz so the runtime
  // (which only loads published quizzes) stops treating this step as an assessment.
  const quiz = step.quiz && typeof step.quiz === "object" ? (step.quiz as DbRow) : null;
  const quizChoices = quiz ? parseChoices(quiz.choices) : [];
  const correct = quiz ? cleanStringArray(quiz.correct_choice_ids) : [];
  if (responseMode === "multiple_choice" && quiz && quizChoices.length >= 2 && correct.length) {
    await upsertByConflict(config, "quiz_items", "id", {
      id: `${activityId}-quiz`,
      lesson_id: lessonId,
      milestone_id: milestoneId,
      activity_id: activityId,
      position,
      prompt: cleanText(quiz.prompt) || cleanText(step.prompt) || "Choose the best answer.",
      question_type: "multiple_choice",
      choices: quizChoices,
      correct_choice_ids: correct,
      rubric: {},
      skill_keys: cleanStringArray(step.skill_keys),
      status: "draft",
      updated_at: new Date().toISOString(),
    });
  } else {
    await patchRows(config, `quiz_items?activity_id=eq.${enc(activityId)}`, {
      status: "archived",
      updated_at: new Date().toISOString(),
    });
  }

  return json({ status: "ok", node_type: "step", id: activityId, lesson_id: lessonId, position });
}

async function reorderSteps(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const lessonId = cleanText(body.lesson_id);
  if (!lessonId) throw new Error("lesson_id is required.");
  const scope = await courseScopeForLesson(config, lessonId);
  await assertCanAuthor(config, actorId, scope.organizationId, cleanText(body.class_id));

  const orderedIds = Array.isArray(body.ordered_ids)
    ? (body.ordered_ids as unknown[]).map((item) => cleanText(item)).filter(Boolean)
    : [];
  if (!orderedIds.length) throw new Error("ordered_ids is required.");
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error("ordered_ids contains duplicates.");
  }
  const rows = await selectAll(
    config,
    `lesson_activities?id=in.(${orderedIds.map(enc).join(",")})&select=id,lesson_id`,
  );
  requireAllPresent(rows, orderedIds, "Step");
  if (rows.some((row) => cleanText(row.lesson_id) !== lessonId)) {
    throw new Error("Steps belong to a different lesson.");
  }

  const now = new Date().toISOString();
  // lesson_activities has no unique(lesson_id, position) constraint -> direct assignment.
  for (let i = 0; i < orderedIds.length; i++) {
    await patchRows(config, `lesson_activities?id=eq.${enc(orderedIds[i])}`, { position: i + 1 });
    await patchRows(config, `quiz_items?activity_id=eq.${enc(orderedIds[i])}`, {
      position: i + 1,
      updated_at: now,
    });
  }
  return json({ status: "ok", lesson_id: lessonId, ordered_ids: orderedIds });
}

async function deleteStep(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const lessonId = cleanText(body.lesson_id);
  const activityId = cleanText(body.activity_id) || cleanText(body.id);
  if (!lessonId) throw new Error("lesson_id is required.");
  if (!activityId) throw new Error("activity_id is required.");
  const scope = await courseScopeForLesson(config, lessonId);
  await assertCanAuthor(config, actorId, scope.organizationId, cleanText(body.class_id));

  const all = await selectAll(config, `lesson_activities?lesson_id=eq.${enc(lessonId)}&select=id`);
  if (all.length <= 1) throw new Error("A lesson needs at least one step.");

  // Archive the linked quiz (preserve any attempts via the FK set-null) then delete the
  // activity. lesson_attempts.activity_id + learning_sessions.current_activity_id are
  // ON DELETE SET NULL, so learner history survives and any active cursor falls back to
  // the first step.
  await patchRows(config, `quiz_items?activity_id=eq.${enc(activityId)}`, {
    status: "archived",
    updated_at: new Date().toISOString(),
  });
  await serviceFetch(config, `/rest/v1/lesson_activities?id=eq.${enc(activityId)}`, {
    method: "DELETE",
  });
  return json({ status: "ok", node_type: "step", id: activityId, lesson_id: lessonId });
}

// ---------------------------------------------------------------------------
// AI authoring (Phase 4 of the curriculum authoring redesign).
// `generate` drafts a course outline or a lesson's steps from a teacher prompt and
// returns structured JSON — it NEVER writes. The teacher reviews and applies the
// draft through the existing create/upsert actions (review-before-save by design).
// ---------------------------------------------------------------------------

async function callModelJson(systemPrompt: string, userPrompt: string): Promise<DbRow> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("AI authoring is not configured (OPENAI_API_KEY missing).");
  const model = Deno.env.get("OPENAI_MODEL_DEFAULT")?.trim() || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const message =
      data && typeof data === "object" && data.error && typeof data.error === "object"
        ? String((data.error as DbRow).message || "Model request failed.")
        : "Model request failed.";
    throw new Error(message);
  }
  const content = data?.choices?.[0]?.message?.content;
  try {
    const parsed = JSON.parse(typeof content === "string" && content ? content : "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as DbRow) : {};
  } catch {
    throw new Error("The model returned invalid JSON. Try again.");
  }
}

function clampText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function currentVersionIdForCourse(config: Config, courseId: string): Promise<string> {
  const rows = await selectAll(
    config,
    `course_versions?course_id=eq.${enc(courseId)}&select=id,is_current,updated_at&order=is_current.desc,updated_at.desc&limit=1`,
  );
  return rows[0] ? cleanText(rows[0].id) : "";
}

// Compact summary of everything under the course's SUBJECT, so generated outlines fit
// the existing curriculum instead of duplicating it.
async function courseOutlineContext(
  config: Config,
  courseId: string,
): Promise<{ organizationId: string; text: string }> {
  const scope = await courseScope(config, courseId);
  const subject = await selectFirst(
    config,
    `subjects?id=eq.${enc(scope.subjectId)}&select=title,description&limit=1`,
  );
  const courses = await selectAll(
    config,
    `courses?subject_id=eq.${enc(scope.subjectId)}&select=id,title&order=position.asc.nullslast,title.asc`,
  );
  const versionId = await currentVersionIdForCourse(config, courseId);
  let unitsText = "";
  if (versionId) {
    const units = await selectAll(
      config,
      `units?course_version_id=eq.${enc(versionId)}&select=id,title,position&order=position.asc`,
    );
    const unitIds = units.map((u) => cleanText(u.id)).filter(Boolean);
    const lessons = unitIds.length
      ? await selectAll(
          config,
          `lessons?unit_id=in.(${unitIds.map(enc).join(",")})&select=unit_id,title,unit_position&order=unit_position.asc.nullslast`,
        )
      : [];
    unitsText = units
      .map((u) => {
        const ls = lessons
          .filter((l) => cleanText(l.unit_id) === cleanText(u.id))
          .map((l) => cleanText(l.title))
          .filter(Boolean);
        return `- ${cleanText(u.title)}${ls.length ? `: ${ls.join("; ")}` : " (no lessons yet)"}`;
      })
      .join("\n");
  }
  const otherCourses = courses.map((c) => cleanText(c.title)).filter(Boolean);
  const lines = [
    subject
      ? `Subject: ${cleanText(subject.title)}${cleanText(subject.description) ? ` — ${cleanText(subject.description)}` : ""}`
      : "",
    otherCourses.length ? `Courses already in this subject: ${otherCourses.join(", ")}` : "",
    unitsText ? `This course's current units and lessons:\n${unitsText}` : "This course has no units yet.",
  ].filter(Boolean);
  return { organizationId: scope.organizationId, text: clampText(lines.join("\n"), 3000) };
}

// Compact summary of the lesson, its unit siblings, and its current steps.
async function lessonStepsContext(
  config: Config,
  lessonId: string,
): Promise<{ organizationId: string; text: string }> {
  const scope = await courseScopeForLesson(config, lessonId);
  const subject = await selectFirst(config, `subjects?id=eq.${enc(scope.subjectId)}&select=title&limit=1`);
  const course = await selectFirst(config, `courses?id=eq.${enc(scope.courseId)}&select=title&limit=1`);
  const unit = await selectFirst(config, `units?id=eq.${enc(scope.unitId)}&select=title&limit=1`);
  const lesson = await selectFirst(
    config,
    `lessons?id=eq.${enc(lessonId)}&select=title,tutor_prompt&limit=1`,
  );
  const siblings = await selectAll(
    config,
    `lessons?unit_id=eq.${enc(scope.unitId)}&select=title,unit_position&order=unit_position.asc.nullslast`,
  );
  const steps = await selectAll(
    config,
    `lesson_activities?lesson_id=eq.${enc(lessonId)}&select=title,stage,response_mode,position&order=position.asc`,
  );
  const siblingTitles = siblings.map((s) => cleanText(s.title)).filter(Boolean);
  const stepLines = steps
    .map((s) => `- [${cleanText(s.stage)}/${cleanText(s.response_mode)}] ${cleanText(s.title)}`)
    .join("\n");
  const lines = [
    subject ? `Subject: ${cleanText(subject.title)}` : "",
    course ? `Course: ${cleanText(course.title)}` : "",
    unit ? `Unit: ${cleanText(unit.title)}` : "",
    lesson ? `Lesson: ${cleanText(lesson.title)}` : "",
    cleanText(lesson?.tutor_prompt) ? `Mentor prompt: ${clampText(cleanText(lesson?.tutor_prompt), 600)}` : "",
    siblingTitles.length ? `Other lessons in this unit: ${siblingTitles.join(", ")}` : "",
    stepLines ? `This lesson's current steps:\n${stepLines}` : "This lesson has no steps yet.",
  ].filter(Boolean);
  return { organizationId: scope.organizationId, text: clampText(lines.join("\n"), 3000) };
}

function parseOutlineUnits(result: DbRow) {
  const rawUnits = Array.isArray(result.units) ? result.units : [];
  return rawUnits
    .slice(0, 8)
    .map((unit) => {
      const row = unit && typeof unit === "object" ? (unit as DbRow) : {};
      const lessons = (Array.isArray(row.lessons) ? row.lessons : [])
        .slice(0, 12)
        .map((lesson) => ({
          title: cleanText((lesson && typeof lesson === "object" ? (lesson as DbRow) : {}).title),
        }))
        .filter((lesson) => lesson.title);
      return { title: cleanText(row.title), lessons };
    })
    .filter((unit) => unit.title);
}

function parseStepDrafts(result: DbRow) {
  const rawSteps = Array.isArray(result.steps) ? result.steps : [];
  return rawSteps
    .slice(0, 10)
    .map((step) => {
      const row = step && typeof step === "object" ? (step as DbRow) : {};
      // v4 drafts carry a mode; older drafts (and refine round-trips of them) carry a
      // kind. Accept either, derive the other, validate both.
      const draftMode =
        cleanMode(row.mode) ??
        ({ teach: "explanation", practice: "practice", checkpoint: "assessment", reflect: "reflection" }[
          cleanText(row.kind)
        ] ||
          "practice");
      const draftModeType = cleanModeType(draftMode, row.mode_type);
      const kind =
        draftMode === "explanation" || draftMode === "media"
          ? "teach"
          : draftMode === "assessment"
            ? "checkpoint"
            : draftMode === "practice"
              ? "practice"
              : "reflect";
      const isMcq = draftMode === "assessment" && draftModeType !== "open_ended";
      const choices = parseChoices(row.choices);
      return {
        kind,
        mode: draftMode,
        mode_type: draftModeType,
        title: cleanText(row.title) || "Step",
        prompt: cleanText(row.prompt),
        choices: isMcq ? choices : [],
        correct_choice_id: isMcq ? cleanText(row.correct_choice_id) : "",
      };
    })
    .filter((step) => step.prompt || step.title);
}

// --- Org-shared lesson templates (v4.0 Phase 2; docs/PLATFORM.md §4) -----------
// A template is a by-value snapshot of a lesson's mode flow + policy; instantiation is a
// fresh lesson fanned out through upsertStep, so a template never drifts with its source.

async function saveTemplate(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const lessonId = cleanText(body.lesson_id);
  if (!lessonId) throw new Error("lesson_id is required.");
  const scope = await courseScopeForLesson(config, lessonId);
  await assertCanAuthor(config, actorId, scope.organizationId, cleanText(body.class_id));

  const lesson = await selectFirst(config, `lessons?id=eq.${enc(lessonId)}&select=*&limit=1`);
  if (!lesson) throw new Error("Lesson was not found.");

  const activities = await selectAll(
    config,
    `lesson_activities?lesson_id=eq.${enc(lessonId)}&order=position.asc&select=*`,
  );
  const activityIds = activities.map((a) => String(a.id)).filter(Boolean);
  const quizzes = activityIds.length
    ? await selectAll(
        config,
        `quiz_items?activity_id=in.(${activityIds.map(enc).join(",")})&status=neq.archived&select=*`,
      )
    : [];
  const quizByActivity = new Map<string, DbRow>();
  for (const q of quizzes) quizByActivity.set(String(q.activity_id), q);

  const steps = activities.map((a, index) => {
    const quiz = quizByActivity.get(String(a.id));
    return {
      v: 1,
      position: Number(a.position) || index + 1,
      title: cleanText(a.title),
      // stage is a display label; activity_type is the legacy (mode=null) runtime kind.
      // Snapshot both so a round-trip preserves them (upsertStep re-derives activity_type
      // from mode for v4 steps and reads step.activity_type only for legacy steps).
      stage: isStage(a.stage) ? a.stage : "practice",
      activity_type: isLessonType(a.activity_type) ? a.activity_type : undefined,
      mode: cleanMode(a.mode),
      mode_type: cleanText(a.mode_type) || null,
      prompt: cleanText(a.prompt),
      response_mode: isResponseMode(a.response_mode) ? a.response_mode : "text",
      starter_code: cleanText(a.starter_code),
      expected_output: cleanText(a.expected_output) || null,
      choices: parseChoices(a.choices),
      rubric:
        a.rubric && typeof a.rubric === "object" && !Array.isArray(a.rubric)
          ? (a.rubric as DbRow)
          : {},
      skill_keys: cleanStringArray(a.skill_keys),
      pass_score: Number(a.pass_score) > 0 ? Number(a.pass_score) : 1,
      quiz: quiz
        ? {
            prompt: cleanText(quiz.prompt),
            choices: parseChoices(quiz.choices),
            correct_choice_ids: cleanStringArray(quiz.correct_choice_ids),
          }
        : null,
    };
  });

  const milestone = await selectFirst(
    config,
    `milestones?lesson_id=eq.${enc(lessonId)}&order=position.asc&limit=1&select=objective,skill_keys`,
  );
  const meta = {
    title: cleanText(lesson.title),
    tutor_prompt: cleanText(lesson.tutor_prompt),
    level: cleanText(lesson.level) || "Any level",
    sample_code: cleanText(lesson.sample_code),
    help_ceiling: cleanText(lesson.help_ceiling) || null,
    require_attempt_first:
      typeof lesson.require_attempt_first === "boolean"
        ? lesson.require_attempt_first
        : null,
    final_answer_policy: cleanText(lesson.final_answer_policy) || null,
    tutor_tone: cleanText(lesson.tutor_tone) || null,
    tutor_pace: cleanText(lesson.tutor_pace) || null,
    grade_band: cleanText(lesson.grade_band) || null,
    objective: cleanText(milestone?.objective),
    skill_keys: cleanStringArray(milestone?.skill_keys),
  };

  const title = cleanText(body.title) || `${cleanText(lesson.title)} template`;
  const inserted = await insertRow(config, "lesson_templates", {
    organization_id: scope.organizationId,
    title,
    description: cleanText(body.description),
    source_lesson_id: lessonId,
    steps,
    meta,
    created_by: actorId,
  });
  return json({ status: "ok", template_id: inserted.id, title });
}

async function listTemplates(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const organizationId = cleanText(body.organization_id);
  if (!organizationId) throw new Error("organization_id is required.");
  await assertCanAuthor(config, actorId, organizationId, cleanText(body.class_id));
  const rows = await selectAll(
    config,
    `lesson_templates?organization_id=eq.${enc(organizationId)}&status=eq.active&order=updated_at.desc&select=id,title,description,source_lesson_id,steps,created_at`,
  );
  const templates = rows.map((row) => ({
    id: row.id,
    title: cleanText(row.title),
    description: cleanText(row.description),
    source_lesson_id: row.source_lesson_id || null,
    steps: Array.isArray(row.steps) ? row.steps : [],
    created_at: row.created_at,
  }));
  return json({ status: "ok", templates });
}

async function archiveTemplate(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const templateId = cleanText(body.template_id);
  if (!templateId) throw new Error("template_id is required.");
  const template = await selectFirst(
    config,
    `lesson_templates?id=eq.${enc(templateId)}&select=id,organization_id&limit=1`,
  );
  if (!template) throw new Error("Template was not found.");
  await assertCanAuthor(config, actorId, String(template.organization_id), cleanText(body.class_id));
  await patchRows(config, `lesson_templates?id=eq.${enc(templateId)}`, {
    status: "archived",
    updated_at: new Date().toISOString(),
  });
  return json({ status: "ok", template_id: templateId });
}

// v4.0 Phase 3: set the full course scope for a class (replace semantics). An empty course_ids
// list clears the scope (the class reverts to the full-catalog fallback). Auditable teacher/admin
// write — assertCanAuthor gates on the CLASS's own organization.
async function setClassCourses(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const classId = cleanText(body.class_id);
  if (!classId) throw new Error("class_id is required.");
  // NOT cleanStringArray: it caps at 24, which would silently truncate a large course set (a
  // full-replace would then drop the dropped ids). A class can legitimately link many courses.
  const courseIds = Array.from(
    new Set(
      (Array.isArray(body.course_ids) ? body.course_ids : [])
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
  );

  const classRow = await selectFirst(
    config,
    `classes?id=eq.${enc(classId)}&select=id,organization_id&limit=1`,
  );
  if (!classRow) throw new Error("Class was not found.");
  const classOrgId = String(classRow.organization_id);
  await assertCanAuthor(config, actorId, classOrgId, classId);

  // Validate every course id exists AND belongs to this class's org (or is a global course with
  // null org) — mirrors the org-scoping discipline of the other authoring actions and yields a
  // clean 4xx for a bad/foreign id instead of an FK 500. Unquoted in.(...) idiom (slugified ids).
  if (courseIds.length) {
    const found = await selectAll(
      config,
      `courses?id=in.(${courseIds.map(enc).join(",")})&select=id,organization_id`,
    );
    const validIds = new Set(
      found
        .filter((row) => !row.organization_id || String(row.organization_id) === classOrgId)
        .map((row) => String(row.id)),
    );
    const missing = courseIds.filter((id) => !validIds.has(id));
    if (missing.length) {
      throw new Error(`These courses were not found in this organization: ${missing.join(", ")}.`);
    }
  }

  // Fail-safe replace: UPSERT the desired links first, THEN delete the ones no longer wanted.
  // Insert-before-delete means a transient failure never leaves the class with an empty scope
  // (the two PostgREST calls are not one transaction); at worst a stale extra link survives —
  // fail-open (students see more, never fewer) and self-heals on the next successful save.
  if (courseIds.length) {
    const now = new Date().toISOString();
    await serviceFetch(config, "/rest/v1/class_courses?on_conflict=class_id,course_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(
        courseIds.map((courseId) => ({
          class_id: classId,
          course_id: courseId,
          created_by: actorId,
          created_at: now,
        })),
      ),
    });
    await serviceFetch(
      config,
      `/rest/v1/class_courses?class_id=eq.${enc(classId)}&course_id=not.in.(${courseIds.map(enc).join(",")})`,
      { method: "DELETE" },
    );
  } else {
    // Clearing the scope entirely.
    await serviceFetch(config, `/rest/v1/class_courses?class_id=eq.${enc(classId)}`, {
      method: "DELETE",
    });
  }

  return json({ status: "ok", class_id: classId, course_ids: courseIds });
}

async function instantiateTemplate(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const templateId = cleanText(body.template_id);
  const unitId = cleanText(body.unit_id);
  if (!templateId) throw new Error("template_id is required.");
  if (!unitId) throw new Error("unit_id is required.");
  const scope = await unitScope(config, unitId);
  await assertCanAuthor(config, actorId, scope.organizationId, cleanText(body.class_id));

  const template = await selectFirst(
    config,
    `lesson_templates?id=eq.${enc(templateId)}&status=eq.active&select=*&limit=1`,
  );
  if (!template) throw new Error("Template was not found.");
  // Org-shared, not cross-org: a template can only be instantiated inside its own org.
  // Message includes "does not match" so the router maps it to a 4xx, not a 500.
  if (String(template.organization_id) !== scope.organizationId) {
    throw new Error("Template organization does not match this unit's organization.");
  }

  const meta = template.meta && typeof template.meta === "object" ? (template.meta as DbRow) : {};
  const templateSteps = (Array.isArray(template.steps) ? template.steps : [])
    .map((step) => (step && typeof step === "object" ? (step as DbRow) : null))
    .filter((step): step is DbRow => step !== null)
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));

  // Create the lesson + its milestone (no default activity — the template supplies steps).
  const title = cleanText(body.title) || cleanText(meta.title) || "Untitled lesson";
  const level = cleanText(meta.level) || "Any level";
  const lessonId = await uniqueId(config, "lessons", safeId(unitId, title));
  const milestoneId = `${lessonId}-milestone-1`;
  const position = await nextLessonPosition(config);
  const unitPosition = await nextPosition(config, "lessons", `unit_id=eq.${enc(unitId)}`, "unit_position");
  const now = new Date().toISOString();

  const HELP_CEILINGS = ["clarify", "hints", "guided", "worked_example", "feedback", "study"];
  const FINAL_ANSWER_POLICIES = ["never", "after_attempt", "allowed"];
  const policy: DbRow = {};
  if (HELP_CEILINGS.includes(cleanText(meta.help_ceiling))) policy.help_ceiling = cleanText(meta.help_ceiling);
  if (FINAL_ANSWER_POLICIES.includes(cleanText(meta.final_answer_policy))) {
    policy.final_answer_policy = cleanText(meta.final_answer_policy);
  }
  if (typeof meta.require_attempt_first === "boolean") policy.require_attempt_first = meta.require_attempt_first;
  if (cleanText(meta.tutor_tone)) policy.tutor_tone = cleanText(meta.tutor_tone);
  if (cleanText(meta.tutor_pace)) policy.tutor_pace = cleanText(meta.tutor_pace);
  if (cleanText(meta.grade_band)) policy.grade_band = cleanText(meta.grade_band);

  await insertRow(config, "lessons", {
    id: lessonId,
    position,
    unit_position: unitPosition,
    title,
    module: scope.unitTitle || "Lesson",
    level,
    tutor_prompt: cleanText(meta.tutor_prompt) || "Introduce this lesson and guide the learner step by step.",
    sample_code: cleanText(meta.sample_code),
    expected_output: null,
    unit_id: unitId,
    author_user_id: actorId,
    publication_status: "draft",
    curriculum_metadata: {
      course_id: scope.courseId,
      course_version_id: scope.courseVersionId,
      class_id: cleanText(body.class_id) || null,
      instantiated_from_template: templateId,
    },
    ...policy,
  });
  await upsertByConflict(config, "milestones", "id", {
    id: milestoneId,
    lesson_id: lessonId,
    position: 1,
    title,
    objective: cleanText(meta.objective) || "Describe what the learner should be able to do.",
    level,
    skill_keys: cleanStringArray(meta.skill_keys),
    expected_evidence: {},
    completion_rules: { requires: ["activity_complete"], min_score: 1 },
    allowed_response_modes: ["text"],
    updated_at: now,
  });
  await patchRows(config, `lessons?id=eq.${enc(lessonId)}`, { milestone_id: milestoneId });

  // Fan the snapshot out through upsertStep (positions land in template order).
  for (const step of templateSteps) {
    await upsertStep(config, actorId, {
      lesson_id: lessonId,
      class_id: cleanText(body.class_id),
      step,
    });
  }

  return json({
    status: "ok",
    node_type: "lesson",
    id: lessonId,
    lesson_id: lessonId,
    unit_id: unitId,
    milestone_id: milestoneId,
    position,
    unit_position: unitPosition,
    steps: templateSteps.length,
  });
}

async function generateDraft(config: Config, actorId: string, body: DbRow): Promise<Response> {
  const mode = cleanText(body.mode);
  const prompt = cleanText(body.prompt);
  const referenceText = clampText(cleanText(body.reference_text), 8000);
  const feedback = cleanText(body.feedback);
  const target = cleanText(body.target);
  const hasCurrent = Boolean(body.current && typeof body.current === "object");
  const isRefine = hasCurrent && Boolean(feedback);
  const currentJson = hasCurrent ? clampText(JSON.stringify(body.current), 6000) : "";

  if (mode === "course_outline") {
    const courseId = cleanText(body.course_id);
    let organizationId = cleanText(body.organization_id);
    let contextText = "";
    if (courseId) {
      const ctx = await courseOutlineContext(config, courseId);
      organizationId = ctx.organizationId;
      contextText = ctx.text;
    }
    if (!organizationId) throw new Error("organization_id is required.");
    await assertCanAuthor(config, actorId, organizationId, cleanText(body.class_id));
    if (!isRefine && !prompt) throw new Error("prompt is required.");

    const system =
      "You are a curriculum designer. Return ONLY JSON of the form " +
      '{"units":[{"title":string,"lessons":[{"title":string}]}]}. ' +
      "Use 2-5 units and 2-6 short, student-facing lesson titles each. Fit the existing " +
      "curriculum context: do not duplicate existing units/lessons; match the level and style. " +
      "If reference material is provided, ground the outline in it.";
    const parts: string[] = [];
    if (contextText) parts.push(`Existing curriculum context:\n${contextText}`);
    if (referenceText) parts.push(`Reference material to draw on:\n${referenceText}`);
    if (isRefine) {
      parts.push(`Current draft outline (JSON):\n${currentJson}`);
      parts.push(
        `Revise the draft per this feedback${target ? ` (which targets ${target})` : ""}: ${feedback}\n` +
          "Change only what the feedback asks; keep everything else identical. Return the full updated outline.",
      );
    } else {
      parts.push(`Design a course outline for this brief:\n${clampText(prompt, 2000)}`);
    }
    const result = await callModelJson(system, parts.join("\n\n"));
    return json({ status: "ok", mode, outline: { units: parseOutlineUnits(result) } });
  }

  if (mode === "lesson_steps") {
    const lessonId = cleanText(body.lesson_id);
    if (!lessonId) throw new Error("lesson_id is required.");
    const ctx = await lessonStepsContext(config, lessonId);
    await assertCanAuthor(config, actorId, ctx.organizationId, cleanText(body.class_id));
    if (!isRefine && !prompt) throw new Error("prompt is required.");

    const system =
      "You design a single lesson as an ordered list of steps. Every step has a learning MODE " +
      "(the platform's pedagogical vocabulary). Return ONLY JSON of the form " +
      '{"steps":[{"mode":"explanation"|"media"|"reflection"|"practice"|"assignment"|"inquiry"|"assessment"|"revision",' +
      '"mode_type":string,"title":string,"prompt":string,' +
      '"choices":[{"id":string,"text":string}],"correct_choice_id":string}]}. ' +
      "mode_type is required only for practice ('code' for run-the-code steps, 'applied' for " +
      "use-the-idea-in-words steps) and assessment ('mcq' or 'open_ended'). " +
      "Include choices and correct_choice_id ONLY for assessment/mcq steps " +
      "(2-4 choices with ids a,b,c,d). Use 3-6 steps. A good lesson opens with explanation or " +
      "media, works the idea with reflection or practice, and ends with an assessment. " +
      "Keep prompts concrete and age-appropriate. Fit the lesson context. " +
      "If reference material is provided, ground the steps in it.";
    const parts: string[] = [];
    if (ctx.text) parts.push(`Lesson context:\n${ctx.text}`);
    if (referenceText) parts.push(`Reference material to draw on:\n${referenceText}`);
    // Optional template scaffold: the template's mode flow is the skeleton; the AI keeps the
    // same modes/order/mode_types and rewrites titles + prompts for THIS lesson's topic.
    const templateId = cleanText(body.template_id);
    if (templateId) {
      const template = await selectFirst(
        config,
        `lesson_templates?id=eq.${enc(templateId)}&organization_id=eq.${enc(ctx.organizationId)}&status=eq.active&select=steps&limit=1`,
      );
      const skeleton = Array.isArray(template?.steps)
        ? (template!.steps as unknown[]).map((step) => {
            const row = step && typeof step === "object" ? (step as DbRow) : {};
            return { mode: cleanText(row.mode), mode_type: cleanText(row.mode_type), title: cleanText(row.title) };
          })
        : [];
      if (skeleton.length) {
        parts.push(
          "Follow this template's mode flow EXACTLY — keep the same modes, order, and mode_types; " +
            `only rewrite each step's title and prompt for the new topic:\n${JSON.stringify(skeleton)}`,
        );
      }
    }
    if (isRefine) {
      parts.push(`Current draft steps (JSON):\n${currentJson}`);
      parts.push(
        `Revise the draft per this feedback${target ? ` (which targets ${target})` : ""}: ${feedback}\n` +
          "Change only what the feedback asks; keep everything else identical. Return the full updated steps array.",
      );
    } else {
      parts.push(`Draft the steps for this lesson brief:\n${clampText(prompt, 2000)}`);
    }
    const result = await callModelJson(system, parts.join("\n\n"));
    return json({ status: "ok", mode, steps: parseStepDrafts(result) });
  }

  throw new Error("Unsupported generate mode.");
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
    const actorId = String(actor.id);
    if (action === "save_lesson_blueprint") return await saveLessonBlueprint(config, actorId, record);
    if (action === "publish_lesson") return await publishLesson(config, actorId, record);
    if (action === "archive_lesson") return await archiveLesson(config, actorId, record);
    if (action === "create_subject") return await createSubject(config, actorId, record);
    if (action === "create_course") return await createCourse(config, actorId, record);
    if (action === "create_unit") return await createUnit(config, actorId, record);
    if (action === "create_lesson_stub") return await createLessonStub(config, actorId, record);
    if (action === "rename_node") return await renameNode(config, actorId, record);
    if (action === "reorder") return await reorderNodes(config, actorId, record);
    if (action === "move_lesson") return await moveLesson(config, actorId, record);
    if (action === "archive_node") return await archiveNode(config, actorId, record);
    if (action === "delete_node") return await deleteNode(config, actorId, record);
    if (action === "save_lesson_meta") return await saveLessonMeta(config, actorId, record);
    if (action === "upsert_step") return await upsertStep(config, actorId, record);
    if (action === "reorder_steps") return await reorderSteps(config, actorId, record);
    if (action === "delete_step") return await deleteStep(config, actorId, record);
    if (action === "save_template") return await saveTemplate(config, actorId, record);
    if (action === "list_templates") return await listTemplates(config, actorId, record);
    if (action === "instantiate_template") return await instantiateTemplate(config, actorId, record);
    if (action === "archive_template") return await archiveTemplate(config, actorId, record);
    if (action === "set_class_courses") return await setClassCourses(config, actorId, record);
    if (action === "generate") return await generateDraft(config, actorId, record);
    return errorResponse("Unsupported curriculum-admin action.", 400);
  } catch (error) {
    const message = errorMessage(error);
    const lower = message.toLowerCase();
    const status = lower.includes("access") || lower.includes("author")
      ? 403
      : lower.includes("authentication") || lower.includes("authenticated")
        ? 401
        : lower.includes("before deleting") || lower.includes("instead of deleting")
          ? 409
          : lower.includes("required") ||
              lower.includes("not found") ||
              lower.includes("does not match") ||
              lower.includes("unsupported") ||
              lower.includes("unknown id") ||
              lower.includes("belong to different") ||
              lower.includes("different lesson") ||
              lower.includes("duplicate") ||
              lower.includes("at least one") ||
              lower.includes("can be archived")
            ? 400
            : 500;
    return errorResponse(message, status);
  }
});
