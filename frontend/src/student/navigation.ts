// The student surface's navigation vocabulary.
//
// Two levels, mirroring how ChatGPT/Claude organize themselves:
//   * PRIMARY — Home (the LMS: coursework, agenda, what's due) vs Learn (the conversation).
//     These are the two things the product is, and they sit at the top of the sidebar.
//   * DESTINATIONS — everything else you can navigate to, listed below the primary split.
//
// The account MENU (profile, notifications, what's new, help, contact, settings) is separate
// again: it hangs off the account row at the bottom, not the main nav, because those are
// about *you* rather than about your coursework.

export type StudentSection = "home" | "learn";

export type StudentDestination = "classes" | "resources" | "checkpoints" | "customize" | "reports";

// Trimmed 2026-07-30 to what actually renders (MVP bar: no dead nav): notifications,
// what's-new, help, and contact had no student-facing surface behind them. Profile opens
// Reports (the old profile popup's stats live there), settings opens Customize, and
// sign-out signs out. The removed items return with their surfaces.
export type StudentMenuItem = "profile" | "settings" | "sign-out";

export type DestinationSpec = {
  id: StudentDestination;
  label: string;
  // Shown as secondary text where there's room (menus, empty states).
  hint: string;
};

// Order is deliberate: Classes first because it's the spine of coursework, then the two
// work surfaces, then the two "about how I work" surfaces.
//
// Routines was removed 2026-07-30 (MVP bar: no dead nav) — nothing backs it yet; it returns
// as a destination the day a routine scheduler exists. Checkpoints replaced it: the formal
// teacher-assigned assessment surface (assessment_attempts flow), which is real.
export const DESTINATIONS: readonly DestinationSpec[] = [
  { id: "classes", label: "Classes", hint: "Your units and lessons" },
  { id: "resources", label: "Resources", hint: "Everything your teachers have shared" },
  { id: "checkpoints", label: "Checkpoints", hint: "Quizzes and tests your teacher assigned" },
  { id: "customize", label: "Customize", hint: "How your mentor talks and teaches" },
  { id: "reports", label: "Reports", hint: "Your grades and progress" },
] as const;

export type MenuItemSpec = {
  id: StudentMenuItem;
  label: string;
  // External destinations open in a new tab; internal ones navigate in place.
  external?: boolean;
};

export const MENU_ITEMS: readonly MenuItemSpec[] = [
  { id: "profile", label: "Profile" },
  { id: "settings", label: "Settings" },
  { id: "sign-out", label: "Sign out" },
] as const;

const DESTINATION_IDS = new Set<string>(DESTINATIONS.map((d) => d.id));

export function isDestination(value: unknown): value is StudentDestination {
  return typeof value === "string" && DESTINATION_IDS.has(value);
}

export function isSection(value: unknown): value is StudentSection {
  return value === "home" || value === "learn";
}

// The URL carries the whole nav state so back/forward, refresh, and deep links all work —
// the same contract the old surface relied on, kept deliberately.
export type StudentNavState = {
  section: StudentSection;
  destination?: StudentDestination;
  // A class canvas is Classes + an id, not its own destination.
  classId?: string;
};
