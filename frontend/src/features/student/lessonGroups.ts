import type { Lesson } from "@/lib/types";

// Shared lesson→unit grouping for every surface that lists a lesson catalog (the class canvas's
// unit sections, the sidebar's lessons list). Groups by unit_id, preserving unit_position then
// position order; lessons without a unit fall into one group titled by course or "Lessons".
export type UnitGroup = { unitId: string; unitTitle: string; lessons: Lesson[] };

export function groupByUnit(lessons: Lesson[]): UnitGroup[] {
  const byUnit = new Map<string, { title: string; pos: number; lessons: Lesson[] }>();
  for (const lesson of lessons) {
    const unitId = lesson.unit_id || "__none__";
    let group = byUnit.get(unitId);
    if (!group) {
      group = {
        title: lesson.unit_title || lesson.course_title || "Lessons",
        pos: lesson.unit_position ?? Number.MAX_SAFE_INTEGER,
        lessons: [],
      };
      byUnit.set(unitId, group);
    }
    group.lessons.push(lesson);
  }
  return Array.from(byUnit, ([unitId, group]) => ({
    unitId,
    unitTitle: group.title,
    lessons: [...group.lessons].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  })).sort((a, b) => {
    const ap = a.lessons[0]?.unit_position ?? Number.MAX_SAFE_INTEGER;
    const bp = b.lessons[0]?.unit_position ?? Number.MAX_SAFE_INTEGER;
    return ap - bp;
  });
}
