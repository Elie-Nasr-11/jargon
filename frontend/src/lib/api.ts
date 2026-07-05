import type { Session, User } from "@supabase/supabase-js";
import { functionUrl, supabase, supabaseAnonKey } from "@/lib/supabase";
import type { RenderedPdfPageAsset } from "@/lib/pdf-extract";
import type {
  Assignment,
  AssignmentRecipient,
  AssignmentRecipientStatus,
  AssignmentStatus,
  AssignmentSubmission,
  AssignmentSubmissionFile,
  AssignmentSubmissionStatus,
  Assessment,
  AssessmentAdminResponse,
  AssessmentAttempt,
  AssessmentGradingMode,
  AssessmentItem,
  AssessmentItemAttempt,
  AssessmentRecipient,
  AssessmentResultReleasePolicy,
  AssessmentStatus,
  Checkpoint,
  CheckpointRecipient,
  CostModelDashboard,
  CurriculumAdminResponse,
  CurriculumAuthoringData,
  CurriculumBlueprint,
  CurriculumCourse,
  CurriculumCourseVersion,
  CurriculumLessonMetaInput,
  CurriculumMilestone,
  CurriculumMilestoneInput,
  CurriculumNodeType,
  CurriculumOutlineDraft,
  CurriculumQuizItem,
  CurriculumStepDraft,
  CurriculumStepInput,
  CurriculumSubject,
  CurriculumUnit,
  JargonRunResponse,
  GoogleClassroomCourse,
  GoogleClassroomIntegrationState,
  GoogleClassroomPerson,
  GoogleClassroomResponse,
  CanvasCourse,
  CanvasGradeTargets,
  CanvasIntegrationState,
  CanvasPerson,
  CanvasResponse,
  InterventionAlert,
  LearningSession,
  LearningTurn,
  Lesson,
  LessonActivity,
  LessonAttempt,
  LessonResource,
  LessonResourceDisplayMode,
  LessonResourceStatus,
  LessonResourceType,
  LessonResourceVisibility,
  LearningEvidence,
  LiveSessionViewer,
  MentorRecommendation,
  Notification,
  ModelUsageEvent,
  ActiveSession,
  AdminActorAccess,
  AdminOpsAction,
  AdminOpsResponse,
  AdminScopeResult,
  AdminSeedResponse,
  AdminSeedUser,
  MentorPreferences,
  Profile,
  QuizAttempt,
  ResourceInteraction,
  StudentClass,
  StudentGradeRow,
  StudentMastery,
  StudentProfileStats,
  StudentProgressSummary,
  TeacherClassSummary,
  TeacherClassMembership,
  TeacherDashboardData,
  TeacherNote,
  RuntimeEvent,
  TranscriptHeatmapEvent,
  ResourceInteractionEvent,
  ResourcePageAsset,
  ResourceProcessingResponse,
  ResourceTextChunk,
  StudentAssessmentBundle,
  StudentAssignmentBundle,
  TypedChatAnswer,
  TypedChatEnvelope,
  TeacherLiveComment,
  VoiceInteractionEvent,
} from "@/lib/types";

function authHeaders(accessToken: string) {
  return {
    "Content-Type": "application/json",
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
  };
}

// Long-lived surfaces (the chat page) capture an access token at bootstrap, but tokens
// expire after ~an hour; a stale one makes the edge gateway reject every call ("Chat
// request failed."). Resolve the CURRENT session token at call time — supabase-js keeps
// it refreshed — falling back to the caller's token.
async function freshAccessToken(fallback: string): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || fallback;
  } catch {
    return fallback;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30000,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The live runtime took too long to answer. Try again in a moment.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function safePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function uniqueId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function storagePathForResource(input: {
  organizationId: string;
  classId: string;
  lessonId: string;
  fileName: string;
}) {
  const name = safePathSegment(input.fileName) || "resource";
  return [
    safePathSegment(input.organizationId),
    safePathSegment(input.classId),
    safePathSegment(input.lessonId),
    `${uniqueId()}-${name}`,
  ].join("/");
}

function storagePathForPdfPageAsset(input: {
  resourceId: string;
  pageNumber: number;
  assetType: "thumbnail" | "ocr_image";
  mimeType: string;
}) {
  const extension =
    input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
  return [
    "derived",
    safePathSegment(input.resourceId),
    `${input.assetType}-page-${String(input.pageNumber).padStart(3, "0")}-${uniqueId()}.${extension}`,
  ].join("/");
}

function storagePathForSubmission(input: {
  assignmentId: string;
  userId: string;
  submissionId: string;
  fileName: string;
}) {
  const name = safePathSegment(input.fileName) || "submission";
  return [
    safePathSegment(input.assignmentId),
    safePathSegment(input.userId),
    safePathSegment(input.submissionId),
    `${uniqueId()}-${name}`,
  ].join("/");
}

function resourceTypeFromFile(file: File): LessonResourceType {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "document";
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
  return data.session;
}

// A user's single effective portal, by precedence:
// platform_admin > org_admin > teacher > student. The two admin types get
// separate portals (/platform vs /admin). "student" is the fallback.
export type PrimaryRole = "platform_admin" | "org_admin" | "teacher" | "student";

export async function fetchPrimaryRole(accessToken: string, userId: string): Promise<PrimaryRole> {
  const scope = await fetchAdminScope(accessToken).catch(() => null);
  if (scope?.actorAccess?.level === "platform_admin") return "platform_admin";
  if (scope?.actorAccess?.level === "org_admin") return "org_admin";
  const classes = await fetchTeacherClasses(userId).catch(() => [] as unknown[]);
  if (Array.isArray(classes) && classes.length > 0) return "teacher";
  return "student";
}

export function roleHome(role: PrimaryRole): "/chat" | "/teacher" | "/admin" | "/platform" {
  if (role === "platform_admin") return "/platform";
  if (role === "org_admin") return "/admin";
  if (role === "teacher") return "/teacher";
  return "/chat";
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
  return data.session;
}

export async function signUp(input: {
  email: string;
  password: string;
  name?: string;
  grade?: string;
}) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        name: input.name || "",
        grade: input.grade || "",
      },
    },
  });
  if (error) throw error;
  if (data.user && data.session) {
    await upsertProfile(data.user, input.name || "", input.grade || "");
  }
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    callback(session);
  });
}

export async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) || null;
}

export async function isPlatformAdmin(userId: string) {
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function upsertProfile(user: User, name: string, grade: string) {
  const payload = {
    id: user.id,
    name: name || (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null),
    grade:
      grade || (typeof user.user_metadata?.grade === "string" ? user.user_metadata.grade : null),
  };
  const { error } = await supabase.from("profiles").upsert(payload);
  if (error) throw error;
}

// v4.0 deferred: cross-device persistence of the student's mentor/voice prefs. student_settings
// has a student-own ALL RLS policy (user_id = auth.uid()); these are client-only prefs (the tutor
// still reads mentor_preferences off the chat request payload), so this is a convenience layer over
// the localStorage source of truth.
export async function fetchStudentSettings(): Promise<{
  mentor_settings: unknown;
  voice_settings: unknown;
} | null> {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const { data, error } = await supabase
    .from("student_settings")
    .select("mentor_settings,voice_settings")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as { mentor_settings: unknown; voice_settings: unknown } | null) || null;
}

export async function upsertStudentSettings(patch: {
  mentor_settings?: unknown;
  voice_settings?: unknown;
}): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) return;
  const { error } = await supabase
    .from("student_settings")
    .upsert(
      { user_id: session.user.id, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

export async function fetchLessons(options: { includeDrafts?: boolean } = {}) {
  let query = supabase.from("lessons").select("*").order("position", { ascending: true });
  if (!options.includeDrafts) query = query.eq("publication_status", "published");

  const { data, error } = await query;
  if (error) throw error;
  const lessons = (data || []) as Lesson[];
  const unitIds = uniqueStrings(lessons.map((lesson) => lesson.unit_id || null));
  if (!unitIds.length) return lessons;

  const { data: unitRows, error: unitsError } = await supabase
    .from("units")
    .select("id,title,course_version_id")
    .in("id", unitIds);
  if (unitsError) throw unitsError;
  const units = ((unitRows || []) as CurriculumUnit[]).filter((unit) => unit.id);
  const versionIds = uniqueStrings(units.map((unit) => unit.course_version_id));
  if (!versionIds.length) return lessons;

  const { data: versionRows, error: versionsError } = await supabase
    .from("course_versions")
    .select("id,course_id")
    .in("id", versionIds);
  if (versionsError) throw versionsError;
  const versions = ((versionRows || []) as CurriculumCourseVersion[]).filter(
    (version) => version.id,
  );
  const courseIds = uniqueStrings(versions.map((version) => version.course_id));
  if (!courseIds.length) return lessons;

  const { data: courseRows, error: coursesError } = await supabase
    .from("courses")
    .select("id,subject_id,title")
    .in("id", courseIds);
  if (coursesError) throw coursesError;
  const courses = ((courseRows || []) as CurriculumCourse[]).filter((course) => course.id);
  const subjectIds = uniqueStrings(courses.map((course) => course.subject_id));

  const { data: subjectRows, error: subjectsError } = subjectIds.length
    ? await supabase.from("subjects").select("id,title").in("id", subjectIds)
    : { data: [], error: null };
  if (subjectsError) throw subjectsError;

  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const subjectById = new Map(
    ((subjectRows || []) as CurriculumSubject[]).map((subject) => [subject.id, subject]),
  );

  return lessons.map((lesson) => {
    const unit = lesson.unit_id ? unitById.get(lesson.unit_id) || null : null;
    const version = unit ? versionById.get(unit.course_version_id) || null : null;
    const course = version ? courseById.get(version.course_id) || null : null;
    const subject = course ? subjectById.get(course.subject_id) || null : null;
    const curriculumGroup = [subject?.title, course?.title, unit?.title]
      .filter(Boolean)
      .join(" / ");
    return {
      ...lesson,
      course_id: version?.course_id || null,
      subject_title: subject?.title || null,
      course_title: course?.title || null,
      unit_title: unit?.title || null,
      curriculum_group: curriculumGroup || null,
    };
  });
}

// v4.0 Phase 3: the student's class-scoped lesson catalog. Semantics (per docs/PLATFORM.md):
// each active class the student is in contributes either its linked courses (if it has ≥1 link)
// or — when it has NO links — the FULL catalog (an unlinked class imposes no scoping). The visible
// catalog is the UNION of those contributions, so a student is only narrowed when EVERY one of
// their active classes is scoped; being in any unlinked class shows the full list. With no session,
// no memberships, no links anywhere, an empty scoped result, or any read error, it returns the full
// fetchLessons() output — so the live student sees an identical list until a teacher links courses.
// `pinnedLessonId` (the student's currently-open lesson) is always retained even if scoped out, so
// scoping can never strand a student mid-lesson with no way back to their in-progress work.
export async function fetchStudentCatalog(pinnedLessonId?: string | null): Promise<Lesson[]> {
  const all = await fetchLessons();
  try {
    const session = await getSession();
    const userId = session?.user?.id;
    if (!userId) return all;

    const { data: membershipRows, error: membershipError } = await supabase
      .from("class_memberships")
      .select("class_id")
      .eq("user_id", userId)
      .eq("role", "student")
      .eq("status", "active");
    if (membershipError) throw membershipError;
    const classIds = uniqueStrings(
      ((membershipRows || []) as Array<{ class_id: string | null }>).map((row) => row.class_id),
    );
    if (!classIds.length) return all;

    const { data: linkRows, error: linkError } = await supabase
      .from("class_courses")
      .select("class_id,course_id")
      .in("class_id", classIds);
    if (linkError) throw linkError;
    const rows = (linkRows || []) as Array<{ class_id: string | null; course_id: string | null }>;

    // A class with NO link rows means "no scoping" → it contributes the full catalog, so the whole
    // catalog is shown. Only when every active class is scoped do we narrow to the union of links.
    const classesWithLinks = new Set(rows.map((row) => row.class_id).filter(Boolean));
    if (classIds.some((id) => !classesWithLinks.has(id))) return all;

    const linkedCourseIds = new Set(uniqueStrings(rows.map((row) => row.course_id)));
    if (!linkedCourseIds.size) return all;

    const scoped = all.filter(
      (lesson) =>
        (lesson.course_id && linkedCourseIds.has(lesson.course_id)) ||
        (pinnedLessonId != null && lesson.id === pinnedLessonId),
    );
    // Never strand the student on an empty catalog (e.g. links point at courses with no published
    // lessons yet) — fall back to the full list rather than showing nothing.
    return scoped.length ? scoped : all;
  } catch {
    return all;
  }
}

// --- v4.0 Phase 3a: student self-read stats for the profile popup --------------------------
// Every read below is the signed-in student's OWN rows, permitted by existing RLS policies
// (student_mastery own-ALL; teacher_notes student_visible+own; checkpoint_recipients user_id;
// learning_sessions own-ALL). No new policy or backend is required.

export async function fetchStudentMastery(): Promise<StudentMastery[]> {
  const session = await getSession();
  if (!session?.user?.id) return [];
  const { data, error } = await supabase
    .from("student_mastery")
    .select("*")
    .eq("user_id", session.user.id);
  if (error) throw error;
  return (data || []) as StudentMastery[];
}

// v4.0 deferred: the student's own mode-dimensioned learning evidence (for the profile's
// "strengths by mode" section). Self-read permitted by the existing SELECT policy
// can_view_student(user_id) (which includes auth.uid() = user_id).
export async function fetchStudentEvidence(): Promise<LearningEvidence[]> {
  const session = await getSession();
  if (!session?.user?.id) return [];
  const { data, error } = await supabase
    .from("learning_evidence")
    .select("id,user_id,mode,mode_type,score,skill_keys,created_at")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as LearningEvidence[];
}

export async function fetchStudentTeacherNotes(): Promise<TeacherNote[]> {
  const session = await getSession();
  if (!session?.user?.id) return [];
  const { data, error } = await supabase
    .from("teacher_notes")
    .select("*")
    .eq("student_id", session.user.id)
    .eq("visibility", "student_visible")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []) as TeacherNote[];
}

// The student's graded work, unified across assignments + assessments via checkpoint_recipients
// joined to checkpoints for title/kind/due (two .in() queries, mirroring the other student fetches
// rather than a PostgREST FK embed). A score is surfaced only once finalized/returned so a
// teacher's in-progress grading is never shown early.
export async function fetchStudentGrades(): Promise<StudentGradeRow[]> {
  const session = await getSession();
  if (!session?.user?.id) return [];
  const { data: recipientRows, error: recipientError } = await supabase
    .from("checkpoint_recipients")
    .select("id,checkpoint_id,status,score,final_score,submitted_at")
    .eq("user_id", session.user.id);
  if (recipientError) throw recipientError;
  const recipients = (recipientRows || []) as Array<{
    id: string;
    checkpoint_id: string;
    status: string;
    score: number | null;
    final_score: number | null;
    submitted_at: string | null;
  }>;
  const checkpointIds = uniqueStrings(recipients.map((row) => row.checkpoint_id));
  if (!checkpointIds.length) return [];

  const { data: checkpointRows, error: checkpointError } = await supabase
    .from("checkpoints")
    .select("id,title,kind,due_at")
    .in("id", checkpointIds);
  if (checkpointError) throw checkpointError;
  const checkpointById = new Map(
    (
      (checkpointRows || []) as Array<{
        id: string;
        title: string;
        kind: string;
        due_at: string | null;
      }>
    ).map((cp) => [cp.id, cp]),
  );

  const released = new Set(["complete", "returned", "graded"]);
  return recipients
    .map((row) => {
      const cp = checkpointById.get(row.checkpoint_id);
      if (!cp) return null;
      const rawScore = row.final_score ?? row.score;
      const score = released.has(row.status) && rawScore != null ? rawScore : null;
      return {
        id: row.id,
        title: cp.title,
        kind: cp.kind === "assessment" ? "assessment" : "assignment",
        status: row.status,
        score,
        due_at: cp.due_at,
        submitted_at: row.submitted_at,
      } as StudentGradeRow;
    })
    .filter((row): row is StudentGradeRow => row !== null);
}

export async function fetchStudentProgressSummary(): Promise<StudentProgressSummary> {
  const session = await getSession();
  if (!session?.user?.id) return { lessonsStarted: 0, lessonsCompleted: 0 };
  const { data, error } = await supabase
    .from("learning_sessions")
    .select("lesson_id,status,activities_complete")
    .eq("user_id", session.user.id);
  if (error) throw error;
  const rows = (data || []) as Array<{
    lesson_id: string | null;
    status: string | null;
    activities_complete: boolean | null;
  }>;
  const started = new Set<string>();
  const completed = new Set<string>();
  for (const row of rows) {
    if (!row.lesson_id) continue;
    started.add(row.lesson_id);
    if (row.status === "complete" || row.activities_complete) completed.add(row.lesson_id);
  }
  return { lessonsStarted: started.size, lessonsCompleted: completed.size };
}

// One call the profile popup awaits. Each read is independent and best-effort: a single failed
// read degrades to an empty section rather than blanking the whole popup.
export async function fetchStudentProfileStats(): Promise<StudentProfileStats> {
  const session = await getSession();
  const userId = session?.user?.id || null;
  const email = session?.user?.email || null;
  const safe = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
  const [profile, mastery, notes, grades, progress, evidence] = await Promise.all([
    userId ? safe(fetchProfile(userId), null) : Promise.resolve(null),
    safe(fetchStudentMastery(), [] as StudentMastery[]),
    safe(fetchStudentTeacherNotes(), [] as TeacherNote[]),
    safe(fetchStudentGrades(), [] as StudentGradeRow[]),
    safe(fetchStudentProgressSummary(), { lessonsStarted: 0, lessonsCompleted: 0 }),
    safe(fetchStudentEvidence(), [] as LearningEvidence[]),
  ]);
  return { profile, email, mastery, notes, grades, progress, evidence };
}

// v4.0 Phase 3b: the classes the signed-in student belongs to (for the LMS class views).
// Class read is via the "Members can view their classes" RLS; org names are best-effort (a
// student may not be an org member) and fall back to null.
export async function fetchStudentClasses(): Promise<StudentClass[]> {
  const session = await getSession();
  if (!session?.user?.id) return [];
  const { data: membershipRows, error: membershipError } = await supabase
    .from("class_memberships")
    .select("class_id")
    .eq("user_id", session.user.id)
    .eq("role", "student")
    .eq("status", "active");
  if (membershipError) throw membershipError;
  const classIds = uniqueStrings(
    ((membershipRows || []) as Array<{ class_id: string | null }>).map((row) => row.class_id),
  );
  if (!classIds.length) return [];

  const { data: classRows, error: classError } = await supabase
    .from("classes")
    .select("id,name,organization_id")
    .in("id", classIds)
    .eq("status", "active");
  if (classError) throw classError;
  const classes = (classRows || []) as Array<{
    id: string;
    name: string;
    organization_id: string | null;
  }>;

  const orgIds = uniqueStrings(classes.map((row) => row.organization_id));
  const orgNameById = new Map<string, string>();
  if (orgIds.length) {
    const { data: orgRows } = await supabase
      .from("organizations")
      .select("id,name")
      .in("id", orgIds);
    for (const org of (orgRows || []) as Array<{ id: string; name: string }>) {
      orgNameById.set(org.id, org.name);
    }
  }

  return classes
    .map((row) => ({
      id: row.id,
      name: row.name,
      organizationId: row.organization_id,
      organizationName: row.organization_id ? orgNameById.get(row.organization_id) || null : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// v4.0 Phase 3b: the published lessons scoped to a single class — its linked courses, or the full
// catalog when the class has no links. Powers the class dashboard + unit views.
export async function fetchClassScopedLessons(classId: string): Promise<Lesson[]> {
  const all = await fetchLessons();
  try {
    const linked = new Set(await fetchClassCourses(classId));
    if (!linked.size) return all;
    return all.filter((lesson) => lesson.course_id && linked.has(lesson.course_id));
  } catch {
    return all;
  }
}

// v4.0 Phase 3b: a per-lesson progress fraction (0..1) for the signed-in student, derived from
// their own learning_sessions. A completed lesson is 1; a lesson with a session still in progress
// is 0.5; anything unstarted is absent (callers default to 0). This replaces the hardcoded-0 bars.
export async function fetchStudentLessonProgress(): Promise<Record<string, number>> {
  const session = await getSession();
  if (!session?.user?.id) return {};
  const { data, error } = await supabase
    .from("learning_sessions")
    .select("lesson_id,status,activities_complete")
    .eq("user_id", session.user.id);
  if (error) throw error;
  const rows = (data || []) as Array<{
    lesson_id: string | null;
    status: string | null;
    activities_complete: boolean | null;
  }>;
  const progress: Record<string, number> = {};
  for (const row of rows) {
    if (!row.lesson_id) continue;
    const done = row.status === "complete" || row.activities_complete === true;
    const value = done ? 1 : 0.5;
    // Keep the most-progressed session per lesson.
    progress[row.lesson_id] = Math.max(progress[row.lesson_id] ?? 0, value);
  }
  return progress;
}

export async function fetchLessonActivities(lessonId: string) {
  const { data, error } = await supabase
    .from("lesson_activities")
    .select("*")
    .eq("lesson_id", lessonId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data || []) as LessonActivity[];
}

export async function fetchLatestLearningSession(lessonId: string) {
  // Newest-first is the authoritative pick: the server never re-picks a session
  // (without a session_id it creates a fresh one), so the client's choice here is
  // what the whole turn loop will use. The explicit user filter is belt-and-braces
  // over RLS.
  const session = await getSession();
  let query = supabase
    .from("learning_sessions")
    .select("*")
    .eq("lesson_id", lessonId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (session?.user?.id) query = query.eq("user_id", session.user.id);
  const { data, error } = await query;
  if (error) throw error;
  return ((data || [])[0] as LearningSession | undefined) || null;
}

export async function fetchLearningSession(sessionId: string) {
  const { data, error } = await supabase
    .from("learning_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as LearningSession | null) || null;
}

export async function fetchLearningTurns(sessionId: string) {
  const { data, error } = await supabase
    .from("learning_turns")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as LearningTurn[];
}

export async function fetchTeacherLiveComments(sessionId: string) {
  const { data, error } = await supabase
    .from("teacher_live_comments")
    .select("*")
    .eq("session_id", sessionId)
    .eq("visibility", "student_visible")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as TeacherLiveComment[];
}

export async function fetchLiveSessionViewers(sessionId: string) {
  const { data, error } = await supabase
    .from("live_session_viewers")
    .select("*")
    .eq("session_id", sessionId)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return (data || []) as LiveSessionViewer[];
}

export async function fetchLessonAttempts(sessionId: string) {
  const { data, error } = await supabase
    .from("lesson_attempts")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as LessonAttempt[];
}

export async function invokeAdminSeed(input: {
  accessToken: string;
  organization: { id?: string; name: string; slug: string };
  class: { id?: string; name: string };
  defaultPassword?: string;
  users: AdminSeedUser[];
}) {
  const response = await fetchWithTimeout(functionUrl("admin-seed"), {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: JSON.stringify({
      action: "seed_roster",
      organization: input.organization,
      class: input.class,
      default_password: input.defaultPassword || undefined,
      users: input.users,
    }),
  });
  const data = (await response.json()) as AdminSeedResponse;
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || "Pilot roster seed failed.");
  }
  return data;
}

// Platform-admin-only: create/reset the three demo logins (student, teacher,
// org-admin) in a "Demo Org" so each portal can be tested. Returns the shared
// password and the accounts.
export async function seedDemoLogins(accessToken: string, defaultPassword?: string) {
  const response = await fetchWithTimeout(functionUrl("admin-seed"), {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      action: "seed_demo_logins",
      default_password: defaultPassword || undefined,
    }),
  });
  const data = (await response.json()) as {
    status: "ok" | "error";
    error?: string;
    password?: string;
    accounts?: Array<{ email: string; role: string; user_id: string }>;
  };
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || "Could not create demo logins.");
  }
  return { password: data.password || "", accounts: data.accounts || [] };
}

export async function invokeAdminOps(input: {
  accessToken: string;
  action: AdminOpsAction;
  organizationId?: string | null;
  classId?: string | null;
  userId?: string | null;
  membershipId?: string | null;
  role?: "student" | "teacher" | "org_admin" | null;
  status?: "active" | "invited" | "disabled" | "removed" | null;
  temporaryPassword?: string | null;
  payload?: Record<string, unknown>;
}) {
  const response = await fetchWithTimeout(functionUrl("admin-ops"), {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: JSON.stringify({
      action: input.action,
      organization_id: input.organizationId || undefined,
      class_id: input.classId || undefined,
      user_id: input.userId || undefined,
      membership_id: input.membershipId || undefined,
      role: input.role || undefined,
      status: input.status || undefined,
      temporary_password: input.temporaryPassword || undefined,
      payload: input.payload,
    }),
  });
  const data = (await response.json()) as AdminOpsResponse;
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || "Admin operation failed.");
  }
  return data;
}

export async function fetchAdminScope(accessToken: string): Promise<AdminScopeResult> {
  const data = await invokeAdminOps({ accessToken, action: "list_admin_scope" });
  if (!data.data?.scope || !data.data.actor_access) {
    throw new Error("Admin scope response was missing data.");
  }
  return {
    actorAccess: data.data.actor_access,
    scope: data.data.scope,
  };
}

export async function fetchPilotReadiness(accessToken: string) {
  const data = await invokeAdminOps({ accessToken, action: "list_pilot_readiness" });
  if (!data.data?.readiness || !data.data.actor_access || !data.data.scope) {
    throw new Error("Pilot readiness response was missing data.");
  }
  return {
    actorAccess: data.data.actor_access,
    scope: data.data.scope,
    readiness: data.data.readiness,
  };
}

export async function fetchCostModelDashboard(accessToken: string): Promise<{
  actorAccess: AdminActorAccess;
  scope: AdminScopeResult["scope"];
  dashboard: CostModelDashboard;
}> {
  const data = await invokeAdminOps({ accessToken, action: "list_cost_model_dashboard" });
  if (!data.data?.cost_model_dashboard || !data.data.actor_access || !data.data.scope) {
    throw new Error("Cost/model dashboard response was missing data.");
  }
  return {
    actorAccess: data.data.actor_access,
    scope: data.data.scope,
    dashboard: data.data.cost_model_dashboard,
  };
}

// v4.0 Phase 5: the admin Live fleet — currently-active learning sessions across the admin's scope.
export async function fetchActiveSessions(accessToken: string): Promise<ActiveSession[]> {
  const data = await invokeAdminOps({ accessToken, action: "list_active_sessions" });
  const sessions = data.data?.sessions;
  return Array.isArray(sessions) ? (sessions as ActiveSession[]) : [];
}

export async function exportClassSnapshot(accessToken: string, classId: string) {
  const data = await invokeAdminOps({
    accessToken,
    action: "export_class_snapshot",
    classId,
  });
  if (!data.data?.export) {
    throw new Error("Class snapshot export response was missing data.");
  }
  return data.data.export;
}

export async function previewCsvImport(input: {
  accessToken: string;
  organizationId: string;
  classId?: string | null;
  csvText: string;
  filename?: string;
  importType?: string;
}) {
  const data = await invokeAdminOps({
    accessToken: input.accessToken,
    action: "preview_csv_import",
    organizationId: input.organizationId,
    classId: input.classId,
    payload: {
      csv_text: input.csvText,
      filename: input.filename || "roster.csv",
      import_type: input.importType || "roster",
    },
  });
  if (!data.data?.csv_import) {
    throw new Error("CSV preview response was missing data.");
  }
  return data.data.csv_import;
}

export async function applyCsvRosterImport(accessToken: string, batchId: string) {
  const data = await invokeAdminOps({
    accessToken,
    action: "apply_csv_roster_import",
    payload: { batch_id: batchId },
  });
  if (!data.data?.csv_import) {
    throw new Error("CSV import response was missing data.");
  }
  return data.data.csv_import;
}

export async function exportStudentArchive(input: {
  accessToken: string;
  organizationId?: string | null;
  userId: string;
}) {
  const data = await invokeAdminOps({
    accessToken: input.accessToken,
    action: "export_student_archive",
    organizationId: input.organizationId,
    userId: input.userId,
  });
  if (!data.data?.export) {
    throw new Error("Student archive export response was missing data.");
  }
  return data.data.export;
}

export async function requestDataRetention(input: {
  accessToken: string;
  organizationId: string;
  classId?: string | null;
  userId?: string | null;
  requestType: "delete" | "anonymize";
  reason?: string;
}) {
  const data = await invokeAdminOps({
    accessToken: input.accessToken,
    action: "request_data_retention",
    organizationId: input.organizationId,
    classId: input.classId,
    userId: input.userId,
    payload: {
      request_type: input.requestType,
      reason: input.reason || "",
    },
  });
  if (!data.data?.retention_request) {
    throw new Error("Retention request response was missing data.");
  }
  return data.data.retention_request;
}

export async function upsertConsentSettings(input: {
  accessToken: string;
  organizationId?: string | null;
  classId?: string | null;
  userId?: string | null;
  scope: "organization" | "class" | "student";
  settings: Record<string, unknown>;
}) {
  const data = await invokeAdminOps({
    accessToken: input.accessToken,
    action: "upsert_consent_settings",
    organizationId: input.organizationId,
    classId: input.classId,
    userId: input.userId,
    payload: {
      organization_id: input.organizationId,
      class_id: input.classId,
      user_id: input.userId,
      scope: input.scope,
      settings: input.settings,
    },
  });
  if (!data.data?.consent_settings) {
    throw new Error("Consent settings response was missing data.");
  }
  return data.data.consent_settings;
}

function campusLiveUrlFromResourceSettings(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const url = (value as Record<string, unknown>).campus_live_url;
  return typeof url === "string" ? url : "";
}

// Admin read/write of per-org external links (admin-ops, service-role scoped so
// platform admins can manage orgs they don't belong to). Returns campus_live_url.
export async function fetchOrganizationLinks(accessToken: string, organizationId: string) {
  const data = await invokeAdminOps({
    accessToken,
    action: "organization_links",
    organizationId,
    payload: {},
  });
  return { campusLiveUrl: campusLiveUrlFromResourceSettings(data.data?.resource_settings) };
}

export async function setOrganizationLinks(input: {
  accessToken: string;
  organizationId: string;
  campusLiveUrl: string;
}) {
  const data = await invokeAdminOps({
    accessToken: input.accessToken,
    action: "organization_links",
    organizationId: input.organizationId,
    payload: { campus_live_url: input.campusLiveUrl },
  });
  return { campusLiveUrl: campusLiveUrlFromResourceSettings(data.data?.resource_settings) };
}

// Member-facing read of the org's Campus Live link-out. Resolves the signed-in
// user's organization, then reads organization_settings via RLS (members may
// SELECT). Returns null when there is no org or no link configured.
export async function fetchCampusLiveLink(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  const { data: memberships } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .limit(1);
  const organizationId = memberships?.[0]?.organization_id as string | undefined;
  if (!organizationId) return null;
  const { data: settings } = await supabase
    .from("organization_settings")
    .select("resource_settings")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const url = campusLiveUrlFromResourceSettings(settings?.resource_settings);
  return url || null;
}

export async function generateProgressReport(input: {
  accessToken: string;
  organizationId?: string | null;
  classId?: string | null;
  userId: string;
  title?: string;
  reportType?: string;
}) {
  const data = await invokeAdminOps({
    accessToken: input.accessToken,
    action: "generate_progress_report",
    organizationId: input.organizationId,
    classId: input.classId,
    userId: input.userId,
    payload: {
      title: input.title || "Student progress report",
      report_type: input.reportType || "parent",
    },
  });
  if (!data.data?.progress_report || !data.data.export) {
    throw new Error("Progress report response was missing data.");
  }
  return {
    report: data.data.progress_report,
    export: data.data.export,
  };
}

// Teacher-scoped progress report. Unlike generateProgressReport (admin), this authorizes via the
// teacher's class_memberships in admin-ops — a teacher can only report on a student they teach.
export async function teacherGenerateProgressReport(input: {
  classId: string;
  userId: string;
  title?: string;
  reportType?: string;
}) {
  const session = await getSession();
  if (!session?.access_token) throw new Error("You must be signed in.");
  const data = await invokeAdminOps({
    accessToken: session.access_token,
    action: "teacher_generate_progress_report",
    classId: input.classId,
    userId: input.userId,
    payload: {
      title: input.title || "Student progress report",
      report_type: input.reportType || "parent",
    },
  });
  if (!data.data?.progress_report || !data.data.export) {
    throw new Error("Progress report response was missing data.");
  }
  return {
    report: data.data.progress_report,
    export: data.data.export,
  };
}

export async function invokeGoogleClassroom(input: {
  accessToken: string;
  action:
    | "diagnose"
    | "start_oauth"
    | "oauth_callback"
    | "list_courses"
    | "preview_roster"
    | "import_course"
    | "list_mappings"
    | "disconnect"
    | "export_coursework"
    | "passback_grade";
  organizationId?: string | null;
  connectionId?: string | null;
  googleCourseId?: string | null;
  classId?: string | null;
  code?: string | null;
  state?: string | null;
}) {
  const response = await fetchWithTimeout(functionUrl("google-classroom"), {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: JSON.stringify({
      action: input.action,
      organization_id: input.organizationId || undefined,
      connection_id: input.connectionId || undefined,
      google_course_id: input.googleCourseId || undefined,
      class_id: input.classId || undefined,
      code: input.code || undefined,
      state: input.state || undefined,
    }),
  });
  const data = (await response.json()) as GoogleClassroomResponse;
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || "Google Classroom operation failed.");
  }
  return data;
}

export async function diagnoseGoogleClassroom(accessToken: string, organizationId?: string | null) {
  const data = await invokeGoogleClassroom({
    accessToken,
    action: "diagnose",
    organizationId,
  });
  return data.data;
}

export async function startGoogleClassroomOAuth(accessToken: string, organizationId: string) {
  const data = await invokeGoogleClassroom({
    accessToken,
    action: "start_oauth",
    organizationId,
  });
  const authUrl = data.data?.auth_url;
  if (!authUrl) throw new Error("Google Classroom OAuth response was missing a URL.");
  return authUrl;
}

export async function completeGoogleClassroomOAuth(
  accessToken: string,
  code: string,
  state: string,
) {
  const data = await invokeGoogleClassroom({
    accessToken,
    action: "oauth_callback",
    code,
    state,
  });
  if (!data.data?.connection) {
    throw new Error("Google Classroom OAuth response was missing the connection.");
  }
  return data.data.connection;
}

export async function fetchGoogleClassroomMappings(
  accessToken: string,
  organizationId?: string | null,
): Promise<GoogleClassroomIntegrationState> {
  const data = await invokeGoogleClassroom({
    accessToken,
    action: "list_mappings",
    organizationId,
  });
  return {
    connections: data.data?.connections || [],
    course_mappings: data.data?.course_mappings || [],
    user_mappings: data.data?.user_mappings || [],
    sync_runs: data.data?.sync_runs || [],
  };
}

export async function fetchGoogleClassroomCourses(
  accessToken: string,
  connectionId: string,
): Promise<GoogleClassroomCourse[]> {
  const data = await invokeGoogleClassroom({
    accessToken,
    action: "list_courses",
    connectionId,
  });
  return data.data?.courses || [];
}

export async function previewGoogleClassroomRoster(
  accessToken: string,
  connectionId: string,
  googleCourseId: string,
): Promise<{
  course: GoogleClassroomCourse | null;
  teachers: GoogleClassroomPerson[];
  students: GoogleClassroomPerson[];
}> {
  const data = await invokeGoogleClassroom({
    accessToken,
    action: "preview_roster",
    connectionId,
    googleCourseId,
  });
  return {
    course: data.data?.course || null,
    teachers: data.data?.teachers || [],
    students: data.data?.students || [],
  };
}

export async function importGoogleClassroomCourse(input: {
  accessToken: string;
  connectionId: string;
  googleCourseId: string;
  classId?: string | null;
}) {
  const data = await invokeGoogleClassroom({
    accessToken: input.accessToken,
    action: "import_course",
    connectionId: input.connectionId,
    googleCourseId: input.googleCourseId,
    classId: input.classId,
  });
  return data.data;
}

export async function disconnectGoogleClassroom(accessToken: string, connectionId: string) {
  await invokeGoogleClassroom({
    accessToken,
    action: "disconnect",
    connectionId,
  });
}

export async function invokeCanvas(input: {
  accessToken: string;
  action:
    | "diagnose"
    | "start_oauth"
    | "oauth_callback"
    | "list_courses"
    | "preview_roster"
    | "import_course"
    | "list_mappings"
    | "disconnect"
    | "list_grade_targets"
    | "upsert_grade_link"
    | "delete_grade_link"
    | "push_grades"
    | "sync"
    | "set_sync_enabled";
  organizationId?: string | null;
  connectionId?: string | null;
  baseUrl?: string | null;
  canvasCourseId?: string | null;
  classId?: string | null;
  code?: string | null;
  state?: string | null;
  createMissingAccounts?: boolean;
  defaultPassword?: string | null;
  courseMappingId?: string | null;
  gradeLinkId?: string | null;
  jargonKind?: "assignment" | "assessment" | null;
  jargonId?: string | null;
  canvasAssignmentId?: string | null;
  enabled?: boolean;
}) {
  const response = await fetchWithTimeout(functionUrl("canvas"), {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: JSON.stringify({
      action: input.action,
      organization_id: input.organizationId || undefined,
      connection_id: input.connectionId || undefined,
      base_url: input.baseUrl || undefined,
      canvas_course_id: input.canvasCourseId || undefined,
      class_id: input.classId || undefined,
      code: input.code || undefined,
      state: input.state || undefined,
      create_missing_accounts: input.createMissingAccounts || undefined,
      default_password: input.defaultPassword || undefined,
      course_mapping_id: input.courseMappingId || undefined,
      grade_link_id: input.gradeLinkId || undefined,
      jargon_kind: input.jargonKind || undefined,
      jargon_id: input.jargonId || undefined,
      canvas_assignment_id: input.canvasAssignmentId || undefined,
      enabled: input.enabled,
    }),
  });
  const data = (await response.json()) as CanvasResponse;
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || "Canvas operation failed.");
  }
  return data;
}

export async function diagnoseCanvas(accessToken: string, organizationId?: string | null) {
  const data = await invokeCanvas({
    accessToken,
    action: "diagnose",
    organizationId,
  });
  return data.data;
}

export async function startCanvasOAuth(
  accessToken: string,
  organizationId: string,
  baseUrl: string,
) {
  const data = await invokeCanvas({
    accessToken,
    action: "start_oauth",
    organizationId,
    baseUrl,
  });
  const authUrl = data.data?.auth_url;
  if (!authUrl) throw new Error("Canvas OAuth response was missing a URL.");
  return authUrl;
}

export async function completeCanvasOAuth(accessToken: string, code: string, state: string) {
  const data = await invokeCanvas({
    accessToken,
    action: "oauth_callback",
    code,
    state,
  });
  if (!data.data?.connection) {
    throw new Error("Canvas OAuth response was missing the connection.");
  }
  return data.data.connection;
}

export async function fetchCanvasMappings(
  accessToken: string,
  organizationId?: string | null,
): Promise<CanvasIntegrationState> {
  const data = await invokeCanvas({
    accessToken,
    action: "list_mappings",
    organizationId,
  });
  return {
    connections: data.data?.connections || [],
    course_mappings: data.data?.course_mappings || [],
    user_mappings: data.data?.user_mappings || [],
    sync_runs: data.data?.sync_runs || [],
    grade_links: data.data?.grade_links || [],
  };
}

export async function fetchCanvasCourses(
  accessToken: string,
  connectionId: string,
): Promise<CanvasCourse[]> {
  const data = await invokeCanvas({
    accessToken,
    action: "list_courses",
    connectionId,
  });
  return data.data?.courses || [];
}

export async function previewCanvasRoster(
  accessToken: string,
  connectionId: string,
  canvasCourseId: string,
): Promise<{
  course: CanvasCourse | null;
  teachers: CanvasPerson[];
  students: CanvasPerson[];
}> {
  const data = await invokeCanvas({
    accessToken,
    action: "preview_roster",
    connectionId,
    canvasCourseId,
  });
  return {
    course: data.data?.course || null,
    teachers: data.data?.teachers || [],
    students: data.data?.students || [],
  };
}

export async function importCanvasCourse(input: {
  accessToken: string;
  connectionId: string;
  canvasCourseId: string;
  classId?: string | null;
  createMissingAccounts?: boolean;
  defaultPassword?: string | null;
}) {
  const data = await invokeCanvas({
    accessToken: input.accessToken,
    action: "import_course",
    connectionId: input.connectionId,
    canvasCourseId: input.canvasCourseId,
    classId: input.classId,
    createMissingAccounts: input.createMissingAccounts,
    defaultPassword: input.defaultPassword,
  });
  return data.data;
}

export async function disconnectCanvas(accessToken: string, connectionId: string) {
  await invokeCanvas({
    accessToken,
    action: "disconnect",
    connectionId,
  });
}

export async function fetchCanvasGradeTargets(
  accessToken: string,
  courseMappingId: string,
): Promise<CanvasGradeTargets> {
  const data = await invokeCanvas({
    accessToken,
    action: "list_grade_targets",
    courseMappingId,
  });
  return {
    jargon_items: data.data?.jargon_items || [],
    canvas_assignments: data.data?.canvas_assignments || [],
    grade_links: data.data?.grade_links || [],
  };
}

export async function upsertCanvasGradeLink(input: {
  accessToken: string;
  courseMappingId: string;
  jargonKind: "assignment" | "assessment";
  jargonId: string;
  canvasAssignmentId: string;
}) {
  const data = await invokeCanvas({
    accessToken: input.accessToken,
    action: "upsert_grade_link",
    courseMappingId: input.courseMappingId,
    jargonKind: input.jargonKind,
    jargonId: input.jargonId,
    canvasAssignmentId: input.canvasAssignmentId,
  });
  return data.data?.grade_link || null;
}

export async function deleteCanvasGradeLink(accessToken: string, gradeLinkId: string) {
  await invokeCanvas({
    accessToken,
    action: "delete_grade_link",
    gradeLinkId,
  });
}

export async function pushCanvasGrades(input: {
  accessToken: string;
  gradeLinkId?: string | null;
  courseMappingId?: string | null;
}) {
  const data = await invokeCanvas({
    accessToken: input.accessToken,
    action: "push_grades",
    gradeLinkId: input.gradeLinkId,
    courseMappingId: input.courseMappingId,
  });
  return data.data;
}

export async function syncCanvas(accessToken: string, connectionId: string) {
  const data = await invokeCanvas({
    accessToken,
    action: "sync",
    connectionId,
  });
  return data.data;
}

export async function setCanvasSyncEnabled(
  accessToken: string,
  connectionId: string,
  enabled: boolean,
) {
  const data = await invokeCanvas({
    accessToken,
    action: "set_sync_enabled",
    connectionId,
    enabled,
  });
  return data.data?.connection || null;
}

export async function fetchCurriculumAuthoringData(
  userId: string,
): Promise<CurriculumAuthoringData> {
  const classes = await fetchTeacherClasses(userId);
  const lessons = await fetchLessons({ includeDrafts: true });
  const [
    subjectsResult,
    coursesResult,
    courseVersionsResult,
    unitsResult,
    milestonesResult,
    activitiesResult,
    quizzesResult,
    resourcesResult,
  ] = await Promise.all([
    supabase.from("subjects").select("*").order("title", { ascending: true }),
    supabase.from("courses").select("*").order("title", { ascending: true }),
    supabase.from("course_versions").select("*").order("updated_at", { ascending: false }),
    supabase.from("units").select("*").order("position", { ascending: true }),
    supabase.from("milestones").select("*").order("position", { ascending: true }),
    supabase.from("lesson_activities").select("*").order("position", { ascending: true }),
    supabase.from("quiz_items").select("*").order("position", { ascending: true }),
    supabase
      .from("lesson_resources")
      .select("*")
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);

  for (const result of [
    subjectsResult,
    coursesResult,
    courseVersionsResult,
    unitsResult,
    milestonesResult,
    activitiesResult,
    quizzesResult,
    resourcesResult,
  ]) {
    if (result.error) throw result.error;
  }

  return {
    classes,
    subjects: (subjectsResult.data || []) as CurriculumSubject[],
    courses: (coursesResult.data || []) as CurriculumCourse[],
    courseVersions: (courseVersionsResult.data || []) as CurriculumCourseVersion[],
    units: (unitsResult.data || []) as CurriculumUnit[],
    lessons,
    milestones: (milestonesResult.data || []) as CurriculumMilestone[],
    activities: (activitiesResult.data || []) as LessonActivity[],
    quizzes: (quizzesResult.data || []) as CurriculumQuizItem[],
    resources: (resourcesResult.data || []) as LessonResource[],
  };
}

async function callCurriculumAdmin(
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<CurriculumAdminResponse> {
  const response = await fetchWithTimeout(functionUrl("curriculum-admin"), {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as CurriculumAdminResponse;
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || "Curriculum update failed.");
  }
  return data;
}

export async function invokeCurriculumAdmin(input: {
  accessToken: string;
  action: "save_lesson_blueprint" | "publish_lesson" | "archive_lesson";
  organizationId: string;
  classId?: string | null;
  lessonId?: string | null;
  blueprint?: CurriculumBlueprint;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: input.action,
    organization_id: input.organizationId,
    class_id: input.classId || undefined,
    lesson_id: input.lessonId || undefined,
    blueprint: input.blueprint,
  });
}

// --- Structure management (curriculum redesign Phase 1) -------------------
// Create / rename / reorder / move / archive / delete curriculum nodes directly,
// decoupled from the monolithic lesson blueprint save. The edge function resolves
// each node's organization from its parent and re-checks author access; rename
// PATCHes by id so children never orphan.

export function createCurriculumSubject(input: {
  accessToken: string;
  organizationId: string;
  classId?: string | null;
  title: string;
  description?: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "create_subject",
    organization_id: input.organizationId,
    class_id: input.classId || undefined,
    title: input.title,
    description: input.description,
  });
}

export function createCurriculumCourse(input: {
  accessToken: string;
  classId?: string | null;
  subjectId: string;
  title: string;
  description?: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "create_course",
    class_id: input.classId || undefined,
    subject_id: input.subjectId,
    title: input.title,
    description: input.description,
  });
}

export function createCurriculumUnit(input: {
  accessToken: string;
  classId?: string | null;
  courseVersionId: string;
  title: string;
  description?: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "create_unit",
    class_id: input.classId || undefined,
    course_version_id: input.courseVersionId,
    title: input.title,
    description: input.description,
  });
}

export function createCurriculumLessonStub(input: {
  accessToken: string;
  classId?: string | null;
  unitId: string;
  title: string;
  level?: string;
  lessonType?: CurriculumBlueprint["lesson"]["type"];
  tutorPrompt?: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "create_lesson_stub",
    class_id: input.classId || undefined,
    unit_id: input.unitId,
    title: input.title,
    level: input.level,
    lesson_type: input.lessonType,
    tutor_prompt: input.tutorPrompt,
  });
}

export function renameCurriculumNode(input: {
  accessToken: string;
  classId?: string | null;
  nodeType: CurriculumNodeType;
  id: string;
  title: string;
  description?: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "rename_node",
    class_id: input.classId || undefined,
    node_type: input.nodeType,
    id: input.id,
    title: input.title,
    description: input.description,
  });
}

export function reorderCurriculumNodes(input: {
  accessToken: string;
  classId?: string | null;
  nodeType: CurriculumNodeType;
  orderedIds: string[];
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "reorder",
    class_id: input.classId || undefined,
    node_type: input.nodeType,
    ordered_ids: input.orderedIds,
  });
}

export function moveCurriculumLesson(input: {
  accessToken: string;
  classId?: string | null;
  lessonId: string;
  targetUnitId: string;
  position?: number;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "move_lesson",
    class_id: input.classId || undefined,
    lesson_id: input.lessonId,
    target_unit_id: input.targetUnitId,
    position: input.position,
  });
}

export function archiveCurriculumNode(input: {
  accessToken: string;
  classId?: string | null;
  nodeType: CurriculumNodeType;
  id: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "archive_node",
    class_id: input.classId || undefined,
    node_type: input.nodeType,
    id: input.id,
  });
}

export function deleteCurriculumNode(input: {
  accessToken: string;
  classId?: string | null;
  nodeType: CurriculumNodeType;
  id: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "delete_node",
    class_id: input.classId || undefined,
    node_type: input.nodeType,
    id: input.id,
  });
}

// --- Multi-step lessons (curriculum redesign Phase 3) ---------------------
// Lesson-level fields + the single milestone (no activity/quiz, no structure
// re-derivation) and ordered steps over lesson_activities/quiz_items.

export function saveCurriculumLessonMeta(input: {
  accessToken: string;
  classId?: string | null;
  lessonId: string;
  meta: CurriculumLessonMetaInput;
  milestone: CurriculumMilestoneInput;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "save_lesson_meta",
    class_id: input.classId || undefined,
    lesson_id: input.lessonId,
    meta: input.meta,
    milestone: input.milestone,
  });
}

export function upsertCurriculumStep(input: {
  accessToken: string;
  classId?: string | null;
  lessonId: string;
  step: CurriculumStepInput;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "upsert_step",
    class_id: input.classId || undefined,
    lesson_id: input.lessonId,
    step: input.step,
  });
}

export function reorderCurriculumSteps(input: {
  accessToken: string;
  classId?: string | null;
  lessonId: string;
  orderedIds: string[];
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "reorder_steps",
    class_id: input.classId || undefined,
    lesson_id: input.lessonId,
    ordered_ids: input.orderedIds,
  });
}

export function deleteCurriculumStep(input: {
  accessToken: string;
  classId?: string | null;
  lessonId: string;
  activityId: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "delete_step",
    class_id: input.classId || undefined,
    lesson_id: input.lessonId,
    activity_id: input.activityId,
  });
}

// --- AI authoring (curriculum redesign Phase 4) ---------------------------
// Drafts a course outline or a lesson's steps from a prompt. Returns structured
// JSON for the teacher to review; never writes (apply uses the create/upsert actions).

export function generateCurriculumDraft(input: {
  accessToken: string;
  classId?: string | null;
  mode: "course_outline" | "lesson_steps";
  prompt?: string;
  organizationId?: string;
  lessonId?: string;
  courseId?: string;
  templateId?: string;
  referenceText?: string;
  current?: CurriculumOutlineDraft | CurriculumStepDraft[];
  feedback?: string;
  target?: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "generate",
    class_id: input.classId || undefined,
    mode: input.mode,
    prompt: input.prompt,
    organization_id: input.organizationId,
    lesson_id: input.lessonId,
    course_id: input.courseId,
    template_id: input.templateId || undefined,
    reference_text: input.referenceText || undefined,
    current: input.current,
    feedback: input.feedback || undefined,
    target: input.target || undefined,
  });
}

// --- Org-shared lesson templates (v4.0 Phase 2) ---------------------------
export function saveCurriculumTemplate(input: {
  accessToken: string;
  classId?: string | null;
  lessonId: string;
  title?: string;
  description?: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "save_template",
    class_id: input.classId || undefined,
    lesson_id: input.lessonId,
    title: input.title || undefined,
    description: input.description || undefined,
  });
}

export function listCurriculumTemplates(input: {
  accessToken: string;
  classId?: string | null;
  organizationId: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "list_templates",
    class_id: input.classId || undefined,
    organization_id: input.organizationId,
  });
}

export function instantiateCurriculumTemplate(input: {
  accessToken: string;
  classId?: string | null;
  templateId: string;
  unitId: string;
  title?: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "instantiate_template",
    class_id: input.classId || undefined,
    template_id: input.templateId,
    unit_id: input.unitId,
    title: input.title || undefined,
  });
}

export function archiveCurriculumTemplate(input: {
  accessToken: string;
  classId?: string | null;
  templateId: string;
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "archive_template",
    class_id: input.classId || undefined,
    template_id: input.templateId,
  });
}

// v4.0 Phase 3: read the courses currently linked to a class (teacher/admin surface). Empty = no
// scoping. Governed by the class_courses RLS select policy (any active class member + org admins).
export async function fetchClassCourses(classId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("class_courses")
    .select("course_id")
    .eq("class_id", classId);
  if (error) throw error;
  return uniqueStrings(
    ((data || []) as Array<{ course_id: string | null }>).map((row) => row.course_id),
  );
}

// v4.0 Phase 3: replace a class's full course scope (teacher/admin). An empty list clears scoping.
export function setClassCourses(input: {
  accessToken: string;
  classId: string;
  courseIds: string[];
}) {
  return callCurriculumAdmin(input.accessToken, {
    action: "set_class_courses",
    class_id: input.classId,
    course_ids: input.courseIds,
  });
}

// v4.0 Phase 5: the signed-in teacher's/admin's persistent notifications (RLS owner-read).
export async function fetchNotifications(limit = 50): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as Notification[];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) throw error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw error;
}

export async function fetchTeacherClasses(userId: string) {
  const { data: memberships, error: membershipsError } = await supabase
    .from("class_memberships")
    .select("class_id")
    .eq("user_id", userId)
    .eq("role", "teacher")
    .eq("status", "active");
  if (membershipsError) throw membershipsError;

  const classIds = Array.from(
    new Set(
      ((memberships || []) as Array<{ class_id: string | null }>)
        .map((membership) => membership.class_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (!classIds.length) return [];

  const { data, error } = await supabase
    .from("classes")
    .select(
      "id,name,status,organization_id,organizations(name,slug),class_memberships(role,status)",
    )
    .in("id", classIds)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []) as TeacherClassSummary[];
}

export async function fetchTeacherDashboard(userId: string): Promise<TeacherDashboardData> {
  const classes = await fetchTeacherClasses(userId);
  const classIds = uniqueStrings(classes.map((item) => item.id));
  const lessons = await fetchLessons({ includeDrafts: true });
  const { data: quizRows, error: quizItemsError } = await supabase
    .from("quiz_items")
    .select("*")
    .order("position", { ascending: true });
  if (quizItemsError) throw quizItemsError;
  const quizItems = (quizRows || []) as CurriculumQuizItem[];

  if (!classIds.length) {
    return {
      classes,
      memberships: [],
      profiles: [],
      lessons,
      quizItems,
      sessions: [],
      turns: [],
      attempts: [],
      quizAttempts: [],
      evidence: [],
      mastery: [],
      notes: [],
      liveComments: [],
      resources: [],
      resourceInteractions: [],
      interventionAlerts: [],
      heatmapEvents: [],
      runtimeEvents: [],
      modelUsageEvents: [],
      assignments: [],
      assignmentRecipients: [],
      assignmentSubmissions: [],
      assignmentSubmissionFiles: [],
      assessments: [],
      assessmentItems: [],
      assessmentRecipients: [],
      assessmentAttempts: [],
      assessmentItemAttempts: [],
      checkpoints: [],
      checkpointRecipients: [],
      mentorRecommendations: [],
    };
  }

  const { data: membershipRows, error: membershipError } = await supabase
    .from("class_memberships")
    .select("id,class_id,user_id,role,status,created_at")
    .in("class_id", classIds)
    .eq("status", "active");
  if (membershipError) throw membershipError;

  const memberships = (membershipRows || []) as TeacherClassMembership[];
  const studentIds = uniqueStrings(
    memberships
      .filter((membership) => membership.role === "student")
      .map((membership) => membership.user_id),
  );
  const profileIds = uniqueStrings([
    ...memberships.map((membership) => membership.user_id),
    userId,
  ]);

  const [
    profilesResult,
    sessionsResult,
    attemptsResult,
    quizAttemptsResult,
    evidenceResult,
    masteryResult,
    notesResult,
    resourcesResult,
    resourceInteractionsResult,
    interventionAlertsResult,
    heatmapEventsResult,
    runtimeEventsResult,
    modelUsageEventsResult,
    assignmentsResult,
    assessmentsResult,
    checkpointsResult,
    mentorRecommendationsResult,
  ] = await Promise.all([
    profileIds.length
      ? supabase.from("profiles").select("id,name,grade").in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("learning_sessions")
          .select("*")
          .in("user_id", studentIds)
          .order("updated_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("lesson_attempts")
          .select("*")
          .in("user_id", studentIds)
          .order("created_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("quiz_attempts")
          .select("*")
          .in("user_id", studentIds)
          .order("created_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("learning_evidence")
          .select("*")
          .in("user_id", studentIds)
          .order("created_at", { ascending: false })
          .limit(400)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase.from("student_mastery").select("*").in("user_id", studentIds)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("teacher_notes")
          .select("*")
          .in("student_id", studentIds)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    classIds.length
      ? supabase
          .from("lesson_resources")
          .select("*")
          .in("class_id", classIds)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("resource_interactions")
          .select("*")
          .in("user_id", studentIds)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("intervention_alerts")
          .select("*")
          .in("student_id", studentIds)
          .order("created_at", { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("transcript_heatmap_events")
          .select("*")
          .in("user_id", studentIds)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("runtime_events")
          .select("*")
          .in("user_id", studentIds)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("model_usage_events")
          .select("*")
          .in("user_id", studentIds)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    classIds.length
      ? supabase
          .from("assignments")
          .select("*")
          .in("class_id", classIds)
          .order("updated_at", { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
    classIds.length
      ? supabase
          .from("assessments")
          .select("*")
          .in("class_id", classIds)
          .order("updated_at", { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
    classIds.length
      ? supabase
          .from("checkpoints")
          .select("*")
          .in("class_id", classIds)
          .order("updated_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    // v4.0 hotlist: the mentor's AI escalations (write-only until now).
    studentIds.length
      ? supabase
          .from("mentor_recommendations")
          .select("*")
          .in("user_id", studentIds)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [
    profilesResult,
    sessionsResult,
    attemptsResult,
    quizAttemptsResult,
    evidenceResult,
    masteryResult,
    notesResult,
    resourcesResult,
    resourceInteractionsResult,
    interventionAlertsResult,
    heatmapEventsResult,
    runtimeEventsResult,
    modelUsageEventsResult,
    assignmentsResult,
    assessmentsResult,
    checkpointsResult,
    mentorRecommendationsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const sessions = (sessionsResult.data || []) as LearningSession[];
  const assignments = (assignmentsResult.data || []) as Assignment[];
  const assessments = (assessmentsResult.data || []) as Assessment[];
  const checkpoints = (checkpointsResult.data || []) as Checkpoint[];
  const assignmentIds = uniqueStrings(assignments.map((assignment) => assignment.id));
  const assessmentIds = uniqueStrings(assessments.map((assessment) => assessment.id));
  const checkpointIds = uniqueStrings(checkpoints.map((checkpoint) => checkpoint.id));
  const sessionIds = uniqueStrings(sessions.map((session) => session.id));
  const [
    { data: turnRows, error: turnsError },
    liveCommentsResult,
    assignmentRecipientsResult,
    assignmentSubmissionsResult,
    assignmentFilesResult,
    assessmentItemsResult,
    assessmentRecipientsResult,
    assessmentAttemptsResult,
    checkpointRecipientsResult,
  ] = await Promise.all([
    sessionIds.length
      ? supabase
          .from("learning_turns")
          .select("*")
          .in("session_id", sessionIds)
          .order("created_at", { ascending: true })
          .limit(600)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? supabase
          .from("teacher_live_comments")
          .select("*")
          .in("session_id", sessionIds)
          .order("created_at", { ascending: true })
          .limit(400)
      : Promise.resolve({ data: [], error: null }),
    assignmentIds.length
      ? supabase
          .from("assignment_recipients")
          .select("*")
          .in("assignment_id", assignmentIds)
          .order("updated_at", { ascending: false })
          .limit(600)
      : Promise.resolve({ data: [], error: null }),
    assignmentIds.length
      ? supabase
          .from("assignment_submissions")
          .select("*")
          .in("assignment_id", assignmentIds)
          .order("updated_at", { ascending: false })
          .limit(600)
      : Promise.resolve({ data: [], error: null }),
    assignmentIds.length
      ? supabase
          .from("assignment_submission_files")
          .select("*")
          .in("assignment_id", assignmentIds)
          .order("created_at", { ascending: false })
          .limit(600)
      : Promise.resolve({ data: [], error: null }),
    assessmentIds.length
      ? supabase
          .from("assessment_items")
          .select("*")
          .in("assessment_id", assessmentIds)
          .order("position", { ascending: true })
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    assessmentIds.length
      ? supabase
          .from("assessment_recipients")
          .select("*")
          .in("assessment_id", assessmentIds)
          .order("updated_at", { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    assessmentIds.length
      ? supabase
          .from("assessment_attempts")
          .select("*")
          .in("assessment_id", assessmentIds)
          .order("updated_at", { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    checkpointIds.length
      ? supabase
          .from("checkpoint_recipients")
          .select("*")
          .in("checkpoint_id", checkpointIds)
          .order("updated_at", { ascending: false })
          .limit(2000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (turnsError) throw turnsError;
  for (const result of [
    liveCommentsResult,
    assignmentRecipientsResult,
    assignmentSubmissionsResult,
    assignmentFilesResult,
    assessmentItemsResult,
    assessmentRecipientsResult,
    assessmentAttemptsResult,
    checkpointRecipientsResult,
  ]) {
    if (result.error) throw result.error;
  }
  const assessmentAttempts = (assessmentAttemptsResult.data || []) as AssessmentAttempt[];
  const assessmentAttemptIds = uniqueStrings(assessmentAttempts.map((attempt) => attempt.id));
  const { data: assessmentItemAttemptRows, error: assessmentItemAttemptError } =
    assessmentAttemptIds.length
      ? await supabase
          .from("assessment_item_attempts")
          .select("*")
          .in("assessment_attempt_id", assessmentAttemptIds)
          .order("created_at", { ascending: true })
          .limit(1500)
      : { data: [], error: null };
  if (assessmentItemAttemptError) throw assessmentItemAttemptError;

  return {
    classes,
    memberships,
    profiles: (profilesResult.data || []) as Profile[],
    lessons,
    quizItems,
    sessions,
    turns: (turnRows || []) as LearningTurn[],
    attempts: (attemptsResult.data || []) as LessonAttempt[],
    quizAttempts: (quizAttemptsResult.data || []) as QuizAttempt[],
    evidence: (evidenceResult.data || []) as LearningEvidence[],
    mastery: (masteryResult.data || []) as StudentMastery[],
    notes: (notesResult.data || []) as TeacherNote[],
    liveComments: (liveCommentsResult.data || []) as TeacherLiveComment[],
    resources: (resourcesResult.data || []) as LessonResource[],
    resourceInteractions: (resourceInteractionsResult.data || []) as ResourceInteraction[],
    interventionAlerts: (interventionAlertsResult.data || []) as InterventionAlert[],
    heatmapEvents: (heatmapEventsResult.data || []) as TranscriptHeatmapEvent[],
    runtimeEvents: (runtimeEventsResult.data || []) as RuntimeEvent[],
    modelUsageEvents: (modelUsageEventsResult.data || []) as ModelUsageEvent[],
    assignments,
    assignmentRecipients: (assignmentRecipientsResult.data || []) as AssignmentRecipient[],
    assignmentSubmissions: (assignmentSubmissionsResult.data || []) as AssignmentSubmission[],
    assignmentSubmissionFiles: (assignmentFilesResult.data || []) as AssignmentSubmissionFile[],
    assessments,
    assessmentItems: (assessmentItemsResult.data || []) as AssessmentItem[],
    assessmentRecipients: (assessmentRecipientsResult.data || []) as AssessmentRecipient[],
    assessmentAttempts,
    assessmentItemAttempts: (assessmentItemAttemptRows || []) as AssessmentItemAttempt[],
    checkpoints,
    checkpointRecipients: (checkpointRecipientsResult.data || []) as CheckpointRecipient[],
    mentorRecommendations: (mentorRecommendationsResult.data || []) as MentorRecommendation[],
  };
}

export async function createTeacherNote(input: {
  teacherId: string;
  studentId: string;
  classId: string;
  note: string;
  visibility: TeacherNote["visibility"];
}) {
  const { data, error } = await supabase
    .from("teacher_notes")
    .insert({
      teacher_id: input.teacherId,
      student_id: input.studentId,
      class_id: input.classId,
      note: input.note,
      visibility: input.visibility,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as TeacherNote;
}

async function currentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error("You need to sign in again.");
  return user.id;
}

export async function startLiveSessionViewer(input: {
  sessionId: string;
  studentId: string;
  classId: string;
}) {
  const teacherId = await currentUserId();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("live_session_viewers")
    .upsert(
      {
        session_id: input.sessionId,
        student_id: input.studentId,
        teacher_id: teacherId,
        class_id: input.classId,
        status: "active",
        last_seen_at: now,
      },
      { onConflict: "session_id,teacher_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as LiveSessionViewer;
}

export async function heartbeatLiveSessionViewer(viewerId: string) {
  const { data, error } = await supabase
    .from("live_session_viewers")
    .update({ status: "active", last_seen_at: new Date().toISOString() })
    .eq("id", viewerId)
    .select("*")
    .single();
  if (error) throw error;
  return data as LiveSessionViewer;
}

export async function stopLiveSessionViewer(viewerId: string) {
  const { data, error } = await supabase
    .from("live_session_viewers")
    .update({ status: "inactive", last_seen_at: new Date().toISOString() })
    .eq("id", viewerId)
    .select("*")
    .single();
  if (error) throw error;
  return data as LiveSessionViewer;
}

export async function sendTeacherLiveComment(input: {
  sessionId: string;
  studentId: string;
  classId: string;
  lessonId?: string | null;
  content: string;
}) {
  const teacherId = await currentUserId();
  const { data, error } = await supabase
    .from("teacher_live_comments")
    .insert({
      session_id: input.sessionId,
      student_id: input.studentId,
      teacher_id: teacherId,
      class_id: input.classId,
      content: input.content.trim(),
      visibility: "student_visible",
    })
    .select("*")
    .single();
  if (error) throw error;

  const comment = data as TeacherLiveComment;
  const { error: heatmapError } = await supabase.from("transcript_heatmap_events").insert({
    session_id: input.sessionId,
    user_id: input.studentId,
    lesson_id: input.lessonId || null,
    event_type: "teacher_intervention",
    intensity: 1,
    payload: {
      teacher_id: teacherId,
      teacher_live_comment_id: comment.id,
      content_preview: input.content.trim().slice(0, 160),
    },
  });
  if (heatmapError) throw heatmapError;

  return comment;
}

export async function updateInterventionAlertStatus(
  alertId: string,
  status: InterventionAlert["status"],
) {
  const userId = await currentUserId();
  const patch: Partial<InterventionAlert> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "resolved" || status === "dismissed") {
    patch.resolved_by = userId;
    patch.resolved_at = new Date().toISOString();
  } else if (status === "acknowledged") {
    patch.resolved_by = null;
    patch.resolved_at = null;
  }

  const { data, error } = await supabase
    .from("intervention_alerts")
    .update(patch)
    .eq("id", alertId)
    .select("*")
    .single();
  if (error) throw error;
  return data as InterventionAlert;
}

export async function fetchLessonResources(lessonId: string) {
  const { data, error } = await supabase
    .from("lesson_resources")
    .select("*")
    .eq("lesson_id", lessonId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as LessonResource[];
}

export async function createLessonResource(input: {
  teacherId: string;
  organizationId: string;
  classId: string;
  lessonId: string;
  title: string;
  description: string;
  studentInstructions: string;
  teacherNotes: string;
  resourceType: LessonResourceType;
  sourceType: "upload" | "external_url";
  status: LessonResourceStatus;
  visibility: LessonResourceVisibility;
  displayMode: LessonResourceDisplayMode;
  externalUrl?: string;
  file?: File | null;
}) {
  let storagePath: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;
  let resourceType = input.resourceType;
  const metadata: Record<string, unknown> = {};
  const resourceId = uniqueId();

  if (input.sourceType === "upload") {
    if (!input.file) throw new Error("Choose a file to upload.");
    resourceType = resourceTypeFromFile(input.file);
    storagePath = storagePathForResource({
      organizationId: input.organizationId,
      classId: input.classId,
      lessonId: input.lessonId,
      fileName: input.file.name,
    });
    mimeType = input.file.type || null;
    fileSize = input.file.size;
    metadata.original_filename = input.file.name;

    const { error: uploadError } = await supabase.storage
      .from("lesson-resources")
      .upload(storagePath, input.file, {
        cacheControl: "3600",
        contentType: input.file.type || undefined,
        upsert: false,
      });
    if (uploadError) throw uploadError;
  }

  const { error: resourceError } = await supabase.from("lesson_resources").insert({
    id: resourceId,
    organization_id: input.organizationId,
    class_id: input.classId,
    lesson_id: input.lessonId,
    created_by: input.teacherId,
    title: input.title.trim(),
    description: input.description.trim(),
    resource_type: resourceType,
    source_type: input.sourceType,
    storage_bucket: input.sourceType === "upload" ? "lesson-resources" : null,
    storage_path: storagePath,
    external_url: input.sourceType === "external_url" ? input.externalUrl?.trim() : null,
    mime_type: mimeType,
    file_size_bytes: fileSize,
    teacher_notes: input.teacherNotes.trim(),
    student_instructions: input.studentInstructions.trim(),
    status: input.status,
    visibility: input.visibility,
    metadata,
  });
  if (resourceError) throw resourceError;

  const { data: resource, error: fetchError } = await supabase
    .from("lesson_resources")
    .select("*")
    .eq("id", resourceId)
    .single();
  if (fetchError) throw fetchError;

  const created = resource as LessonResource;
  const { error: placementError } = await supabase.from("lesson_resource_placements").insert({
    resource_id: created.id,
    organization_id: input.organizationId,
    class_id: input.classId,
    lesson_id: input.lessonId,
    display_mode: input.displayMode,
    position: 0,
  });
  if (placementError) throw placementError;

  return created;
}

export async function updateLessonResource(
  resourceId: string,
  patch: Partial<
    Pick<
      LessonResource,
      "title" | "description" | "student_instructions" | "teacher_notes" | "status" | "visibility"
    >
  >,
) {
  const { error } = await supabase.from("lesson_resources").update(patch).eq("id", resourceId);
  if (error) throw error;

  const { data, error: fetchError } = await supabase
    .from("lesson_resources")
    .select("*")
    .eq("id", resourceId)
    .single();
  if (fetchError) throw fetchError;

  return data as LessonResource;
}

export async function getLessonResourceSignedUrl(resource: {
  source_type: "upload" | "external_url";
  storage_bucket?: string | null;
  storage_path?: string | null;
  external_url?: string | null;
}) {
  if (resource.source_type === "external_url") return resource.external_url || "";
  if (!resource.storage_path) throw new Error("This resource has no storage path.");
  const { data, error } = await supabase.storage
    .from(resource.storage_bucket || "lesson-resources")
    .createSignedUrl(resource.storage_path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
}

export async function getLessonResourceThumbnailSignedUrl(resource: {
  thumbnail_url?: string | null;
  thumbnail_bucket?: string | null;
  thumbnail_path?: string | null;
}) {
  if (resource.thumbnail_url?.startsWith("http")) return resource.thumbnail_url;
  const path = resource.thumbnail_path || resource.thumbnail_url || "";
  if (!path) return "";
  const { data, error } = await supabase.storage
    .from(resource.thumbnail_bucket || "lesson-resources")
    .createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
}

export async function getResourcePageAssetSignedUrl(asset: ResourcePageAsset) {
  const { data, error } = await supabase.storage
    .from(asset.storage_bucket || "lesson-resources")
    .createSignedUrl(asset.storage_path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
}

export async function recordResourceInteraction(event: ResourceInteractionEvent) {
  // Telemetry fires on every open/progress tick — read the locally-cached session
  // instead of a per-event auth round trip (RLS still enforces the user server-side).
  const session = await getSession();
  const user = session?.user;
  if (!user) throw new Error("You need to sign in to record resource progress.");
  const { error } = await supabase.from("resource_interactions").insert({
    resource_id: event.resource_id,
    user_id: user.id,
    session_id: event.session_id || null,
    lesson_id: event.lesson_id || null,
    event_type: event.event_type,
    progress_seconds: event.progress_seconds ?? null,
    progress_percent: event.progress_percent ?? null,
  });
  if (error) throw error;
}

async function invokeResourceProcessing(
  body: Record<string, unknown>,
): Promise<ResourceProcessingResponse> {
  const session = await getSession();
  if (!session?.access_token) throw new Error("You need to sign in to process lesson resources.");
  const response = await fetchWithTimeout(functionUrl("resource-processing"), {
    method: "POST",
    headers: authHeaders(session.access_token),
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as ResourceProcessingResponse;
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || "Resource processing failed.");
  }
  return data;
}

export async function fetchResourceTextChunks(resourceId: string) {
  const data = await invokeResourceProcessing({
    action: "list_resource_chunks",
    resource_id: resourceId,
  });
  return {
    chunks: data.chunks || [],
    jobs: data.jobs || [],
    errors: data.errors || [],
    assets: data.assets || [],
  };
}

export async function uploadPdfPageAssets(
  resource: LessonResource,
  renderedAssets: RenderedPdfPageAsset[],
) {
  if (!renderedAssets.length) throw new Error("No PDF page previews were generated.");
  const assets = [];
  for (const asset of renderedAssets) {
    const storagePath = storagePathForPdfPageAsset({
      resourceId: resource.id,
      pageNumber: asset.page_number,
      assetType: asset.asset_type,
      mimeType: asset.mime_type,
    });
    const { error } = await supabase.storage
      .from("lesson-resources")
      .upload(storagePath, asset.blob, {
        cacheControl: "3600",
        contentType: asset.mime_type,
        upsert: false,
      });
    if (error) throw error;
    assets.push({
      page_number: asset.page_number,
      asset_type: asset.asset_type,
      storage_bucket: "lesson-resources",
      storage_path: storagePath,
      mime_type: asset.mime_type,
      width: asset.width,
      height: asset.height,
      file_size_bytes: asset.blob.size,
      metadata: asset.metadata || {},
    });
  }
  const data = await invokeResourceProcessing({
    action: "save_pdf_page_assets",
    resource_id: resource.id,
    assets,
    metadata: {
      rendered_in: "browser",
      rendered_at: new Date().toISOString(),
    },
  });
  return data.assets || [];
}

export async function saveExtractedPdfChunks(
  resourceId: string,
  chunks: Array<Pick<ResourceTextChunk, "page_number" | "chunk_index" | "chunk_text">>,
  metadata: Record<string, unknown> = {},
) {
  const data = await invokeResourceProcessing({
    action: "extract_pdf_chunks",
    resource_id: resourceId,
    chunks,
    metadata,
  });
  return data.chunks || [];
}

export async function transcribeMediaResource(resourceId: string) {
  const data = await invokeResourceProcessing({
    action: "transcribe_media_resource",
    resource_id: resourceId,
  });
  return data.chunks || [];
}

export async function ocrPdfPages(resourceId: string, pageNumbers?: number[]) {
  const data = await invokeResourceProcessing({
    action: "ocr_pdf_pages",
    resource_id: resourceId,
    page_numbers: pageNumbers || [],
  });
  return data.chunks || [];
}

export async function saveResourceChunkEdits(
  resourceId: string,
  chunks: Array<Pick<ResourceTextChunk, "id" | "page_number" | "chunk_index" | "chunk_text">>,
) {
  const data = await invokeResourceProcessing({
    action: "save_chunk_edits",
    resource_id: resourceId,
    chunks,
  });
  return data.chunks || [];
}

export async function approveResourceChunks(resourceId: string, chunkIds: string[]) {
  const data = await invokeResourceProcessing({
    action: "approve_chunks",
    resource_id: resourceId,
    chunk_ids: chunkIds,
  });
  return data.chunks || [];
}

export async function rejectResourceChunks(resourceId: string, chunkIds: string[]) {
  const data = await invokeResourceProcessing({
    action: "reject_chunks",
    resource_id: resourceId,
    chunk_ids: chunkIds,
  });
  return data.chunks || [];
}

export async function deleteResourceChunks(resourceId: string, chunkIds: string[]) {
  await invokeResourceProcessing({
    action: "delete_chunks",
    resource_id: resourceId,
    chunk_ids: chunkIds,
  });
}

export async function recordVoiceInteraction(event: VoiceInteractionEvent) {
  // Voice telemetry is high-frequency — same locally-cached session read as above.
  const session = await getSession();
  const user = session?.user;
  if (!user) throw new Error("You need to sign in to record voice usage.");

  const { error } = await supabase.from("voice_interaction_events").insert({
    user_id: user.id,
    session_id: event.session_id || null,
    lesson_id: event.lesson_id || null,
    turn_id: event.turn_id || null,
    event_type: event.event_type,
    input_modality: event.input_modality || null,
    transcript: event.transcript || null,
    transcript_confidence: event.transcript_confidence ?? null,
    duration_seconds: event.duration_seconds ?? null,
    payload: event.payload || {},
  });
  if (error) throw error;
}

export async function createAssignment(input: {
  teacherId: string;
  organizationId: string;
  classId: string;
  lessonId: string;
  title: string;
  instructions: string;
  dueAt?: string | null;
  status: Extract<AssignmentStatus, "draft" | "assigned">;
  required?: boolean;
  recipientIds: string[];
  resourceIds: string[];
}) {
  const assignmentId = uniqueId();
  const recipientIds = uniqueStrings(input.recipientIds);
  if (!recipientIds.length) throw new Error("Choose at least one student.");

  const { error: assignmentError } = await supabase.from("assignments").insert({
    id: assignmentId,
    organization_id: input.organizationId,
    class_id: input.classId,
    lesson_id: input.lessonId,
    title: input.title.trim(),
    instructions: input.instructions.trim(),
    assigned_by: input.teacherId,
    source: "teacher",
    status: input.status,
    requires_teacher_approval: false,
    required: input.required === true,
    due_at: input.dueAt || null,
  });
  if (assignmentError) throw assignmentError;

  const { error: recipientsError } = await supabase.from("assignment_recipients").insert(
    recipientIds.map((userId) => ({
      assignment_id: assignmentId,
      user_id: userId,
      status: "assigned" satisfies AssignmentRecipientStatus,
    })),
  );
  if (recipientsError) throw recipientsError;

  if (input.resourceIds.length) {
    const { error: resourcesError } = await supabase
      .from("lesson_resources")
      .update({ assignment_id: assignmentId })
      .in("id", input.resourceIds);
    if (resourcesError) throw resourcesError;
  }

  const [
    { data: assignment, error: assignmentFetchError },
    { data: recipients, error: recipientsFetchError },
  ] = await Promise.all([
    supabase.from("assignments").select("*").eq("id", assignmentId).single(),
    supabase.from("assignment_recipients").select("*").eq("assignment_id", assignmentId),
  ]);
  if (assignmentFetchError) throw assignmentFetchError;
  if (recipientsFetchError) throw recipientsFetchError;

  return {
    assignment: assignment as Assignment,
    recipients: (recipients || []) as AssignmentRecipient[],
  };
}

export async function updateAssignmentStatus(assignmentId: string, status: AssignmentStatus) {
  const { error } = await supabase
    .from("assignments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", assignmentId);
  if (error) throw error;

  const { data, error: fetchError } = await supabase
    .from("assignments")
    .select("*")
    .eq("id", assignmentId)
    .single();
  if (fetchError) throw fetchError;
  return data as Assignment;
}

export async function fetchStudentAssignments(): Promise<StudentAssignmentBundle> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Sign in to view assignments.");

  const { data: recipients, error: recipientsError } = await supabase
    .from("assignment_recipients")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (recipientsError) throw recipientsError;

  const assignmentIds = uniqueStrings(
    ((recipients || []) as AssignmentRecipient[]).map((recipient) => recipient.assignment_id),
  );
  if (!assignmentIds.length) {
    return { assignments: [], recipients: [], submissions: [], files: [] };
  }

  const [assignmentsResult, submissionsResult, filesResult] = await Promise.all([
    supabase
      .from("assignments")
      .select("*")
      .in("id", assignmentIds)
      .neq("status", "archived")
      .order("updated_at", { ascending: false }),
    supabase
      .from("assignment_submissions")
      .select("*")
      .eq("user_id", user.id)
      .in("assignment_id", assignmentIds)
      .order("updated_at", { ascending: false }),
    supabase
      .from("assignment_submission_files")
      .select("*")
      .eq("user_id", user.id)
      .in("assignment_id", assignmentIds)
      .order("created_at", { ascending: false }),
  ]);
  for (const result of [assignmentsResult, submissionsResult, filesResult]) {
    if (result.error) throw result.error;
  }

  return {
    assignments: (assignmentsResult.data || []) as Assignment[],
    recipients: (recipients || []) as AssignmentRecipient[],
    submissions: (submissionsResult.data || []) as AssignmentSubmission[],
    files: (filesResult.data || []) as AssignmentSubmissionFile[],
  };
}

export async function submitAssignment(input: {
  assignmentId: string;
  content: string;
  code: string;
  runResult?: Record<string, unknown> | null;
  files: File[];
}) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Sign in to submit assignments.");

  const submissionId = uniqueId();
  const now = new Date().toISOString();
  const { error: submissionError } = await supabase.from("assignment_submissions").insert({
    id: submissionId,
    assignment_id: input.assignmentId,
    user_id: user.id,
    content: input.content.trim() || null,
    code: input.code.trim() || null,
    run_result: input.runResult || null,
    status: "submitted" satisfies AssignmentSubmissionStatus,
    submitted_at: now,
  });
  if (submissionError) throw submissionError;

  const createdFiles: AssignmentSubmissionFile[] = [];
  for (const file of input.files) {
    const storagePath = storagePathForSubmission({
      assignmentId: input.assignmentId,
      userId: user.id,
      submissionId,
      fileName: file.name,
    });
    const { error: uploadError } = await supabase.storage
      .from("student-submissions")
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type || undefined,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const fileId = uniqueId();
    const { error: fileError } = await supabase.from("assignment_submission_files").insert({
      id: fileId,
      assignment_id: input.assignmentId,
      submission_id: submissionId,
      user_id: user.id,
      storage_bucket: "student-submissions",
      storage_path: storagePath,
      original_filename: file.name,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      status: "submitted",
    });
    if (fileError) throw fileError;

    const { data: fileRow, error: fileFetchError } = await supabase
      .from("assignment_submission_files")
      .select("*")
      .eq("id", fileId)
      .single();
    if (fileFetchError) throw fileFetchError;
    createdFiles.push(fileRow as AssignmentSubmissionFile);
  }

  const { error: recipientError } = await supabase
    .from("assignment_recipients")
    .update({ status: "submitted", updated_at: now })
    .eq("assignment_id", input.assignmentId)
    .eq("user_id", user.id);
  if (recipientError) throw recipientError;

  const [
    { data: submission, error: submissionFetchError },
    { data: recipient, error: recipientFetchError },
  ] = await Promise.all([
    supabase.from("assignment_submissions").select("*").eq("id", submissionId).single(),
    supabase
      .from("assignment_recipients")
      .select("*")
      .eq("assignment_id", input.assignmentId)
      .eq("user_id", user.id)
      .single(),
  ]);
  if (submissionFetchError) throw submissionFetchError;
  if (recipientFetchError) throw recipientFetchError;

  return {
    submission: submission as AssignmentSubmission,
    recipient: recipient as AssignmentRecipient,
    files: createdFiles,
  };
}

export async function gradeAssignmentSubmission(input: {
  teacherId: string;
  assignment: Assignment;
  submission: AssignmentSubmission;
  scorePercent: number;
  feedback: string;
  decision: "accepted" | "returned";
}) {
  const normalizedScore = Math.max(0, Math.min(100, input.scorePercent)) / 100;
  const now = new Date().toISOString();
  const recipientStatus =
    input.decision === "accepted"
      ? ("complete" satisfies AssignmentRecipientStatus)
      : ("returned" satisfies AssignmentRecipientStatus);

  const { error: submissionError } = await supabase
    .from("assignment_submissions")
    .update({
      score: normalizedScore,
      feedback: input.feedback.trim(),
      status: input.decision,
      updated_at: now,
    })
    .eq("id", input.submission.id);
  if (submissionError) throw submissionError;

  const { error: recipientError } = await supabase
    .from("assignment_recipients")
    .update({
      score: normalizedScore,
      feedback: input.feedback.trim(),
      status: recipientStatus,
      completed_at: input.decision === "accepted" ? now : null,
      updated_at: now,
    })
    .eq("assignment_id", input.assignment.id)
    .eq("user_id", input.submission.user_id);
  if (recipientError) throw recipientError;

  const { error: evidenceError } = await supabase.from("learning_evidence").insert({
    user_id: input.submission.user_id,
    lesson_id: input.assignment.lesson_id,
    milestone_id: input.assignment.milestone_id,
    source_type: "assignment",
    source_ref: {
      assignment_id: input.assignment.id,
      submission_id: input.submission.id,
      decision: input.decision,
    },
    skill_keys: [],
    score: normalizedScore,
    confidence: input.decision === "accepted" ? 0.85 : 0.55,
    rubric_result: {
      teacher_feedback: input.feedback.trim(),
      status: input.decision,
    },
    notes: input.feedback.trim() || "Assignment reviewed by teacher.",
    created_by: input.teacherId,
  });
  if (evidenceError) throw evidenceError;

  const [
    { data: submission, error: submissionFetchError },
    { data: recipient, error: recipientFetchError },
  ] = await Promise.all([
    supabase.from("assignment_submissions").select("*").eq("id", input.submission.id).single(),
    supabase
      .from("assignment_recipients")
      .select("*")
      .eq("assignment_id", input.assignment.id)
      .eq("user_id", input.submission.user_id)
      .single(),
  ]);
  if (submissionFetchError) throw submissionFetchError;
  if (recipientFetchError) throw recipientFetchError;

  return {
    submission: submission as AssignmentSubmission,
    recipient: recipient as AssignmentRecipient,
  };
}

async function invokeAssessmentAdmin(
  payload: Record<string, unknown>,
): Promise<AssessmentAdminResponse> {
  const session = await getSession();
  if (!session?.access_token) throw new Error("Sign in to work with assessments.");
  const response = await fetchWithTimeout(functionUrl("assessment-admin"), {
    method: "POST",
    headers: authHeaders(session.access_token),
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as AssessmentAdminResponse;
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || "Assessment operation failed.");
  }
  return data;
}

export async function createAssessment(input: {
  organizationId: string;
  classId: string;
  lessonId: string;
  title: string;
  instructions: string;
  dueAt?: string | null;
  status: Extract<AssessmentStatus, "draft" | "published">;
  gradingMode: AssessmentGradingMode;
  resultReleasePolicy: AssessmentResultReleasePolicy;
  attemptLimit: number;
  required?: boolean;
  recipientIds: string[];
  items: Array<{
    quizItemId?: string;
    prompt?: string;
    questionType?: "multiple_choice" | "text" | "code";
    choices?: Array<{ id: string; text: string }>;
    correctChoiceIds?: string[];
    rubric?: Record<string, unknown>;
    skillKeys?: string[];
    points: number;
    required: boolean;
  }>;
}) {
  const data = await invokeAssessmentAdmin({
    action: "create_assessment",
    organization_id: input.organizationId,
    class_id: input.classId,
    lesson_id: input.lessonId,
    title: input.title,
    instructions: input.instructions,
    due_at: input.dueAt || null,
    status: input.status,
    grading_mode: input.gradingMode,
    result_release_policy: input.resultReleasePolicy,
    attempt_limit: input.attemptLimit,
    required: input.required === true,
    recipient_ids: input.recipientIds,
    items: input.items.map((item) => ({
      quiz_item_id: item.quizItemId || undefined,
      prompt: item.prompt || undefined,
      question_type: item.questionType || undefined,
      choices: item.choices || undefined,
      correct_choice_ids: item.correctChoiceIds || undefined,
      rubric: item.rubric || undefined,
      skill_keys: item.skillKeys || undefined,
      points: item.points,
      required: item.required,
    })),
  });
  return data.data;
}

export async function updateAssessmentStatus(assessmentId: string, status: AssessmentStatus) {
  const data = await invokeAssessmentAdmin({
    action: "set_assessment_status",
    assessment_id: assessmentId,
    status,
  });
  return data.data?.assessment || null;
}

export async function fetchStudentAssessments(): Promise<StudentAssessmentBundle> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Sign in to view assessments.");

  const { data: recipients, error: recipientsError } = await supabase
    .from("assessment_recipients")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (recipientsError) throw recipientsError;
  const recipientRows = (recipients || []) as AssessmentRecipient[];
  const assessmentIds = uniqueStrings(recipientRows.map((recipient) => recipient.assessment_id));
  if (!assessmentIds.length) {
    return {
      assessments: [],
      items: [],
      recipients: [],
      attempts: [],
      itemAttempts: [],
      quizzes: [],
    };
  }

  const [assessmentsResult, itemsResult, attemptsResult] = await Promise.all([
    supabase
      .from("assessments")
      .select("*")
      .in("id", assessmentIds)
      .neq("status", "archived")
      .order("updated_at", { ascending: false }),
    supabase
      .from("assessment_items")
      .select("*")
      .in("assessment_id", assessmentIds)
      .order("position", { ascending: true }),
    supabase
      .from("assessment_attempts")
      .select("*")
      .eq("user_id", user.id)
      .in("assessment_id", assessmentIds)
      .order("updated_at", { ascending: false }),
  ]);
  for (const result of [assessmentsResult, itemsResult, attemptsResult]) {
    if (result.error) throw result.error;
  }
  const items = (itemsResult.data || []) as AssessmentItem[];
  const attempts = (attemptsResult.data || []) as AssessmentAttempt[];
  const quizIds = uniqueStrings(items.map((item) => item.quiz_item_id));
  const attemptIds = uniqueStrings(attempts.map((attempt) => attempt.id));
  const [quizzesResult, itemAttemptsResult] = await Promise.all([
    quizIds.length
      ? supabase.from("quiz_items").select("*").in("id", quizIds)
      : Promise.resolve({ data: [], error: null }),
    attemptIds.length
      ? supabase
          .from("assessment_item_attempts")
          .select("*")
          .in("assessment_attempt_id", attemptIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (quizzesResult.error) throw quizzesResult.error;
  if (itemAttemptsResult.error) throw itemAttemptsResult.error;

  return {
    assessments: (assessmentsResult.data || []) as Assessment[],
    items,
    recipients: recipientRows,
    attempts,
    itemAttempts: (itemAttemptsResult.data || []) as AssessmentItemAttempt[],
    quizzes: (quizzesResult.data || []) as CurriculumQuizItem[],
  };
}

export async function startAssessment(assessmentId: string) {
  const data = await invokeAssessmentAdmin({
    action: "start_assessment",
    assessment_id: assessmentId,
  });
  return data.data;
}

export async function submitAssessment(input: {
  attemptId: string;
  answers: Array<{
    assessmentItemId: string;
    answerMode: "text" | "code" | "multiple_choice";
    answerText?: string;
    answerCode?: string;
    choiceId?: string;
    runResult?: Record<string, unknown> | null;
  }>;
}) {
  const data = await invokeAssessmentAdmin({
    action: "submit_assessment",
    attempt_id: input.attemptId,
    answers: input.answers.map((answer) => ({
      assessment_item_id: answer.assessmentItemId,
      answer_mode: answer.answerMode,
      answer_text: answer.answerText || undefined,
      answer_code: answer.answerCode || undefined,
      choice_id: answer.choiceId || undefined,
      run_result: answer.runResult || undefined,
    })),
  });
  return data.data;
}

export async function reviewAssessmentItem(input: {
  itemAttemptId: string;
  scorePercent: number;
  feedback: string;
}) {
  const data = await invokeAssessmentAdmin({
    action: "review_assessment_item",
    item_attempt_id: input.itemAttemptId,
    score_percent: input.scorePercent,
    feedback: input.feedback,
  });
  return data.data?.item_attempt || null;
}

export async function returnAssessment(input: { attemptId: string; feedback: string }) {
  const data = await invokeAssessmentAdmin({
    action: "return_assessment",
    attempt_id: input.attemptId,
    feedback: input.feedback,
  });
  return data.data;
}

export async function getSubmissionFileSignedUrl(file: AssignmentSubmissionFile) {
  const { data, error } = await supabase.storage
    .from(file.storage_bucket || "student-submissions")
    .createSignedUrl(file.storage_path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
}

export async function invokeTypedChat(input: {
  accessToken: string;
  lessonId: string;
  sessionId?: string | null;
  answer?: TypedChatAnswer;
  mentorPreferences: MentorPreferences;
}) {
  const response = await fetchWithTimeout(functionUrl("chat"), {
    method: "POST",
    headers: authHeaders(await freshAccessToken(input.accessToken)),
    body: JSON.stringify({
      lesson_id: input.lessonId,
      session_id: input.sessionId || undefined,
      answer: input.answer,
      mentor_preferences: input.mentorPreferences,
    }),
  });
  const data = (await response.json()) as TypedChatEnvelope;
  if (!response.ok || data.status === "error") {
    throw new Error(data.reply || "Chat request failed.");
  }
  return data;
}

export async function createRealtimeVoiceSession(input: {
  accessToken: string;
  sdp: string;
  lessonId: string;
  sessionId?: string | null;
  voice: string;
}) {
  const response = await fetchWithTimeout(
    functionUrl("voice-session"),
    {
      method: "POST",
      headers: authHeaders(await freshAccessToken(input.accessToken)),
      body: JSON.stringify({
        action: "realtime_session",
        sdp: input.sdp,
        lesson_id: input.lessonId,
        session_id: input.sessionId || null,
        voice: input.voice,
      }),
    },
    // Heavier than mentor_audio (auth + external OpenAI SDP negotiation + edge cold start):
    // give the handshake more room so a slow mobile network isn't aborted mid-negotiation.
    35000,
  );
  const data = (await response.json()) as {
    status: "ok" | "error";
    sdp?: string;
    model?: string;
    voice?: string;
    error?: string;
  };
  if (!response.ok || data.status === "error" || !data.sdp) {
    throw new Error(data.error || "Could not start live voice.");
  }
  return data;
}

export async function getMentorAudio(input: {
  accessToken: string;
  text: string;
  lessonId: string;
  sessionId?: string | null;
  turnId?: string | null;
  voice: string;
  rate: number;
}) {
  const response = await fetchWithTimeout(
    functionUrl("voice-session"),
    {
      method: "POST",
      headers: authHeaders(await freshAccessToken(input.accessToken)),
      body: JSON.stringify({
        action: "mentor_audio",
        text: input.text,
        lesson_id: input.lessonId,
        session_id: input.sessionId || null,
        turn_id: input.turnId || null,
        voice: input.voice,
        rate: input.rate,
      }),
    },
    30000,
  );
  const data = (await response.json()) as {
    status: "ok" | "error";
    audio_url?: string;
    cache_hit?: boolean;
    model?: string;
    voice?: string;
    error?: string;
  };
  if (!response.ok || data.status === "error" || !data.audio_url) {
    throw new Error(data.error || "Could not prepare Mentor audio.");
  }
  return data;
}

export async function invokeJargonRun(input: {
  accessToken: string;
  code: string;
  answers: string[];
}) {
  const response = await fetchWithTimeout(
    functionUrl("run"),
    {
      method: "POST",
      headers: authHeaders(await freshAccessToken(input.accessToken)),
      body: JSON.stringify({
        code: input.code,
        answers: input.answers,
      }),
    },
    20000,
  );
  const data = (await response.json()) as JargonRunResponse | null;
  if (!response.ok) {
    // The run fn's error responses (incl. engine timeouts, HTTP 502) carry the canonical
    // run-result dict — with the explicit `timeout` flag the tutor prefers. Return it as
    // the result (status "error" renders in the output bubble and rides run_result to the
    // mentor) instead of throwing the shape away.
    const isRunShape =
      !!data &&
      typeof data === "object" &&
      typeof data.status === "string" &&
      (Array.isArray(data.errors) || data.output !== undefined);
    if (isRunShape) return data;
    const firstError = data && Array.isArray(data.errors) ? data.errors[0] : "";
    throw new Error(firstError || "Jargon run failed.");
  }
  if (!data) throw new Error("Jargon run returned an empty response.");
  return data;
}
