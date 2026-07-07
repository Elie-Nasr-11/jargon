import { useEffect, useRef, useState } from "react";
import { GraduationCap } from "lucide-react";
import gsap from "gsap";
import { StateNote } from "@/components/StateNote";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { prefersReducedMotion } from "@/lib/motion";
import { formatScore } from "@/lib/format";
import {
  fetchClassScopedLessons,
  fetchStudentClasses,
  fetchStudentLessonProgress,
} from "@/lib/api";
import type { StudentClass } from "@/lib/types";

// The Classes panel at rest: a grid of class cards. Rest shows name/org/due-pill; hovering or
// focusing a card expands a stat footer (due · next lesson · avg) — the "next lesson" is computed
// lazily on FIRST peek per class, cached per GRID MOUNT (every panel open is a natural refresh —
// a page-life cache went stale the moment a lesson was completed). On coarse pointers the footer
// is always expanded. Click opens the class canvas (?view=classes&class=id).

type PeekCaches = {
  nextLesson: Map<string, string | null>;
  progress: Promise<Record<string, number>> | null;
};

async function computeNextLesson(caches: PeekCaches, classId: string): Promise<string | null> {
  if (caches.nextLesson.has(classId)) return caches.nextLesson.get(classId) ?? null;
  caches.progress ??= fetchStudentLessonProgress().catch(() => ({}) as Record<string, number>);
  const [lessons, progress] = await Promise.all([
    fetchClassScopedLessons(classId),
    caches.progress,
  ]);
  const ordered = [...lessons].sort(
    (a, b) =>
      (a.unit_position ?? Number.MAX_SAFE_INTEGER) - (b.unit_position ?? Number.MAX_SAFE_INTEGER) ||
      (a.position ?? 0) - (b.position ?? 0),
  );
  const next = ordered.find((l) => (progress[l.id] ?? 0) < 1) ?? null;
  const title = next?.title ?? null;
  caches.nextLesson.set(classId, title);
  return title;
}

function ClassCard({
  cls,
  due,
  avg,
  alwaysPeek,
  caches,
  onOpen,
}: {
  cls: StudentClass;
  due: number;
  avg: number | null;
  alwaysPeek: boolean;
  caches: PeekCaches;
  onOpen: () => void;
}) {
  const [peek, setPeek] = useState(alwaysPeek);
  const [nextLesson, setNextLesson] = useState<string | null | undefined>(
    caches.nextLesson.has(cls.id) ? caches.nextLesson.get(cls.id) : undefined,
  );
  const footerRef = useRef<HTMLDivElement>(null);
  const shown = alwaysPeek || peek;

  // Lazy next-lesson on first reveal.
  useEffect(() => {
    if (!shown || nextLesson !== undefined) return;
    let alive = true;
    void computeNextLesson(caches, cls.id)
      .then((title) => alive && setNextLesson(title))
      .catch(() => alive && setNextLesson(null));
    return () => {
      alive = false;
    };
  }, [shown, nextLesson, cls.id, caches]);

  // Footer expands with a crisp height rise (hover = more info made physical).
  useEffect(() => {
    const el = footerRef.current;
    if (!el || alwaysPeek) return;
    if (prefersReducedMotion()) {
      gsap.set(el, { height: shown ? "auto" : 0, opacity: shown ? 1 : 0 });
      return;
    }
    if (shown) {
      gsap.to(el, { height: "auto", opacity: 1, duration: 0.2, ease: "power2.out" });
    } else {
      gsap.to(el, { height: 0, opacity: 0, duration: 0.16, ease: "power2.in" });
    }
  }, [shown, alwaysPeek]);

  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={(e) => e.pointerType === "mouse" && setPeek(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setPeek(false)}
      onFocus={() => setPeek(true)}
      onBlur={() => setPeek(false)}
      className="elev-hover rounded-card border border-border/60 bg-depth-card p-4 text-left shadow-card"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-background/45">
          <GraduationCap className="h-5 w-5 text-foreground" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium text-foreground">{cls.name}</div>
          {cls.organizationName ? (
            <div className="truncate text-meta text-muted-foreground">{cls.organizationName}</div>
          ) : null}
        </div>
        {due > 0 ? (
          <span className="shrink-0 rounded-pill border border-warning/40 bg-warning/10 px-2.5 py-1 text-meta font-medium tabular-nums text-warning">
            {due} due
          </span>
        ) : null}
      </div>
      <div
        ref={footerRef}
        className="overflow-hidden"
        style={alwaysPeek ? undefined : { height: 0, opacity: 0 }}
      >
        <div className="mt-3 grid gap-1 border-t border-border/60 pt-3">
          <div className="flex items-baseline justify-between gap-3 text-meta">
            <span className="text-muted-foreground">Next lesson</span>
            <span className="min-w-0 truncate text-right font-medium text-foreground">
              {nextLesson === undefined ? "…" : (nextLesson ?? "All caught up")}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-meta">
            <span className="text-muted-foreground">To do</span>
            <span className="font-medium tabular-nums text-foreground">
              {due > 0 ? `${due} item${due === 1 ? "" : "s"}` : "Nothing due"}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-meta">
            <span className="text-muted-foreground">Average</span>
            <span className="font-medium tabular-nums text-foreground">
              {avg != null ? formatScore(avg) : "—"}
            </span>
          </div>
        </div>
      </div>
    </button>
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
  const [error, setError] = useState<string | null>(null);
  const coarse = useCoarsePointer();
  const cachesRef = useRef<PeekCaches>({ nextLesson: new Map(), progress: null });

  useEffect(() => {
    let alive = true;
    fetchStudentClasses()
      .then((rows) => alive && setClasses(rows))
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
      {classes.map((cls) => (
        <ClassCard
          key={cls.id}
          cls={cls}
          due={dueByClass[cls.id] ?? 0}
          avg={avgByClass[cls.id] ?? null}
          alwaysPeek={coarse}
          caches={cachesRef.current}
          onOpen={() => onOpenClass(cls.id)}
        />
      ))}
    </div>
  );
}
