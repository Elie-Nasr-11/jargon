import type { ArtifactConfig, DeckSpec } from "./artifact-schema";

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
  unit_position?: number | null;
  author_user_id?: string | null;
  publication_status?: "draft" | "published" | "archived";
  curriculum_metadata?: Record<string, unknown>;
  milestone_id?: string | null;
  course_id?: string | null;
  subject_title?: string | null;
  course_title?: string | null;
  unit_title?: string | null;
  curriculum_group?: string | null;
  // Tutor-behavior policy (set in the curriculum studio).
  help_ceiling?: LessonHelpCeiling | null;
  require_attempt_first?: boolean | null;
  final_answer_policy?: LessonFinalAnswerPolicy | null;
  tutor_tone?: string | null;
  tutor_pace?: string | null;
  grade_band?: string | null;
  // P8: per-lesson opt-in for live mentor-built activities.
  allow_live_artifacts?: boolean | null;
};

// v4.0 learning modes (docs/PLATFORM.md). A step with mode null is a legacy step whose
// kind is derived from response_mode + quiz presence; activity_type is deprecated.
export type LearningMode =
  | "explanation"
  | "media"
  | "reflection"
  | "practice"
  | "assignment"
  | "inquiry"
  | "assessment"
  | "revision";

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
  mode?: LearningMode | null;
  mode_type?: string | null;
};

export type CurriculumStatus = "draft" | "published" | "archived";

export type CurriculumSubject = {
  id: string;
  organization_id: string | null;
  title: string;
  description: string;
  status: CurriculumStatus;
  position: number | null;
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
  position: number | null;
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

export type CurriculumNodeType = "subject" | "course" | "unit" | "lesson";

// A lesson step is stored as a `lesson_activities` row (+ a `quiz_items` row for
// checkpoints). The kind is a UI grouping derived from stage/response_mode.
export type CurriculumStepKind = "teach" | "practice" | "checkpoint" | "reflect";

export type CurriculumStepInput = {
  id?: string;
  title: string;
  stage: "intro" | "teach" | "practice" | "assessment" | "review";
  activity_type: "discussion" | "code" | "multiple_choice" | "reflection" | "file";
  response_mode: "text" | "code" | "multiple_choice" | "file";
  prompt: string;
  starter_code?: string;
  expected_output?: string;
  choices?: Array<{ id: string; text: string }>;
  skill_keys?: string[];
  pass_score?: number;
  // v4 mode: when present in the payload the backend pins response_mode/activity_type
  // from it (null explicitly clears back to a legacy step).
  mode?: LearningMode | null;
  mode_type?: string | null;
  quiz?: {
    prompt: string;
    choices: Array<{ id: string; text: string }>;
    correct_choice_ids: string[];
  };
};

export type CurriculumLessonMetaInput = {
  title: string;
  level: string;
  lesson_type: "discussion" | "code" | "reflection" | "multiple_choice" | "file";
  tutor_prompt: string;
  sample_code?: string;
  // Tutor-behavior policy (optional; omitted keeps the lesson's current values).
  help_ceiling?: LessonHelpCeiling;
  require_attempt_first?: boolean;
  final_answer_policy?: LessonFinalAnswerPolicy;
  tutor_tone?: string;
  tutor_pace?: string;
  grade_band?: string;
  // P8: per-lesson opt-in for live mentor-built activities.
  allow_live_artifacts?: boolean;
};

export type CurriculumMilestoneInput = {
  title?: string;
  objective: string;
  skill_keys: string[];
  allowed_response_modes: Array<"text" | "code" | "multiple_choice" | "file">;
};

export type CurriculumOutlineDraft = {
  units: Array<{ title: string; lessons: Array<{ title: string }> }>;
};

export type CurriculumStepDraft = {
  kind: CurriculumStepKind;
  mode?: LearningMode;
  mode_type?: string;
  title: string;
  prompt: string;
  choices: Array<{ id: string; text: string }>;
  correct_choice_id: string;
};

// v4.0 org-shared lesson template (a by-value snapshot of a lesson's mode flow + policy).
export type CurriculumTemplate = {
  id: string;
  title: string;
  description: string;
  source_lesson_id: string | null;
  steps: Array<{
    position?: number;
    title?: string;
    mode?: LearningMode | null;
    mode_type?: string | null;
  }>;
  created_at: string;
};

// R30 (tester feedback #4): an illustration lifted from a teacher's own material and bound
// to the idea it explains. Only teacher-approved (published) figures ever reach a student.
export type LessonFigure = {
  id: string;
  title: string;
  caption: string;
  image_url: string;
  alt_text: string;
};

export type CurriculumAdminResponse = {
  status: "ok" | "error";
  node_type?: CurriculumNodeType | "step";
  mode?: string;
  outline?: CurriculumOutlineDraft;
  steps?: CurriculumStepDraft[];
  // P7 artifact generation (mode "artifact"): one of these is set per artifact_kind.
  artifact_kind?: "html_sim" | "deck";
  artifact_html?: string;
  deck?: DeckSpec;
  lint?: { ok: boolean; violations: string[] };
  templates?: CurriculumTemplate[];
  template_id?: string;
  id?: string;
  lesson_id?: string;
  subject_id?: string;
  course_id?: string;
  course_version_id?: string;
  unit_id?: string;
  milestone_id?: string;
  activity_id?: string;
  position?: number;
  unit_position?: number;
  ordered_ids?: string[];
  // Brain-first Phase D: lesson knowledge intake (extract_knowledge / list_knowledge).
  drafted?: { ideas: number; vocab: number; links: number; practice: number; steps: number };
  ideas?: KnowledgeIdeaRow[];
  vocab?: KnowledgeVocabRow[];
  links?: KnowledgeLinkRow[];
  practice?: KnowledgePracticeRow[];
  figures?: KnowledgeFigureRow[];
  error?: string;
};

// Rows the studio-lite Knowledge card reviews (curriculum-admin list_knowledge).
// status: "draft" awaits teacher review; "published" is live for students;
// practice items can also be "retired" (hidden but never deleted).
export type KnowledgeIdeaRow = {
  id: string;
  key: string;
  title: string;
  one_liner: string | null;
  status: string;
};

export type KnowledgeVocabRow = {
  id: string;
  term: string;
  definition: string;
  variants: string[] | null;
  status: string;
};

export type KnowledgeLinkRow = {
  id: string;
  from_key: string;
  to_key: string;
  kind: string;
  note: string | null;
  status: string;
};

export type KnowledgeFigureRow = {
  id: string;
  idea_key: string | null;
  title: string;
  caption: string | null;
  image_url: string;
  status: string;
};

export type KnowledgePracticeRow = {
  id: string;
  idea_key: string;
  prompt: string;
  expected: string | null;
  difficulty: string;
  status: string;
};

export type LessonResourceType =
  | "video"
  | "audio"
  | "pdf"
  | "flipbook"
  | "youtube"
  | "image"
  | "link"
  | "document"
  // Artifacts v1 (P6): interactive html_sim / native deck; config in metadata.artifact.
  | "artifact";

export type LessonResourceSource = "upload" | "external_url";
export type LessonResourceStatus = "draft" | "published" | "archived";
export type LessonResourceVisibility =
  | "class_private"
  | "org_private"
  | "public"
  // P8: a mentor-built artifact scoped to ONE student (teacher can promote it).
  | "student_private";
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
  // P8: set (with visibility student_private) on mentor-built rows.
  student_id: string | null;
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
  // Artifacts v1 (P6): validated artifact config — present only on resource_type
  // "artifact" (server-sanitized on the envelope; parsed from metadata on direct reads).
  artifact?: ArtifactConfig;
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

// Phase 3: a teacher's pause of a live session. At most one row per session; `active` toggles.
export type SessionHold = {
  id: string;
  session_id: string;
  student_id: string;
  teacher_id: string;
  class_id: string | null;
  active: boolean;
  reason: string | null;
  created_at: string;
  released_at: string | null;
  updated_at: string;
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
  // Sticky "the lesson's activities are done" flag. The runtime holds a lesson at
  // status "active" with this true while gated on required checkpoints, so it — not
  // status === "complete" — is the real "activities finished" signal.
  activities_complete: boolean;
  created_at: string;
  updated_at: string;
  // Flow v3 (optional — rows predating the migration don't carry them): durable
  // per-step completion history, and the live revisit frame (null unless revisiting).
  steps_done?: Record<string, unknown> | null;
  nav?: { frontier_activity_id?: string | null; revisit_of?: string | null } | null;
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
  // v4.0 learning-mode dimension (stamped by the tutor since P1; null on legacy evidence).
  mode?: LearningMode | null;
  mode_type?: string | null;
};

// v4.0 Phase 3a: the student profile popup's derived stats (all from student-self reads).
export type StudentGradeRow = {
  id: string;
  title: string;
  kind: "assignment" | "assessment";
  status: string;
  score: number | null; // 0..1 fraction, shown only when released/finalized
  due_at: string | null;
  submitted_at: string | null;
  class_id: string | null;
  lesson_id: string | null;
};

export type StudentProgressSummary = {
  lessonsStarted: number;
  lessonsCompleted: number;
};

// Post-v4.0 Phase 4: a skill whose last practice is older than its tier's spacing interval.
export type ReviewDueSkill = {
  skill_key: string;
  level: string;
  last_practiced_at: string | null;
  days_overdue: number;
};

// Memory v1 (docs/MVP_SCOPE.md §9): the rolling per-student mentor memory profile. Written by the
// chat fn's background completing-turn task; owner RLS scopes reads to the signed-in student.
export type StudentMemoryProfile = {
  narrative?: string;
  strengths?: string[];
  struggles?: string[];
  preferences?: string[];
  // Memory files (round 11): overarching takeaways — free-form observations and topics
  // the mentor quietly steers around.
  notes?: string[];
  avoid?: string[];
  // Memory v2 decay bookkeeping ("kind:text" -> ISO last-affirmed date). Server-maintained;
  // the UI never renders it.
  affirmed?: Record<string, string>;
};

export type StudentMemory = {
  user_id: string;
  profile: StudentMemoryProfile;
  updated_at: string;
};

// Memory v1: one immutable per-session recap (append-only history, newest first).
export type SessionSummaryContent = {
  covered?: string;
  wins?: string;
  struggles?: string;
  note?: string;
};

export type SessionSummary = {
  id: string;
  user_id: string;
  session_id: string;
  lesson_id: string | null;
  summary: SessionSummaryContent;
  created_at: string;
};

export type StudentProfileStats = {
  profile: Profile | null;
  email: string | null;
  mastery: StudentMastery[];
  notes: TeacherNote[];
  progress: StudentProgressSummary;
  evidence: LearningEvidence[];
  reviewDue: ReviewDueSkill[];
};

// v4.0 Phase 3b: a class the signed-in student belongs to (for the LMS class views).
export type StudentClass = {
  id: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
};

// v4.0 Phase 5: a persistent teacher/admin notification (recipient = user_id).
export type Notification = {
  id: string;
  user_id: string;
  organization_id: string | null;
  class_id: string | null;
  related_student_id: string | null;
  kind: string;
  title: string;
  body: string;
  ref: Record<string, unknown>;
  read_at: string | null;
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
// Phase 2b scan dimension (separate from the lifecycle status). Only 'quarantined' blocks reads.
export type SubmissionScanStatus = "pending" | "clean" | "quarantined" | "skipped";

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
  required: boolean;
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
  scan_status: SubmissionScanStatus;
  purged_at: string | null;
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
  required: boolean;
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

// Unified checkpoint model (checkpoint unification): dual-write triggers keep these in sync
// with assignments + assessments. `kind` discriminates; assignment-only / assessment-only
// fields coexist. Read by the completion gate + teacher gradebook.
export type CheckpointKind = "assignment" | "assessment";
export type Checkpoint = {
  id: string;
  kind: CheckpointKind;
  organization_id: string | null;
  class_id: string | null;
  course_id: string | null;
  lesson_id: string | null;
  milestone_id: string | null;
  title: string;
  instructions: string;
  created_by: string | null;
  source: string;
  status: string;
  required: boolean;
  requires_teacher_approval: boolean;
  grading_mode: string | null;
  result_release_policy: string | null;
  attempt_limit: number | null;
  due_at: string | null;
  legacy_id: string | null;
  created_at: string;
  updated_at: string;
};
export type CheckpointRecipient = {
  id: string;
  checkpoint_id: string;
  user_id: string;
  status: string;
  score: number | null;
  final_score: number | null;
  feedback: string | null;
  assigned_at: string;
  started_at: string | null;
  submitted_at: string | null;
  returned_at: string | null;
  completed_at: string | null;
  legacy_id: string | null;
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
  // Round 11: what the student wants to be called + their standing mentor note
  // (style-only custom instruction — the chat fn guardrails it server-side).
  preferred_name?: string | null;
  mentor_instructions?: string | null;
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

export type MentorMode = "explain" | "guide" | "quiz" | "check" | "write" | "challenge";

export type MentorPreferences = {
  pace: "brief" | "balanced" | "guided";
  tone: "neutral" | "encouraging";
  hint_level: "low" | "medium" | "high";
  mode: MentorMode;
};

// Teacher "help-level" + integrity policy that governs the tutor for a lesson.
export type LessonHelpCeiling =
  | "clarify"
  | "hints"
  | "guided"
  | "worked_example"
  | "feedback"
  | "study";
export type LessonFinalAnswerPolicy = "never" | "after_attempt" | "allowed";

// v9: a file the student attached to a chat turn. The client sends only these references; the edge
// fn re-reads the owning student_uploads row under the caller's JWT before touching bytes.
export type ChatAttachment = {
  upload_id: string;
  storage_path: string;
  mime_type: string;
  filename: string;
};

// v9: a row in the student's general upload library (assignment-free), backing chat attachments.
export type StudentUpload = {
  id: string;
  user_id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  scan_status: "pending" | "clean" | "quarantined" | "skipped";
  purged_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TypedChatAnswer = {
  mode: "text" | "code" | "multiple_choice" | "file";
  text?: string;
  code?: string;
  choice_id?: string;
  run_result?: Record<string, unknown> | null;
  input_modality?: ChatInputModality;
  transcript_confidence?: number | null;
  // Client-generated per-send id so the server can drop duplicate deliveries.
  client_msg_id?: string;
  // v9: files attached to this turn (the tutor sees images / reads text files); resolved server-side.
  attachments?: ChatAttachment[];
};

export type LessonArcStep = { step: number; title: string; activity_id?: string };
export type LessonArc = {
  step: number;
  total: number;
  current: { title: string; prompt?: string } | null;
  completed: LessonArcStep[];
  upcoming: LessonArcStep[];
  next: LessonArcStep | null;
  // Flow v3: activity ids the student has actually completed — the clickable-stepper
  // set (cursor position alone can't express this during a revisit).
  steps_done?: string[];
  // Round 22: true only on the ADVANCING turn's arc — the arc points at the next step
  // (the stepper needs that immediately) but the reply's content wraps the step that
  // just finished, so the transcript keeps that message under the old section marker.
  transition?: boolean;
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
  // v6: what this lesson currently offers, for the chatbox's inline pills. Optional — when the
  // server does not send it the client falls back to what it can see in this envelope (live quiz
  // choices, attached resources). `homework` has NO client-side fallback and stays false until
  // the server sends it, so that pill simply does not appear yet.
  available?: { quiz?: boolean; homework?: boolean; resources?: boolean };
  lesson_arc?: LessonArc | null;
  next_action: "reply" | "run_code" | "choose" | "retry" | "rescue" | "continue" | "complete";
  guardrail: {
    redirected: boolean;
    reason: string | null;
  };
  // Authoritative session snapshot from the orchestrator (v2): keeps the client's
  // LearningSession in sync (status, step cursor, sticky activities-done flag)
  // without a refetch. Optional — envelopes stored before v2 don't carry it.
  session?: {
    status: LearningSession["status"];
    current_activity_id: string | null;
    activities_complete: boolean;
  } | null;
  // Set only when a teacher has paused the session; the mentor did not run this turn.
  held?: boolean;
  // Learning framework (F2/F3): this turn's display events — at most one of each. The
  // graph state lives in the tables; these only drive the toasts. Live-turn only
  // (never replayed from history, like artifact_offer).
  vocab_events?: VocabEvent[];
  link_events?: LinkEvent[];
  idea_events?: IdeaEvent[];
  // R30: figures this reply referenced with [[figure:id]], resolved server-side from the
  // lesson's teacher-approved set. Rendered inline where the marker sits.
  figures?: LessonFigure[];
  // Flow v3 (all optional — old stored envelopes replay fine): the turn router's
  // verdict (telemetry/hinting). Pillar 5: continue_offer left the wire — the button
  // went in R31b and nothing rendered the offer since.
  // Phase A (brain-first): mode hand-off pill — [Practice this idea] / [Talk it through];
  // only the latest offer is live.
  // R31e: "lesson" joined the set — the pill that returns a student from Discuss or
  // Practice to the lesson spine, which is the only register that can advance a step.
  mode_offer?: { mode: "practice" | "discuss" | "lesson"; topic: string; label: string } | null;
  turn_kind?: string;
  router_disagreement?: boolean;
  // P8: consent-first offer to build a live activity for this student. Live-turn only
  // (never replayed on reload).
  artifact_offer?: { label: string; kind: "html_sim" | "deck"; activity_id: string } | null;
  // Flow v3 backtracking: non-null while revisiting a completed step ("revisit") or on
  // the turn that returned to the frontier ("resume"); null on normal turns.
  navigation?: {
    mode: "revisit" | "resume";
    target_activity_id: string;
    frontier_activity_id: string;
  } | null;
  // Pillar 1 (flow rebuild): the server-written flow log — one entry per flow fact this
  // turn established. The transcript renders section boundaries from this record; turns
  // stored before the log fall back to client-side inference. Absent = no facts / old turn.
  flow?: FlowEvent[];
};

// Pillar 1 (flow rebuild): mirrors the chat fn's FlowEvent. The server is the only
// writer; the client only renders what was recorded.
export type FlowEvent =
  | { kind: "mode_changed"; from: string; to: string; cause: "picker" | "pill" }
  | { kind: "revisit_opened"; target_activity_id: string; target_title: string }
  | { kind: "revisit_resumed"; frontier_activity_id: string }
  | { kind: "checkpoint_opened" }
  | {
      kind: "step_advanced";
      to_activity_id: string;
      to_title: string;
      step: number;
      total: number;
    };

// Flow v3 structured client affordances: the Continue button (and, later, stepper
// navigation) post a control turn instead of synthetic text.
export type TypedChatControl = {
  type: "continue" | "navigate" | "resume" | "artifact_ready" | "mode_offer";
  target_activity_id?: string;
  // mode_offer accepts: which register and what topic the pill carried. "lesson" is the
  // way back from a register that cannot advance a step.
  mode?: "practice" | "discuss" | "lesson";
  topic?: string;
  // artifact_ready: the lesson_resources row artifact-live just created.
  resource_id?: string;
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
  // Explicit infra-timeout marker from the run fn's engine/wake timeout path — the
  // tutor prefers it over string-matching the error message.
  timeout?: boolean;
  limits_hit: string[];
};

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
  content_type: "text/csv" | "application/json";
  body: string;
};

export type AdminCsvImportRow = {
  row_index: number;
  raw_row: Record<string, unknown>;
  normalized_row: Record<string, unknown>;
  matched_user_id: string | null;
  status: "ready" | "needs_seed" | "duplicate" | "error" | "applied";
  error?: string | null;
};

export type AdminCsvImportResult = {
  batch?: Record<string, unknown>;
  rows?: AdminCsvImportRow[];
  applied?: TeacherClassMembership[];
  skipped_count?: number;
};

export type AdminDataExportRequest = {
  id: string;
  organization_id: string | null;
  target_user_id: string | null;
  requested_by: string | null;
  export_type: string;
  status: string;
  filename: string | null;
  content_type: string | null;
  created_at: string;
  completed_at: string | null;
};

export type AdminDataRetentionRequest = {
  id: string;
  organization_id: string | null;
  class_id: string | null;
  target_user_id: string | null;
  requested_by: string | null;
  request_type: "delete" | "anonymize";
  status: string;
  reason: string | null;
  created_at: string;
};

export type PlatformConsentSetting = {
  id: string;
  organization_id: string | null;
  class_id: string | null;
  user_id: string | null;
  scope: "organization" | "class" | "student";
  settings: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentProgressReport = {
  id: string;
  organization_id: string | null;
  class_id: string | null;
  student_id: string;
  generated_by: string | null;
  report_type: string;
  title: string;
  status: string;
  summary: Record<string, unknown>;
  body: Record<string, unknown>;
  visibility: string;
  created_at: string;
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

// v4.0 Phase 5: a currently-active learning session in the admin Live fleet.
export type ActiveSession = {
  session_id: string;
  user_id: string;
  student_name: string;
  lesson_title: string;
  stage: string;
  status: string;
  class_name: string;
  updated_at: string;
};

export type AdminOpsAction =
  | "list_admin_scope"
  | "list_pilot_readiness"
  | "list_active_sessions"
  | "list_cost_model_dashboard"
  | "export_class_snapshot"
  | "preview_csv_import"
  | "apply_csv_roster_import"
  | "export_student_archive"
  | "request_data_retention"
  | "upsert_consent_settings"
  | "organization_links"
  | "generate_progress_report"
  | "teacher_generate_progress_report"
  | "teacher_export_class_snapshot"
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
    csv_import?: AdminCsvImportResult;
    export_request?: AdminDataExportRequest;
    retention_request?: AdminDataRetentionRequest;
    consent_settings?: PlatformConsentSetting;
    progress_report?: StudentProgressReport;
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
  checkpoints: Checkpoint[];
  checkpointRecipients: CheckpointRecipient[];
  mentorRecommendations: MentorRecommendation[];
};

// The mentor's AI escalations (v4.0 hotlist source). Written by the chat fn at 3 graded
// fails; surfaced to teachers for the first time in the hotlist.
export type MentorRecommendation = {
  id: string;
  user_id: string;
  session_id: string | null;
  lesson_id: string | null;
  milestone_id: string | null;
  recommendation_type: "assignment" | "retry" | "rescue" | "intervention";
  title: string;
  rationale: string;
  status: "pending" | "approved" | "rejected" | "applied";
  created_at: string;
};

export type StudentAssignmentBundle = {
  assignments: Assignment[];
  recipients: AssignmentRecipient[];
  submissions: AssignmentSubmission[];
  files: AssignmentSubmissionFile[];
};

// --- Learning framework (docs/LEARNING_FRAMEWORK.md) -----------------------------------
export type VocabEvent = { term: string; definition: string; subject: string };
export type LinkEvent = {
  from_key: string;
  to_key: string;
  from_title: string;
  to_title: string;
  kind: string;
  note: string;
};
export type IdeaEvent = { key: string; title: string; one_liner: string; subject: string };

export type VocabTerm = {
  id: string;
  term: string;
  variants: string[];
  definition: string;
  subject: string;
  idea_keys: string[];
  lesson_id: string | null;
};
// "My Jargon" (Wael's name for it): one word the student has collected — their
// student_vocab row flattened with its term. `traveled` = met in 2+ subjects, the
// bridge-word signal the brain already tracks.
export type MyJargonWord = {
  term: string;
  definition: string;
  subject: string;
  first_seen_at: string;
  traveled: boolean;
};
export type IdeaNode = {
  id: string;
  key: string;
  title: string;
  one_liner: string;
  subject: string;
  origin: "authored" | "emergent";
  lesson_id: string | null;
  user_id: string | null;
  created_at: string;
};
export type StudentLinkRow = {
  id: string;
  from_key: string;
  to_key: string;
  kind: string;
  evidence_kind: string;
  note: string;
  created_at: string;
};
export type CurriculumLinkRow = {
  id: string;
  from_key: string;
  to_key: string;
  kind: string;
  note: string;
};
