import { useEffect, useState } from "react";
import { StateNote } from "@/components/StateNote";
import { formatScore } from "@/lib/format";
import { subjectIcon } from "@/lib/subjectIcon";
import {
  fetchClassScopedLessons,
  fetchStudentClasses,
  fetchStudentLessonProgress,
} from "@/lib/api";
import type { StudentClass } from "@/lib/types";

// The Classes page: a grid of class cards. Each card leads with a subject-appropriate icon and,
// by default, just the class name — a calm, scannable wall. On hover/focus the name cross-fades
// to the stat readout (next lesson · to do · average) in the SAME slot, so nothing reflows: the
// stats always occupy the row height and the name overlays them. The subject icon + next lesson
// come from the class's scoped lessons (one fetch already made for "next"); the grid remounts per
// page open, so every open is a natural refresh. Click opens the class canvas (?view=classes&class=id).

// A fetch failure must stay distinguishable from "every lesson complete" — the card renders
// done as "All caught up" and unknown as an honest dash.
type NextLesson = { kind: "next"; title: string } | { kind: "done" } | { kind: "unknown" };
// Per-class derived metadata: the next lesson to do + a subject label for the icon (both read off
// the same scoped-lessons fetch — no extra query for the icon).
type ClassMeta = { next: NextLesson; subject: string | null };

async function computeClassMeta(classes: StudentClass[]): Promise<Record<string, ClassMeta>> {
  const progress = await fetchStudentLessonProgress().catch(() => null);
  const entries = await Promise.all(
    classes.map(async (cls): Promise<readonly [string, ClassMeta]> => {
      if (!progress) return [cls.id, { next: { kind: "unknown" }, subject: null }] as const;
      try {
        const lessons = await fetchClassScopedLessons(cls.id);
        const ordered = [...lessons].sort(
          (a, b) =>
            (a.unit_position ?? Number.MAX_SAFE_INTEGER) -
              (b.unit_position ?? Number.MAX_SAFE_INTEGER) || (a.position ?? 0) - (b.position ?? 0),
        );
        const next = ordered.find((l) => (progress[l.id] ?? 0) < 1) ?? null;
        const subjectLesson = lessons.find((l) => l.subject_title || l.course_title);
        const subject = subjectLesson?.subject_title || subjectLesson?.course_title || null;
        return [
          cls.id,
          { next: next ? { kind: "next", title: next.title } : { kind: "done" }, subject },
        ] as const;
      } catch {
        return [cls.id, { next: { kind: "unknown" }, subject: null }] as const;
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
  const [metaByClass, setMetaByClass] = useState<Record<string, ClassMeta> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchStudentClasses()
      .then((rows) => {
        if (!alive) return;
        setClasses(rows);
        void computeClassMeta(rows).then((map) => alive && setMetaByClass(map));
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
        const meta = metaByClass?.[cls.id];
        const next = meta?.next;
        const { Icon, tintClass } = subjectIcon(meta?.subject ?? cls.name);
        return (
          <button
            key={cls.id}
            type="button"
            onClick={() => onOpenClass(cls.id)}
            className="group elev-hover flex items-center gap-3 rounded-card border border-border bg-depth-card p-4 text-left shadow-card"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-depth-sub">
              <Icon className={`h-5 w-5 ${tintClass}`} strokeWidth={1.6} />
            </span>
            {/* Swap slot: the stats sit in normal flow (defining the height) but stay invisible
                until hover/focus; the name overlays them and fades out. Nothing reflows. */}
            <div className="relative min-w-0 flex-1">
              <div className="grid gap-1 opacity-0 transition-opacity duration-(--dur) group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
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
              <div className="absolute inset-0 flex flex-col justify-center transition-opacity duration-(--dur) group-hover:opacity-0 group-focus-within:opacity-0 motion-reduce:transition-none">
                <div className="truncate text-body-lg font-medium text-foreground">{cls.name}</div>
              </div>
            </div>
            {due > 0 ? (
              <span className="shrink-0 rounded-pill border border-warning/40 bg-warning/10 px-2.5 py-1 text-meta font-medium tabular-nums text-warning">
                {due} due
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
