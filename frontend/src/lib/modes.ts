import type { LearningMode } from "@/lib/types";

// v4.0 shared learning-mode labels (docs/PLATFORM.md). Short, student- and teacher-facing labels
// for the eight modes, used by the proficiency-by-mode surfaces. Kept here (not in a route file) so
// the student Pulse Performance section and the teacher console share them without a cross-route import.
export const MODE_LABELS: Record<LearningMode, string> = {
  explanation: "Explanation",
  media: "Media",
  reflection: "Reflection",
  practice: "Practice",
  assignment: "Assignment",
  inquiry: "Inquiry",
  assessment: "Assessment",
  revision: "Revision",
};

export function modeLabel(mode: string | null | undefined): string {
  if (mode && mode in MODE_LABELS) return MODE_LABELS[mode as LearningMode];
  return "Other";
}

// Inquiry mode_type split (confusion vs curiosity) — not represented in the studio MODE_META, so
// its labels live here for the teacher per-mode breakdown.
export const INQUIRY_TYPE_LABELS: Record<string, string> = {
  confusion: "Confusion",
  curiosity: "Curiosity",
};

// ---------------------------------------------------------------------------------------------
// MVP student-facing chat modes (docs/MVP_SCOPE.md §8) — the seven switchable postures of the
// student chat surface. Distinct from the eight lesson STEP modes above: these describe what the
// student is doing with the mentor right now, not what a curriculum step is.
//
// Only open/discuss/quiz ride the typed envelope as `chat_mode` (server-side directive postures
// on the SAME session); lesson is the default flow (no chat_mode key at all), and
// practice/assessment/resources swap the pane to a dedicated surface client-side.

export type ServerChatMode = "open" | "discuss" | "quiz";
export type StudentChatMode =
  | "lesson"
  | "open"
  | "discuss"
  | "quiz"
  | "practice"
  | "assessment"
  | "resources";

export const STUDENT_CHAT_MODES: Array<{
  key: StudentChatMode;
  label: string;
  // One-line student-facing description (switcher tooltips / mode indicator copy).
  hint: string;
}> = [
  { key: "lesson", label: "Lesson", hint: "Your guided lesson — pick up where you left off." },
  { key: "open", label: "Open", hint: "Free chat with your mentor. The lesson waits for you." },
  {
    key: "discuss",
    label: "Discuss",
    hint: "Talk through today's ideas — no grades, no advancing.",
  },
  { key: "quiz", label: "Quiz", hint: "Get quizzed on what you've learned, on demand." },
  { key: "practice", label: "Practice", hint: "Review skills that are due for spaced practice." },
  { key: "assessment", label: "Assessment", hint: "Your formal assessments." },
  { key: "resources", label: "Resources", hint: "This lesson's attachments and materials." },
];

const SERVER_CHAT_MODES = new Set<StudentChatMode>(["open", "discuss", "quiz"]);

// The envelope field for a student chat mode: open/discuss/quiz map to themselves, everything
// else (lesson + the client-side surfaces) maps to null — the send path OMITS the key entirely.
export function serverChatMode(mode: StudentChatMode): ServerChatMode | null {
  return SERVER_CHAT_MODES.has(mode) ? (mode as ServerChatMode) : null;
}

export function studentChatModeLabel(mode: StudentChatMode): string {
  return STUDENT_CHAT_MODES.find((m) => m.key === mode)?.label ?? "Lesson";
}
