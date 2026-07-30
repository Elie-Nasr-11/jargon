import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, GraduationCap, Loader2 } from "lucide-react";
import { fetchStudentGrades } from "@/lib/api";
import { formatScore, relativeTime } from "@/lib/format";
import type { StudentGradeRow } from "@/lib/types";

// Home: the LMS half of the student surface. Answers the three questions a student actually opens
// an LMS to ask — what is due, what have I handed in, and how did I do — and nothing else.
//
// Built fresh rather than reusing the old surface's PulsePanel: that component is ~700 lines and
// carries the previous shell's assumptions, and importing it would undo the point of rebuilding
// the student surface in a clean namespace. The DATA layer is reused as-is: fetchStudentGrades
// already resolves checkpoint recipients into titles, due dates, submissions and scores, so this
// needs one call and no new endpoint.

type Group = { key: string; label: string; icon: typeof CalendarClock; rows: StudentGradeRow[] };

function Row({ row }: { row: StudentGradeRow }) {
  // A released score is the most useful thing on the row, so it gets the right-hand slot; before
  // release the timing does.
  const scored = row.score !== null;
  const when = row.submitted_at ?? row.due_at;
  return (
    <li className="flex items-baseline gap-3 border-b border-border/60 py-2 last:border-0">
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{row.title}</span>
      <span className="shrink-0 text-meta capitalize text-muted-foreground">{row.kind}</span>
      <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
        {scored ? formatScore(row.score) : when ? relativeTime(when) : "—"}
      </span>
    </li>
  );
}

function Section({ group }: { group: Group }) {
  const Icon = group.icon;
  return (
    <section className="rounded-card border border-border bg-depth-card p-4">
      <h2 className="mb-2 flex items-center gap-2 text-body font-medium text-foreground">
        <Icon className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
        {group.label}
        <span className="text-meta tabular-nums text-muted-foreground">{group.rows.length}</span>
      </h2>
      {group.rows.length ? (
        <ul className="flex flex-col">
          {group.rows.slice(0, 6).map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      ) : (
        <p className="text-meta text-muted-foreground">Nothing here right now.</p>
      )}
    </section>
  );
}

export function StudentHome() {
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchStudentGrades()
      .then((rows) => !cancelled && setGrades(rows))
      .catch(() => {
        if (!cancelled) {
          setGrades([]);
          setError("Couldn't load your work. Check your connection and try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo<Group[]>(() => {
    const rows = grades ?? [];
    const outstanding = rows
      .filter((r) => !r.submitted_at)
      // Undated work sorts last: it is not urgent, it is just unscheduled.
      .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
    const submitted = rows
      .filter((r) => r.submitted_at && r.score === null)
      .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
    const scored = rows
      .filter((r) => r.score !== null)
      .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
    return [
      { key: "due", label: "To do", icon: CalendarClock, rows: outstanding },
      { key: "submitted", label: "Handed in", icon: CheckCircle2, rows: submitted },
      { key: "scored", label: "Marked", icon: GraduationCap, rows: scored },
    ];
  }, [grades]);

  return (
    <section className="flex min-h-0 flex-1 flex-col px-6 py-6">
      <h1 className="mb-4 font-serif text-[22px] tracking-tight text-foreground">Home</h1>

      {grades === null ? (
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your work…
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? <p className="mb-3 text-meta text-danger">{error}</p> : null}
          <div className="mx-auto grid w-full max-w-4xl gap-3 md:grid-cols-3">
            {groups.map((group) => (
              <Section key={group.key} group={group} />
            ))}
          </div>
          {/* Classes, the agenda calendar, and per-mode strengths are the next additions here;
              this covers the three questions Home exists to answer first. */}
        </div>
      )}
    </section>
  );
}
