// Nav-level derivations shared by the teacher shell (sidebar) and TeacherConsole (landing class
// picker). Living here — not in TeacherConsole — avoids a console ↔ sidebar import cycle.

// R83: a class is four screens, and only three of them are daily.
//
//   Today    — what the class learned, and what needs me now (the landing).
//   People   — who is in the class, in what section, how each is doing.
//   Course   — what gets taught: the outline, and nothing beside it.
//   Settings — the rare, real things: which courses this class teaches, its name,
//              its sections, archiving it.
//
// Settings is a screen but NOT a pill. Law 4 of the rebuild brief — nothing always-on
// that isn't always needed — and a teacher renames a class about once. It is reached
// from the gear beside the class name, which is one click and no daily noise.
export type ClassSection = "today" | "people" | "course" | "settings";

// The pill row. Rooms never appear or disappear (P2: no hidden rooms); Settings is
// deliberately absent because it is not a room a teacher works in.
export const CLASS_SECTIONS: ReadonlyArray<{ value: ClassSection; label: string }> = [
  { value: "today", label: "Today" },
  { value: "people", label: "People" },
  { value: "course", label: "Course" },
];

// Legacy ?tab= values (old bookmarks, stale notification deep links) map onto the room
// that now owns their content. "content" is here because the lexicon retired Content as
// a noun — the room is the Course — and "students" because R83 renamed the roster to
// People, which is what the brief calls it and what it actually holds.
export function normalizeClassSection(tab: string | undefined): ClassSection {
  switch (tab) {
    case "people":
    case "students":
    case "grades":
    case "roster":
      return "people";
    case "course":
    case "content":
    case "classwork":
    case "curriculum":
    case "structure":
    case "lessons":
    case "resources":
      return "course";
    case "settings":
      return "settings";
    default:
      return "today";
  }
}

// R45 consolidated: a teacher belongs to ONE school — the old org-name and org-grouping
// helpers are retired; class lists render flat and the org never appears in teacher chrome.
