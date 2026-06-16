import type { MentorPreferences } from "@/lib/types";

const KEY = "jargon_mentor_preferences";

export const DEFAULT_MENTOR_PREFERENCES: MentorPreferences = {
  pace: "balanced",
  tone: "encouraging",
  hint_level: "medium",
};

export function loadMentorPreferences(): MentorPreferences {
  if (typeof window === "undefined") return DEFAULT_MENTOR_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_MENTOR_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<MentorPreferences>;
    return {
      pace: parsed.pace || DEFAULT_MENTOR_PREFERENCES.pace,
      tone: parsed.tone || DEFAULT_MENTOR_PREFERENCES.tone,
      hint_level: parsed.hint_level || DEFAULT_MENTOR_PREFERENCES.hint_level,
    };
  } catch {
    return DEFAULT_MENTOR_PREFERENCES;
  }
}

export function saveMentorPreferences(preferences: MentorPreferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(preferences));
}
