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

// "classes" retired 2026-07-31: classes live in the Home sidebar now, each with its own
// summary page (?section=home&class=<id>) — no destination panel needed.
export type StudentDestination = "resources" | "checkpoints" | "customize" | "reports" | "profile";

// Trimmed 2026-07-30 to what actually renders (MVP bar: no dead nav): notifications,
// what's-new, help, and contact had no student-facing surface behind them. Profile opens
// the Profile panel (round 11 — it aliased Reports before that), customize opens
// Customize, and sign-out signs out. The removed items return with their surfaces. The
// light/dark toggle also lives in this menu but is not a StudentMenuItem — it flips state
// in place rather than navigating.
export type StudentMenuItem = "profile" | "customize" | "sign-out";

export type DestinationSpec = {
  id: StudentDestination;
  label: string;
  // Shown as secondary text where there's room (menus, empty states).
  hint: string;
};

// Destinations are PANELS, not sidebar rows (slimmed 2026-07-31): the sidebar carries only
// Home/Learn and the lesson tree. Each destination is reached from where it's relevant —
// Resources from the chatbox pill, Checkpoints from Home's due list, Customize and Reports
// from the account menu, Classes inline on Home. The specs stay here because the panel
// header and the ?to= URL contract still need them.
export const DESTINATIONS: readonly DestinationSpec[] = [
  { id: "resources", label: "Resources", hint: "Everything your teachers have shared" },
  { id: "checkpoints", label: "Checkpoints", hint: "Quizzes and tests your teacher assigned" },
  { id: "customize", label: "Customize", hint: "How your mentor talks and teaches" },
  { id: "reports", label: "Reports", hint: "Your grades and progress" },
  // Round 11: Profile got its own surface (it used to alias Reports) — who you are, your
  // account, your standing note to the mentor, and your classes at a glance.
  { id: "profile", label: "Profile", hint: "Your info, account, and mentor note" },
] as const;

export type MenuItemSpec = {
  id: StudentMenuItem;
  label: string;
  // External destinations open in a new tab; internal ones navigate in place.
  external?: boolean;
};

export const MENU_ITEMS: readonly MenuItemSpec[] = [
  { id: "profile", label: "Profile" },
  { id: "customize", label: "Customize" },
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
