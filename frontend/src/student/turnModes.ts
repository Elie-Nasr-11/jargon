// The conversation modes a student picks from the chatbox.
//
// NAMING: this is a `TurnMode` — a property of the MESSAGE being sent ("what am I doing right
// now?"). It is NOT the authored step type (`StepKind`, a property of the lesson step: "what
// finishes this step?"), and NOT the composer's text-vs-code toggle (`InputSurface`). The old
// surface called all three "mode", which is the single biggest source of confusion in this
// codebase — keep these three words distinct.
//
// Brain-first Phase A: THREE modes. Quiz and assignment are teacher POSTS (work items in the
// dock and class pages), not conversation registers — their availability is the dock's job.
// "Open" folded into Discuss. Legacy ids (open/quiz/assignment) survive ONLY as render specs so
// historical transcript sections keep their labels; they are never pickable.
//
// The backend accepts a `mode` on the turn and caps what a turn may discharge: `discuss` and
// `practice` can never close a lesson gate. See supabase/functions/chat/index.ts
// (applyModeCeiling) and docs/PLATFORM.md §10.

export type TurnMode = "lesson" | "practice" | "discuss";

export type TurnModeSpec = {
  id: string;
  label: string;
  // One line, shown in the picker. Written for a student, not a developer.
  hint: string;
  // Whether a turn in this mode can close a progression gate. Mirrors the server ceiling —
  // duplicated here only to drive UI affordances, never as the enforcement point. The server
  // is authoritative.
  canProgress: boolean;
  // Per-mode skin. A CSS custom property name defined in styles.css, so light/dark both work
  // and no hex codes leak into components.
  accentVar: string;
};

// The picker. Always these three, in this order — `lesson` leads because it is the default:
// the spine of the conversation when the student hasn't chosen anything else.
export const PICKER_MODES: readonly TurnModeSpec[] = [
  {
    id: "lesson",
    label: "Lesson",
    hint: "Work through the lesson as your teacher laid it out",
    canProgress: true,
    accentVar: "--mode-lesson",
  },
  {
    id: "practice",
    label: "Practice",
    hint: "Solve exercises to build proficiency — doesn't move the lesson",
    canProgress: false,
    accentVar: "--mode-practice",
  },
  {
    id: "discuss",
    label: "Discuss",
    hint: "Explore ideas, recap, and fill gaps — nothing here is graded",
    canProgress: false,
    accentVar: "--mode-discuss",
  },
] as const;

// Historical transcript sections may carry these ids (recorded before Phase A). Render-only:
// the label and hue stay honest to what the student did back then; never pickable now.
const LEGACY_MODE_SPECS: readonly TurnModeSpec[] = [
  {
    id: "open",
    label: "Open",
    hint: "",
    canProgress: false,
    accentVar: "--mode-open",
  },
  {
    id: "quiz",
    label: "Quiz",
    hint: "",
    canProgress: false,
    accentVar: "--mode-quiz",
  },
  {
    id: "assignment",
    label: "Homework",
    hint: "",
    canProgress: false,
    accentVar: "--mode-assignment",
  },
] as const;

export const DEFAULT_TURN_MODE: TurnMode = "lesson";

const PICKER_BY_ID = new Map<string, TurnModeSpec>(PICKER_MODES.map((m) => [m.id, m]));
const RENDER_BY_ID = new Map<string, TurnModeSpec>(
  [...PICKER_MODES, ...LEGACY_MODE_SPECS].map((m) => [m.id, m]),
);

export function turnModeSpec(id: TurnMode): TurnModeSpec {
  // Every TurnMode has a spec by construction; the fallback keeps a bad cast from crashing the
  // composer.
  return PICKER_BY_ID.get(id) ?? PICKER_MODES[0];
}

export function isTurnMode(value: unknown): value is TurnMode {
  return typeof value === "string" && PICKER_BY_ID.has(value);
}

// Rendering resolver: picker modes AND legacy ids — a transcript section recorded as "quiz"
// still wears its pink label. Null for anything unknown (render no chrome; never invent).
export function renderModeSpec(value: unknown): TurnModeSpec | null {
  return typeof value === "string" ? (RENDER_BY_ID.get(value) ?? null) : null;
}

// The checkpoint section marker keeps the quiz hue — being tested has its own color even
// though "quiz" is no longer a conversation mode.
export const CHECKPOINT_SPEC: TurnModeSpec =
  LEGACY_MODE_SPECS.find((m) => m.id === "quiz") ?? PICKER_MODES[0];

// The CSS value a mode wrapper should set as --mode-accent. Design system (docs/design-system,
// board 5a): every mode owns a full hue. Still token-derived: no hex codes leak into
// components, and both themes resolve.
export function modeAccentValue(spec: TurnModeSpec): string {
  return `var(${spec.accentVar})`;
}

// The on-tag text color for a SOLID mode tag (dark ink on the light hues, white on blue) —
// paired tokens defined next to each --mode-* in styles.css.
export function modeInkValue(spec: TurnModeSpec): string {
  return `var(${spec.accentVar}-ink, var(--background))`;
}

// What this lesson currently offers. Post-Phase A only `resources` drives chatbox chrome
// (quiz/homework are dock work items); the other flags are kept for envelope compatibility.
export type LessonOffers = {
  quiz: boolean;
  homework: boolean;
  resources: boolean;
};

export const NO_OFFERS: LessonOffers = { quiz: false, homework: false, resources: false };
