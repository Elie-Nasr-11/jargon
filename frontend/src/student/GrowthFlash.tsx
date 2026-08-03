import type { KnowledgeToast } from "@/student/useConversation";

// Round 20 (owner spec): the CENTER-SCREEN growth moment.
//
//   LINK  — a yellow circle draws a yellow line across to a gray circle; the gray circle
//           lights up yellow with a glow — then the whole thing settles to gray: the
//           connection is made, and made part of what you know.
//   VOCAB — the same language with one line: a line draws into a single circle, the
//           circle flashes yellow, then line and circle settle gray together.
//
// One flash per FRESH event (envelope-driven; tapping a highlight to re-read a
// definition never replays it), ~2.4s, self-contained CSS keyframes (gflash-*), skipped
// entirely under prefers-reduced-motion (the toasts already carry the information).
// Yellow is the discuss/memory hue — the same yellow the brain map's memory halos wear.

export function GrowthFlash({ toast }: { toast: KnowledgeToast }) {
  const isLink = toast.kind === "link";
  const labelLeft = isLink ? toast.event.from_title : "";
  const labelRight =
    toast.kind === "link"
      ? toast.event.to_title
      : toast.kind === "vocab"
        ? toast.event.term
        : toast.event.title;
  return (
    <div
      aria-hidden
      className="gflash pointer-events-none absolute inset-0 z-[var(--z-overlay)] flex items-center justify-center"
    >
      <svg viewBox="0 0 260 100" className="w-[260px]">
        {/* The line: draws in yellow, settles gray with everything else. */}
        <line
          x1={isLink ? 50 : 20}
          y1="44"
          x2="210"
          y2="44"
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={100}
          className="gflash-line"
        />
        {isLink ? (
          /* The known end: already yellow — this is where the connection starts. */
          <circle cx="50" cy="44" r="9" className="gflash-a" />
        ) : null}
        {/* The far end: gray until the line arrives, then lights and glows. */}
        <circle cx="210" cy="44" r="14" fill="none" strokeWidth="2" className="gflash-glow" />
        <circle cx="210" cy="44" r="9" className="gflash-b" />
        {/* Tiny mono labels so the moment says WHAT connected. */}
        {isLink && labelLeft ? (
          <text
            x="50"
            y="72"
            textAnchor="middle"
            className="gflash-label fill-[var(--ink-62)] font-mono text-[8px] uppercase tracking-[0.1em]"
          >
            {labelLeft.length > 18 ? `${labelLeft.slice(0, 18)}…` : labelLeft}
          </text>
        ) : null}
        {labelRight ? (
          <text
            x="210"
            y="72"
            textAnchor="middle"
            className="gflash-label fill-[var(--ink-62)] font-mono text-[8px] uppercase tracking-[0.1em]"
          >
            {labelRight.length > 18 ? `${labelRight.slice(0, 18)}…` : labelRight}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
