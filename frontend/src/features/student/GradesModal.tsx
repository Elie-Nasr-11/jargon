import { useEffect, useMemo, useState } from "react";
import { ModalCard } from "@/components/ModalCard";
import { fetchLessons, fetchStudentClasses, fetchStudentGrades } from "@/lib/api";
import type { StudentGradeRow } from "@/lib/types";

// The student gradebook — its own popup (pulled out of the profile). Grouped by class, then by unit
// (a grade's checkpoint carries lesson_id → the lesson's unitTitle); grades without a lesson/unit fall
// into a "General" bucket, and grades whose class isn't among the student's active classes into "Other".

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

type UnitGroup = { unit: string; grades: StudentGradeRow[] };
type ClassGroup = { classKey: string; className: string; units: UnitGroup[] };

export function GradesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [grades, setGrades] = useState<StudentGradeRow[]>([]);
  const [classNames, setClassNames] = useState<Map<string, string>>(new Map());
  const [unitByLesson, setUnitByLesson] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [g, classes, lessons] = await Promise.all([
          fetchStudentGrades(),
          fetchStudentClasses(),
          fetchLessons(),
        ]);
        if (cancelled) return;
        setGrades(g);
        setClassNames(new Map(classes.map((c) => [c.id, c.name])));
        const lessonUnits = new Map<string, string>();
        for (const l of lessons) if (l.unit_title) lessonUnits.set(l.id, l.unit_title);
        setUnitByLesson(lessonUnits);
      } catch {
        // grades stay empty on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const grouped = useMemo<ClassGroup[]>(() => {
    const byClass = new Map<string, { className: string; units: Map<string, StudentGradeRow[]> }>();
    for (const g of grades) {
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

  return (
    <ModalCard open={open} onOpenChange={onOpenChange} title="Grades">
      {loading ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">Loading…</p>
      ) : grouped.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">No graded work yet.</p>
      ) : (
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
                              g.score == null
                                ? "text-muted-foreground"
                                : "font-medium text-foreground"
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
      )}
    </ModalCard>
  );
}
