// UI-only persistence for the imported tutor shell.
// Auth, lessons, sessions, runs, and mentor replies come from Supabase.

export type Lesson = {
  id: string;
  title: string;
  subtitle: string;
  progress: number; // 0..1
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
};

export const DEFAULT_MENTOR: MentorConfig = {
  tone: "Socratic",
  verbosity: "Balanced",
  difficulty: "Standard",
};

const KEYS = {
  lesson: "jargon_lesson",
  mentor: "jargon_mentor",
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
  getMentor: () => read<MentorConfig>(KEYS.mentor, DEFAULT_MENTOR),
  setMentor: (m: MentorConfig) => write(KEYS.mentor, m),
};
