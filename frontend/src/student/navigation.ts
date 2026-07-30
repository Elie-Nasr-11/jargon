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

export type StudentDestination = "classes" | "resources" | "routines" | "customize" | "reports";

export type StudentMenuItem =
  | "profile"
  | "notifications"
  | "whats-new"
  | "help"
  | "contact"
  | "settings";

export type DestinationSpec = {
  id: StudentDestination;
  label: string;
  // Shown as secondary text where there's room (menus, empty states).
  hint: string;
};

// Order is deliberate: Classes first because it's the spine of coursework, then the two
// content surfaces, then the two "about how I work" surfaces.
export const DESTINATIONS: readonly DestinationSpec[] = [
  { id: "classes", label: "Classes", hint: "Your units and lessons" },
  { id: "resources", label: "Resources", hint: "Everything your teachers have shared" },
  { id: "routines", label: "Routines", hint: "Recurring updates, summaries, and review" },
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
  { id: "notifications", label: "Notifications" },
  { id: "whats-new", label: "What's new" },
  { id: "help", label: "Help" },
  { id: "contact", label: "Contact" },
  { id: "settings", label: "Settings" },
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
