import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { AudioLines, Code2, Loader2, Mic, Paperclip, Play, Send, Type, X } from "lucide-react";
import { CHAT_UPLOAD_ACCEPT, MAX_CHAT_UPLOAD_FILES, uploadStudentUpload } from "@/lib/api";
import type { ChatAttachment, VoiceInteractionEvent } from "@/lib/types";
import { CodeArea } from "@/components/CodeArea";
import type { ComposerLanguage } from "@/components/Composer";
import { ModeSelector } from "@/student/ModeSelector";
import { OfferPills } from "@/student/OfferPills";
import { stageInputMeta } from "@/student/useConversation";
import type { LessonOffers, TurnMode } from "@/student/turnModes";

// The chatbox: attachments, the TurnMode selector, dictation, live voice, and speak/send — plus
// a code surface.
//
// NAMING, and this is the whole reason the word was reserved: text-vs-code is an INPUT SURFACE,
// a different axis from TurnMode. A student can write code in Practice or in Discuss; the surface
// says HOW they are typing, the mode says WHAT the turn is for. The old surface called both
// "mode", and that collision is what made the previous architecture hard to reason about.
//
// In the code surface the primary action is RUN, not Send. Running IS the turn: the server's code
// gate only passes on a real execution result, so there is no useful "submit without running" —
// and one action makes a stale run result impossible.
//
// DICTATION is browser speech-to-text INTO the input: the transcript lands in the textarea where
// the student can read and fix it before sending (dictation mishears; an editable transcript is
// the difference between a tool and a trap). A send that used dictation stages
// input_modality="dictated" + the recognition confidence for the turn record (see stageInputMeta
// in useConversation — the shell's onSend prop forwards only text+attachments).

type InputSurface = "text" | "code";

const LANGUAGES: ComposerLanguage[] = ["jargon", "javascript", "python"];

// --- Browser speech recognition (ported from components/Composer, the pre-v6 dictation) -------

type SpeechResultLike = ArrayLike<{ transcript?: string; confidence?: number }> & {
  isFinal?: boolean;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const host = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return host.SpeechRecognition || host.webkitSpeechRecognition || null;
}

function friendlySpeechError(error: string | undefined) {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Allow the mic in your browser settings, then try again.";
    case "no-speech":
      return "I did not catch anything. Try again when you're ready.";
    case "audio-capture":
      return "No microphone was found for dictation.";
    case "network":
      return "Dictation could not reach the browser speech service.";
    case "aborted":
      return "Dictation stopped.";
    default:
      return "Dictation stopped.";
  }
}

export type ChatboxProps = {
  mode: TurnMode;
  onModeChange: (mode: TurnMode) => void;
  // What this lesson offers. Drives the inline pills; absent offers show no pill at all.
  offers: LessonOffers;
  onOpenResources: () => void;
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  // Absent = this surface cannot run code, so the toggle is not offered.
  onSendCode?: (code: string, language: ComposerLanguage) => void;
  // Absent = live voice is not available here (unsupported browser, no session yet), so the
  // toggle is not offered. A permanently-disabled button is a promise the app does not keep.
  onToggleVoice?: () => void;
  voiceActive?: boolean;
  // Voice telemetry sink (dictation started/transcribed/submitted).
  onVoiceEvent?: (event: VoiceInteractionEvent) => void;
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
  onToggleVoice,
  voiceActive,
  onVoiceEvent,
  disabled,
  placeholder,
}: ChatboxProps) {
  const [text, setText] = useState("");
  const [surface, setSurface] = useState<InputSurface>("text");
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState<ComposerLanguage>("jargon");
  // Resolved attachments plus the count still uploading, so Send can wait for them.
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  // Dictation state: whether the mic is hot, whether THIS draft used it, and the recognition
  // confidence of the final transcript (null when the engine reports none).
  const [dictating, setDictating] = useState(false);
  const [dictationUsed, setDictationUsed] = useState(false);
  const [dictationConfidence, setDictationConfidence] = useState<number | null>(null);
  const [dictationError, setDictationError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseRef = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const dictationAvailable = speechRecognitionConstructor() !== null;
  // An attachment alone is a legitimate message ("here, look at this"), so text is not required —
  // but an upload still in flight is, or the tutor would receive a reference to nothing.
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !uploading;
  const canRun = code.trim().length > 0 && !disabled;

  // A hot mic must not outlive the chatbox (or a disable — the hold lock disables the composer,
  // and dictation must stop with it).
  useEffect(() => {
    if (disabled) recognitionRef.current?.stop();
    return () => recognitionRef.current?.abort();
  }, [disabled]);

  const emitVoiceEvent = (event: VoiceInteractionEvent) => {
    void onVoiceEvent?.(event);
  };

  const toggleDictation = () => {
    if (dictating) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = speechRecognitionConstructor();
    if (!Ctor) {
      setDictationError("Dictation is not available in this browser.");
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    dictationBaseRef.current = text.trim();
    setDictationError("");

    recognition.onresult = (event) => {
      let spoken = "";
      let finalTranscript = "";
      let confidence: number | null = null;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alternative = result?.[0];
        if (!alternative?.transcript) continue;
        spoken += alternative.transcript;
        if (result.isFinal) {
          finalTranscript += alternative.transcript;
          if (
            typeof alternative.confidence === "number" &&
            Number.isFinite(alternative.confidence)
          ) {
            confidence = Math.max(0, Math.min(1, alternative.confidence));
          }
        }
      }
      // Interim results stream INTO the editable input, appended to whatever was already typed.
      const nextText = [dictationBaseRef.current, spoken.trim()].filter(Boolean).join(" ");
      setText(nextText);
      if (spoken.trim()) setDictationUsed(true);
      if (confidence !== null) setDictationConfidence(confidence);
      if (finalTranscript.trim()) {
        emitVoiceEvent({
          event_type: "dictation_transcribed",
          input_modality: "dictated",
          transcript: finalTranscript.trim(),
          transcript_confidence: confidence,
        });
      }
    };
    recognition.onerror = (event) => {
      setDictationError(event.message || friendlySpeechError(event.error));
      setDictating(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setDictating(false);
      areaRef.current?.focus();
    };

    try {
      recognition.start();
      setDictating(true);
      emitVoiceEvent({ event_type: "dictation_started", input_modality: "dictated" });
    } catch (error) {
      recognitionRef.current = null;
      setDictating(false);
      setDictationError((error as Error).message || "Dictation could not start.");
    }
  };

  const submit = () => {
    if (!canSend) return;
    recognitionRef.current?.stop();
    const trimmed = text.trim();
    if (dictationUsed) {
      // Stage the modality for the turn the hook is about to build — same synchronous call
      // stack, consumed exactly once (see stageInputMeta).
      stageInputMeta({ inputModality: "dictated", transcriptConfidence: dictationConfidence });
      emitVoiceEvent({
        event_type: "dictation_submitted",
        input_modality: "dictated",
        transcript: trimmed,
        transcript_confidence: dictationConfidence,
      });
    }
    onSend(trimmed, attachments.length ? attachments : undefined);
    setText("");
    setAttachments([]);
    setUploadError("");
    setDictationUsed(false);
    setDictationConfidence(null);
    setDictationError("");
    areaRef.current?.focus();
  };

  // Uploads run as the files are picked, not at send time: a 20 MB file should be moving while the
  // student is still typing. Each settles independently so one failure does not lose the others.
  const pickFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = ""; // let the same file be re-picked after a removal
    if (!picked.length) return;

    const room = MAX_CHAT_UPLOAD_FILES - attachments.length - uploading;
    const accepted = picked.slice(0, Math.max(0, room));
    if (picked.length > accepted.length) {
      setUploadError(`You can attach up to ${MAX_CHAT_UPLOAD_FILES} files.`);
    }
    if (!accepted.length) return;

    setUploading((n) => n + accepted.length);
    await Promise.all(
      accepted.map(async (file) => {
        try {
          const upload = await uploadStudentUpload(file);
          setAttachments((current) => [
            ...current,
            {
              upload_id: upload.id,
              storage_path: upload.storage_path,
              mime_type: upload.mime_type || file.type || "application/octet-stream",
              filename: upload.original_filename || file.name,
            },
          ]);
        } catch (err) {
          setUploadError((err as Error)?.message || `Could not attach ${file.name}.`);
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }),
    );
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
      // Design system: the composer is a PLAIN soft surface — the mode announces itself via
      // the solid tag inside (ModeSelector), not by tinting the box. Hairline + inset
      // top-highlight + quiet shadow; focus sharpens the hairline (composer-elev).
      className="mode-surface composer-elev rounded-[24px] border"
      style={{ boxShadow: "var(--inset-highlight), var(--elev-raised)" }}
    >
      {attachments.length || uploading || uploadError || dictationError ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
          {attachments.map((attachment) => (
            <span
              key={attachment.upload_id}
              className="flex items-center gap-1 rounded-pill border border-border bg-depth-sub px-2 py-0.5 text-meta text-foreground"
            >
              <span className="max-w-[14rem] truncate">{attachment.filename}</span>
              <button
                type="button"
                onClick={() =>
                  setAttachments((c) => c.filter((a) => a.upload_id !== attachment.upload_id))
                }
                aria-label={`Remove ${attachment.filename}`}
                className="text-muted-foreground hover:text-danger"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
          {uploading ? (
            <span className="flex items-center gap-1 text-meta text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Attaching {uploading}…
            </span>
          ) : null}
          {uploadError ? <span className="text-meta text-danger">{uploadError}</span> : null}
          {dictationError ? <span className="text-meta text-danger">{dictationError}</span> : null}
        </div>
      ) : null}

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
          dictating
            ? "Listening — speak, then tidy up the words before you send…"
            : surface === "code"
              ? "Add a note with your code (optional)…"
              : // The mode announces itself via the solid tag; the field just invites the reply
                // (the tag's hint lives in the dropdown where it's explained properly).
                (placeholder ?? "Reply to your mentor…")
        }
        rows={surface === "code" ? 1 : 2}
        className="w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-body text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
      />

      {/* flex-wrap: in the docked chat widget (media full screen) this row is ~400px wide and
          must wrap rather than overflow. */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
        {/* Rendered only when wired. A permanently-disabled button is a promise the app does
            not keep — absent reads as "not a feature here", greyed reads as "broken". */}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={CHAT_UPLOAD_ACCEPT}
          onChange={(e) => void pickFiles(e)}
          className="hidden"
        />
        {/* PDFs are absent from CHAT_UPLOAD_ACCEPT on purpose: the edge function only inlines
            text and images, so accepting one would attach a file the tutor silently cannot read. */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Attach a file"
          className="flex h-8 w-8 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <Paperclip className="h-[16px] w-[16px]" strokeWidth={1.6} />
        </button>

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

        {/* Dictation: browser speech-to-text into the editable input. Only rendered where the
            browser actually has a recognizer, and only on the text surface — dictating code is
            not a thing this composer pretends to do. */}
        {surface === "text" && dictationAvailable ? (
          <button
            type="button"
            onClick={toggleDictation}
            disabled={disabled}
            aria-label={dictating ? "Stop dictation" : "Dictate your message"}
            aria-pressed={dictating}
            className={`relative flex h-8 w-8 items-center justify-center rounded-control transition-colors duration-(--dur-fast) disabled:opacity-40 ${
              dictating
                ? "bg-danger/15 text-danger"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {dictating ? (
              <span className="absolute inset-1 animate-ping rounded-full bg-danger/20" />
            ) : null}
            <Mic className="h-[16px] w-[16px]" strokeWidth={1.6} />
          </button>
        ) : null}

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

        {surface === "code" ? (
          <button
            type="button"
            disabled={!canRun}
            onClick={() => {
              onSendCode?.(code, language);
              setCode("");
            }}
            aria-label="Run and send your code"
            className="flex h-8 items-center gap-1.5 rounded-pill bg-primary px-3 text-meta font-bold text-background transition-transform duration-(--dur-fast) hover:scale-[1.03] disabled:opacity-30"
          >
            <Play className="h-[13px] w-[13px]" strokeWidth={2} /> Run
          </button>
        ) : (
          // Send is a CIRCLE and the only light-filled control in dark (inverts per theme —
          // bg-foreground/text-background does exactly that). Hover scales, press is instant.
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-background transition-transform duration-(--dur-fast) hover:scale-105 disabled:opacity-30"
          >
            <Send className="h-[14px] w-[14px]" strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
}
