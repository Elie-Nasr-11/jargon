import { BookOpen, ClipboardList, ListChecks } from "lucide-react";
import { CONDITIONAL_MODES, type LessonOffers, type TurnMode } from "@/student/turnModes";

// The inline pills beside the mode dropdown: Quiz, Homework, and Resources — each shown ONLY
// when the lesson actually has one.
//
// Why pills and not dropdown entries: their presence is the signal. A student glancing at the
// chatbox can see "this lesson has a quiz" without opening anything, and a lesson without one
// simply has no pill rather than a greyed row to wonder about.
//
// Why not hover-expanding circles (the idea floated when this was specced): hover does not exist
// on touch, and a control whose meaning is hidden until you hover is a discoverability cost paid
// by exactly the person least able to afford it — a twelve-year-old meeting the app for the first
// time. Icon plus short label is two words wider and always legible.
//
// Resources is NOT a TurnMode: opening materials sends no turn and cannot change the
// conversation's contract, so it calls its own handler rather than setting a mode.

const MODE_ICONS: Record<string, typeof ListChecks> = {
  quiz: ListChecks,
  assignment: ClipboardList,
};

// Design system: an ACTIVE offer is the solid tag (bg hue + on-tag ink); an available-but-idle
// offer is the "Quiz ready" treatment — a soft pill whose TEXT carries the hue, mixed toward
// ink so yellow/orange stay readable on both ladders.
function Pill({
  icon: Icon,
  label,
  active,
  accentVar,
  disabled,
  onClick,
}: {
  icon: typeof ListChecks;
  label: string;
  active?: boolean;
  accentVar: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 text-meta font-semibold transition-colors duration-(--dur-fast) disabled:opacity-40 ${
        active ? "ds-tag" : "border border-border hover:bg-muted"
      }`}
      style={
        active
          ? {
              ["--tag-bg" as string]: `var(${accentVar})`,
              ["--tag-ink" as string]: `var(${accentVar}-ink, var(--background))`,
            }
          : {
              color: `color-mix(in oklab, var(${accentVar}) 60%, var(--foreground))`,
            }
      }
    >
      <Icon className="h-[13px] w-[13px]" strokeWidth={1.7} />
      {label}
    </button>
  );
}

export type OfferPillsProps = {
  offers: LessonOffers;
  mode: TurnMode;
  onModeChange: (mode: TurnMode) => void;
  onOpenResources: () => void;
  disabled?: boolean;
};

export function OfferPills({
  offers,
  mode,
  onModeChange,
  onOpenResources,
  disabled,
}: OfferPillsProps) {
  const available = CONDITIONAL_MODES.filter((spec) =>
    spec.id === "quiz" ? offers.quiz : offers.homework,
  );

  if (!available.length && !offers.resources) return null;

  return (
    <>
      {available.map((spec) => (
        <Pill
          key={spec.id}
          icon={MODE_ICONS[spec.id] ?? ListChecks}
          label={spec.label}
          active={mode === spec.id}
          accentVar={spec.accentVar}
          disabled={disabled}
          onClick={() => onModeChange(spec.id)}
        />
      ))}
      {offers.resources ? (
        <Pill
          icon={BookOpen}
          label="Resources"
          accentVar="--mode-lesson"
          disabled={disabled}
          onClick={onOpenResources}
        />
      ) : null}
    </>
  );
}
