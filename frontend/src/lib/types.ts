export type Lesson = {
  id: string;
  position: number;
  title: string;
  tutor_prompt: string;
  sample_code: string;
  module: string;
  level: string;
  expected_output: string | null;
  unit_id?: string | null;
  author_user_id?: string | null;
  publication_status?: "draft" | "published" | "archived";
  curriculum_metadata?: Record<string, unknown>;
  milestone_id?: string | null;
};

export type LessonActivity = {
  id: string;
  lesson_id: string;
  position: number;
  title: string;
  activity_type: "discussion" | "code" | "multiple_choice" | "reflection" | "file";
  stage: "intro" | "teach" | "practice" | "assessment" | "review" | "complete";
  prompt: string;
  response_mode: "text" | "code" | "multiple_choice" | "file";
  starter_code: string;
  expected_output: string | null;
  choices: Array<{ id?: string; label?: string; text?: string; value?: string }>;
  rubric: Record<string, unknown>;
  skill_keys: string[];
  pass_score: number;
};

export type CurriculumStatus = "draft" | "published" | "archived";

export type CurriculumSubject = {
  id: string;
  organization_id: string | null;
  title: string;
  description: string;
  status: CurriculumStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CurriculumCourse = {
  id: string;
  subject_id: string;
  organization_id: string | null;
  title: string;
  description: string;
  status: CurriculumStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CurriculumCourseVersion = {
  id: string;
  course_id: string;
  version_label: string;
  status: CurriculumStatus;
  is_current: boolean;
  content_schema_version: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CurriculumUnit = {
  id: string;
  course_version_id: string;
  position: number;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type CurriculumMilestone = {
  id: string;
  lesson_id: string;
  position: number;
  title: string;
  objective: string;
  level: string;
  skill_keys: string[];
  expected_evidence: Record<string, unknown>;
  completion_rules: Record<string, unknown>;
  allowed_response_modes: Array<"text" | "code" | "multiple_choice" | "file">;
  created_at: string;
  updated_at: string;
};

export type CurriculumQuizItem = {
  id: string;
  lesson_id: string;
  milestone_id: string | null;
  activity_id: string | null;
  position: number;
  prompt: string;
  question_type: "multiple_choice" | "text" | "code";
  choices: Array<{ id: string; text: string }>;
  correct_choice_ids: string[];
  rubric: Record<string, unknown>;
  skill_keys: string[];
  status: CurriculumStatus;
  created_at: string;
  updated_at: string;
};

export type CurriculumAuthoringData = {
  classes: TeacherClassSummary[];
  subjects: CurriculumSubject[];
  courses: CurriculumCourse[];
  courseVersions: CurriculumCourseVersion[];
  units: CurriculumUnit[];
  lessons: Lesson[];
  milestones: CurriculumMilestone[];
  activities: LessonActivity[];
  quizzes: CurriculumQuizItem[];
  resources: LessonResource[];
};

export type CurriculumBlueprint = {
  subject: { id?: string; title: string; description?: string };
  course: { id?: string; title: string; description?: string };
  unit: { id?: string; title: string; position: number };
  lesson: {
    id?: string;
    title: string;
    level: string;
    type: "discussion" | "code" | "reflection" | "multiple_choice" | "file";
    tutor_prompt: string;
    sample_code?: string;
  };
  milestone: {
    title: string;
    objective: string;
    skill_keys: string[];
    allowed_response_modes: Array<"text" | "code" | "multiple_choice" | "file">;
  };
  activity: {
    title: string;
    stage: "intro" | "teach" | "practice" | "assessment" | "review";
    prompt: string;
    response_mode: "text" | "code" | "multiple_choice" | "file";
    starter_code?: string;
    expected_output?: string;
    rubric?: Record<string, unknown>;
  };
  quiz?: {
    prompt: string;
    choices: Array<{ id: string; text: string }>;
    correct_choice_ids: string[];
  };
  resource_ids?: string[];
};

export type CurriculumAdminResponse = {
  status: "ok" | "error";
  lesson_id?: string;
  subject_id?: string;
  course_id?: string;
  unit_id?: string;
  error?: string;
};

export type LessonResourceType =
  | "video"
  | "audio"
  | "pdf"
  | "flipbook"
  | "youtube"
  | "image"
  | "link"
  | "document";

export type LessonResourceSource = "upload" | "external_url";
export type LessonResourceStatus = "draft" | "published" | "archived";
export type LessonResourceVisibility = "class_private" | "org_private" | "public";
export type LessonResourceDisplayMode = "inline" | "modal" | "card";

export type LessonResource = {
  id: string;
  organization_id: string | null;
  class_id: string | null;
  course_id: string | null;
  course_version_id: string | null;
  unit_id: string | null;
  lesson_id: string | null;
  milestone_id: string | null;
  activity_id: string | null;
  assignment_id: string | null;
  created_by: string | null;
  title: string;
  description: string;
  resource_type: LessonResourceType;
  source_type: LessonResourceSource;
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  page_count: number | null;
  thumbnail_path: string | null;
  teacher_notes: string;
  student_instructions: string;
  transcript_text: string | null;
  status: LessonResourceStatus;
  visibility: LessonResourceVisibility;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type LessonResourcePlacement = {
  id: string;
  resource_id: string;
  organization_id: string | null;
  class_id: string | null;
  course_id: string | null;
  course_version_id: string | null;
  unit_id: string | null;
  lesson_id: string | null;
  milestone_id: string | null;
  activity_id: string | null;
  assignment_id: string | null;
  quiz_item_id: string | null;
  position: number;
  display_mode: LessonResourceDisplayMode;
  show_before_stage: LearningSession["stage"] | null;
  created_at: string;
};

export type LessonChatResource = {
  id: string;
  title: string;
  description?: string;
  resource_type: LessonResourceType;
  display_mode: LessonResourceDisplayMode;
  source_type: LessonResourceSource;
  storage_bucket?: string | null;
  storage_path?: string | null;
  signed_url?: string;
  external_url?: string | null;
  thumbnail_url?: string | null;
  student_instructions?: string;
};

export type ResourceInteractionEvent = {
  resource_id: string;
  session_id?: string | null;
  lesson_id?: string | null;
  event_type: "shown" | "opened" | "played" | "paused" | "completed" | "downloaded";
  progress_seconds?: number;
  progress_percent?: number;
};

export type ChatInputModality = "typed" | "dictated" | "audio_session";

export type VoiceInteractionEventType =
  | "dictation_started"
  | "dictation_transcribed"
  | "dictation_submitted"
  | "read_aloud_started"
  | "read_aloud_finished";

export type VoiceInteractionEvent = {
  session_id?: string | null;
  lesson_id?: string | null;
  turn_id?: string | null;
  event_type: VoiceInteractionEventType;
  input_modality?: Exclude<ChatInputModality, "typed"> | null;
  transcript?: string | null;
  transcript_confidence?: number | null;
  duration_seconds?: number | null;
  payload?: Record<string, unknown>;
};

export type LearningSession = {
  id: string;
  user_id: string;
  lesson_id: string;
  current_activity_id: string | null;
  stage: "intro" | "teach" | "practice" | "assessment" | "review" | "complete";
  status: "active" | "needs_retry" | "needs_rescue" | "complete" | "abandoned";
  score: number;
  retry_count: number;
  rescue_count: number;
  created_at: string;
  updated_at: string;
};

export type LearningTurn = {
  id: string;
  session_id: string;
  user_id: string;
  lesson_id: string;
  role: "student" | "mentor" | "system";
  stage: LearningSession["stage"];
  response_mode: "text" | "code" | "multiple_choice" | "file" | null;
  content: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type LessonAttempt = {
  id: string;
  session_id: string;
  activity_id: string | null;
  user_id: string;
  lesson_id: string;
  answer_mode: "text" | "code" | "multiple_choice" | "file";
  answer_text: string | null;
  answer_code: string | null;
  choice_id: string | null;
  run_result: Record<string, unknown> | null;
  score: number | null;
  passed: boolean | null;
  feedback: string | null;
  input_modality?: ChatInputModality | null;
  transcript_confidence?: number | null;
  created_at: string;
};

export type QuizAttempt = {
  id: string;
  quiz_item_id: string;
  session_id: string | null;
  user_id: string;
  lesson_id: string;
  answer_mode: "text" | "code" | "multiple_choice" | "file";
  answer_text: string | null;
  answer_code: string | null;
  choice_id: string | null;
  run_result: Record<string, unknown> | null;
  score: number | null;
  passed: boolean | null;
  feedback: string | null;
  graded_by: "mentor" | "teacher" | "system";
  created_at: string;
};

export type LearningEvidence = {
  id: string;
  user_id: string;
  lesson_id: string | null;
  milestone_id: string | null;
  session_id: string | null;
  source_type: "chat_turn" | "code_run" | "quiz" | "file" | "teacher_note" | "assignment";
  source_ref: Record<string, unknown>;
  skill_keys: string[];
  score: number | null;
  confidence: number | null;
  rubric_result: Record<string, unknown>;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type StudentMastery = {
  user_id: string;
  skill_key: string;
  level: string;
  evidence_count: number;
  score: number;
  attempt_count: number;
  latest_score: number | null;
  confidence: number | null;
  common_error_patterns: unknown[];
  last_practiced_at: string | null;
  last_seen_at: string;
  updated_at: string;
};

export type TeacherNote = {
  id: string;
  student_id: string;
  teacher_id: string;
  class_id: string | null;
  lesson_id: string | null;
  note: string;
  visibility: "teacher_private" | "student_visible";
  created_at: string;
  updated_at: string;
};

export type AssignmentStatus = "recommended" | "draft" | "assigned" | "archived";
export type AssignmentRecipientStatus =
  | "assigned"
  | "started"
  | "submitted"
  | "returned"
  | "complete";
export type AssignmentSubmissionStatus = "submitted" | "returned" | "accepted";
export type AssignmentSubmissionFileStatus = "submitted" | "returned" | "accepted" | "removed";

export type Assignment = {
  id: string;
  organization_id: string | null;
  class_id: string | null;
  course_id: string | null;
  lesson_id: string | null;
  milestone_id: string | null;
  title: string;
  instructions: string;
  assigned_by: string | null;
  source: "teacher" | "mentor_recommendation" | "system";
  status: AssignmentStatus;
  requires_teacher_approval: boolean;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssignmentRecipient = {
  id: string;
  assignment_id: string;
  user_id: string;
  status: AssignmentRecipientStatus;
  score: number | null;
  feedback: string | null;
  assigned_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type AssignmentSubmission = {
  id: string;
  assignment_id: string;
  user_id: string;
  content: string | null;
  code: string | null;
  file_path: string | null;
  run_result: Record<string, unknown> | null;
  score: number | null;
  feedback: string | null;
  status: AssignmentSubmissionStatus;
  created_at: string;
  updated_at: string;
  submitted_at?: string | null;
};

export type AssignmentSubmissionFile = {
  id: string;
  assignment_id: string;
  submission_id: string | null;
  user_id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  status: AssignmentSubmissionFileStatus;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  name: string | null;
  grade: string | null;
};

export type MentorPreferences = {
  pace: "brief" | "balanced" | "guided";
  tone: "neutral" | "encouraging";
  hint_level: "low" | "medium" | "high";
};

export type TypedChatAnswer = {
  mode: "text" | "code" | "multiple_choice" | "file";
  text?: string;
  code?: string;
  choice_id?: string;
  run_result?: Record<string, unknown> | null;
  input_modality?: ChatInputModality;
  transcript_confidence?: number | null;
};

export type TypedChatEnvelope = {
  status: "ok" | "error";
  reply: string;
  session_id: string | null;
  lesson_id: string | null;
  stage: LearningSession["stage"];
  response_mode: "text" | "code" | "multiple_choice" | "file";
  choices: Array<{ id?: string; label?: string; text?: string; value?: string }>;
  exercise: Record<string, unknown> | null;
  assessment: Record<string, unknown> | null;
  resources?: LessonChatResource[];
  next_action: "reply" | "run_code" | "choose" | "retry" | "rescue" | "continue" | "complete";
  guardrail: {
    redirected: boolean;
    reason: string | null;
  };
};

export type JargonRunResponse = {
  output: string[];
  result?: string[];
  errors: string[];
  memory: Record<string, unknown>;
  ask: string | null;
  ask_var: string | null;
  status: "ok" | "error" | "limit_exceeded" | "waiting_for_input" | "sandbox_error";
  truncated: boolean;
  limits_hit: string[];
};

export type LocalRunResult = {
  language: "javascript" | "python";
  ok: boolean;
  output: string;
};

export type JargonExecutionResult = {
  language: "jargon";
  ok: boolean;
  output: string;
  raw: JargonRunResponse;
};

export type CodeExecutionResult = LocalRunResult | JargonExecutionResult;

export type PilotRole = "student" | "teacher";

export type AdminSeedUser = {
  email: string;
  name: string;
  role: PilotRole;
  grade?: string;
  password?: string;
};

export type AdminSeedResult = {
  email: string;
  role: PilotRole;
  status: "created" | "reused" | "failed" | "skipped";
  user_id?: string;
  error?: string;
};

export type AdminSeedResponse = {
  status: "ok" | "error";
  batch_id?: string;
  organization_id?: string;
  class_id?: string;
  results: AdminSeedResult[];
  error?: string;
};

export type TeacherClassSummary = {
  id: string;
  name: string;
  status: string;
  organization_id: string;
  organizations?:
    | {
        name: string | null;
        slug: string | null;
      }
    | Array<{
        name: string | null;
        slug: string | null;
      }>
    | null;
  class_memberships?: Array<{
    role: "student" | "teacher";
    status: string;
  }>;
};

export type TeacherClassMembership = {
  id: string;
  class_id: string;
  user_id: string;
  role: "student" | "teacher";
  status: string;
  created_at: string;
};

export type TeacherDashboardData = {
  classes: TeacherClassSummary[];
  memberships: TeacherClassMembership[];
  profiles: Profile[];
  lessons: Lesson[];
  sessions: LearningSession[];
  turns: LearningTurn[];
  attempts: LessonAttempt[];
  quizAttempts: QuizAttempt[];
  evidence: LearningEvidence[];
  mastery: StudentMastery[];
  notes: TeacherNote[];
  resources: LessonResource[];
  assignments: Assignment[];
  assignmentRecipients: AssignmentRecipient[];
  assignmentSubmissions: AssignmentSubmission[];
  assignmentSubmissionFiles: AssignmentSubmissionFile[];
};

export type StudentAssignmentBundle = {
  assignments: Assignment[];
  recipients: AssignmentRecipient[];
  submissions: AssignmentSubmission[];
  files: AssignmentSubmissionFile[];
};
