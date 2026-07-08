import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { StateNote } from "@/components/StateNote";
import { formatScore } from "@/lib/format";
import type { StudentGradeRow } from "@/lib/types";

// A month calendar of this student's work — deadlines (due) and submissions — driven by the SAME
// grades feed the agenda timeline uses (no extra fetch). Days carrying due/submitted work are
// marked; picking a day lists that day's items below. Pulse's "Up next" toggle swaps between this
// and the agenda.

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
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function AgendaCalendar({ grades }: { grades: StudentGradeRow[] }) {
  const [selected, setSelected] = useState<Date | undefined>(() => new Date());

  // Group work by the day it's DUE and the day it was SUBMITTED (one pass).
  const { dueByDay, submittedByDay, dueDates, submittedDates } = useMemo(() => {
    const due = new Map<string, StudentGradeRow[]>();
    const sub = new Map<string, StudentGradeRow[]>();
    const dueDateList: Date[] = [];
    const subDateList: Date[] = [];
    for (const row of grades) {
      // Match the agenda's semantics: a deadline only marks the calendar while the work is still
      // OPEN — submitted/graded items surface on their submitted day instead, not as stale "due".
      const openWork = row.status === "assigned" || row.status === "started";
      const dk = openWork ? dayKey(row.due_at) : null;
      if (dk) {
        const list = due.get(dk);
        if (!list) {
          due.set(dk, [row]);
          dueDateList.push(new Date(row.due_at as string));
        } else {
          list.push(row);
        }
      }
      const sk = dayKey(row.submitted_at);
      if (sk) {
        const list = sub.get(sk);
        if (!list) {
          sub.set(sk, [row]);
          subDateList.push(new Date(row.submitted_at as string));
        } else {
          list.push(row);
        }
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

  return (
    <div className="grid gap-4">
      <div className="rounded-card border border-border bg-depth-sub p-2">
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
        <div className="flex items-center gap-4 px-3 pb-2 pt-1 text-meta text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.8} /> Due
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" strokeWidth={1.8} /> Submitted
          </span>
        </div>
      </div>

      <div>
        <div className="mb-2 text-body font-medium text-foreground">
          {selected ? longDate(selected) : "Pick a day"}
        </div>
        {dueThatDay.length === 0 && submittedThatDay.length === 0 ? (
          <StateNote>Nothing due or submitted on this day.</StateNote>
        ) : (
          <div className="grid gap-1.5">
            {dueThatDay.map((row) => (
              <div
                key={`due-${row.id}`}
                className="flex items-center gap-2.5 rounded-control border border-border bg-depth-field px-3 py-2.5"
              >
                <CalendarClock className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-foreground">{row.title}</div>
                  <div className="text-meta text-muted-foreground">
                    {row.kind === "assessment" ? "Assessment" : "Assignment"} due
                  </div>
                </div>
              </div>
            ))}
            {submittedThatDay.map((row) => (
              <div
                key={`sub-${row.id}`}
                className="flex items-center gap-2.5 rounded-control border border-border bg-depth-field px-3 py-2.5"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" strokeWidth={1.7} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-foreground">{row.title}</div>
                  <div className="text-meta text-muted-foreground">
                    Submitted{row.score != null ? ` · ${formatScore(row.score)}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
