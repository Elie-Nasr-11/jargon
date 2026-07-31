// The conversation modes a student picks from the chatbox.
//
// NAMING: this is a `TurnMode` — a property of the MESSAGE being sent ("what am I doing right
// now?"). It is NOT the authored step type (`StepKind`, a property of the lesson step: "what
// finishes this step?"), and NOT the composer's text-vs-code toggle (`InputSurface`). The old
// surface called all three "mode", which is the single biggest source of confusion in this
// codebase — keep these three words distinct.
//
// TWO GROUPS, deliberately:
//   * ALWAYS — the four ways to talk to the tutor about any lesson. These live in the dropdown.
//   * CONDITIONAL — quiz and homework only exist when the lesson actually has one. They sit
//     INLINE beside the dropdown as pills, not inside it, because a dropdown that sometimes has
//     six entries and sometimes four is harder to learn than a fixed list plus visible extras.
//     Their presence is itself the signal that there is something to do.
//
// The backend already accepts a `mode` on the turn and caps what a turn may discharge: `discuss`
// and `open` can never close a progression gate. See supabase/functions/chat/index.ts
// (applyModeCeiling) and docs/PLATFORM.md §10.

export type TurnMode = "lesson" | "practice" | "discuss" | "open" | "quiz" | "assignment";

export type TurnModeSpec = {
  id: TurnMode;
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

// The dropdown. Always available, in this order — `lesson` leads because it is the default:
// the spine of the conversation when the student hasn't chosen anything else.
export const ALWAYS_MODES: readonly TurnModeSpec[] = [
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
    hint: "Try it yourself and get feedback",
    canProgress: true,
    accentVar: "--mode-practice",
  },
  {
    id: "discuss",
    label: "Discuss",
    hint: "Talk it through — nothing here is graded",
    canProgress: false,
    accentVar: "--mode-discuss",
  },
  {
    id: "open",
    label: "Open",
    hint: "Ask anything, on or off the lesson",
    canProgress: false,
    accentVar: "--mode-open",
  },
] as const;

// Shown as inline pills ONLY when the lesson has one. `assignment` keeps its id because that is
// the value the server's mode whitelist accepts; only the student-facing label says "Homework".
// Renaming the id would silently fall back to legacy behaviour server-side.
export const CONDITIONAL_MODES: readonly TurnModeSpec[] = [
  {
    id: "quiz",
    label: "Quiz",
    hint: "Answer the questions for this step",
    canProgress: true,
    accentVar: "--mode-quiz",
  },
  {
    id: "assignment",
    label: "Homework",
    hint: "Work on something you'll hand in",
    canProgress: true,
    accentVar: "--mode-assignment",
  },
] as const;

export const TURN_MODES: readonly TurnModeSpec[] = [...ALWAYS_MODES, ...CONDITIONAL_MODES];

export const DEFAULT_TURN_MODE: TurnMode = "lesson";

const BY_ID = new Map<TurnMode, TurnModeSpec>(TURN_MODES.map((m) => [m.id, m]));

export function turnModeSpec(id: TurnMode): TurnModeSpec {
  // Every TurnMode has a spec by construction; the fallback keeps a bad cast from crashing the
  // composer.
  return BY_ID.get(id) ?? ALWAYS_MODES[0];
}

export function isTurnMode(value: unknown): value is TurnMode {
  return typeof value === "string" && BY_ID.has(value as TurnMode);
}

// The CSS value a mode wrapper should set as --mode-accent. Design system (docs/design-system,
// board 5a): every mode owns a full hue — Lesson blue, Practice green, Discuss yellow, Open
// orange, Quiz pink, Homework lavender. The old off-spine desaturation is retired; progression
// honesty lives in the server ceiling and the canProgress affordances, not in washed-out chips.
// Still token-derived: no hex codes leak into components, and both themes resolve.
export function modeAccentValue(spec: TurnModeSpec): string {
  return `var(${spec.accentVar})`;
}

// The on-tag text color for a SOLID mode tag (dark ink on the light hues, white on blue) —
// paired tokens defined next to each --mode-* in styles.css.
export function modeInkValue(spec: TurnModeSpec): string {
  return `var(${spec.accentVar}-ink, var(--background))`;
}

// What this lesson currently offers. Resources is NOT a TurnMode — opening materials sends no
// turn and cannot change the conversation's contract — so it rides alongside rather than in the
// union. Absent/false hides the affordance: a pill only ever appears when there is something
// behind it.
export type LessonOffers = {
  quiz: boolean;
  homework: boolean;
  resources: boolean;
};

export const NO_OFFERS: LessonOffers = { quiz: false, homework: false, resources: false };
