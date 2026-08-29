/**
 * The authoring studio's local-state algebra.
 *
 * Every function here is pure: outline rows in, outline rows out. The studio
 * applies each edit locally first (so the tree responds at once) and only then
 * writes it through curriculum-admin; these are the local halves of that pair,
 * plus the small ordering and breadcrumb helpers the outline reads.
 */
import type {
  CurriculumAuthoringData,
  CurriculumCourse,
  CurriculumNodeType,
  CurriculumQuizItem,
  CurriculumStepInput,
  CurriculumSubject,
  CurriculumUnit,
  Lesson,
  LessonActivity,
} from "@/lib/types";
import type { LessonKind, Selection } from "@/features/teacher/authoring/types";

export function byPositionThenTitle(
  a: { position: number | null; title: string },
  b: { position: number | null; title: string },
) {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER;
  const pb = b.position ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return a.title.localeCompare(b.title);
}

export function lessonOrder(lesson: Lesson) {
  return lesson.unit_position ?? lesson.position ?? Number.MAX_SAFE_INTEGER;
}

export function nodeLabel(nodeType: CurriculumNodeType): string {
  return nodeType.charAt(0).toUpperCase() + nodeType.slice(1);
}

// The actual rows removed by a cascading delete, captured so Undo can re-insert them.
export function collectRemovedRows(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  id: string,
): Partial<CurriculumAuthoringData> {
  const ids = collectRemovedIds(data, nodeType, id);
  const lessonIds = new Set(data.lessons.filter((l) => ids.has(l.id)).map((l) => l.id));
  return {
    subjects: data.subjects.filter((s) => ids.has(s.id)),
    courses: data.courses.filter((c) => ids.has(c.id)),
    // Versions aren't selectable so they're not in `ids`; capture by removed course.
    courseVersions: data.courseVersions.filter((v) => ids.has(v.course_id)),
    units: data.units.filter((u) => ids.has(u.id)),
    lessons: data.lessons.filter((l) => ids.has(l.id)),
    milestones: data.milestones.filter((m) => lessonIds.has(m.lesson_id)),
    activities: data.activities.filter((a) => lessonIds.has(a.lesson_id)),
    quizzes: data.quizzes.filter((q) => lessonIds.has(q.lesson_id)),
  };
}

// Re-insert previously-removed rows (skipping any ids that already exist) — the
// inverse of cascadeRemove, used by Undo.
export function mergeRows(
  data: CurriculumAuthoringData,
  removed: Partial<CurriculumAuthoringData>,
): CurriculumAuthoringData {
  const merge = <T extends { id: string }>(current: T[], add?: T[]): T[] => {
    if (!add || !add.length) return current;
    const present = new Set(current.map((row) => row.id));
    return [...current, ...add.filter((row) => !present.has(row.id))];
  };
  return {
    ...data,
    subjects: merge(data.subjects, removed.subjects),
    courses: merge(data.courses, removed.courses),
    courseVersions: merge(data.courseVersions, removed.courseVersions),
    units: merge(data.units, removed.units),
    lessons: merge(data.lessons, removed.lessons),
    milestones: merge(data.milestones, removed.milestones),
    activities: merge(data.activities, removed.activities),
    quizzes: merge(data.quizzes, removed.quizzes),
  };
}

// --- Optimistic local mutations -------------------------------------------
// Pure transforms over the in-memory CurriculumAuthoringData so structure edits
// reflect instantly; the network call persists the same change in the background.

// Every node id removed when deleting a subject/course/unit/lesson (cascades down
// the hierarchy). Used to drop the right rows and to clear a stale selection.
export function collectRemovedIds(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  id: string,
): Set<string> {
  const subjectIds = new Set<string>();
  const courseIds = new Set<string>();
  const versionIds = new Set<string>();
  const unitIds = new Set<string>();
  const lessonIds = new Set<string>();

  if (nodeType === "subject") subjectIds.add(id);
  if (nodeType === "course") courseIds.add(id);
  if (nodeType === "unit") unitIds.add(id);
  if (nodeType === "lesson") lessonIds.add(id);

  if (subjectIds.size)
    for (const c of data.courses) if (subjectIds.has(c.subject_id)) courseIds.add(c.id);
  if (courseIds.size)
    for (const v of data.courseVersions) if (courseIds.has(v.course_id)) versionIds.add(v.id);
  if (versionIds.size)
    for (const u of data.units) if (versionIds.has(u.course_version_id)) unitIds.add(u.id);
  if (unitIds.size)
    for (const l of data.lessons) if (l.unit_id && unitIds.has(l.unit_id)) lessonIds.add(l.id);

  return new Set<string>([...subjectIds, ...courseIds, ...unitIds, ...lessonIds]);
}

export function cascadeRemove(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  id: string,
): CurriculumAuthoringData {
  const subjectIds = new Set<string>();
  const courseIds = new Set<string>();
  const versionIds = new Set<string>();
  const unitIds = new Set<string>();
  const lessonIds = new Set<string>();

  if (nodeType === "subject") subjectIds.add(id);
  if (nodeType === "course") courseIds.add(id);
  if (nodeType === "unit") unitIds.add(id);
  if (nodeType === "lesson") lessonIds.add(id);

  if (subjectIds.size)
    for (const c of data.courses) if (subjectIds.has(c.subject_id)) courseIds.add(c.id);
  if (courseIds.size)
    for (const v of data.courseVersions) if (courseIds.has(v.course_id)) versionIds.add(v.id);
  if (versionIds.size)
    for (const u of data.units) if (versionIds.has(u.course_version_id)) unitIds.add(u.id);
  if (unitIds.size)
    for (const l of data.lessons) if (l.unit_id && unitIds.has(l.unit_id)) lessonIds.add(l.id);

  return {
    ...data,
    subjects: data.subjects.filter((s) => !subjectIds.has(s.id)),
    courses: data.courses.filter((c) => !courseIds.has(c.id)),
    courseVersions: data.courseVersions.filter((v) => !versionIds.has(v.id)),
    units: data.units.filter((u) => !unitIds.has(u.id)),
    lessons: data.lessons.filter((l) => !lessonIds.has(l.id)),
    milestones: data.milestones.filter((m) => !lessonIds.has(m.lesson_id)),
    activities: data.activities.filter((a) => !lessonIds.has(a.lesson_id)),
    quizzes: data.quizzes.filter((q) => !lessonIds.has(q.lesson_id)),
  };
}

export function reorderNodesLocal(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  orderedIds: string[],
): CurriculumAuthoringData {
  const pos = new Map(orderedIds.map((id, i) => [id, i + 1]));
  if (nodeType === "subject")
    return {
      ...data,
      subjects: data.subjects.map((s) => (pos.has(s.id) ? { ...s, position: pos.get(s.id)! } : s)),
    };
  if (nodeType === "course")
    return {
      ...data,
      courses: data.courses.map((c) => (pos.has(c.id) ? { ...c, position: pos.get(c.id)! } : c)),
    };
  if (nodeType === "unit")
    return {
      ...data,
      units: data.units.map((u) => (pos.has(u.id) ? { ...u, position: pos.get(u.id)! } : u)),
    };
  return {
    ...data,
    lessons: data.lessons.map((l) => (pos.has(l.id) ? { ...l, unit_position: pos.get(l.id)! } : l)),
  };
}

export function renameNodeLocal(
  data: CurriculumAuthoringData,
  nodeType: CurriculumNodeType,
  id: string,
  title: string,
  description?: string,
): CurriculumAuthoringData {
  const withDesc = description !== undefined;
  if (nodeType === "subject")
    return {
      ...data,
      subjects: data.subjects.map((s) =>
        s.id === id ? { ...s, title, ...(withDesc ? { description } : {}) } : s,
      ),
    };
  if (nodeType === "course")
    return {
      ...data,
      courses: data.courses.map((c) =>
        c.id === id ? { ...c, title, ...(withDesc ? { description } : {}) } : c,
      ),
    };
  if (nodeType === "unit")
    return {
      ...data,
      units: data.units.map((u) =>
        u.id === id ? { ...u, title, ...(withDesc ? { description } : {}) } : u,
      ),
    };
  return {
    ...data,
    lessons: data.lessons.map((l) => (l.id === id ? { ...l, title } : l)),
  };
}

// Map a step input onto a lesson_activities row, mirroring the edge function's
// defaults so the optimistic row matches what the server will persist.
export function activityFromStepInput(
  lessonId: string,
  step: CurriculumStepInput,
  position: number,
  id: string,
): LessonActivity {
  return {
    id,
    lesson_id: lessonId,
    position,
    title: step.title || "Step",
    activity_type: step.activity_type,
    stage: step.stage,
    prompt: step.prompt || "Add a prompt for learners.",
    response_mode: step.response_mode,
    starter_code: step.starter_code || "",
    expected_output: step.expected_output || null,
    choices: step.choices || [],
    rubric: {},
    skill_keys: step.skill_keys || [],
    pass_score: step.pass_score && step.pass_score > 0 ? step.pass_score : 1,
    mode: step.mode ?? null,
    mode_type: step.mode_type ?? null,
  };
}

export function quizFromStepInput(
  activityId: string,
  lessonId: string,
  step: CurriculumStepInput,
  position: number,
): CurriculumQuizItem | null {
  if (step.response_mode !== "multiple_choice" || !step.quiz) return null;
  const choices = step.quiz.choices || [];
  const correct = step.quiz.correct_choice_ids || [];
  if (choices.length < 2 || !correct.length) return null;
  const now = new Date().toISOString();
  return {
    id: `${activityId}-quiz`,
    lesson_id: lessonId,
    milestone_id: null,
    activity_id: activityId,
    position,
    prompt: step.quiz.prompt || step.prompt || "Choose the best answer.",
    question_type: "multiple_choice",
    choices,
    correct_choice_ids: correct,
    rubric: {},
    skill_keys: step.skill_keys || [],
    status: "draft",
    created_at: now,
    updated_at: now,
  };
}

export function nextStepPosition(data: CurriculumAuthoringData, lessonId: string): number {
  const positions = data.activities.filter((a) => a.lesson_id === lessonId).map((a) => a.position);
  return positions.length ? Math.max(...positions) + 1 : 1;
}

export function insertStepLocal(
  data: CurriculumAuthoringData,
  lessonId: string,
  step: CurriculumStepInput,
  tempId: string,
): CurriculumAuthoringData {
  const position = nextStepPosition(data, lessonId);
  const activity = activityFromStepInput(lessonId, step, position, tempId);
  const quiz = quizFromStepInput(tempId, lessonId, step, position);
  return {
    ...data,
    activities: [...data.activities, activity],
    quizzes: quiz ? [...data.quizzes, quiz] : data.quizzes,
  };
}

export function patchStepLocal(
  data: CurriculumAuthoringData,
  lessonId: string,
  step: CurriculumStepInput,
): CurriculumAuthoringData {
  const id = step.id!;
  const position = data.activities.find((a) => a.id === id)?.position ?? 1;
  const activity = activityFromStepInput(lessonId, step, position, id);
  const quiz = quizFromStepInput(id, lessonId, step, position);
  return {
    ...data,
    activities: data.activities.map((a) => (a.id === id ? activity : a)),
    // Replace this step's quiz to match the edit (removing it when no longer a checkpoint).
    quizzes: [...data.quizzes.filter((q) => q.activity_id !== id), ...(quiz ? [quiz] : [])],
  };
}

// P5: bind/unbind a resource to a step in local state (mirror of the DB write).
export function patchResourceLocal(
  data: CurriculumAuthoringData,
  resourceId: string,
  activityId: string | null,
): CurriculumAuthoringData {
  return {
    ...data,
    resources: data.resources.map((resource) =>
      resource.id === resourceId ? { ...resource, activity_id: activityId } : resource,
    ),
  };
}

export function swapStepId(
  data: CurriculumAuthoringData,
  tempId: string,
  realId: string,
): CurriculumAuthoringData {
  return {
    ...data,
    activities: data.activities.map((a) => (a.id === tempId ? { ...a, id: realId } : a)),
    quizzes: data.quizzes.map((q) =>
      q.activity_id === tempId ? { ...q, id: `${realId}-quiz`, activity_id: realId } : q,
    ),
  };
}

export function reorderStepsLocal(
  data: CurriculumAuthoringData,
  orderedIds: string[],
): CurriculumAuthoringData {
  const pos = new Map(orderedIds.map((id, i) => [id, i + 1]));
  return {
    ...data,
    activities: data.activities.map((a) =>
      pos.has(a.id) ? { ...a, position: pos.get(a.id)! } : a,
    ),
    quizzes: data.quizzes.map((q) =>
      q.activity_id && pos.has(q.activity_id) ? { ...q, position: pos.get(q.activity_id)! } : q,
    ),
  };
}

export function reorderArray(ids: string[], srcId: string, targetId: string): string[] {
  const next = ids.filter((id) => id !== srcId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return ids;
  next.splice(targetIndex, 0, srcId);
  return next;
}

export function parseLessonKind(value: unknown): LessonKind | null {
  return ["discussion", "code", "reflection", "multiple_choice", "file"].includes(String(value))
    ? (value as LessonKind)
    : null;
}

export function buildBreadcrumb({
  selection,
  data,
  goRoot,
  goNode,
}: {
  selection: Selection;
  data: CurriculumAuthoringData | null;
  goRoot: () => void;
  goNode: (type: CurriculumNodeType, id: string) => void;
}) {
  // Rooted at the class's Curriculum section — the studio has no page of its own anymore,
  // so the crumb encodes only the content path (subject → … → lesson) within this class.
  const segments: Array<{ label: string; onClick?: () => void }> = [
    { label: "Content", onClick: goRoot },
  ];
  if (!selection || !data) return segments;

  const path = nodePath(selection, data);
  void goNode; // R60: no unit pane — the unit crumb is a label, not a link.

  // R45 consolidated: subject/course are invisible plumbing — the crumb shows only the
  // levels the teacher actually navigates (unit → lesson).
  if (path.unit) segments.push({ label: path.unit.title });
  if (path.lesson) segments.push({ label: path.lesson.title });
  return segments;
}

export function nodePath(selection: NonNullable<Selection>, data: CurriculumAuthoringData) {
  let subject: CurriculumSubject | undefined;
  let course: CurriculumCourse | undefined;
  let unit: CurriculumUnit | undefined;
  let lesson: Lesson | undefined;

  if (selection.type === "subject") {
    subject = data.subjects.find((item) => item.id === selection.id);
  } else if (selection.type === "course") {
    course = data.courses.find((item) => item.id === selection.id);
    subject = course ? data.subjects.find((item) => item.id === course!.subject_id) : undefined;
  } else if (selection.type === "unit") {
    unit = data.units.find((item) => item.id === selection.id);
    const version = unit
      ? data.courseVersions.find((item) => item.id === unit!.course_version_id)
      : undefined;
    course = version ? data.courses.find((item) => item.id === version.course_id) : undefined;
    subject = course ? data.subjects.find((item) => item.id === course!.subject_id) : undefined;
  } else {
    lesson = data.lessons.find((item) => item.id === selection.id);
    unit = lesson?.unit_id ? data.units.find((item) => item.id === lesson!.unit_id) : undefined;
    const version = unit
      ? data.courseVersions.find((item) => item.id === unit!.course_version_id)
      : undefined;
    course = version ? data.courses.find((item) => item.id === version.course_id) : undefined;
    subject = course ? data.subjects.find((item) => item.id === course!.subject_id) : undefined;
  }
  return { subject, course, unit, lesson };
}

// ---------------------------------------------------------------------------
// Small inputs.
// ---------------------------------------------------------------------------
