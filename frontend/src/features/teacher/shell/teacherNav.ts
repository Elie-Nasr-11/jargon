import type { TeacherClassSummary } from "@/lib/types";

// Nav-level derivations shared by the teacher shell (sidebar) and TeacherConsole (landing class
// picker). Living here — not in TeacherConsole — avoids a console ↔ sidebar import cycle.

// R42 class-first hierarchy: the class workspace has exactly two sections. Students is the
// landing face (roster + activity + grading — the people), Curriculum is the class's backend
// (the authoring studio scoped to this class, linked courses, and the class builders). They
// ride the existing ?tab= search param (a free string on both class routes) and render as
// sidebar sub-rows under the active class; the in-page tab row is gone.
export type ClassSection = "students" | "curriculum";

export const CLASS_SECTIONS: ReadonlyArray<{ value: ClassSection; label: string }> = [
  { value: "students", label: "Students" },
  { value: "curriculum", label: "Curriculum" },
];

// Legacy ?tab= values (old bookmarks, stale notification deep links) map onto the section that
// now owns their content: everything people-shaped (the old Overview strips now open Students,
// grading always lived there) → students; everything content-shaped (the old Structure section,
// builder deep links) → curriculum. Unknown/absent → students, the landing section.
export function normalizeClassSection(tab: string | undefined): ClassSection {
  switch (tab) {
    case "curriculum":
    case "structure":
    case "lessons":
    case "resources":
      return "curriculum";
    default:
      return "students";
  }
}

export function organizationName(summary: TeacherClassSummary) {
  const organization = Array.isArray(summary.organizations)
    ? summary.organizations[0]
    : summary.organizations;
  return organization?.name || "Organization";
}

// Org -> classes, preserving the input order, so pickers/lists mirror the real hierarchy.
export function groupClassesByOrg(
  classes: TeacherClassSummary[],
): Array<[string, TeacherClassSummary[]]> {
  const groups = new Map<string, TeacherClassSummary[]>();
  for (const item of classes) {
    const org = organizationName(item);
    const list = groups.get(org) ?? [];
    list.push(item);
    groups.set(org, list);
  }
  return Array.from(groups.entries());
}
