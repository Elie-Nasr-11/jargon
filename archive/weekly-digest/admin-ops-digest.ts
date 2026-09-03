// ARCHIVED 2026-09-03 — R102. Lifted verbatim out of supabase/functions/admin-ops/index.ts
// (lines 1872-2104 at commit a9ded0b). See ../README.md and ./NOTES.md before restoring:
// this code has a KNOWN BUG that made it fail on every run in production.

// R71: the weekly evidence digest.
//
// The pitch this product is sold on is "the book never told you who's stuck — this
// one does." That promise is only real if a teacher is TOLD, on a rhythm, without
// going looking. The hotlist answers "who needs me right now"; the progress report
// answers "how is this one child doing, for their parents". Neither answers the
// question a teacher actually carries into Monday: what did my class learn last
// week, and what do I need to teach again?
//
// Read-only and computed on demand — no new table, no scheduled job, nothing to
// migrate. A week window over evidence that is already recorded.
//
// The honest-reporting rule: this digest never converts thin data into confident
// claims. A skill only reaches "reteach" when at least TWO students missed it, so
// one child's bad afternoon is never presented to a teacher as a class-wide gap.

type DigestWindow = { from: string; to: string; days: number };

function digestWindow(body: DbRow): DigestWindow {
  const rawDays = Number(body.days);
  const days = Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 60 ? Math.floor(rawDays) : 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString(), days };
}

// Study time is inferred from the spacing of a student's own turns: consecutive turns
// less than 10 minutes apart are one sitting, and anything longer is a break, not study.
// Deliberately an UNDER-estimate — a teacher reading "42 minutes" should be able to
// trust that at least that much happened.
function studyMinutes(timestamps: number[]): number {
  if (timestamps.length < 2) return 0;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0 && gap <= 10 * 60 * 1000) total += gap;
  }
  return Math.round(total / 60000);
}

// The lessons THIS class teaches: class_courses -> course_versions -> units -> lessons.
// Without this a student enrolled in six classes has all six subjects' work counted in
// every digest, and a biology teacher is shown maths as their own class's progress.
async function classLessonIds(config: Config, classId: string): Promise<Set<string>> {
  const links = await selectRows(
    config,
    `class_courses?class_id=eq.${encodeURIComponent(classId)}&select=course_id`,
  );
  const courseIds = links.map((row) => cleanId(row.course_id)).filter(Boolean);
  if (!courseIds.length) return new Set();
  const versions = await selectRows(
    config,
    `course_versions?${inFilter("course_id", courseIds)}&select=id`,
  );
  const versionIds = versions.map((row) => cleanId(row.id)).filter(Boolean);
  if (!versionIds.length) return new Set();
  const units = await selectRows(
    config,
    `units?${inFilter("course_version_id", versionIds)}&select=id`,
  );
  const unitIds = units.map((row) => cleanId(row.id)).filter(Boolean);
  if (!unitIds.length) return new Set();
  const lessons = await selectRows(config, `lessons?${inFilter("unit_id", unitIds)}&select=id`);
  return new Set(lessons.map((row) => cleanText(row.id)).filter(Boolean));
}

async function buildClassDigest(
  config: Config,
  classId: string,
  window: DigestWindow,
): Promise<DbRow> {
  const [members, lessonIds] = await Promise.all([
    selectRows(
      config,
      `class_memberships?class_id=eq.${encodeURIComponent(classId)}&role=eq.student&status=eq.active&select=user_id`,
    ),
    classLessonIds(config, classId),
  ]);
  const studentIds = members.map((row) => cleanId(row.user_id)).filter(Boolean);
  if (!studentIds.length || !lessonIds.size) {
    return {
      window,
      students: { enrolled: studentIds.length, active: 0 },
      totals: {},
      movers: [],
      stalled: [],
      reteach: [],
      // A class with no course linked has nothing to report ON, which is different
      // from a class where nobody studied — say which.
      no_curriculum: studentIds.length > 0 && lessonIds.size === 0,
    };
  }
  const inList = `(${studentIds.map((id) => `"${id}"`).join(",")})`;
  const since = encodeURIComponent(window.from);
  const inThisClass = (lessonId: unknown) => lessonIds.has(cleanText(lessonId));

  const [profiles, allTurns, allSessions, allEvidence, misconceptions] = await Promise.all([
    selectRows(config, `profiles?id=in.${inList}&select=id,full_name`),
    selectRows(
      config,
      `learning_turns?user_id=in.${inList}&created_at=gte.${since}&select=user_id,created_at,lesson_id&order=created_at.asc&limit=6000`,
    ),
    selectRows(
      config,
      `learning_sessions?user_id=in.${inList}&updated_at=gte.${since}&select=user_id,lesson_id,status,steps_done,updated_at`,
    ),
    selectRows(
      config,
      `learning_evidence?user_id=in.${inList}&created_at=gte.${since}&select=user_id,lesson_id,skill_keys,score,mode,created_at&limit=4000`,
    ),
    selectRows(
      config,
      `student_misconceptions?user_id=in.${inList}&last_seen_at=gte.${since}&select=user_id,skill_key,pattern,hint,occurrences,status`,
    ),
  ]);
  // Everything a student did in ANOTHER class is somebody else's digest.
  const turns = allTurns.filter((row) => inThisClass(row.lesson_id));
  const sessions = allSessions.filter((row) => inThisClass(row.lesson_id));
  const evidence = allEvidence.filter((row) => inThisClass(row.lesson_id));

  const nameOf = new Map<string, string>();
  for (const row of profiles) nameOf.set(cleanId(row.id), cleanText(row.full_name, "Student"));

  // Per-student roll-up.
  const perStudent = new Map<string, { turns: number[]; lessons: Set<string>; completed: number; steps: number }>();
  for (const id of studentIds) perStudent.set(id, { turns: [], lessons: new Set(), completed: 0, steps: 0 });
  for (const turn of turns) {
    const entry = perStudent.get(cleanId(turn.user_id));
    if (!entry) continue;
    const at = Date.parse(cleanText(turn.created_at));
    if (Number.isFinite(at)) entry.turns.push(at);
    const lessonId = cleanText(turn.lesson_id);
    if (lessonId) entry.lessons.add(lessonId);
  }
  for (const session of sessions) {
    const entry = perStudent.get(cleanId(session.user_id));
    if (!entry) continue;
    if (cleanText(session.status) === "complete") entry.completed += 1;
    const done = session.steps_done;
    if (done && typeof done === "object" && !Array.isArray(done)) {
      entry.steps += Object.keys(done as Record<string, unknown>).length;
    }
  }

  const rows = studentIds.map((id) => {
    const entry = perStudent.get(id)!;
    return {
      user_id: id,
      name: nameOf.get(id) || "Student",
      minutes: studyMinutes(entry.turns),
      turns: entry.turns.length,
      lessons_touched: entry.lessons.size,
      lessons_completed: entry.completed,
      steps_done: entry.steps,
    };
  });
  const active = rows.filter((row) => row.turns > 0);

  // What to teach again. A skill counts as missed when graded evidence scored under
  // half marks; it only surfaces when TWO OR MORE students missed it, so the list is
  // a class signal and never one child's bad afternoon.
  const missesBySkill = new Map<string, Set<string>>();
  for (const row of evidence) {
    const score = Number(row.score);
    if (!Number.isFinite(score) || score >= 0.5) continue;
    const keys = Array.isArray(row.skill_keys) ? row.skill_keys : [];
    for (const key of keys) {
      const skill = cleanText(key);
      if (!skill) continue;
      const set = missesBySkill.get(skill) || new Set<string>();
      set.add(cleanId(row.user_id));
      missesBySkill.set(skill, set);
    }
  }
  for (const row of misconceptions) {
    if (cleanText(row.status) === "resolved") continue;
    const skill = cleanText(row.skill_key);
    if (!skill) continue;
    const set = missesBySkill.get(skill) || new Set<string>();
    set.add(cleanId(row.user_id));
    missesBySkill.set(skill, set);
  }
  const patternFor = new Map<string, string>();
  for (const row of misconceptions) {
    const skill = cleanText(row.skill_key);
    const pattern = cleanText(row.pattern);
    if (skill && pattern && !patternFor.has(skill)) patternFor.set(skill, pattern);
  }
  const reteach = [...missesBySkill.entries()]
    .filter(([, students]) => students.size >= 2)
    .map(([skill, students]) => ({
      skill_key: skill,
      students: students.size,
      pattern: patternFor.get(skill) || "",
    }))
    .sort((a, b) => b.students - a.students)
    .slice(0, 8);

  return {
    window,
    students: { enrolled: studentIds.length, active: active.length },
    totals: {
      minutes: rows.reduce((sum, row) => sum + row.minutes, 0),
      turns: rows.reduce((sum, row) => sum + row.turns, 0),
      lessons_completed: rows.reduce((sum, row) => sum + row.lessons_completed, 0),
      steps_done: rows.reduce((sum, row) => sum + row.steps_done, 0),
      evidence: evidence.length,
    },
    movers: [...active]
      .sort((a, b) => b.steps_done - a.steps_done || b.minutes - a.minutes)
      .slice(0, 5),
    // Silence is the signal a teacher most needs and the one no dashboard shows:
    // every enrolled student who did nothing at all this week.
    stalled: rows.filter((row) => row.turns === 0).sort((a, b) => a.name.localeCompare(b.name)),
    reteach,
  };
}

async function handleTeacherClassDigest(
  config: Config,
  actorId: string,
  body: DbRow,
): Promise<Response> {
  const classId = cleanId(body.class_id);
  if (!classId) throw new Error("class_id is required.");
  const teacherClassIds = await fetchTeacherClassIds(config, actorId);
  if (!teacherClassIds.length) throw new Error("Teacher access is required.");
  if (!teacherClassIds.includes(classId)) throw new Error("You do not teach this class.");

  const digest = await buildClassDigest(config, classId, digestWindow(body));
  return json({ status: "ok", data: { digest } });
}
