import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { AudioLines, Code2, Loader2, Mic, Paperclip, Play, Send, Type, X } from "lucide-react";
import { CHAT_UPLOAD_ACCEPT, MAX_CHAT_UPLOAD_FILES, uploadStudentUpload } from "@/lib/api";
import type { ChatAttachment } from "@/lib/types";
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
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  // Absent = this surface cannot run code, so the toggle is not offered.
  onSendCode?: (code: string, language: ComposerLanguage) => void;
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
  onToggleVoice,
  voiceActive,
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
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const spec = turnModeSpec(mode);
  // An attachment alone is a legitimate message ("here, look at this"), so text is not required —
  // but an upload still in flight is, or the tutor would receive a reference to nothing.
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !uploading;
  const canRun = code.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), attachments.length ? attachments : undefined);
    setText("");
    setAttachments([]);
    setUploadError("");
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
      className="mode-surface rounded-card border shadow-card transition-colors duration-(--dur)"
      style={{ ["--mode-accent" as string]: `var(${spec.accentVar})` }}
    >
      {attachments.length || uploading || uploadError ? (
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
            {attachments.length || uploading || uploadError ? (
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
              </div>
            ) : null}

            {surface === "code" ? (
              <Type className="h-[16px] w-[16px]" strokeWidth={1.6} />
            ) : (
              <Code2 className="h-[16px] w-[16px]" strokeWidth={1.6} />
            )}
          </button>
        ) : null}

        <ModeSelector value={mode} onChange={onModeChange} disabled={disabled} />

        {attachments.length || uploading || uploadError ? (
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
          </div>
        ) : null}

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
        {attachments.length || uploading || uploadError ? (
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
          </div>
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
