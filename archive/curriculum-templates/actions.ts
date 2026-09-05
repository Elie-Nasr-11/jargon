// ARCHIVED 2026-09-03 — R102. Lesson/rubric template handlers and the bulk curriculum
// importer, lifted out of supabase/functions/curriculum-admin/index.ts (commit a9ded0b).
// See ./NOTES.md. Their tables (lesson_templates, rubric_templates) still exist and are
// empty, so a restore needs no migration.

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
    allow_live_artifacts: lesson.allow_live_artifacts === true,
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
  if (typeof meta.allow_live_artifacts === "boolean") {
    policy.allow_live_artifacts = meta.allow_live_artifacts;
  }

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


