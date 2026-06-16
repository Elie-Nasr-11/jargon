export type Lesson = {
  id: string;
  position: number;
  title: string;
  tutor_prompt: string;
  sample_code: string;
  module: string;
  level: string;
  expected_output: string | null;
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
  created_at: string;
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
