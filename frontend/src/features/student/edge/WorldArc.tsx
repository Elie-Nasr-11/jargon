import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, LayoutGrid } from "lucide-react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/motion";
import { useEdgePresence } from "@/features/student/edge/useEdgePresence";
import { fetchStudentClasses } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { StudentView } from "@/features/student/shell/studentViews";
import type { StudentClass, StudentGradeRow } from "@/lib/types";

// The right edge of the v5 stage: TWO glyphs — Classes and Pulse — resting as a quiet
// near-straight pair on an invisible arc (circle center off-screen right, R=220px, ±8°). Hovering
// or focusing the edge FANS them apart (±16°, bowing slightly left); each glyph peeks a flyout of
// slightly-more-desirable info; click opens the panel. Coarse pointers and reduced motion get a
// straight strip with 44px targets instead — the fan is an enhancement, never a requirement.

const R = 220;
const REST_DEG = 8;
const FAN_DEG = 16;

function polar(deg: number, sign: -1 | 1) {
  const rad = (deg * Math.PI) / 180;
  return { x: -(R - R * Math.cos(rad)), y: sign * R * Math.sin(rad) };
}

// Fine-pointer detection (live — a tablet gaining a mouse re-evaluates).
function useFinePointer(): boolean {
  const [fine, setFine] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const onChange = () => setFine(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return fine;
}

function PeekCard({
  side,
  interactive,
  onOpen,
  openLabel,
  children,
}: {
  side: "top" | "bottom";
  interactive: boolean;
  onOpen: () => void;
  openLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || prefersReducedMotion()) return;
    gsap.fromTo(
      ref.current,
      { opacity: 0, x: 6 },
      { opacity: 1, x: 0, duration: 0.18, ease: "power2.out" },
    );
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden={interactive ? undefined : true}
      className={`absolute right-full mr-2 w-[220px] rounded-card border border-border bg-depth-card p-3 shadow-raised ${
        side === "top" ? "top-0" : "bottom-0"
      }`}
    >
      {children}
      {interactive ? (
        <button
          type="button"
          onClick={onOpen}
          className="mt-2 w-full rounded-pill border border-border px-3 py-2 text-meta font-medium text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
        >
          {openLabel}
        </button>
      ) : null}
    </div>
  );
}

function EdgeGlyph({
  label,
  active,
  fancy,
  badge,
  icon,
  onOpen,
  onPeekChange,
  peekContent,
  openLabel,
  side,
}: {
  label: string;
  active: boolean;
  fancy: boolean;
  badge?: number;
  icon: ReactNode;
  onOpen: () => void;
  onPeekChange: (peeking: boolean) => void;
  peekContent: ReactNode;
  openLabel: string;
  side: "top" | "bottom";
}) {
  const presence = useEdgePresence(onOpen);
  const { peek, touchPeek } = presence;
  useEffect(() => {
    onPeekChange(peek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek]);
  return (
    <div ref={presence.wrapRef} className="relative" {...presence.hoverProps}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={active}
        {...presence.triggerProps}
        className={`relative flex items-center justify-center rounded-full transition-[color,background-color,transform] duration-(--dur-fast) ${
          fancy ? "h-[34px] w-[34px]" : "h-11 w-11"
        } ${
          active
            ? "bg-depth-card text-foreground shadow-card"
            : "text-muted-foreground hover:text-foreground"
        } ${peek && fancy ? "scale-[1.12] text-foreground" : ""}`}
      >
        {icon}
        {badge ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9.5px] font-semibold tabular-nums text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </button>
      {peek ? (
        <PeekCard side={side} interactive={touchPeek} onOpen={presence.open} openLabel={openLabel}>
          {peekContent}
        </PeekCard>
      ) : null}
    </div>
  );
}

function PeekRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-meta text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-meta font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

export function WorldArc({
  view,
  retracted = false,
  notificationsUnread,
  reviewDueCount,
  nextDue,
  dueByClass,
  onOpenClasses,
  onOpenPulse,
  onCloseView,
}: {
  view: StudentView | undefined;
  // Lockdown retraction: inert, faded, nudged toward its edge; the fan stays at rest.
  retracted?: boolean;
  notificationsUnread: number;
  reviewDueCount: number;
  nextDue: StudentGradeRow | null;
  dueByClass: Record<string, number>;
  onOpenClasses: () => void;
  onOpenPulse: () => void;
  onCloseView: () => void;
}) {
  const fine = useFinePointer();
  const fancy = fine && !prefersReducedMotion();
  const [edgeHover, setEdgeHover] = useState(false);
  const [peeks, setPeeks] = useState({ classes: false, pulse: false });
  // The classes peek fetches names lazily on FIRST peek, cached per MOUNT (component state, not a
  // module cache — a module cache would survive sign-out and leak the previous user's classes).
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const classesFetchRef = useRef<Promise<StudentClass[]> | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const anyPeek = peeks.classes || peeks.pulse;
  const fanned = fancy && !retracted && (edgeHover || anyPeek);

  // The fan: both glyph wrappers tween along the arc between rest ±8° and open ±16°.
  useEffect(() => {
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!top || !bottom) return;
    if (!fancy) {
      gsap.killTweensOf([top, bottom]);
      gsap.set([top, bottom], { x: 0, y: 0 });
      return;
    }
    const deg = fanned ? FAN_DEG : REST_DEG;
    const t = polar(deg, -1);
    const b = polar(deg, 1);
    if (prefersReducedMotion()) {
      gsap.set(top, { x: t.x, y: t.y });
      gsap.set(bottom, { x: b.x, y: b.y });
    } else {
      gsap.to(top, { x: t.x, y: t.y, duration: 0.28, ease: "power3.out", overwrite: "auto" });
      gsap.to(bottom, { x: b.x, y: b.y, duration: 0.28, ease: "power3.out", overwrite: "auto" });
    }
  }, [fanned, fancy]);

  // Lazy classes fetch on first peek. A failed fetch clears the in-flight ref so the NEXT peek
  // retries instead of showing "Loading…" forever.
  useEffect(() => {
    if (!peeks.classes || classes) return;
    classesFetchRef.current ??= fetchStudentClasses();
    let cancelled = false;
    void classesFetchRef.current
      .then((rows) => !cancelled && setClasses(rows))
      .catch(() => {
        classesFetchRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [peeks.classes, classes]);

  const pulseBadge = notificationsUnread + reviewDueCount;

  const classesPeek = useMemo(() => {
    const rows = (classes ?? []).slice(0, 4);
    return (
      <div>
        <div className="mb-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Classes
        </div>
        {classes === null ? (
          <div className="py-1 text-meta text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-1 text-meta text-muted-foreground">No classes yet</div>
        ) : (
          rows.map((c) => (
            <PeekRow
              key={c.id}
              label={c.name}
              value={dueByClass[c.id] ? `${dueByClass[c.id]} due` : "—"}
            />
          ))
        )}
      </div>
    );
  }, [classes, dueByClass]);

  const pulsePeek = (
    <div>
      <div className="mb-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Pulse
      </div>
      <PeekRow
        label="Next due"
        value={nextDue ? `${nextDue.title} · ${formatDate(nextDue.due_at)}` : "Nothing due"}
      />
      <PeekRow label="Unread" value={String(notificationsUnread)} />
      <PeekRow label="Review due" value={String(reviewDueCount)} />
    </div>
  );

  return (
    <div
      inert={retracted ? true : undefined}
      className={`fixed right-1.5 top-1/2 z-[var(--z-header)] flex -translate-y-1/2 flex-col items-center transition-[opacity] duration-(--dur) ${
        fancy ? "gap-0" : "gap-1.5"
      } ${retracted ? "pointer-events-none opacity-30" : ""}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && setEdgeHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setEdgeHover(false)}
    >
      <div ref={topRef}>
        <EdgeGlyph
          label="Classes"
          active={view === "classes"}
          fancy={fancy}
          icon={<LayoutGrid className="h-[18px] w-[18px]" strokeWidth={1.6} />}
          onOpen={() => (view === "classes" ? onCloseView() : onOpenClasses())}
          onPeekChange={(p) => setPeeks((prev) => ({ ...prev, classes: p }))}
          peekContent={classesPeek}
          openLabel="Open Classes"
          side="top"
        />
      </div>
      <div ref={bottomRef}>
        <EdgeGlyph
          label={`Pulse${pulseBadge > 0 ? ` — ${pulseBadge} new` : ""}`}
          active={view === "pulse"}
          fancy={fancy}
          badge={pulseBadge}
          icon={<Activity className="h-[18px] w-[18px]" strokeWidth={1.6} />}
          onOpen={() => (view === "pulse" ? onCloseView() : onOpenPulse())}
          onPeekChange={(p) => setPeeks((prev) => ({ ...prev, pulse: p }))}
          peekContent={pulsePeek}
          openLabel="Open Pulse"
          side="bottom"
        />
      </div>
    </div>
  );
}
