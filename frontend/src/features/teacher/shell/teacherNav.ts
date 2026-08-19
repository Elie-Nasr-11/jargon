// Nav-level derivations shared by the teacher shell (sidebar) and TeacherConsole (landing class
// picker). Living here — not in TeacherConsole — avoids a console ↔ sidebar import cycle.

// R47 four-tab console ("Steal These Flows" synthesis): a class workspace is exactly four
// fixed rooms, each answering one teacher question — Live (what's happening right now),
// Classwork (what's the work — lessons, assignments, quizzes, materials in one list),
// People (who's in it), Grades (how are they doing). Tabs never appear or disappear.
export type ClassSection = "live" | "classwork" | "people" | "grades";

export const CLASS_SECTIONS: ReadonlyArray<{ value: ClassSection; label: string }> = [
  { value: "live", label: "Live" },
  { value: "classwork", label: "Classwork" },
  { value: "people", label: "People" },
  { value: "grades", label: "Grades" },
];

// Legacy ?tab= values (old bookmarks, stale notification deep links) map onto the room that
// now owns their content: content-shaped values (the old Curriculum/Structure sections, the
// builder and resources deep links) → classwork; grading-shaped values (the old Review
// section, the gradebook drawer) → grades; the old Students tab's landing face was activity →
// live, which is also the default landing for unknown/absent values.
export function normalizeClassSection(tab: string | undefined): ClassSection {
  switch (tab) {
    case "classwork":
    case "curriculum":
    case "structure":
    case "lessons":
    case "resources":
    case "assignments":
    case "assessments":
      return "classwork";
    case "grades":
    case "review":
    case "gradebook":
      return "grades";
    case "people":
    case "roster":
      return "people";
    default:
      return "live";
  }
}

// R45 consolidated: a teacher belongs to ONE school — the old org-name and org-grouping
// helpers are retired; class lists render flat and the org never appears in teacher chrome.
