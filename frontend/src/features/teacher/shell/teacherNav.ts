// Nav-level derivations shared by the teacher shell (sidebar) and TeacherConsole (landing class
// picker). Living here — not in TeacherConsole — avoids a console ↔ sidebar import cycle.

// R60 three-room console: a class workspace is exactly three fixed rooms, each answering one
// teacher question — Students (who's in it and how are they doing), Activity (what's happening
// and what work is out — live students, quizzes, assignments, what needs review), Content
// (what gets taught — units and lessons, editable and previewable). Tabs never appear or
// disappear. R47's four rooms folded down: People+Grades → Students, Live+work items →
// Activity, the curriculum studio → Content.
export type ClassSection = "students" | "activity" | "content";

export const CLASS_SECTIONS: ReadonlyArray<{ value: ClassSection; label: string }> = [
  { value: "students", label: "Students" },
  { value: "activity", label: "Activity" },
  { value: "content", label: "Content" },
];

// Legacy ?tab= values (old bookmarks, stale notification deep links) map onto the room that
// now owns their content: happening/work-shaped values (the old Live tab, assignment and
// assessment deep links, the old Review section) → activity; content-shaped values (the old
// Classwork/Curriculum/Structure sections, builder and resources deep links) → content;
// people/grades-shaped values and anything unknown → students, the default landing.
export function normalizeClassSection(tab: string | undefined): ClassSection {
  switch (tab) {
    case "activity":
    case "live":
    case "assignments":
    case "assessments":
    case "review":
      return "activity";
    case "content":
    case "classwork":
    case "curriculum":
    case "structure":
    case "lessons":
    case "resources":
      return "content";
    default:
      return "students";
  }
}

// R45 consolidated: a teacher belongs to ONE school — the old org-name and org-grouping
// helpers are retired; class lists render flat and the org never appears in teacher chrome.
