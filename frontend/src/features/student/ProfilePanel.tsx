import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchStudentProfileStats } from "@/lib/api";
import { modeLabel } from "@/lib/modes";
import type { StudentProfileStats } from "@/lib/types";
import { humanizeSkillKey, practicedAgo } from "@/lib/review";

// The student profile popup: the student's OWN identity, progress, FULL skill map, strengths by
// mode, review history, and student-visible teacher notes (all permitted by existing RLS — no new
// backend). Self-contained: it fetches its bundle on mount and degrades each section gracefully.
// Grades live in the hub's Grades tab; the review QUEUE lives in the hub's Review tab.

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

export function ProfilePanel({ bare }: { bare?: boolean }) {
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

  // The FULL skill map by score, strongest first (the panel scrolls; no truncation).
  const skills = useMemo(() => {
    const rows = stats?.mastery ?? [];
    return [...rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [stats]);

  // Completed guided-review sessions, newest first — the student's own review record.
  const reviewHistory = useMemo(
    () => (stats?.reviewSessions ?? []).filter((s) => s.status === "complete").slice(0, 6),
    [stats],
  );

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
          {skills.length ? (
            <div className="space-y-1.5">
              {skills.map((skill) => (
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

          {reviewHistory.length ? (
            <>
              <SectionLabel>Review history</SectionLabel>
              <div className="space-y-1.5">
                {reviewHistory.map((session) => (
                  <div key={session.id} className="flex items-center gap-2.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                      {humanizeSkillKey(session.skill_key)}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {practicedAgo(session.updated_at)}
                    </span>
                    <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-foreground/70">
                      {session.score != null ? pct(session.score) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

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
        </>
      )}
    </div>
  );
}
