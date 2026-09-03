import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarRange, Loader2, TrendingUp, UserMinus } from "lucide-react";
import { fetchClassDigest, getSession } from "@/lib/api";
import type { ClassDigest } from "@/lib/types";

// R71: the weekly evidence digest.
//
// Jargon is sold on "the book never told you who's stuck — this one does." That
// promise is only real if the teacher is TOLD, on a rhythm, without going looking.
// The hotlist answers "who needs me right now"; the progress report answers "how is
// this child doing, for their parents". This answers the question a teacher actually
// carries into Monday: what did my class learn last week, and what must I teach again?
//
// Every number here is under-stated on purpose (study minutes count only gaps under
// ten minutes; a skill reaches "teach again" only when two or more students missed
// it), because a teacher who catches this card exaggerating once will never trust
// it again.
function minutesLabel(total: number): string {
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function ClassDigestCard({ classId }: { classId: string }) {
  const [digest, setDigest] = useState<ClassDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(7);

  const load = useCallback(
    (windowDays: number) => {
      let cancelled = false;
      setLoading(true);
      setError("");
      void (async () => {
        try {
          const session = await getSession();
          if (!session) throw new Error("Sign in to see the digest.");
          const result = await fetchClassDigest({
            accessToken: session.access_token,
            classId,
            days: windowDays,
          });
          if (!cancelled) setDigest(result);
        } catch (err) {
          if (!cancelled) setError((err as Error).message || "Could not read this week's digest.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    },
    [classId],
  );

  useEffect(() => load(days), [load, days]);

  const totals = digest?.totals ?? {};
  const active = digest?.students.active ?? 0;
  const enrolled = digest?.students.enrolled ?? 0;

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-title font-medium text-foreground">
              <CalendarRange className="h-4 w-4" strokeWidth={1.7} />
              {days === 7 ? "This week" : `Last ${days} days`}
            </div>
            <p className="mt-1 text-meta text-muted-foreground">
              {loading
                ? "Reading what your class did…"
                : error
                  ? error
                  : enrolled
                    ? `${active} of ${enrolled} students studied — ${minutesLabel(totals.minutes ?? 0)} in total.`
                    : "No students are enrolled in this class yet."}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            {[7, 14, 30].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={`btn btn-sm ${days === option ? "btn-secondary" : "btn-ghost"}`}
                aria-pressed={days === option}
              >
                {option}d
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-meta text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            Working it out
          </div>
        ) : digest && enrolled ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { k: "Lessons finished", v: totals.lessons_completed ?? 0 },
                { k: "Steps done", v: totals.steps_done ?? 0 },
                { k: "Time studied", v: minutesLabel(totals.minutes ?? 0) },
                { k: "Graded moments", v: totals.evidence ?? 0 },
              ].map((cell) => (
                <div
                  key={cell.k}
                  className="rounded-control border border-border/70 bg-depth-sub px-3 py-2"
                >
                  <div className="text-overline uppercase tracking-[0.08em] text-muted-foreground">
                    {cell.k}
                  </div>
                  <div className="mt-0.5 text-title font-medium tabular-nums text-foreground">
                    {cell.v}
                  </div>
                </div>
              ))}
            </div>

            {digest.reteach.length ? (
              <div className="mt-4">
                <div className="flex items-center gap-1.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" strokeWidth={2} />
                  Worth teaching again
                </div>
                <ul className="mt-2 grid gap-1.5">
                  {digest.reteach.map((row) => (
                    <li
                      key={row.skill_key}
                      className="rounded-control border border-border/70 bg-depth-sub px-3 py-2"
                    >
                      <div className="text-meta font-medium text-foreground">{row.skill_key}</div>
                      <div className="text-meta text-muted-foreground">
                        {row.students} students missed it
                        {row.pattern ? ` · ${row.pattern}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {digest.movers.length ? (
                <div>
                  <div className="flex items-center gap-1.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5 text-success" strokeWidth={2} />
                    Moving well
                  </div>
                  <ul className="mt-2 grid gap-1">
                    {digest.movers.map((row) => (
                      <li
                        key={row.user_id}
                        className="flex items-center justify-between gap-2 text-meta"
                      >
                        <span className="min-w-0 truncate text-foreground">{row.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {row.steps_done} steps · {minutesLabel(row.minutes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {digest.stalled.length ? (
                <div>
                  <div className="flex items-center gap-1.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    <UserMinus className="h-3.5 w-3.5 text-danger" strokeWidth={2} />
                    Nothing at all
                  </div>
                  <ul className="mt-2 grid gap-1">
                    {digest.stalled.slice(0, 8).map((row) => (
                      <li key={row.user_id} className="truncate text-meta text-foreground">
                        {row.name}
                      </li>
                    ))}
                  </ul>
                  {digest.stalled.length > 8 ? (
                    <p className="mt-1 text-meta text-muted-foreground">
                      and {digest.stalled.length - 8} more
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
