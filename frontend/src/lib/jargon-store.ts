// UI-only persistence for the imported tutor shell.
// Auth, lessons, sessions, runs, and mentor replies come from Supabase.
import type { MentorMode } from "./types";

export type MentorConfig = {
  tone: "Friendly" | "Direct" | "Socratic";
  verbosity: "Concise" | "Balanced" | "Detailed";
  difficulty: "Gentle" | "Standard" | "Challenging";
  mode: MentorMode;
};

export const DEFAULT_MENTOR: MentorConfig = {
  tone: "Socratic",
  verbosity: "Balanced",
  difficulty: "Standard",
  mode: "guide",
};

// Dictation, read-aloud, and live voice are always on (their toggles were removed from
// the UI along with the enabled flags); only rate and voice remain user-configurable.
// Older localStorage payloads may still carry the deleted flags — the read() spread
// tolerates unknown keys.
export type VoiceSettings = {
  readAloudRate: 0.85 | 1 | 1.2;
  voiceName: "marin" | "cedar" | "coral" | "nova" | "shimmer";
};

export const DEFAULT_VOICE: VoiceSettings = {
  readAloudRate: 1,
  voiceName: "marin",
};

const KEYS = {
  lesson: "jargon_lesson",
  mentor: "jargon_mentor",
  voice: "jargon_voice",
} as const;

function read<T>(k: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(k: string, v: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(k, JSON.stringify(v));
  window.dispatchEvent(new CustomEvent("jargon:store", { detail: { key: k } }));
}

export const store = {
  // Null when the student has never opened a lesson — callers fall back to the live catalog.
  getLessonId: () => read<string | null>(KEYS.lesson, null),
  setLessonId: (id: string) => write(KEYS.lesson, id),
  getMentor: () => ({ ...DEFAULT_MENTOR, ...read<Partial<MentorConfig>>(KEYS.mentor, {}) }),
  setMentor: (m: MentorConfig) => write(KEYS.mentor, m),
  getVoice: () => ({
    ...DEFAULT_VOICE,
    ...read<Partial<VoiceSettings>>(KEYS.voice, {}),
  }),
  setVoice: (v: VoiceSettings) => write(KEYS.voice, v),
};
