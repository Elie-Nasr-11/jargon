import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { GradesPanel } from "@/features/student/GradesPanel";
import { fetchStudentProfileStats } from "@/lib/api";
import { formatScore } from "@/lib/format";
import { humanizeSkillKey, practicedAgo } from "@/lib/review";
import type { StudentProfileStats } from "@/lib/types";

// The Reports destination: grades + proficiency. GradesPanel is the deep gradebook (by class,
// by unit); the proficiency section reads fetchStudentProfileStats — which survives exactly
// for this — and shows the mastery ladder per skill plus the lessons started/completed pair.
//
// Levels render as the raw tier word (emerging/developing/secure): the tiers are the shared
// vocabulary teachers use, so inventing a prettier synonym here would fork the language.

const LEVEL_ORDER: Record<string, number> = { secure: 0, developing: 1, emerging: 2 };

export function ReportsPanel() {
  const [stats, setStats] = useState<StudentProfileStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchStudentProfileStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => {
        // fetchStudentProfileStats degrades per-read internally; a total failure just leaves
        // the proficiency section in its empty state.
        if (!cancelled) {
          setStats({
            profile: null,
            email: null,
            mastery: [],
            notes: [],
            progress: { lessonsStarted: 0, lessonsCompleted: 0 },
            evidence: [],
            reviewDue: [],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mastery = [...(stats?.mastery ?? [])]
    .filter((m) => (m.attempt_count ?? 0) > 0 || (m.evidence_count ?? 0) > 0)
    .sort(
      (a, b) =>
        (LEVEL_ORDER[a.level] ?? 3) - (LEVEL_ORDER[b.level] ?? 3) ||
        a.skill_key.localeCompare(b.skill_key),
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <section className="rounded-card border border-border bg-depth-card p-4">
        <h2 className="mb-3 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Proficiency
        </h2>
        {stats === null ? (
          <p className="flex items-center gap-2 text-body text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <p className="mb-3 text-meta tabular-nums text-muted-foreground">
              {stats.progress.lessonsCompleted} of {stats.progress.lessonsStarted} started lessons
              completed
            </p>
            {mastery.length ? (
              <ul className="flex flex-col">
                {mastery.map((m) => (
                  <li
                    key={m.skill_key}
                    className="flex items-baseline gap-3 border-b border-border/60 py-2 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">
                      {humanizeSkillKey(m.skill_key)}
                    </span>
                    <span className="shrink-0 rounded-pill border border-border px-2 py-0.5 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                      {m.level}
                    </span>
                    <span className="hidden shrink-0 text-meta tabular-nums text-muted-foreground sm:inline">
                      {m.latest_score !== null ? formatScore(m.latest_score) : "—"}
                    </span>
                    <span className="hidden shrink-0 text-meta text-muted-foreground md:inline">
                      {practicedAgo(m.last_practiced_at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-meta text-muted-foreground">
                No practiced skills yet — proficiency builds as you work through lessons.
              </p>
            )}
          </>
        )}
      </section>

      <section className="rounded-card border border-border bg-depth-card p-4">
        <h2 className="mb-3 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Grades
        </h2>
        <GradesPanel />
      </section>
    </div>
  );
}
