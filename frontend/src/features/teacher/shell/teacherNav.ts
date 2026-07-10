import type { TeacherClassSummary } from "@/lib/types";

// Nav-level derivations shared by the teacher shell (sidebar) and TeacherConsole (landing class
// picker). Living here — not in TeacherConsole — avoids a console ↔ sidebar import cycle.

// The class workspace's three sections — the whole flow is classes → section. They ride the
// existing ?tab= search param (a free string on both class routes) and render as sidebar
// sub-rows under the active class; the in-page tab row is gone.
export type ClassSection = "overview" | "students" | "structure";

export const CLASS_SECTIONS: ReadonlyArray<{ value: ClassSection; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "students", label: "Students & performance" },
  { value: "structure", label: "Structure & curriculum" },
];

// Legacy ?tab= values (old bookmarks, stale notification deep links) map onto the section that
// now owns their content. assignments/assessments carried grading intent — grading lives under
// Students + performance; the builders sit in Structure where a stale link would strand the
// teacher above the fold with nothing actionable.
export function normalizeClassSection(tab: string | undefined): ClassSection {
  switch (tab) {
    case "students":
    case "gradebook":
    case "roster":
    case "assignments":
    case "assessments":
      return "students";
    case "structure":
    case "lessons":
    case "resources":
      return "structure";
    default:
      return "overview";
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
