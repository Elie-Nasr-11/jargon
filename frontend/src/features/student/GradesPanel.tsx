import { useEffect, useMemo, useState } from "react";
import { fetchLessons, fetchStudentClasses } from "@/lib/api";
import type { StudentGradeRow } from "@/lib/types";

// The student gradebook — the hub's Grades tab (formerly its own Settings-menu popup). Grouped by
// class, then by unit (a grade's checkpoint carries lesson_id → the lesson's unitTitle); grades
// without a lesson/unit fall into a "General" bucket, and grades whose class isn't among the
// student's active classes into "Other". Grade rows are fetched once by the hub and passed in;
// class/lesson names for grouping are fetched here on mount.

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

type UnitGroup = { unit: string; grades: StudentGradeRow[] };
type ClassGroup = { classKey: string; className: string; units: UnitGroup[] };

export function GradesPanel({ grades }: { grades: StudentGradeRow[] | null }) {
  const [classNames, setClassNames] = useState<Map<string, string>>(new Map());
  const [unitByLesson, setUnitByLesson] = useState<Map<string, string>>(new Map());
  const [namesLoaded, setNamesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [classes, lessons] = await Promise.all([fetchStudentClasses(), fetchLessons()]);
        if (cancelled) return;
        setClassNames(new Map(classes.map((c) => [c.id, c.name])));
        const lessonUnits = new Map<string, string>();
        for (const l of lessons) if (l.unit_title) lessonUnits.set(l.id, l.unit_title);
        setUnitByLesson(lessonUnits);
      } catch {
        // grouping degrades to "Other"/"General" buckets on error
      } finally {
        if (!cancelled) setNamesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo<ClassGroup[]>(() => {
    const byClass = new Map<string, { className: string; units: Map<string, StudentGradeRow[]> }>();
    for (const g of grades ?? []) {
      const classKey = g.class_id ?? "none";
      const className = (g.class_id && classNames.get(g.class_id)) || "Other";
      const entry = byClass.get(classKey) ?? { className, units: new Map() };
      const unit = (g.lesson_id && unitByLesson.get(g.lesson_id)) || "General";
      const list = entry.units.get(unit) ?? [];
      list.push(g);
      entry.units.set(unit, list);
      byClass.set(classKey, entry);
    }
    return Array.from(byClass.entries()).map(([classKey, v]) => ({
      classKey,
      className: v.className,
      units: Array.from(v.units.entries()).map(([unit, gs]) => ({ unit, grades: gs })),
    }));
  }, [grades, classNames, unitByLesson]);

  if (grades === null || !namesLoaded) {
    return <p className="py-6 text-center text-[12.5px] text-muted-foreground">Loading…</p>;
  }
  if (grouped.length === 0) {
    return (
      <p className="py-6 text-center text-[12.5px] text-muted-foreground">No graded work yet.</p>
    );
  }
  return (
    <div className="space-y-5">
      {grouped.map((cls) => (
        <div key={cls.classKey}>
          <div className="mb-2 text-[13px] font-medium text-foreground">{cls.className}</div>
          <div className="space-y-3">
            {cls.units.map((u) => (
              <div key={u.unit}>
                <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {u.unit}
                </div>
                <div className="space-y-1.5">
                  {u.grades.map((g) => (
                    <div key={g.id} className="flex items-center gap-2.5">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                        {g.title}
                      </span>
                      <span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                        {g.kind}
                      </span>
                      <span
                        className={`w-16 shrink-0 text-right text-[12px] tabular-nums ${
                          g.score == null ? "text-muted-foreground" : "font-medium text-foreground"
                        }`}
                      >
                        {g.score == null ? g.status || "pending" : pct(g.score)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
