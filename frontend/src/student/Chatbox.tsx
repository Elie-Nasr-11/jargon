import { useRef, useState, type KeyboardEvent } from "react";
import { AudioLines, Mic, Paperclip, Send } from "lucide-react";
import { ModeSelector } from "@/student/ModeSelector";
import { OfferPills } from "@/student/OfferPills";
import { turnModeSpec, type LessonOffers, type TurnMode } from "@/student/turnModes";

// The chatbox: attachments, the TurnMode selector, audio, and speak/send.
//
// Naming note — the composer's text-vs-code toggle is an INPUT SURFACE, a different axis from
// TurnMode. The old surface called both "mode" and that collision is what made the previous
// architecture hard to reason about. Neither word is used bare here.

export type ChatboxProps = {
  mode: TurnMode;
  onModeChange: (mode: TurnMode) => void;
  // What this lesson offers. Drives the inline pills; absent offers show no pill at all.
  offers: LessonOffers;
  onOpenResources: () => void;
  onSend: (text: string) => void;
  onAttach?: () => void;
  onToggleVoice?: () => void;
  voiceActive?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

export function Chatbox({
  mode,
  onModeChange,
  offers,
  onOpenResources,
  onSend,
  onAttach,
  onToggleVoice,
  voiceActive,
  disabled,
  placeholder,
}: ChatboxProps) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const spec = turnModeSpec(mode);
  const canSend = text.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    areaRef.current?.focus();
  };

  // Enter sends, Shift+Enter breaks the line — the convention every LLM chat uses, so it needs
  // no explanation.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="mode-surface rounded-card border shadow-card transition-colors duration-(--dur)"
      style={{ ["--mode-accent" as string]: `var(${spec.accentVar})` }}
    >
      <label className="sr-only" htmlFor="student-chatbox">
        Message
      </label>
      <textarea
        id="student-chatbox"
        ref={areaRef}
        rows={2}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? `${spec.label} — ${spec.hint.toLowerCase()}`}
        className="w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-body text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
      />

      <div className="flex items-center gap-1.5 px-2 pb-2">
        {/* Rendered only when wired. A permanently-disabled button is a promise the app does
            not keep — absent reads as "not a feature here", greyed reads as "broken". */}
        {onAttach ? (
          <button
            type="button"
            onClick={onAttach}
            disabled={disabled}
            aria-label="Attach a file"
            className="flex h-8 w-8 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Paperclip className="h-[16px] w-[16px]" strokeWidth={1.6} />
          </button>
        ) : null}

        <ModeSelector value={mode} onChange={onModeChange} disabled={disabled} />

        {/* Quiz / Homework / Resources — only the ones this lesson actually has. */}
        <OfferPills
          offers={offers}
          mode={mode}
          onModeChange={onModeChange}
          onOpenResources={onOpenResources}
          disabled={disabled}
        />

        <div className="min-w-2 flex-1" />

        {onToggleVoice ? (
          <button
            type="button"
            onClick={onToggleVoice}
            disabled={disabled}
            aria-label={voiceActive ? "Stop live voice" : "Start live voice"}
            aria-pressed={voiceActive}
            className={`flex h-8 w-8 items-center justify-center rounded-control transition-colors duration-(--dur-fast) disabled:opacity-40 ${
              voiceActive
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <AudioLines className="h-[16px] w-[16px]" strokeWidth={1.6} />
          </button>
        ) : null}

        {/* Speak/Send: the primary action swaps to Send the moment there's text, so an empty
            box invites speaking and a filled one invites sending. */}
        <button
          type="button"
          onClick={canSend ? submit : onToggleVoice}
          disabled={disabled || (!canSend && !onToggleVoice)}
          aria-label={canSend || !onToggleVoice ? "Send" : "Speak"}
          className="flex h-8 w-8 items-center justify-center rounded-control bg-foreground text-background transition-opacity duration-(--dur-fast) hover:opacity-90 disabled:opacity-30"
        >
          {canSend || !onToggleVoice ? (
            <Send className="h-[15px] w-[15px]" strokeWidth={1.7} />
          ) : (
            <Mic className="h-[15px] w-[15px]" strokeWidth={1.7} />
          )}
        </button>
      </div>
    </div>
  );
}
