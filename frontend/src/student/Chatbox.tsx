import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  AudioLines,
  BookOpen,
  ChevronLeft,
  Code2,
  FolderOpen,
  Loader2,
  Mic,
  Paperclip,
  Play,
  Plus,
  Send,
  Sigma,
  Type,
  X,
} from "lucide-react";
import {
  CHAT_UPLOAD_ACCEPT,
  MAX_CHAT_UPLOAD_FILES,
  fetchLessonResources,
  listStudentUploads,
  studentUploadState,
  uploadStudentUpload,
} from "@/lib/api";
import type {
  ChatAttachment,
  LessonChatResource,
  StudentUpload,
  VoiceInteractionEvent,
} from "@/lib/types";
import { CodeArea } from "@/components/CodeArea";
import { Popover } from "@/components/Popover";
import { EquationPad } from "@/student/EquationPad";
import type { ComposerLanguage } from "@/lib/composerLanguage";
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

// The plus popover's views: the menu, the two pickers, and the equation pad behind it.
type PlusView = "menu" | "uploads" | "resources" | "equation";

const PLUS_ROW =
  "flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted";

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
  // Hard lock (teacher hold): the whole composer goes inert.
  disabled?: boolean;
  // Turn in flight: only Send/Run are gated — the student keeps typing their next
  // thought while the mentor's reply paces out.
  busy?: boolean;
  placeholder?: string;
  // Context for the plus menu's "Reference a resource" picker: without a lesson there is
  // nothing to reference, so the row hides. sessionResources = what the mentor has already
  // attached this session (merged with the lesson's published catalog, session copies win).
  lessonId?: string | null;
  sessionResources?: LessonChatResource[];
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
  busy,
  placeholder,
  lessonId,
  sessionResources,
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
  const canSend =
    (text.trim().length > 0 || attachments.length > 0) && !disabled && !busy && !uploading;
  // The send-slot swap: an empty draft offers speech; any typed text (or attachment) swaps
  // in the send circle.
  const draftEmpty = text.trim().length === 0 && attachments.length === 0 && !uploading;
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusView, setPlusView] = useState<PlusView>("menu");
  // Picker data, fetched lazily when its view opens; null = loading.
  const [uploads, setUploads] = useState<StudentUpload[] | null>(null);
  const [refResources, setRefResources] = useState<LessonChatResource[] | null>(null);
  const canRun = code.trim().length > 0 && !disabled && !busy;

  // The input grows with the draft until 5 lines are visible, then scrolls inside the box.
  // Runs on every text change — typed, dictated, or cleared on send — so the height always
  // tracks the current value and snaps back when the box empties. The cap is derived from the
  // LIVE line-height + padding so it stays correct if the type scale changes.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 23;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const max = Math.ceil(lineHeight * 5 + pad);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text, surface]);

  const closePlus = () => {
    setPlusOpen(false);
    setPlusView("menu");
  };

  const openUploadsPicker = () => {
    setPlusView("uploads");
    setUploads(null);
    void listStudentUploads()
      .then((rows) => setUploads(rows.filter((row) => studentUploadState(row) === "available")))
      .catch(() => setUploads([]));
  };

  const openResourcePicker = () => {
    setPlusView("resources");
    setRefResources(null);
    const session = sessionResources ?? [];
    void fetchLessonResources(lessonId ?? "")
      .catch(() => [] as LessonChatResource[])
      .then((catalog) => {
        // Session copies win by id — the same merge the Resources panel uses.
        const known = new Set(session.map((r) => r.id));
        setRefResources([...session, ...catalog.filter((r) => !known.has(r.id))]);
      });
  };

  const pickExistingUpload = (upload: StudentUpload) => {
    if (attachments.length + uploading >= MAX_CHAT_UPLOAD_FILES) {
      setUploadError(`You can attach up to ${MAX_CHAT_UPLOAD_FILES} files.`);
      closePlus();
      return;
    }
    setAttachments((current) =>
      current.some((a) => a.upload_id === upload.id)
        ? current
        : [
            ...current,
            {
              upload_id: upload.id,
              storage_path: upload.storage_path,
              mime_type: upload.mime_type || "application/octet-stream",
              filename: upload.original_filename,
            },
          ],
    );
    closePlus();
  };

  // R29: the equation pad writes `$...$` into the draft at the caret, like any other typed
  // text — the student can still edit it, and the transcript typesets it on send.
  const insertEquation = (latex: string) => {
    const el = areaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const spacer = before && !before.endsWith(" ") ? " " : "";
    const next = `${before}${spacer}${latex} ${after}`;
    setText(next);
    closePlus();
    const caret = before.length + spacer.length + latex.length + 1;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  // Referencing is TEXT, visible and editable — the mentor's context carries the lesson's
  // resource titles, so naming one is how the student points at it (and phrasing it as a
  // request also attaches the card server-side). No hidden payload rides the turn.
  const referenceResource = (resource: LessonChatResource) => {
    setText((current) => {
      const reference = `About "${resource.title}": `;
      if (!current.trim()) return reference;
      return current.endsWith(" ") ? `${current}${reference}` : `${current} ${reference}`;
    });
    closePlus();
    areaRef.current?.focus();
  };

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
      // rounded-[20px] + raised insets: the curve must never crowd the text or the controls.
      className="mode-surface composer-elev rounded-[20px] border"
      style={{ boxShadow: "var(--inset-highlight), var(--elev-raised)" }}
    >
      {attachments.length || uploading || uploadError || dictationError ? (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5">
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
        className="w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-body text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
      />

      {/* flex-wrap: in the docked chat widget (media full screen) this row is ~400px wide and
          must wrap rather than overflow. */}
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={CHAT_UPLOAD_ACCEPT}
          onChange={(e) => void pickFiles(e)}
          className="hidden"
        />
        {/* The PLUS: one circle that opens the compose menu — upload, pick from your
            uploads, reference a resource, switch surface. (PDFs are absent from
            CHAT_UPLOAD_ACCEPT on purpose: the edge function only inlines text and images.) */}
        <Popover
          open={plusOpen}
          onClose={closePlus}
          placement="top-start"
          panelClassName={`${plusView === "equation" ? "w-[310px]" : "w-[240px]"} rounded-card border border-border bg-background p-1.5`}
          trigger={
            <button
              type="button"
              disabled={disabled}
              onClick={() => (plusOpen ? closePlus() : setPlusOpen(true))}
              aria-expanded={plusOpen}
              aria-label="Add to your message"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground disabled:opacity-40"
              style={{ boxShadow: "var(--inset-highlight)" }}
            >
              <Plus className="h-[16px] w-[16px]" strokeWidth={1.8} />
            </button>
          }
        >
          {plusView === "menu" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  closePlus();
                  fileRef.current?.click();
                }}
                className={PLUS_ROW}
              >
                <Paperclip className="h-[15px] w-[15px]" strokeWidth={1.5} />
                Upload files
              </button>
              <button type="button" onClick={() => openUploadsPicker()} className={PLUS_ROW}>
                <FolderOpen className="h-[15px] w-[15px]" strokeWidth={1.5} />
                Your uploads
              </button>
              {lessonId ? (
                <button type="button" onClick={() => openResourcePicker()} className={PLUS_ROW}>
                  <BookOpen className="h-[15px] w-[15px]" strokeWidth={1.5} />
                  Reference a resource
                </button>
              ) : null}
              <button type="button" onClick={() => setPlusView("equation")} className={PLUS_ROW}>
                <Sigma className="h-[15px] w-[15px]" strokeWidth={1.5} />
                Write an equation
              </button>
              {onSendCode ? (
                <button
                  type="button"
                  onClick={() => {
                    closePlus();
                    setSurface((s) => (s === "text" ? "code" : "text"));
                  }}
                  className={PLUS_ROW}
                >
                  {surface === "code" ? (
                    <Type className="h-[15px] w-[15px]" strokeWidth={1.5} />
                  ) : (
                    <Code2 className="h-[15px] w-[15px]" strokeWidth={1.5} />
                  )}
                  {surface === "code" ? "Write text" : "Write code"}
                </button>
              ) : null}
            </>
          ) : plusView === "equation" ? (
            <EquationPad onInsert={insertEquation} onCancel={() => setPlusView("menu")} />
          ) : (
            <>
              <button type="button" onClick={() => setPlusView("menu")} className={PLUS_ROW}>
                <ChevronLeft className="h-[15px] w-[15px]" strokeWidth={1.7} />
                {plusView === "uploads" ? "Your uploads" : "Reference a resource"}
              </button>
              <div className="max-h-56 overflow-y-auto overscroll-contain">
                {plusView === "uploads" ? (
                  uploads === null ? (
                    <p className="flex items-center gap-2 px-2.5 py-2 text-meta text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                    </p>
                  ) : uploads.length ? (
                    uploads.map((upload) => {
                      const attached = attachments.some((a) => a.upload_id === upload.id);
                      return (
                        <button
                          key={upload.id}
                          type="button"
                          disabled={attached}
                          onClick={() => pickExistingUpload(upload)}
                          className={`${PLUS_ROW} disabled:opacity-40`}
                        >
                          <Paperclip className="h-[13px] w-[13px] shrink-0" strokeWidth={1.5} />
                          <span className="min-w-0 flex-1 truncate">
                            {upload.original_filename}
                          </span>
                          {attached ? (
                            <span className="shrink-0 text-overline text-muted-foreground">
                              added
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-2.5 py-2 text-meta text-muted-foreground">
                      Nothing uploaded yet.
                    </p>
                  )
                ) : refResources === null ? (
                  <p className="flex items-center gap-2 px-2.5 py-2 text-meta text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                  </p>
                ) : refResources.length ? (
                  refResources.map((resource) => (
                    <button
                      key={resource.id}
                      type="button"
                      onClick={() => referenceResource(resource)}
                      className={PLUS_ROW}
                    >
                      <BookOpen className="h-[13px] w-[13px] shrink-0" strokeWidth={1.5} />
                      <span className="min-w-0 flex-1 truncate">{resource.title}</span>
                      <span className="shrink-0 text-overline uppercase text-muted-foreground">
                        {resource.resource_type === "artifact"
                          ? "activity"
                          : resource.resource_type}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-2.5 py-2 text-meta text-muted-foreground">
                    No materials in this lesson yet.
                  </p>
                )}
              </div>
            </>
          )}
        </Popover>

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

        {/* Resources — the only inline pill left; quiz/homework live in the work dock. */}
        <OfferPills offers={offers} onOpenResources={onOpenResources} disabled={disabled} />

        <div className="min-w-2 flex-1" />

        {/* Dictation: speech-to-text into the editable input. ALWAYS visible on the text
            surface (round 19, owner call) — starting it mid-draft APPENDS the transcript to
            what's already typed (dictationBaseRef), so typing and speaking mix freely. */}
        {surface === "text" && dictationAvailable ? (
          <button
            type="button"
            onClick={toggleDictation}
            disabled={disabled}
            aria-label={dictating ? "Stop dictation" : "Dictate your message"}
            aria-pressed={dictating}
            className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-(--dur-fast) disabled:opacity-40 ${
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
        ) : draftEmpty && onToggleVoice ? (
          // THE SLOT, empty draft: speech is the primary act — the live-voice button holds
          // the send position (the ChatGPT pattern) and disappears the moment text lands.
          <button
            type="button"
            onClick={onToggleVoice}
            disabled={disabled}
            aria-label={voiceActive ? "Stop live voice" : "Start live voice"}
            aria-pressed={voiceActive}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-(--dur-fast) hover:scale-105 disabled:opacity-40 ${
              voiceActive ? "bg-danger text-white" : "bg-primary text-background"
            }`}
          >
            <AudioLines className="h-[15px] w-[15px]" strokeWidth={1.7} />
          </button>
        ) : (
          // THE SLOT, draft in progress: send takes over — a circle, the only light-filled
          // control in dark (bg-primary/text-background inverts per theme).
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
