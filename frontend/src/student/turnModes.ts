// The conversation modes a student picks from the chatbox.
//
// NAMING: this is a `TurnMode` — a property of the MESSAGE being sent ("what am I doing right
// now?"). It is NOT the authored step type (`StepKind`, a property of the lesson step: "what
// finishes this step?"), and NOT the composer's text-vs-code toggle (`InputSurface`). The old
// surface called all three "mode", which is the single biggest source of confusion in this
// codebase — keep these three words distinct.
//
// The backend already accepts a `mode` field on the turn and caps what a turn may discharge:
// `discuss` and `open` can never close a progression gate. See supabase/functions/chat/index.ts
// (applyModeCeiling) and docs/PLATFORM.md §10.

export type TurnMode =
  | "lesson"
  | "practice"
  | "discuss"
  | "checkpoints"
  | "quiz"
  | "assignment"
  | "open";

export type TurnModeSpec = {
  id: TurnMode;
  label: string;
  // One line, shown in the picker. Written for a student, not a developer.
  hint: string;
  // View-only modes open a panel instead of sending a turn (checkpoints is the work dock).
  sendsTurn: boolean;
  // Whether a turn in this mode can close a progression gate. Mirrors the server ceiling —
  // duplicated here only to drive UI affordances, never as the enforcement point. The server
  // is authoritative.
  canProgress: boolean;
  // Per-mode skin. Each is a CSS custom property name defined in styles.css, so light/dark
  // both work and no hex codes leak into components.
  accentVar: string;
};

// Ordered as they appear in the picker. `lesson` leads because it is the default state — the
// spine of the conversation when the student hasn't chosen anything else.
export const TURN_MODES: readonly TurnModeSpec[] = [
  {
    id: "lesson",
    label: "Lesson",
    hint: "Work through the lesson as your teacher laid it out",
    sendsTurn: true,
    canProgress: true,
    accentVar: "--mode-lesson",
  },
  {
    id: "practice",
    label: "Practice",
    hint: "Try it yourself and get feedback",
    sendsTurn: true,
    canProgress: true,
    accentVar: "--mode-practice",
  },
  {
    id: "discuss",
    label: "Discuss",
    hint: "Talk it through — nothing here is graded",
    sendsTurn: true,
    canProgress: false,
    accentVar: "--mode-discuss",
  },
  {
    id: "checkpoints",
    label: "Checkpoints",
    hint: "See what's due and what you've handed in",
    sendsTurn: false,
    canProgress: false,
    accentVar: "--mode-checkpoints",
  },
  {
    id: "quiz",
    label: "Take quiz",
    hint: "Answer the questions for this step",
    sendsTurn: true,
    canProgress: true,
    accentVar: "--mode-quiz",
  },
  {
    id: "assignment",
    label: "Assignment",
    hint: "Work on something you'll hand in",
    sendsTurn: true,
    canProgress: true,
    accentVar: "--mode-assignment",
  },
  {
    id: "open",
    label: "Open",
    hint: "Ask anything, on or off the lesson",
    sendsTurn: true,
    canProgress: false,
    accentVar: "--mode-open",
  },
] as const;

export const DEFAULT_TURN_MODE: TurnMode = "lesson";

const BY_ID = new Map<TurnMode, TurnModeSpec>(TURN_MODES.map((m) => [m.id, m]));

export function turnModeSpec(id: TurnMode): TurnModeSpec {
  // Every TurnMode has a spec by construction; the fallback keeps a bad cast from crashing the
  // composer.
  return BY_ID.get(id) ?? TURN_MODES[0];
}

export function isTurnMode(value: unknown): value is TurnMode {
  return typeof value === "string" && BY_ID.has(value as TurnMode);
}
