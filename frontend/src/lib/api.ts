import type { Session, User } from "@supabase/supabase-js";
import { functionUrl, supabase, supabaseAnonKey } from "@/lib/supabase";
import type {
  Assignment,
  AssignmentRecipient,
  AssignmentRecipientStatus,
  AssignmentStatus,
  AssignmentSubmission,
  AssignmentSubmissionFile,
  AssignmentSubmissionStatus,
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
  AdminSeedResponse,
  AdminSeedUser,
  MentorPreferences,
  Profile,
  QuizAttempt,
  StudentMastery,
  TeacherClassSummary,
  TeacherClassMembership,
  TeacherDashboardData,
  TeacherNote,
  ResourceInteractionEvent,
  StudentAssignmentBundle,
  TypedChatAnswer,
  TypedChatEnvelope,
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
  return data.session;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
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
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
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
  return (data || []) as Lesson[];
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

  if (!classIds.length) {
    return {
      classes,
      memberships: [],
      profiles: [],
      lessons,
      sessions: [],
      turns: [],
      attempts: [],
      quizAttempts: [],
      evidence: [],
      mastery: [],
      notes: [],
      resources: [],
      assignments: [],
      assignmentRecipients: [],
      assignmentSubmissions: [],
      assignmentSubmissionFiles: [],
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
    assignmentsResult,
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
    classIds.length
      ? supabase
          .from("assignments")
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
    assignmentsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const sessions = (sessionsResult.data || []) as LearningSession[];
  const assignments = (assignmentsResult.data || []) as Assignment[];
  const assignmentIds = uniqueStrings(assignments.map((assignment) => assignment.id));
  const sessionIds = uniqueStrings(sessions.map((session) => session.id));
  const [
    { data: turnRows, error: turnsError },
    assignmentRecipientsResult,
    assignmentSubmissionsResult,
    assignmentFilesResult,
  ] = await Promise.all([
    sessionIds.length
      ? supabase
          .from("learning_turns")
          .select("*")
          .in("session_id", sessionIds)
          .order("created_at", { ascending: true })
          .limit(600)
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
  ]);
  if (turnsError) throw turnsError;
  for (const result of [
    assignmentRecipientsResult,
    assignmentSubmissionsResult,
    assignmentFilesResult,
  ]) {
    if (result.error) throw result.error;
  }

  return {
    classes,
    memberships,
    profiles: (profilesResult.data || []) as Profile[],
    lessons,
    sessions,
    turns: (turnRows || []) as LearningTurn[],
    attempts: (attemptsResult.data || []) as LessonAttempt[],
    quizAttempts: (quizAttemptsResult.data || []) as QuizAttempt[],
    evidence: (evidenceResult.data || []) as LearningEvidence[],
    mastery: (masteryResult.data || []) as StudentMastery[],
    notes: (notesResult.data || []) as TeacherNote[],
    resources: (resourcesResult.data || []) as LessonResource[],
    assignments,
    assignmentRecipients: (assignmentRecipientsResult.data || []) as AssignmentRecipient[],
    assignmentSubmissions: (assignmentSubmissionsResult.data || []) as AssignmentSubmission[],
    assignmentSubmissionFiles: (assignmentFilesResult.data || []) as AssignmentSubmissionFile[],
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
