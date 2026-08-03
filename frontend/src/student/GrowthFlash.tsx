import type { KnowledgeToast } from "@/student/useConversation";

// Round 20 (owner spec): the CENTER-SCREEN growth moment.
//
//   LINK  — a yellow circle draws a yellow line across to a gray circle; the gray circle
//           lights up yellow with a glow — then the whole thing settles to gray: the
//           connection is made, and made part of what you know.
//   VOCAB — the same language with one line: a line draws into a single circle, the
//           circle flashes yellow, then line and circle settle gray together.
//
// Round 22g (owner): the moment now OWNS the screen — everything behind it dims and
// blurs while it plays, the line draws like it's working against RESISTANCE (fast
// start, grinding finish — forging a connection takes effort), and a plain-language
// note underneath says exactly what just happened ("New link between A and B", "New
// word: x — definition"). The tiny in-SVG labels are gone; the note is the label.
//
// One flash per FRESH event (envelope-driven; tapping a highlight to re-read a
// definition never replays it), ~3.2s, self-contained CSS keyframes (gflash-*), skipped
// entirely under prefers-reduced-motion (the toasts already carry the information).
// Yellow is the discuss/memory hue — the same yellow the brain map's memory halos wear.

const NOTE_MAX = 140;

function clampNote(text: string): string {
  return text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX - 1)}…` : text;
}

function noteFor(toast: KnowledgeToast): string {
  if (toast.kind === "link")
    return clampNote(`New link between ${toast.event.from_title} and ${toast.event.to_title}`);
  if (toast.kind === "vocab")
    return clampNote(`New word: ${toast.event.term} — ${toast.event.definition}`);
  return clampNote(`New idea: ${toast.event.title}`);
}

export function GrowthFlash({ toast }: { toast: KnowledgeToast }) {
  const isLink = toast.kind === "link";
  return (
    <div aria-hidden className="gflash pointer-events-none absolute inset-0 z-[var(--z-overlay)]">
      {/* The rest of the screen steps back: dimmed + blurred while the moment plays. */}
      <div className="gflash-overlay absolute inset-0" />
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-4">
        <svg viewBox="0 0 260 100" className="w-[260px]">
          {/* The line: draws in yellow — against resistance — and settles gray. */}
          <line
            x1={isLink ? 50 : 20}
            y1="50"
            x2="210"
            y2="50"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={100}
            className="gflash-line"
          />
          {isLink ? (
            /* The known end: already yellow — this is where the connection starts. */
            <circle cx="50" cy="50" r="9" className="gflash-a" />
          ) : null}
          {/* The far end: gray until the line arrives, then lights and glows. */}
          <circle cx="210" cy="50" r="14" fill="none" strokeWidth="2" className="gflash-glow" />
          <circle cx="210" cy="50" r="9" className="gflash-b" />
        </svg>
        {/* The plain-language note: what just happened, in words a student reads. */}
        <p className="gflash-note max-w-[min(80vw,26rem)] text-balance text-center text-sm font-medium leading-snug text-foreground">
          {noteFor(toast)}
        </p>
      </div>
    </div>
  );
}
