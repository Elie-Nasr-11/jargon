import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "@/components/Popover";
import { TURN_MODES, turnModeSpec, type TurnMode } from "@/student/turnModes";

// The mode picker that lives in the chatbox. Shows the current TurnMode and opens a list with
// a one-line hint per mode — the hints are the whole point, since "Discuss" vs "Open" is not
// self-evident to a 12-year-old.
//
// A mode with nothing to act on renders DISABLED rather than hidden: a control that vanishes
// reads as a bug, one that's dimmed with a reason explains itself.

export type ModeSelectorProps = {
  value: TurnMode;
  onChange: (mode: TurnMode) => void;
  // Modes that can't be entered right now, each with a reason shown in the list.
  unavailable?: Partial<Record<TurnMode, string>>;
  disabled?: boolean;
};

export function ModeSelector({ value, onChange, unavailable, disabled }: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const current = turnModeSpec(value);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top-start"
      panelClassName="w-[280px] rounded-card border border-border bg-depth-card p-1.5 shadow-raised"
      trigger={
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Conversation mode: ${current.label}`}
          className="flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-meta text-foreground transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-40"
          style={{ ["--mode-accent" as string]: `var(${current.accentVar})` }}
        >
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--mode-accent)" }}
          />
          {current.label}
          <ChevronDown className="h-3 w-3 text-muted-foreground" strokeWidth={1.8} />
        </button>
      }
    >
      {TURN_MODES.map((mode) => {
        const blockedReason = unavailable?.[mode.id];
        const selected = mode.id === value;
        return (
          <button
            key={mode.id}
            type="button"
            disabled={Boolean(blockedReason)}
            onClick={() => {
              setOpen(false);
              onChange(mode.id);
            }}
            className="flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
            style={{ ["--mode-accent" as string]: `var(${mode.accentVar})` }}
          >
            <span
              aria-hidden
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--mode-accent)" }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-body text-foreground">
                {mode.label}
                {selected ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
              </span>
              <span className="mt-0.5 block text-meta text-muted-foreground">
                {blockedReason || mode.hint}
              </span>
            </span>
          </button>
        );
      })}
    </Popover>
  );
}
