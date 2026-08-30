/**
 * The roster's derivations — who is in the class, in what section.
 *
 * A "section" is not a row anywhere in the database: it is a text label on each
 * class membership. Every question the People screen asks about sections is
 * therefore a grouping over memberships, which is why it lives here rather than
 * pretending to be an object with its own store.
 */
import type { TeacherDashboardData } from "@/lib/types";

export type SectionGroup = { label: string | null; students: string[] };

/** Each student's section label in this class, or null when they have none. */
export function sectionByStudent(
  dashboard: TeacherDashboardData,
  classId: string,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const membership of dashboard.memberships) {
    if (membership.class_id === classId && membership.role === "student") {
      map.set(membership.user_id, membership.section ?? null);
    }
  }
  return map;
}

/** Every section name in use in this class, alphabetically. */
export function sectionNames(sections: Map<string, string | null>): string[] {
  return Array.from(
    new Set(Array.from(sections.values()).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b));
}

/**
 * The roster grouped for display: named sections first in alphabetical order, then
 * the students with no section. An unsectioned group only appears when someone is
 * actually in it — a class that has never used sections shows one flat list.
 */
export function sectionGroups(
  studentIds: string[],
  sections: Map<string, string | null>,
): SectionGroup[] {
  const groups = new Map<string | null, string[]>();
  for (const studentId of studentIds) {
    const label = sections.get(studentId) ?? null;
    const list = groups.get(label) ?? [];
    list.push(studentId);
    groups.set(label, list);
  }
  const named = (
    Array.from(groups.entries()).filter(([label]) => label !== null) as Array<[string, string[]]>
  ).sort((a, b) => a[0].localeCompare(b[0]));
  const result: SectionGroup[] = named.map(([label, students]) => ({ label, students }));
  const unsectioned = groups.get(null);
  if (unsectioned) result.push({ label: null, students: unsectioned });
  return result;
}

/** How many students sit in each section — Settings reports this before a rename. */
export function sectionCounts(
  studentIds: string[],
  sections: Map<string, string | null>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const studentId of studentIds) {
    const label = sections.get(studentId);
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}
