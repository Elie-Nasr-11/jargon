import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "@/components/Popover";
import {
  ALWAYS_MODES,
  modeAccentValue,
  modeInkValue,
  turnModeSpec,
  type TurnMode,
} from "@/student/turnModes";

// The mode picker that lives in the chatbox. Lists ONLY the four always-available modes, with a
// one-line hint each — the hints are the whole point, since "Discuss" vs "Open" is not
// self-evident to a 12-year-old.
//
// Quiz and Homework are deliberately NOT in here: they exist only when the lesson has one, and a
// dropdown whose length changes per lesson is harder to learn than a fixed list plus visible
// inline pills. Chatbox renders those.

export type ModeSelectorProps = {
  value: TurnMode;
  onChange: (mode: TurnMode) => void;
  disabled?: boolean;
};

export function ModeSelector({ value, onChange, disabled }: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const current = turnModeSpec(value);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top-start"
      panelClassName="w-[280px] rounded-card border border-border bg-depth-card p-1.5 shadow-raised"
      trigger={
        // The current mode IS the solid tag (design system board 5a): one hue, dark ink on the
        // tag, pill geometry, wearing the cursor-tip.
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Conversation mode: ${current.label}`}
          className="ds-tag ds-tag-tip gap-1 px-3 py-1.5 text-[11px] transition-transform duration-(--dur-fast) hover:-translate-y-px disabled:opacity-40"
          style={{
            ["--tag-bg" as string]: modeAccentValue(current),
            ["--tag-ink" as string]: modeInkValue(current),
          }}
        >
          {current.label}
          <ChevronDown className="h-3 w-3 opacity-80" strokeWidth={2} />
        </button>
      }
    >
      {ALWAYS_MODES.map((mode) => {
        const selected = mode.id === value;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => {
              setOpen(false);
              onChange(mode.id);
            }}
            className="flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
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
              <span className="mt-0.5 block text-meta text-muted-foreground">{mode.hint}</span>
            </span>
          </button>
        );
      })}
    </Popover>
  );
}
