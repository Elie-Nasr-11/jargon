// Nav-level derivations shared by the teacher shell (sidebar) and TeacherConsole (landing class
// picker). Living here — not in TeacherConsole — avoids a console ↔ sidebar import cycle.

// R81: a class workspace is Today (what the class learned and what needs me now — the
// landing), Students (who is in it and how they are doing), Content (what gets taught).
// Tabs never appear or disappear. R60's Activity room is gone: its live strip and review
// queue ARE "what needs me now", so they lead Today instead of hiding one tab away, and
// work is set on the lesson it belongs to rather than from a class-level Create.
export type ClassSection = "today" | "students" | "content";

export const CLASS_SECTIONS: ReadonlyArray<{ value: ClassSection; label: string }> = [
  { value: "today", label: "Today" },
  { value: "students", label: "Students" },
  { value: "content", label: "Content" },
];

// Legacy ?tab= values (old bookmarks, stale notification deep links) map onto the room that
// now owns their content: content-shaped values (the old Classwork/Curriculum/Structure
// sections, builder and resources deep links) → content; people/grades-shaped values →
// students; everything happening-or-work shaped, and anything unknown, → today, the landing.
export function normalizeClassSection(tab: string | undefined): ClassSection {
  switch (tab) {
    case "students":
    case "people":
    case "grades":
    case "roster":
      return "students";
    case "content":
    case "classwork":
    case "curriculum":
    case "structure":
    case "lessons":
    case "resources":
      return "content";
    default:
      return "today";
  }
}

// R45 consolidated: a teacher belongs to ONE school — the old org-name and org-grouping
// helpers are retired; class lists render flat and the org never appears in teacher chrome.
