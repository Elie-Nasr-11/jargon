import { useEffect, useRef } from "react";
import { BookOpen, Link2, Sparkles } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";
import { subjectHueVar } from "@/student/Transcript";
import type { KnowledgeToast } from "@/student/useConversation";

// R32 (owner: "much better design for the link and vocab popups — it's not good at all").
//
// WHAT WAS WRONG. Three surfaces fired at once for one moment of learning: a full-screen
// SVG of two circles and a line in the middle, a definition card dropping from the top
// centre, and growth toasts stacking in the top right. A turn that taught three words put
// three separate cards on screen plus an abstract animation that carried no information
// the note underneath didn't already say. It read as chrome, not as a thing worth reading.
//
// WHAT THIS IS. ONE card, centred, holding EVERYTHING the turn taught — which is also the
// owner's earlier ask ("multiple vocab words in the pop-up") finally done. A word is set
// in the display face at reading size with its definition underneath, because the
// definition is the point; a new connection names both ends and why they link. The card is
// modal and must be dismissed by the student, so nothing is lost to a timer.
//
// The brain-growth idea survives as a QUIET accent — a small hue-keyed rule down the left
// of each entry — instead of a full-screen animation. Entrance is a short rise; reduced
// motion skips it. Nothing here is time-limited.

function entryHue(toast: KnowledgeToast): string {
  if (toast.kind === "vocab" && toast.event.subject) {
    return `var(${subjectHueVar(toast.event.subject)})`;
  }
  return "var(--grad-1)";
}

function Entry({ toast }: { toast: KnowledgeToast }) {
  const hue = entryHue(toast);
  const Icon = toast.kind === "vocab" ? BookOpen : toast.kind === "link" ? Link2 : Sparkles;
  const eyebrow =
    toast.kind === "vocab" ? "New word" : toast.kind === "link" ? "New connection" : "New idea";
  const headline =
    toast.kind === "vocab"
      ? toast.event.term
      : toast.kind === "link"
        ? `${toast.event.from_title} → ${toast.event.to_title}`
        : toast.event.title;
  const detail =
    toast.kind === "vocab"
      ? toast.event.definition
      : toast.kind === "link"
        ? toast.event.note
        : toast.event.one_liner;
  const tag = toast.kind === "vocab" ? toast.event.subject : null;
  return (
    <li
      className="relative pl-4"
      style={{ borderLeft: `2px solid color-mix(in oklab, ${hue} 55%, transparent)` }}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 shrink-0" strokeWidth={2} style={{ color: hue }} />
        <span
          className="font-mono text-overline uppercase tracking-[0.16em]"
          style={{ color: hue }}
        >
          {eyebrow}
        </span>
        {tag ? (
          <span className="font-mono text-overline uppercase tracking-[0.12em] text-muted-foreground">
            · {tag}
          </span>
        ) : null}
      </div>
      {/* The word itself carries the weight — a definition is what the student came for. */}
      <p className="mt-1 text-title font-semibold leading-snug text-foreground">{headline}</p>
      {detail ? (
        <p className="mt-1 text-body leading-relaxed text-muted-foreground">{detail}</p>
      ) : null}
    </li>
  );
}

export function KnowledgeCard({
  toasts,
  onDismiss,
  onSeeBrain,
}: {
  toasts: KnowledgeToast[];
  onDismiss: () => void;
  onSeeBrain?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Focus the way out, and let Escape take it — a modal that traps a keyboard user is
  // worse than the three-surface mess this replaces.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (!toasts.length) return null;
  const hasGrowth = toasts.some((toast) => toast.kind !== "vocab");
  const words = toasts.filter((toast) => toast.kind === "vocab").length;
  const links = toasts.length - words;
  // A plain-language summary beats a count: "2 new words" tells a student what happened.
  const summary = [
    words ? `${words} new word${words > 1 ? "s" : ""}` : "",
    links ? `${links} new connection${links > 1 ? "s" : ""}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={summary || "What you just learned"}
      className="pointer-events-auto absolute inset-0 z-[var(--z-overlay)] flex items-center justify-center p-4"
    >
      {/* The conversation steps back, but stays readable behind the card. */}
      <div
        className="absolute inset-0"
        style={{ background: "color-mix(in oklab, var(--background) 62%, transparent)" }}
        // Clicking the backdrop is a normal way out of a modal; the card still cannot be
        // lost to a timer, which is what "must be closed by the student" was protecting.
        onClick={onDismiss}
      />
      <div
        className={`relative w-full max-w-[26rem] rounded-card border border-border bg-depth-card p-5 shadow-pop ${
          prefersReducedMotion() ? "" : "kcard-in"
        }`}
      >
        <div className="font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
          {summary}
        </div>
        <ul className="mt-3.5 flex flex-col gap-3.5">
          {toasts.map((toast) => (
            <Entry key={toast.id} toast={toast} />
          ))}
        </ul>
        <div className="mt-5 flex items-center justify-end gap-2">
          {hasGrowth && onSeeBrain ? (
            <button
              type="button"
              onClick={() => {
                onDismiss();
                onSeeBrain();
              }}
              className="rounded-pill border border-border px-3 py-1.5 text-meta font-semibold text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
            >
              See it in your brain
            </button>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            onClick={onDismiss}
            className="rounded-pill bg-primary px-5 py-1.5 text-body font-bold text-background shadow-card transition-transform duration-(--dur-fast) hover:scale-[1.02]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
