import type { LearningMode } from "@/lib/types";

// v4.0 shared learning-mode labels (docs/PLATFORM.md). Short, student- and teacher-facing labels
// for the eight modes, used by the proficiency-by-mode surfaces. Kept here (not in a route file) so
// both the student ProfilePanel and the teacher console can import them without a cross-route import.
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
