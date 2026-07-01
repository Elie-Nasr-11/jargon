// UI-only persistence for the imported tutor shell.
// Auth, lessons, sessions, runs, and mentor replies come from Supabase.
import type { MentorMode } from "./types";

export type Lesson = {
  id: string;
  title: string;
  subtitle: string;
  group?: string;
  progress: number; // 0..1
  // Curriculum hierarchy for the header nav (optional; the demo LESSONS omit them and
  // fall back to a single "Lessons" group).
  subjectTitle?: string;
  courseTitle?: string;
  unitTitle?: string;
  unitPosition?: number;
  position?: number;
};

export const LESSONS: Lesson[] = [
  {
    id: "lesson1",
    title: "Purpose",
    subtitle: "Start with what a process is trying to do.",
    progress: 0,
  },
];

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

export type VoiceSettings = {
  dictationEnabled: boolean;
  readAloudEnabled: boolean;
  realtimeEnabled: boolean;
  readAloudRate: 0.85 | 1 | 1.2;
  voiceName: "marin" | "cedar" | "coral" | "nova" | "shimmer";
};

export const DEFAULT_VOICE: VoiceSettings = {
  dictationEnabled: true,
  readAloudEnabled: true,
  realtimeEnabled: true,
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
  getLessonId: () => read<string>(KEYS.lesson, LESSONS[0].id),
  setLessonId: (id: string) => write(KEYS.lesson, id),
  getMentor: () => ({ ...DEFAULT_MENTOR, ...read<Partial<MentorConfig>>(KEYS.mentor, {}) }),
  setMentor: (m: MentorConfig) => write(KEYS.mentor, m),
  getVoice: () => ({
    ...DEFAULT_VOICE,
    ...read<Partial<VoiceSettings>>(KEYS.voice, {}),
    // Dictation, read-aloud, and live voice are always on now (their toggles were removed from the
    // UI) — coerce any previously-saved "off" back on so every consumer sees them enabled.
    dictationEnabled: true,
    readAloudEnabled: true,
    realtimeEnabled: true,
  }),
  setVoice: (v: VoiceSettings) => write(KEYS.voice, v),
};
