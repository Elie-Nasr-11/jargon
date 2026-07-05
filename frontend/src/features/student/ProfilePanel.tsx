import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchStudentProfileStats } from "@/lib/api";
import type { MentorConfig } from "@/lib/jargon-store";
import { modeLabel } from "@/lib/modes";
import type { StudentProfileStats } from "@/lib/types";

// v4.0 Phase 3a — the student profile popup. Reads the signed-in student's OWN profile, mastery,
// grades, progress, and student-visible teacher notes (all permitted by existing RLS — no new
// backend). Self-contained: it fetches its bundle on mount and degrades each section gracefully.

function pct(score: number | null | undefined): string {
  if (score == null) return "—";
  const value = score <= 1 ? score * 100 : score;
  return `${Math.round(value)}%`;
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/45 px-3 py-2.5">
      <div className="text-[18px] font-medium leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 mt-5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  );
}

export function ProfilePanel({ mentor, bare }: { mentor: MentorConfig; bare?: boolean }) {
  const [stats, setStats] = useState<StudentProfileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchStudentProfileStats()
      .then((data) => {
        if (alive) setStats(data);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message || "Could not load your profile.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Top skills by score, strongest first — the student's proficiency snapshot.
  const topSkills = useMemo(() => {
    const rows = stats?.mastery ?? [];
    return [...rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 6);
  }, [stats]);

  // Strengths & focus areas BY MODE: average score of scored evidence per learning mode. Populates
  // as the student completes mode-tagged steps; empty until then.
  const byMode = useMemo(() => {
    const acc = new Map<string, { total: number; count: number }>();
    for (const ev of stats?.evidence ?? []) {
      if (!ev.mode || ev.score == null) continue;
      const cur = acc.get(ev.mode) ?? { total: 0, count: 0 };
      cur.total += ev.score;
      cur.count += 1;
      acc.set(ev.mode, cur);
    }
    return Array.from(acc, ([mode, { total, count }]) => ({
      mode,
      avg: total / count,
      count,
    })).sort((a, b) => b.avg - a.avg);
  }, [stats]);

  const gradedGrades = useMemo(
    () => (stats?.grades ?? []).filter((g) => g.score != null).slice(0, 5),
    [stats],
  );
  const pendingCount = useMemo(
    () => (stats?.grades ?? []).filter((g) => g.score == null).length,
    [stats],
  );

  const name = stats?.profile?.name || "Student";
  const grade = stats?.profile?.grade || null;

  return (
    <div>
      {!bare && <h3 className="font-serif text-[22px] leading-tight tracking-tight">Profile</h3>}

      {loading ? (
        <p className="mt-3 text-[13px] text-muted-foreground">Loading your profile…</p>
      ) : error ? (
        <p className="mt-3 text-[13px] text-danger">{error}</p>
      ) : (
        <>
          <div className="mt-2">
            <div className="text-[15px] font-medium text-foreground">{name}</div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              {[grade, stats?.email].filter(Boolean).join(" · ") || "Learner"}
            </div>
          </div>

          <SectionLabel>Progress</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <StatTile value={stats?.progress.lessonsCompleted ?? 0} label="Lessons completed" />
            <StatTile value={stats?.progress.lessonsStarted ?? 0} label="Lessons started" />
          </div>

          <SectionLabel>Proficiency</SectionLabel>
          {topSkills.length ? (
            <div className="space-y-1.5">
              {topSkills.map((skill) => (
                <div key={skill.skill_key} className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                    {skill.skill_key}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {titleCase(skill.level)}
                  </span>
                  <span className="h-[4px] w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-foreground"
                      style={{ width: pct(skill.score) }}
                    />
                  </span>
                  <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-foreground/70">
                    {pct(skill.score)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Complete lessons to build your skill map.
            </p>
          )}

          {byMode.length ? (
            <>
              <SectionLabel>Strengths by activity</SectionLabel>
              <div className="space-y-1.5">
                {byMode.map((row) => (
                  <div key={row.mode} className="flex items-center gap-2.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                      {modeLabel(row.mode)}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {row.count} {row.count === 1 ? "item" : "items"}
                    </span>
                    <span className="h-[4px] w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-foreground"
                        style={{ width: pct(row.avg) }}
                      />
                    </span>
                    <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-foreground/70">
                      {pct(row.avg)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <SectionLabel>Grades</SectionLabel>
          {gradedGrades.length ? (
            <div className="space-y-1.5">
              {gradedGrades.map((g) => (
                <div key={g.id} className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                    {g.title}
                  </span>
                  <span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                    {g.kind}
                  </span>
                  <span className="w-10 shrink-0 text-right text-[12.5px] font-medium tabular-nums text-foreground">
                    {pct(g.score)}
                  </span>
                </div>
              ))}
              {pendingCount ? (
                <p className="pt-0.5 text-[11.5px] text-muted-foreground">
                  {pendingCount} awaiting grade or not yet released.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              {pendingCount
                ? `${pendingCount} piece${pendingCount === 1 ? "" : "s"} of work awaiting a grade.`
                : "No graded work yet."}
            </p>
          )}

          {stats?.notes.length ? (
            <>
              <SectionLabel>Notes from your teacher</SectionLabel>
              <div className="space-y-2">
                {stats.notes.slice(0, 4).map((note) => (
                  <div
                    key={note.id}
                    className="rounded-2xl border border-border bg-background/45 px-3 py-2 text-[12.5px] leading-snug text-foreground"
                  >
                    {note.note}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <SectionLabel>Mentor style</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {[mentor.tone, mentor.verbosity, mentor.difficulty].map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground"
              >
                {chip}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Adjust these in the Mentor menu.
          </p>
        </>
      )}
    </div>
  );
}
