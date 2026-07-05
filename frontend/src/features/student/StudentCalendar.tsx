import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { PageShell, StateNote } from "@/features/student/ClassViews";
import { useStudentGuard } from "@/features/student/useStudentGuard";
import { fetchStudentGrades } from "@/lib/api";
import type { StudentGradeRow } from "@/lib/types";

// v4.0 deferred (Phase 5): a month calendar of the student's assignment/assessment deadlines and
// submissions. Frontend-only — fed by fetchStudentGrades (checkpoint_recipients + checkpoints,
// self-scoped by RLS), which already carries due_at + submitted_at per unified work item.

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function sameDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function longDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function StudentCalendar() {
  const { ready } = useStudentGuard();
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Date | undefined>(new Date());

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    fetchStudentGrades()
      .then((rows) => alive && setGrades(rows))
      .catch((e) => alive && setError((e as Error).message || "Could not load your calendar."));
    return () => {
      alive = false;
    };
  }, [ready]);

  // Group work by the day it's DUE and the day it was SUBMITTED.
  const { dueByDay, submittedByDay, dueDates, submittedDates } = useMemo(() => {
    const due = new Map<string, StudentGradeRow[]>();
    const sub = new Map<string, StudentGradeRow[]>();
    const dueDateList: Date[] = [];
    const subDateList: Date[] = [];
    for (const row of grades ?? []) {
      const dk = dayKey(row.due_at);
      if (dk) {
        if (!due.has(dk)) {
          due.set(dk, []);
          dueDateList.push(new Date(row.due_at as string));
        }
        due.get(dk)!.push(row);
      }
      const sk = dayKey(row.submitted_at);
      if (sk) {
        if (!sub.has(sk)) {
          sub.set(sk, []);
          subDateList.push(new Date(row.submitted_at as string));
        }
        sub.get(sk)!.push(row);
      }
    }
    return {
      dueByDay: due,
      submittedByDay: sub,
      dueDates: dueDateList,
      submittedDates: subDateList,
    };
  }, [grades]);

  const selectedKey = selected ? sameDayKey(selected) : null;
  const dueThatDay = (selectedKey && dueByDay.get(selectedKey)) || [];
  const submittedThatDay = (selectedKey && submittedByDay.get(selectedKey)) || [];

  if (!ready) return <PageShell title="Calendar" />;

  return (
    <PageShell
      title="Calendar"
      subtitle="Your assignment and assessment deadlines and submissions."
    >
      {error ? (
        <StateNote>{error}</StateNote>
      ) : grades === null ? (
        <StateNote>Loading your calendar…</StateNote>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
          <div className="rounded-3xl border border-border bg-depth-sub p-2">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={setSelected}
              modifiers={{ due: dueDates, submitted: submittedDates }}
              modifiersClassNames={{
                due: "font-semibold text-foreground",
                submitted: "text-success",
              }}
            />
            <div className="flex items-center gap-4 px-3 pb-2 pt-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.8} /> Due
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" strokeWidth={1.8} /> Submitted
              </span>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[13px] font-medium text-foreground">
              {selected ? longDate(selected) : "Pick a day"}
            </div>
            {dueThatDay.length === 0 && submittedThatDay.length === 0 ? (
              <StateNote>Nothing due or submitted on this day.</StateNote>
            ) : (
              <div className="grid gap-2">
                {dueThatDay.map((row) => (
                  <div
                    key={`due-${row.id}`}
                    className="flex items-center gap-2.5 rounded-2xl border border-border bg-depth-field px-3 py-2.5"
                  >
                    <CalendarClock className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-foreground">{row.title}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {row.kind === "assessment" ? "Assessment" : "Assignment"} due
                      </div>
                    </div>
                  </div>
                ))}
                {submittedThatDay.map((row) => (
                  <div
                    key={`sub-${row.id}`}
                    className="flex items-center gap-2.5 rounded-2xl border border-border bg-depth-field px-3 py-2.5"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" strokeWidth={1.7} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-foreground">{row.title}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        Submitted
                        {row.score != null
                          ? ` · ${Math.round(row.score <= 1 ? row.score * 100 : row.score)}%`
                          : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
