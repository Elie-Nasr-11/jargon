import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import gsap from "gsap";
import { LessonMilestones } from "@/components/LessonMilestones";
import { Popover } from "@/components/Popover";
import { prefersReducedMotion } from "@/lib/motion";
import type { LessonActivity, LessonArc } from "@/lib/types";

// The lesson journey, v6: ONE universal treatment at every breakpoint — ChatStepperStrip, a slim
// gradient progress bar + "Step N/M · title" at the top of the message stream. Tapping opens the
// roadmap popover (LessonMilestones + Restart), which is also the keyboard/AT path to every step
// title. (The v5 fixed left-edge rail died with the ChatGPT-style shell.)

function RoadmapPanel({
  arc,
  activities,
  onRestart,
  onNavigate,
  navigateDisabled,
  onClose,
}: {
  arc: LessonArc;
  activities: LessonActivity[];
  onRestart?: () => void;
  onNavigate?: (activityId: string) => void;
  navigateDisabled?: boolean;
  onClose: () => void;
}) {
  return (
    <div className="max-h-[70vh] w-[min(320px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-card border border-border bg-depth-card p-3 shadow-pop">
      <LessonMilestones
        arc={arc}
        activities={activities}
        navigateDisabled={navigateDisabled}
        // Close the roadmap before posting the navigate turn so the revisit lands in
        // the visible stream, not behind the popover.
        onNavigate={
          onNavigate
            ? (activityId) => {
                onClose();
                onNavigate(activityId);
              }
            : undefined
        }
      />
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

export function ChatStepperStrip({
  arc,
  activities = [],
  onRestart,
  onNavigate,
  navigateDisabled,
}: {
  arc: LessonArc;
  activities?: LessonActivity[];
  onRestart?: () => void;
  onNavigate?: (activityId: string) => void;
  navigateDisabled?: boolean;
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
        placement="bottom-start"
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
          onNavigate={onNavigate}
          navigateDisabled={navigateDisabled}
          onClose={() => setOpen(false)}
        />
      </Popover>
    </div>
  );
}
