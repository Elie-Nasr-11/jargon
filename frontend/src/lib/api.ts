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
  CostModelDashboard,
  CurriculumAdminResponse,
  CurriculumAuthoringData,
  CurriculumBlueprint,
  CurriculumCourse,
  CurriculumCourseVersion,
  CurriculumMilestone,
  CurriculumQuizItem,
  CurriculumSubject,
  CurriculumUnit,
  JargonRunResponse,
  GoogleClassroomCourse,
  GoogleClassroomIntegrationState,
  GoogleClassroomPerson,
  GoogleClassroomResponse,
  CanvasCourse,
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
  ModelUsageEvent,
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
  StudentMastery,
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
      subject_title: subject?.title || null,
      course_title: course?.title || null,
      unit_title: unit?.title || null,
      curriculum_group: curriculumGroup || null,
    };
  });
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
  const { data, error } = await supabase
    .from("learning_sessions")
    .select("*")
    .eq("lesson_id", lessonId)
    .order("updated_at", { ascending: false })
    .limit(1);
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
    | "push_grades"
    | "sync";
  organizationId?: string | null;
  connectionId?: string | null;
  baseUrl?: string | null;
  canvasCourseId?: string | null;
  classId?: string | null;
  code?: string | null;
  state?: string | null;
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
}) {
  const data = await invokeCanvas({
    accessToken: input.accessToken,
    action: "import_course",
    connectionId: input.connectionId,
    canvasCourseId: input.canvasCourseId,
    classId: input.classId,
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

export async function invokeCurriculumAdmin(input: {
  accessToken: string;
  action: "save_lesson_blueprint" | "publish_lesson" | "archive_lesson";
  organizationId: string;
  classId?: string | null;
  lessonId?: string | null;
  blueprint?: CurriculumBlueprint;
}) {
  const response = await fetchWithTimeout(functionUrl("curriculum-admin"), {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: JSON.stringify({
      action: input.action,
      organization_id: input.organizationId,
      class_id: input.classId || undefined,
      lesson_id: input.lessonId || undefined,
      blueprint: input.blueprint,
    }),
  });
  const data = (await response.json()) as CurriculumAdminResponse;
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || "Curriculum update failed.");
  }
  return data;
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
  ]) {
    if (result.error) throw result.error;
  }

  const sessions = (sessionsResult.data || []) as LearningSession[];
  const assignments = (assignmentsResult.data || []) as Assignment[];
  const assessments = (assessmentsResult.data || []) as Assessment[];
  const assignmentIds = uniqueStrings(assignments.map((assignment) => assignment.id));
  const assessmentIds = uniqueStrings(assessments.map((assessment) => assessment.id));
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
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
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
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
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
    headers: authHeaders(input.accessToken),
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
      headers: authHeaders(input.accessToken),
      body: JSON.stringify({
        action: "realtime_session",
        sdp: input.sdp,
        lesson_id: input.lessonId,
        session_id: input.sessionId || null,
        voice: input.voice,
      }),
    },
    20000,
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
      headers: authHeaders(input.accessToken),
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
      headers: authHeaders(input.accessToken),
      body: JSON.stringify({
        code: input.code,
        answers: input.answers,
      }),
    },
    20000,
  );
  const data = (await response.json()) as JargonRunResponse;
  if (!response.ok) {
    throw new Error((data.errors && data.errors[0]) || "Jargon run failed.");
  }
  return data;
}
