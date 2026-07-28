import type { ReactNode } from "react";
import { Chatbox } from "@/student/Chatbox";
import { turnModeSpec, type TurnMode } from "@/student/turnModes";

// The conversation surface. Its whole job is to make the current TurnMode legible: the panel
// takes the mode's tint, gets its own border so it reads as a distinct container, and carries a
// centered eyebrow pill ON the top border — the fieldset-legend treatment, so the mode labels
// the container rather than floating as one more chip inside the transcript.
//
// All colour comes from --mode-accent via the .mode-surface / .mode-eyebrow classes in
// styles.css; nothing here hardcodes a hue, so the theme toggle needs no work.

export type ChatWindowProps = {
  mode: TurnMode;
  onModeChange: (mode: TurnMode) => void;
  modeUnavailable?: Partial<Record<TurnMode, string>>;
  onSend: (text: string) => void;
  onAttach?: () => void;
  onToggleVoice?: () => void;
  voiceActive?: boolean;
  sending?: boolean;
  // The transcript. Supplied by the route so this component stays presentational.
  children?: ReactNode;
};

export function ChatWindow({
  mode,
  onModeChange,
  modeUnavailable,
  onSend,
  onAttach,
  onToggleVoice,
  voiceActive,
  sending,
  children,
}: ChatWindowProps) {
  const spec = turnModeSpec(mode);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-6"
      style={{ ["--mode-accent" as string]: `var(${spec.accentVar})` }}
    >
      <section
        aria-label={`Conversation — ${spec.label} mode`}
        className="mode-surface relative flex min-h-0 flex-1 flex-col rounded-card border transition-colors duration-(--dur)"
      >
        {/* Eyebrow pill, centered on the top border. aria-hidden because the section's
            aria-label already announces the mode — a screen reader shouldn't hear it twice. */}
        <span
          aria-hidden
          className="mode-eyebrow absolute -top-[11px] left-1/2 -translate-x-1/2 rounded-pill border px-2.5 py-0.5 text-overline font-medium uppercase tracking-[0.09em]"
        >
          {spec.label}
        </span>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-7">
          {children}
        </div>

        <div className="shrink-0 px-3 pb-3">
          <Chatbox
            mode={mode}
            onModeChange={onModeChange}
            modeUnavailable={modeUnavailable}
            onSend={onSend}
            onAttach={onAttach}
            onToggleVoice={onToggleVoice}
            voiceActive={voiceActive}
            disabled={sending}
          />
        </div>
      </section>
    </div>
  );
}
