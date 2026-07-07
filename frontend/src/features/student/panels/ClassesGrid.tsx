import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { StateNote } from "@/components/StateNote";
import { formatScore } from "@/lib/format";
import {
  fetchClassScopedLessons,
  fetchStudentClasses,
  fetchStudentLessonProgress,
} from "@/lib/api";
import type { StudentClass } from "@/lib/types";

// The Classes page: a grid of STATIC class cards — name/org/due pill up top, a stat footer
// (next lesson · to do · average) always visible below. No hover motion, no expanding footers
// (the v5 peek mechanic died with the v6 shell). Next lessons are computed eagerly after the
// classes load (scoped lessons × own progress); the grid remounts per page open, so every open
// is a natural refresh. Click opens the class canvas (?view=classes&class=id).

// A fetch failure must stay distinguishable from "every lesson complete" — the card renders
// done as "All caught up" and unknown as an honest dash.
type NextLesson = { kind: "next"; title: string } | { kind: "done" } | { kind: "unknown" };

async function computeNextLessons(classes: StudentClass[]): Promise<Record<string, NextLesson>> {
  const progress = await fetchStudentLessonProgress().catch(() => null);
  const entries = await Promise.all(
    classes.map(async (cls): Promise<readonly [string, NextLesson]> => {
      if (!progress) return [cls.id, { kind: "unknown" }] as const;
      try {
        const lessons = await fetchClassScopedLessons(cls.id);
        const ordered = [...lessons].sort(
          (a, b) =>
            (a.unit_position ?? Number.MAX_SAFE_INTEGER) -
              (b.unit_position ?? Number.MAX_SAFE_INTEGER) || (a.position ?? 0) - (b.position ?? 0),
        );
        const next = ordered.find((l) => (progress[l.id] ?? 0) < 1) ?? null;
        return [cls.id, next ? { kind: "next", title: next.title } : { kind: "done" }] as const;
      } catch {
        return [cls.id, { kind: "unknown" }] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-meta">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

export function ClassesGrid({
  dueByClass,
  avgByClass,
  onOpenClass,
}: {
  dueByClass: Record<string, number>;
  avgByClass: Record<string, number>;
  onOpenClass: (classId: string) => void;
}) {
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [nextByClass, setNextByClass] = useState<Record<string, NextLesson> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchStudentClasses()
      .then((rows) => {
        if (!alive) return;
        setClasses(rows);
        void computeNextLessons(rows).then((map) => alive && setNextByClass(map));
      })
      .catch((e) => alive && setError((e as Error).message || "Could not load your classes."));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <StateNote>{error}</StateNote>;
  if (classes === null) return <StateNote>Loading your classes…</StateNote>;
  if (classes.length === 0) {
    return (
      <StateNote>
        You&apos;re not enrolled in a class yet. You can still browse every lesson from the chat.
      </StateNote>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {classes.map((cls) => {
        const due = dueByClass[cls.id] ?? 0;
        const avg = avgByClass[cls.id] ?? null;
        const next = nextByClass?.[cls.id];
        return (
          <button
            key={cls.id}
            type="button"
            onClick={() => onOpenClass(cls.id)}
            className="rounded-card border border-border/60 bg-depth-card p-4 text-left shadow-card transition-colors duration-(--dur-fast) hover:border-border"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-background/45">
                <GraduationCap className="h-5 w-5 text-foreground" strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-foreground">{cls.name}</div>
                {cls.organizationName ? (
                  <div className="truncate text-meta text-muted-foreground">
                    {cls.organizationName}
                  </div>
                ) : null}
              </div>
              {due > 0 ? (
                <span className="shrink-0 rounded-pill border border-warning/40 bg-warning/10 px-2.5 py-1 text-meta font-medium tabular-nums text-warning">
                  {due} due
                </span>
              ) : null}
            </div>
            <div className="mt-3 grid gap-1 border-t border-border/60 pt-3">
              <StatRow
                label="Next lesson"
                value={
                  next === undefined
                    ? "…"
                    : next.kind === "next"
                      ? next.title
                      : next.kind === "done"
                        ? "All caught up"
                        : "—"
                }
              />
              <StatRow
                label="To do"
                value={due > 0 ? `${due} item${due === 1 ? "" : "s"}` : "Nothing due"}
              />
              <StatRow label="Average" value={avg != null ? formatScore(avg) : "—"} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
