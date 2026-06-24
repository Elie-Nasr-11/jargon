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
  subject_title?: string | null;
  course_title?: string | null;
  unit_title?: string | null;
  curriculum_group?: string | null;
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
  thumbnail_bucket?: string | null;
  thumbnail_path?: string | null;
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

export type ResourceInteraction = ResourceInteractionEvent & {
  id: string;
  user_id: string;
  created_at: string;
};

export type ResourceProcessingJobStatus =
  | "draft"
  | "processing"
  | "complete"
  | "failed"
  | "cancelled";

export type ResourceProcessingJob = {
  id: string;
  resource_id: string;
  organization_id: string | null;
  class_id: string | null;
  lesson_id: string | null;
  job_type:
    | "pdf_text_extraction"
    | "pdf_page_render"
    | "pdf_ocr"
    | "audio_transcription"
    | "video_transcription";
  status: ResourceProcessingJobStatus;
  requested_by: string | null;
  completed_by: string | null;
  chunk_count: number;
  error_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ResourceProcessingError = {
  id: string;
  job_id: string | null;
  resource_id: string;
  severity: "warning" | "error";
  page_number: number | null;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ResourceTextChunkStatus = "draft" | "approved" | "rejected";
export type ResourceTextChunkSourceKind = "document" | "audio" | "video" | "manual";

export type ResourcePageAssetType = "thumbnail" | "ocr_image";

export type ResourcePageAsset = {
  id: string;
  resource_id: string;
  job_id: string | null;
  organization_id: string | null;
  class_id: string | null;
  lesson_id: string | null;
  page_number: number;
  asset_type: ResourcePageAssetType;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  status: "ready" | "failed" | "deleted";
  created_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ResourceTextChunk = {
  id: string;
  resource_id: string;
  job_id: string | null;
  organization_id: string | null;
  class_id: string | null;
  lesson_id: string | null;
  page_number: number;
  chunk_index: number;
  chunk_text: string;
  source_kind: ResourceTextChunkSourceKind;
  start_seconds: number | null;
  end_seconds: number | null;
  confidence: number | null;
  status: ResourceTextChunkStatus;
  created_by: string | null;
  updated_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ResourceProcessingResponse = {
  status: "ok" | "error";
  resource_id?: string;
  job_id?: string;
  chunks?: ResourceTextChunk[];
  jobs?: ResourceProcessingJob[];
  errors?: ResourceProcessingError[];
  assets?: ResourcePageAsset[];
  deleted_chunk_ids?: string[];
  error?: string;
};

export type ChatInputModality = "typed" | "dictated" | "audio_session";

export type VoiceInteractionEventType =
  | "dictation_started"
  | "dictation_transcribed"
  | "dictation_submitted"
  | "read_aloud_started"
  | "read_aloud_finished"
  | "read_aloud_requested"
  | "read_aloud_cached"
  | "read_aloud_failed"
  | "voice_session_started"
  | "voice_session_ready"
  | "voice_session_ended"
  | "voice_session_failed"
  | "voice_turn_submitted"
  | "voice_tool_result";

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

export type InterventionAlert = {
  id: string;
  student_id: string;
  class_id: string | null;
  lesson_id: string | null;
  session_id: string | null;
  created_by: string | null;
  alert_type: string;
  title: string;
  message: string;
  severity: "low" | "medium" | "high";
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  payload: Record<string, unknown>;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LiveSessionViewer = {
  id: string;
  session_id: string;
  student_id: string;
  teacher_id: string;
  class_id: string | null;
  status: "active" | "inactive";
  last_seen_at: string;
  created_at: string;
};

export type TeacherLiveComment = {
  id: string;
  session_id: string;
  student_id: string;
  teacher_id: string;
  class_id: string | null;
  content: string;
  visibility: "student_visible" | "teacher_private";
  turn_id: string | null;
  created_at: string;
};

export type TranscriptHeatmapEvent = {
  id: string;
  session_id: string;
  user_id: string;
  lesson_id: string | null;
  turn_id: string | null;
  event_type:
    | "confusion"
    | "retry"
    | "rescue"
    | "quiz_miss"
    | "failed_code_run"
    | "low_confidence_dictation"
    | "teacher_intervention";
  intensity: number;
  payload: Record<string, unknown>;
  created_at: string;
};

export type RuntimeEvent = {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  class_id: string | null;
  session_id: string | null;
  lesson_id: string | null;
  event_type:
    | "chat_failure"
    | "run_failure"
    | "stage_transition"
    | "completion"
    | "retry"
    | "rescue"
    | "controlled_error";
  status: "ok" | "error";
  latency_ms: number | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ModelUsageEvent = {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  class_id: string | null;
  session_id: string | null;
  lesson_id: string | null;
  provider: string;
  model: string;
  task_type:
    | "mentor_turn"
    | "grading"
    | "rescue"
    | "authoring"
    | "summarization"
    | "speech_to_text"
    | "text_to_speech";
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  estimated_cost_usd: number | null;
  latency_ms: number | null;
  status: "ok" | "error";
  payload: Record<string, unknown>;
  created_at: string;
};

export type SpeechUsageEvent = {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  class_id: string | null;
  session_id: string | null;
  provider: string;
  task_type: "speech_to_text" | "text_to_speech";
  duration_seconds: number;
  character_count: number;
  estimated_cost_usd: number | null;
  status: "ok" | "error";
  created_at: string | null;
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

export type AssessmentStatus = "draft" | "published" | "archived";
export type AssessmentGradingMode = "auto" | "teacher" | "mixed";
export type AssessmentResultReleasePolicy = "immediate" | "after_review" | "manual";
export type AssessmentRecipientStatus =
  | "assigned"
  | "started"
  | "submitted"
  | "returned"
  | "complete";
export type AssessmentAttemptStatus = "in_progress" | "submitted" | "graded" | "returned";
export type AssessmentReviewState = "auto_graded" | "pending_review" | "reviewed";

export type Assessment = {
  id: string;
  organization_id: string | null;
  class_id: string | null;
  lesson_id: string;
  title: string;
  instructions: string;
  created_by: string | null;
  status: AssessmentStatus;
  grading_mode: AssessmentGradingMode;
  result_release_policy: AssessmentResultReleasePolicy;
  attempt_limit: number;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssessmentItem = {
  id: string;
  assessment_id: string;
  quiz_item_id: string;
  position: number;
  points: number;
  required: boolean;
  rubric_override: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AssessmentRecipient = {
  id: string;
  assessment_id: string;
  user_id: string;
  status: AssessmentRecipientStatus;
  final_score: number | null;
  feedback: string | null;
  assigned_at: string;
  started_at: string | null;
  submitted_at: string | null;
  returned_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type AssessmentAttempt = {
  id: string;
  assessment_id: string;
  recipient_id: string | null;
  user_id: string;
  attempt_number: number;
  status: AssessmentAttemptStatus;
  auto_score: number | null;
  teacher_score: number | null;
  final_score: number | null;
  feedback: string | null;
  started_at: string;
  submitted_at: string | null;
  graded_at: string | null;
  returned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssessmentItemAttempt = {
  id: string;
  assessment_attempt_id: string;
  assessment_item_id: string;
  quiz_item_id: string;
  user_id: string;
  answer_mode: "text" | "code" | "multiple_choice" | "file";
  answer_text: string | null;
  answer_code: string | null;
  choice_id: string | null;
  run_result: Record<string, unknown> | null;
  score: number | null;
  max_score: number;
  passed: boolean | null;
  feedback: string | null;
  review_state: AssessmentReviewState;
  graded_by: "system" | "teacher";
  created_at: string;
  updated_at: string;
};

export type StudentAssessmentBundle = {
  assessments: Assessment[];
  items: AssessmentItem[];
  recipients: AssessmentRecipient[];
  attempts: AssessmentAttempt[];
  itemAttempts: AssessmentItemAttempt[];
  quizzes: CurriculumQuizItem[];
};

export type AssessmentAdminResponse = {
  status: "ok" | "error";
  data?: {
    assessment?: Assessment;
    items?: AssessmentItem[];
    recipients?: AssessmentRecipient[];
    quizzes?: CurriculumQuizItem[];
    attempt?: AssessmentAttempt;
    item_attempt?: AssessmentItemAttempt;
    item_attempts?: AssessmentItemAttempt[];
    final_score?: number;
  };
  error?: string;
};

export type Profile = {
  id: string;
  name: string | null;
  grade: string | null;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  organization_type?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type AdminClass = {
  id: string;
  organization_id: string;
  name: string;
  class_code?: string | null;
  status: string;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
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

export type OrganizationMembership = {
  id: string;
  organization_id: string;
  user_id: string;
  role: "student" | "teacher" | "org_admin";
  status: "active" | "invited" | "disabled";
  created_at: string;
  updated_at: string;
};

export type AdminAuthUser = {
  id: string;
  email: string;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
};

export type AdminSeedBatch = {
  id: string;
  label: string;
  status: string;
  summary: Record<string, unknown>;
  organization_id?: string | null;
  class_id?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type AuditEvent = {
  id: string;
  actor_id: string | null;
  organization_id: string | null;
  class_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AdminScope = {
  organizations: Organization[];
  classes: AdminClass[];
  organization_memberships: OrganizationMembership[];
  class_memberships: TeacherClassMembership[];
  profiles: Profile[];
  users: AdminAuthUser[];
  seed_batches: AdminSeedBatch[];
  audit_events: AuditEvent[];
};

export type AdminActorAccess = {
  level: "platform_admin" | "org_admin";
  organization_ids: string[];
};

export type AdminScopeResult = {
  actorAccess: AdminActorAccess;
  scope: AdminScope;
};

export type ReadinessStatus = "ready" | "needs_setup" | "needs_attention" | "blocked";

export type ReadinessIssue = {
  severity: "setup" | "attention" | "blocked";
  message: string;
};

export type ReadinessChecklistItem = {
  label: string;
  status: "ok" | "missing" | "attention";
};

export type ReadinessRosterRow = {
  user_id: string;
  role: "student" | "teacher";
  status: string;
  name: string;
  grade: string;
  email: string;
  last_sign_in_at: string | null;
};

export type ClassReadiness = {
  class_id: string;
  organization_id: string;
  class_name: string;
  organization_name: string;
  status: ReadinessStatus;
  teacher_count: number;
  student_count: number;
  active_membership_count: number;
  disabled_membership_count: number;
  published_lesson_count: number;
  completed_session_count: number;
  recent_completion_count: number;
  assignment_count: number;
  resource_count: number;
  open_alert_count: number;
  recent_error_count: number;
  audit_event_count: number;
  checklist: ReadinessChecklistItem[];
  issues: ReadinessIssue[];
  roster: ReadinessRosterRow[];
};

export type OrganizationReadiness = {
  organization_id: string;
  organization_name: string;
  status: ReadinessStatus;
  class_count: number;
  ready_class_count: number;
  needs_setup_class_count: number;
  needs_attention_class_count: number;
  blocked_class_count: number;
};

export type PilotReadiness = {
  generated_at: string;
  organizations: OrganizationReadiness[];
  classes: ClassReadiness[];
  recent_errors: RuntimeEvent[];
  open_alerts: InterventionAlert[];
};

export type ClassSnapshotExport = {
  filename: string;
  content_type: "text/csv";
  body: string;
};

export type CostModelVisibility = "full_cost" | "scoped_usage";

export type CostModelMetric = {
  key: string;
  label: string;
  organization_id?: string | null;
  class_id?: string | null;
  user_id?: string | null;
  model?: string | null;
  task_type?: string | null;
  model_event_count: number;
  runtime_event_count: number;
  speech_event_count: number;
  session_count: number;
  completion_count: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
  latency_count: number;
  latency_total_ms: number;
  average_latency_ms: number | null;
  error_count: number;
  error_rate: number | null;
};

export type RuntimeHealthSummary = {
  run_failures: number;
  engine_wake_timeouts: number;
  engine_retry_successes: number;
  rate_limit_hits: number;
  controlled_errors: number;
  last_runtime_event_at: string | null;
};

export type CostModelDashboard = {
  generated_at: string;
  visibility: CostModelVisibility;
  totals: CostModelMetric;
  by_organization: CostModelMetric[];
  by_class: CostModelMetric[];
  by_student: CostModelMetric[];
  by_model: CostModelMetric[];
  by_task_type: CostModelMetric[];
  by_lesson: CostModelMetric[];
  runtime_health?: RuntimeHealthSummary;
  recent_model_events: Array<
    Pick<
      ModelUsageEvent,
      | "id"
      | "user_id"
      | "organization_id"
      | "class_id"
      | "session_id"
      | "lesson_id"
      | "provider"
      | "model"
      | "task_type"
      | "input_tokens"
      | "output_tokens"
      | "cached_tokens"
      | "estimated_cost_usd"
      | "latency_ms"
      | "status"
      | "created_at"
    >
  >;
  recent_runtime_errors: RuntimeEvent[];
  recent_speech_events: SpeechUsageEvent[];
};

export type GoogleClassroomConnection = {
  id: string;
  organization_id: string;
  connected_by: string;
  google_user_id: string;
  google_email: string;
  google_name: string;
  scopes: string[];
  status: "active" | "revoked" | "error";
  last_error: string | null;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GoogleClassroomCourse = {
  id: string;
  name: string;
  section?: string | null;
  course_state?: string | null;
  alternate_link?: string | null;
  raw?: Record<string, unknown>;
};

export type GoogleClassroomPerson = {
  google_user_id: string;
  email: string;
  display_name: string;
  role: "student" | "teacher";
  user_id?: string | null;
  matched?: boolean;
  raw_profile?: Record<string, unknown>;
};

export type GoogleClassroomCourseMapping = {
  id: string;
  organization_id: string;
  connection_id: string | null;
  google_course_id: string;
  google_course_name: string;
  google_course_section: string | null;
  google_course_state: string | null;
  class_id: string | null;
  status: "active" | "archived" | "disconnected";
  last_synced_at: string | null;
  raw_course: Record<string, unknown>;
  imported_by: string | null;
  created_at: string;
  updated_at: string;
};

export type GoogleClassroomUserMapping = {
  id: string;
  organization_id: string;
  course_mapping_id: string | null;
  google_course_id: string | null;
  google_user_id: string;
  email: string;
  display_name: string;
  role: "student" | "teacher";
  user_id: string | null;
  last_seen_at: string;
  raw_profile: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type GoogleClassroomSyncRun = {
  id: string;
  organization_id: string;
  connection_id: string | null;
  course_mapping_id: string | null;
  class_id: string | null;
  triggered_by: string | null;
  action: "oauth_connect" | "list_courses" | "preview_roster" | "import_course" | "disconnect";
  status: "success" | "partial" | "failed";
  counts: Record<string, unknown>;
  errors: unknown[];
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
};

export type GoogleClassroomIntegrationState = {
  connections: GoogleClassroomConnection[];
  course_mappings: GoogleClassroomCourseMapping[];
  user_mappings: GoogleClassroomUserMapping[];
  sync_runs: GoogleClassroomSyncRun[];
};

export type GoogleClassroomResponse = {
  status: "ok" | "error";
  data?: {
    actor_access?: AdminActorAccess;
    auth_url?: string;
    scopes?: string[];
    connection?: GoogleClassroomConnection;
    connections?: GoogleClassroomConnection[];
    course_mappings?: GoogleClassroomCourseMapping[];
    user_mappings?: GoogleClassroomUserMapping[];
    sync_runs?: GoogleClassroomSyncRun[];
    courses?: GoogleClassroomCourse[];
    course?: GoogleClassroomCourse;
    teachers?: GoogleClassroomPerson[];
    students?: GoogleClassroomPerson[];
    course_mapping?: GoogleClassroomCourseMapping;
    class_id?: string;
    counts?: Record<string, unknown>;
    missing_users?: GoogleClassroomPerson[];
  };
  error?: string;
};

export type AdminOpsAction =
  | "list_admin_scope"
  | "list_pilot_readiness"
  | "list_cost_model_dashboard"
  | "export_class_snapshot"
  | "create_class"
  | "update_class"
  | "reset_user_password"
  | "update_membership_status"
  | "update_membership_role"
  | "add_existing_user_to_class";

export type AdminOpsResponse = {
  status: "ok" | "error";
  data?: {
    actor_access?: AdminActorAccess;
    scope?: AdminScope;
    readiness?: PilotReadiness;
    cost_model_dashboard?: CostModelDashboard;
    export?: ClassSnapshotExport;
    class?: AdminClass | null;
    membership?: OrganizationMembership | TeacherClassMembership | null;
  } & Record<string, unknown>;
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
  quizItems: CurriculumQuizItem[];
  sessions: LearningSession[];
  turns: LearningTurn[];
  attempts: LessonAttempt[];
  quizAttempts: QuizAttempt[];
  evidence: LearningEvidence[];
  mastery: StudentMastery[];
  notes: TeacherNote[];
  liveComments: TeacherLiveComment[];
  resources: LessonResource[];
  resourceInteractions: ResourceInteraction[];
  interventionAlerts: InterventionAlert[];
  heatmapEvents: TranscriptHeatmapEvent[];
  runtimeEvents: RuntimeEvent[];
  modelUsageEvents: ModelUsageEvent[];
  assignments: Assignment[];
  assignmentRecipients: AssignmentRecipient[];
  assignmentSubmissions: AssignmentSubmission[];
  assignmentSubmissionFiles: AssignmentSubmissionFile[];
  assessments: Assessment[];
  assessmentItems: AssessmentItem[];
  assessmentRecipients: AssessmentRecipient[];
  assessmentAttempts: AssessmentAttempt[];
  assessmentItemAttempts: AssessmentItemAttempt[];
};

export type StudentAssignmentBundle = {
  assignments: Assignment[];
  recipients: AssignmentRecipient[];
  submissions: AssignmentSubmission[];
  files: AssignmentSubmissionFile[];
};
