import { useRef, useState, type KeyboardEvent } from "react";
import { AudioLines, Code2, Mic, Paperclip, Play, Send, Type } from "lucide-react";
import { CodeArea } from "@/components/CodeArea";
import type { ComposerLanguage } from "@/components/Composer";
import { ModeSelector } from "@/student/ModeSelector";
import { OfferPills } from "@/student/OfferPills";
import { turnModeSpec, type LessonOffers, type TurnMode } from "@/student/turnModes";

// The chatbox: attachments, the TurnMode selector, audio, and speak/send — plus a code surface.
//
// NAMING, and this is the whole reason the word was reserved: text-vs-code is an INPUT SURFACE,
// a different axis from TurnMode. A student can write code in Practice or in Discuss; the surface
// says HOW they are typing, the mode says WHAT the turn is for. The old surface called both
// "mode", and that collision is what made the previous architecture hard to reason about.
//
// In the code surface the primary action is RUN, not Send. Running IS the turn: the server's code
// gate only passes on a real execution result, so there is no useful "submit without running" —
// and one action makes a stale run result impossible.

type InputSurface = "text" | "code";

const LANGUAGES: ComposerLanguage[] = ["jargon", "javascript", "python"];

export type ChatboxProps = {
  mode: TurnMode;
  onModeChange: (mode: TurnMode) => void;
  // What this lesson offers. Drives the inline pills; absent offers show no pill at all.
  offers: LessonOffers;
  onOpenResources: () => void;
  onSend: (text: string) => void;
  // Absent = this surface cannot run code, so the toggle is not offered.
  onSendCode?: (code: string, language: ComposerLanguage) => void;
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
  onSendCode,
  onAttach,
  onToggleVoice,
  voiceActive,
  disabled,
  placeholder,
}: ChatboxProps) {
  const [text, setText] = useState("");
  const [surface, setSurface] = useState<InputSurface>("text");
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState<ComposerLanguage>("jargon");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const spec = turnModeSpec(mode);
  const canSend = text.trim().length > 0 && !disabled;
  const canRun = code.trim().length > 0 && !disabled;

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
      {surface === "code" ? (
        <div className="px-2 pt-2">
          <CodeArea value={code} onChange={setCode} height={168} placeholder="Write your code..." />
        </div>
      ) : null}

      <label className="sr-only" htmlFor="student-chatbox">
        Message
      </label>
      <textarea
        id="student-chatbox"
        ref={areaRef}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          surface === "code"
            ? "Add a note with your code (optional)…"
            : (placeholder ?? `${spec.label} — ${spec.hint.toLowerCase()}`)
        }
        rows={surface === "code" ? 1 : 2}
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

        {onSendCode ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setSurface((s) => (s === "text" ? "code" : "text"))}
            aria-pressed={surface === "code"}
            aria-label={surface === "code" ? "Switch to writing text" : "Switch to writing code"}
            className={`flex h-8 w-8 items-center justify-center rounded-control transition-colors duration-(--dur-fast) disabled:opacity-40 ${
              surface === "code"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {surface === "code" ? (
              <Type className="h-[16px] w-[16px]" strokeWidth={1.6} />
            ) : (
              <Code2 className="h-[16px] w-[16px]" strokeWidth={1.6} />
            )}
          </button>
        ) : null}

        <ModeSelector value={mode} onChange={onModeChange} disabled={disabled} />

        {surface === "code" ? (
          <label className="flex items-center gap-1 text-meta text-muted-foreground">
            <span className="sr-only">Language</span>
            <select
              value={language}
              disabled={disabled}
              onChange={(e) => setLanguage(e.target.value as ComposerLanguage)}
              className="rounded-control border border-border bg-transparent px-1.5 py-1 text-meta text-foreground disabled:opacity-40"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang === "jargon" ? "Jargon" : lang === "python" ? "Python" : "JavaScript"}
                </option>
              ))}
            </select>
          </label>
        ) : null}

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
        {surface === "code" ? (
          <button
            type="button"
            disabled={!canRun}
            onClick={() => {
              onSendCode?.(code, language);
              setCode("");
            }}
            aria-label="Run and send your code"
            className="flex h-8 items-center gap-1.5 rounded-control bg-foreground px-2.5 text-meta font-medium text-background transition-opacity duration-(--dur-fast) hover:opacity-90 disabled:opacity-30"
          >
            <Play className="h-[13px] w-[13px]" strokeWidth={2} /> Run
          </button>
        ) : (
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
        )}
      </div>
    </div>
  );
}
