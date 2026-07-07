import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import gsap from "gsap";
import { LessonMilestones } from "@/components/LessonMilestones";
import { Popover } from "@/components/Popover";
import { prefersReducedMotion } from "@/lib/motion";
import type { LessonActivity, LessonArc } from "@/lib/types";

// The lesson progress, integrated INTO the chat column (no more floating chrome):
// - ChatStepperRail — the desktop (md+) left-gutter rail: a vertical track with a rainbow fill
//   that tweens as the step advances, step nodes (done / current-with-rainbow-ring / upcoming),
//   an N/M label, and at xl+ a title chip for the current step extending into the empty left
//   margin. Click anywhere → the full roadmap popover (LessonMilestones + Restart).
// - ChatStepperStrip — the mobile (<md) top-of-stream strip: a slim gradient progress bar +
//   "Step N/M · title", tapping opens the same roadmap.

function RoadmapPanel({
  arc,
  activities,
  onRestart,
  onClose,
}: {
  arc: LessonArc;
  activities: LessonActivity[];
  onRestart?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="max-h-[70vh] w-[320px] overflow-y-auto overscroll-contain rounded-card border border-border bg-background p-3 shadow-pop">
      <LessonMilestones arc={arc} activities={activities} />
      {onRestart ? (
        <button
          type="button"
          onClick={() => {
            onClose();
            onRestart();
          }}
          className="mt-3 inline-flex items-center gap-1.5 text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={1.8} />
          Restart lesson
        </button>
      ) : null}
    </div>
  );
}

export function ChatStepperRail({
  arc,
  activities = [],
  onRestart,
}: {
  arc: LessonArc;
  activities?: LessonActivity[];
  onRestart?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fillRef = useRef<HTMLSpanElement>(null);

  const fraction = arc.total > 1 ? (arc.step - 1) / (arc.total - 1) : 0;

  // The fill line grows to the current step — the one deliberate slow beat in the system.
  useEffect(() => {
    if (!fillRef.current) return;
    const pct = `${Math.round(fraction * 1000) / 10}%`;
    if (prefersReducedMotion()) {
      gsap.set(fillRef.current, { height: pct });
    } else {
      gsap.to(fillRef.current, { height: pct, duration: 0.45, ease: "power3.out" });
    }
  }, [fraction]);

  if (arc.total <= 1) return null;

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="right-start"
        trigger={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`Lesson progress: step ${arc.step} of ${arc.total}. ${arc.current?.title ?? ""}`}
            className="group flex flex-col items-center gap-2.5 rounded-pill px-2 py-2"
          >
            <span className="relative block h-[min(320px,46vh)] w-[2px] rounded-pill bg-[var(--ink-16)]">
              {/* animated fill */}
              <span
                ref={fillRef}
                aria-hidden
                className="absolute left-0 top-0 block w-full rounded-pill"
                style={{
                  height: 0,
                  background: "linear-gradient(180deg, var(--grad-4), var(--grad-3))",
                }}
              />
              {/* nodes */}
              {Array.from({ length: arc.total }).map((_, i) => {
                const done = i < arc.step - 1;
                const current = i === arc.step - 1;
                const top = `${(i / (arc.total - 1)) * 100}%`;
                if (current) {
                  return (
                    <span
                      key={i}
                      aria-hidden
                      className="grad-border grad-border-pill absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 shadow-card"
                      style={{ top }}
                    >
                      <span className="grad-border-inner block" />
                    </span>
                  );
                }
                return (
                  <span
                    key={i}
                    aria-hidden
                    className={`absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                      done ? "bg-foreground/60" : "border border-[var(--ink-30)] bg-background"
                    }`}
                    style={{ top }}
                  />
                );
              })}
              {/* current-step title chip — xl+ has guaranteed empty margin to the left */}
              <span
                className="absolute right-full mr-3 hidden max-w-[150px] -translate-y-1/2 truncate rounded-pill border border-border bg-depth-card px-2.5 py-1 text-meta font-medium text-foreground shadow-card xl:block"
                style={{ top: `${fraction * 100}%` }}
              >
                {arc.current?.title ?? `Step ${arc.step}`}
              </span>
            </span>
            <span className="text-[10px] font-medium tabular-nums text-muted-foreground transition-colors duration-(--dur-fast) group-hover:text-foreground">
              {arc.step}/{arc.total}
            </span>
          </button>
        }
      >
        <RoadmapPanel
          arc={arc}
          activities={activities}
          onRestart={onRestart}
          onClose={() => setOpen(false)}
        />
      </Popover>
    </div>
  );
}

export function ChatStepperStrip({
  arc,
  activities = [],
  onRestart,
}: {
  arc: LessonArc;
  activities?: LessonActivity[];
  onRestart?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fillRef = useRef<HTMLSpanElement>(null);

  const fraction = arc.total > 1 ? (arc.step - 1) / (arc.total - 1) : 0;

  useEffect(() => {
    if (!fillRef.current) return;
    const pct = `${Math.round(fraction * 1000) / 10}%`;
    if (prefersReducedMotion()) {
      gsap.set(fillRef.current, { width: pct });
    } else {
      gsap.to(fillRef.current, { width: pct, duration: 0.45, ease: "power3.out" });
    }
  }, [fraction]);

  if (arc.total <= 1) return null;

  return (
    <div className="mb-3">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        trigger={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full flex-col gap-1.5 rounded-control px-1 py-1.5 text-left"
          >
            <span className="relative block h-[3px] w-full overflow-hidden rounded-pill bg-[var(--ink-16)]">
              <span
                ref={fillRef}
                aria-hidden
                className="absolute left-0 top-0 block h-full rounded-pill"
                style={{
                  width: 0,
                  background: "linear-gradient(90deg, var(--grad-4), var(--grad-3))",
                }}
              />
            </span>
            <span className="truncate text-meta text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">
                Step {arc.step}/{arc.total}
              </span>
              {arc.current?.title ? ` · ${arc.current.title}` : ""}
            </span>
          </button>
        }
      >
        <RoadmapPanel
          arc={arc}
          activities={activities}
          onRestart={onRestart}
          onClose={() => setOpen(false)}
        />
      </Popover>
    </div>
  );
}
