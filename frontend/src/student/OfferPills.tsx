import { BookOpen } from "lucide-react";
import type { LessonOffers } from "@/student/turnModes";

// Phase A: quiz/homework left the chatbox — they're teacher POSTS, surfaced by the work
// dock and class pages, not conversation modes. The only inline pill left is Resources,
// which is not a TurnMode either: opening materials sends no turn and cannot change the
// conversation's contract, so it calls its own handler rather than setting a mode.

export type OfferPillsProps = {
  offers: LessonOffers;
  onOpenResources: () => void;
  disabled?: boolean;
};

export function OfferPills({ offers, onOpenResources, disabled }: OfferPillsProps) {
  if (!offers.resources) return null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpenResources}
      className="flex shrink-0 items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-meta font-semibold transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-40"
      style={{ color: "color-mix(in oklab, var(--mode-lesson) 60%, var(--foreground))" }}
    >
      <BookOpen className="h-[13px] w-[13px]" strokeWidth={1.7} />
      Resources
    </button>
  );
}
