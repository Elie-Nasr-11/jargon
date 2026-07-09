import type { TeacherClassSummary } from "@/lib/types";

// Nav-level derivations shared by the teacher shell (sidebar) and TeacherConsole (landing class
// picker). Living here — not in TeacherConsole — avoids a console ↔ sidebar import cycle.

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
