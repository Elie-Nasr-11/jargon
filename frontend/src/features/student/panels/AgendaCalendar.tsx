import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { DayButton, getDefaultClassNames } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { StateNote } from "@/components/StateNote";
import { cn } from "@/lib/utils";
import { formatScore } from "@/lib/format";
import type { StudentGradeRow } from "@/lib/types";

// A FULL-WIDTH month calendar of this student's work — deadlines (due) and submissions — driven by
// the SAME grades feed the agenda timeline uses (no extra fetch). Each day cell shows the date plus
// event dots (warning = due, success = submitted) with a +N overflow, so the month reads at a
// glance; picking a day lists that day's items below. Pulse's "Up next" toggle swaps between this
// and the agenda. The day maps reach the custom DayButton through context so the button stays a
// stable component (react-day-picker keeps its keyboard nav / focus / month navigation).

function dayCellKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return dayCellKey(new Date(t));
}

function longDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

type DayEvents = {
  dueByDay: Map<string, StudentGradeRow[]>;
  submittedByDay: Map<string, StudentGradeRow[]>;
};
const DayEventsContext = createContext<DayEvents>({
  dueByDay: new Map(),
  submittedByDay: new Map(),
});

// A day cell: the date on top, then up to three event dots (due first, then submitted) with a +N
// overflow. Spreads react-day-picker's own button props so selection/keyboard still work.
function EventDayButton({ className, day, modifiers, ...props }: ComponentProps<typeof DayButton>) {
  const { dueByDay, submittedByDay } = useContext(DayEventsContext);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  const key = dayCellKey(day.date);
  const dueCount = dueByDay.get(key)?.length ?? 0;
  const subCount = submittedByDay.get(key)?.length ?? 0;
  const total = dueCount + subCount;
  const dots: ("due" | "sub")[] = [
    ...Array<"due">(dueCount).fill("due"),
    ...Array<"sub">(subCount).fill("sub"),
  ].slice(0, 3);
  const extra = total - dots.length;
  const selected = Boolean(modifiers.selected);
  const today = Boolean(modifiers.today);
  const outside = Boolean(modifiers.outside);

  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex h-full w-full flex-col items-center gap-1 rounded-control px-1 pb-1 pt-2 leading-none outline-none transition-colors group-data-[focused=true]/day:ring-2 group-data-[focused=true]/day:ring-inset group-data-[focused=true]/day:ring-ring",
        selected
          ? "bg-foreground text-background"
          : today
            ? "bg-accent text-foreground ring-1 ring-inset ring-foreground/25 hover:bg-muted"
            : "text-foreground hover:bg-accent",
        outside && !selected ? "text-muted-foreground/50" : "",
        className,
      )}
      {...props}
    >
      <span className={cn("text-meta tabular-nums", today && !selected ? "font-semibold" : "")}>
        {day.date.getDate()}
      </span>
      {total ? (
        <span className="flex items-center gap-0.5">
          {dots.map((d, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                d === "due" ? "bg-warning" : "bg-success",
                selected ? "opacity-90" : "",
              )}
            />
          ))}
          {extra > 0 ? (
            <span
              className={cn(
                "text-[10px] leading-none",
                selected ? "text-background/80" : "text-muted-foreground",
              )}
            >
              +{extra}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

export function AgendaCalendar({ grades }: { grades: StudentGradeRow[] }) {
  const [selected, setSelected] = useState<Date | undefined>(() => new Date());

  // Group work by the day it's DUE and the day it was SUBMITTED (one pass).
  const { dueByDay, submittedByDay } = useMemo(() => {
    const due = new Map<string, StudentGradeRow[]>();
    const sub = new Map<string, StudentGradeRow[]>();
    const add = (map: Map<string, StudentGradeRow[]>, k: string, row: StudentGradeRow) => {
      const list = map.get(k);
      if (list) list.push(row);
      else map.set(k, [row]);
    };
    for (const row of grades) {
      // Match the agenda's semantics: a deadline only marks the calendar while the work is still
      // OPEN — submitted/graded items surface on their submitted day instead, not as stale "due".
      const openWork = row.status === "assigned" || row.status === "started";
      const dk = openWork ? dayKey(row.due_at) : null;
      if (dk) add(due, dk, row);
      const sk = dayKey(row.submitted_at);
      if (sk) add(sub, sk, row);
    }
    return { dueByDay: due, submittedByDay: sub };
  }, [grades]);

  const dayEvents = useMemo<DayEvents>(
    () => ({ dueByDay, submittedByDay }),
    [dueByDay, submittedByDay],
  );

  const selectedKey = selected ? dayCellKey(selected) : null;
  const dueThatDay = (selectedKey && dueByDay.get(selectedKey)) || [];
  const submittedThatDay = (selectedKey && submittedByDay.get(selectedKey)) || [];
  const defaults = getDefaultClassNames();

  return (
    <div className="grid gap-4">
      <div className="rounded-card border border-border bg-depth-sub p-2">
        <DayEventsContext.Provider value={dayEvents}>
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            className="bg-transparent p-2"
            classNames={{
              root: cn("w-full", defaults.root),
              day: cn("group/day relative h-16 flex-1 select-none p-0", defaults.day),
              today: "",
            }}
            components={{ DayButton: EventDayButton }}
          />
        </DayEventsContext.Provider>
        <div className="flex items-center gap-4 px-2 pb-1 pt-2 text-meta text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" /> Due
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Submitted
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
