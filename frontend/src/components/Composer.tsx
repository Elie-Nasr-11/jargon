import {
  Suspense,
  forwardRef,
  lazy,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import gsap from "gsap";
import { AudioLines, Code2, Mic, MicOff, Plus, Send, Play, X } from "lucide-react";
import { GradientCard } from "./GradientCard";
import { Popover } from "./Popover";
import { runJavaScript, runPython, type RunResult } from "@/lib/code-runner";
import {
  JARGON_COMMANDS,
  JARGON_CONDITION_PHRASES,
  JARGON_CONDITION_WORDS,
  JARGON_LANGUAGE_ID,
} from "@/lib/jargon-syntax";
import { useTheme } from "@/lib/theme";
import type { ChatInputModality, VoiceInteractionEvent } from "@/lib/types";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.default })),
);

const JARGON_LIGHT_THEME = "jargon-light";
const JARGON_DARK_THEME = "jargon-dark";

function registerJargonLanguage(monaco: typeof import("monaco-editor")) {
  if (!monaco.languages.getLanguages().some((language) => language.id === JARGON_LANGUAGE_ID)) {
    monaco.languages.register({ id: JARGON_LANGUAGE_ID });
  }

  monaco.languages.setMonarchTokensProvider(JARGON_LANGUAGE_ID, {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/^\s*\/\/.*$/, "comment"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/#.*$/, "comment"],
        [
          new RegExp(
            `\\b(?:${JARGON_CONDITION_PHRASES.map((phrase) => phrase.replace(/\s+/g, "\\s+")).join(
              "|",
            )})\\b`,
          ),
          "jargon-condition",
        ],
        [new RegExp(`\\b(?:${JARGON_COMMANDS.join("|")})\\b`), "jargon-command"],
        [new RegExp(`\\b(?:${JARGON_CONDITION_WORDS.join("|")})\\b`), "jargon-condition"],
        [/\b\d+(?:\.\d+)?\b/, "number"],
        [/[()[\]{}]/, "delimiter.bracket"],
      ],
    },
  });
}

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

type Mode = "text" | "code";
export type ComposerLanguage = "jargon" | "javascript" | "python";
type Lang = ComposerLanguage;

type SendTextOptions = {
  inputModality?: ChatInputModality;
  transcriptConfidence?: number | null;
};

type SpeechAlternativeLike = {
  transcript: string;
  confidence?: number;
};

type SpeechResultLike = {
  isFinal: boolean;
  0: SpeechAlternativeLike;
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

export type ComposerHandle = {
  loadCode: (input: { code: string; language: ComposerLanguage }) => void;
};

type ComposerProps = {
  onSendText: (text: string, options?: SendTextOptions) => void;
  onSendCodeResult: (code: string, lang: Lang, result: RunResult) => void;
  onRunCode?: (code: string, lang: Lang) => Promise<RunResult>;
  onVoiceEvent?: (event: VoiceInteractionEvent) => void | Promise<void>;
  initialCode?: string;
  initialLanguage?: Lang;
  sending: boolean;
  // When the textbox is empty, the send button becomes a voice-mode toggle.
  canStartVoice?: boolean;
  onStartVoice?: () => void;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    onSendText,
    onSendCodeResult,
    onRunCode,
    onVoiceEvent,
    initialCode,
    initialLanguage = "jargon",
    sending,
    canStartVoice,
    onStartVoice,
  },
  ref,
) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [lang, setLang] = useState<Lang>(initialLanguage);
  const [code, setCode] = useState<string>(
    initialCode ||
      `// Try me. Hit Run \u25B6 to see output in the chat.\nPRINT "hello from jargon"`,
  );
  const [running, setRunning] = useState(false);
  // The "+" add-menu (opens upward from the composer's left). Today it carries one live action —
  // Write code — and is the seam where attach actions (upload/photo/screenshot) land once the chat
  // wire can carry them; for now the tutor only accepts text + code, so nothing else is offered.
  const [plusOpen, setPlusOpen] = useState(false);
  const lastSeedRef = useRef<string | undefined>(initialCode);
  const morphRef = useRef<HTMLDivElement>(null);
  const textPanelRef = useRef<HTMLDivElement>(null);
  const codePanelRef = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseRef = useRef("");
  const dictationStartedAtRef = useRef<number | null>(null);
  const [dictating, setDictating] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [dictationUsed, setDictationUsed] = useState(false);
  const [dictationConfidence, setDictationConfidence] = useState<number | null>(null);

  const MIN_EDITOR_H = 150;
  const DEFAULT_EDITOR_H = 260;
  const CHROME_OFFSET = 128;
  const [editorHeight, setEditorHeight] = useState<number>(DEFAULT_EDITOR_H);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);
  const [vh, setVh] = useState<number>(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  const maxEditorH = Math.max(MIN_EDITOR_H, Math.floor(vh * 0.65) - CHROME_OFFSET);
  const clampEditorHeight = (height: number) =>
    Math.max(MIN_EDITOR_H, Math.min(height, maxEditorH));

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setVoiceSupported(Boolean(speechRecognitionConstructor()));
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  // Re-clamp when viewport changes so the panel never exceeds 65vh.
  useEffect(() => {
    setEditorHeight((h) => Math.max(MIN_EDITOR_H, Math.min(h, maxEditorH)));
  }, [maxEditorH]);

  const toHex = (input: string, fallback: string) => {
    try {
      const c = document.createElement("canvas").getContext("2d");
      if (!c) return fallback;
      c.fillStyle = "#000";
      c.fillStyle = input;
      const v = c.fillStyle as string;
      if (typeof v === "string" && v.startsWith("#")) return v;
    } catch {
      /* noop */
    }
    return fallback;
  };

  const applyMonacoTheme = (monaco: typeof import("monaco-editor")) => {
    const isDark = document.documentElement.classList.contains("dark");
    const bg = toHex(
      readVar("--code-background", isDark ? "#161619" : "#eef0f6"),
      isDark ? "#161619" : "#eef0f6",
    );
    const fg = toHex(
      readVar("--code-foreground", isDark ? "#e6e6ea" : "#1f2026"),
      isDark ? "#e6e6ea" : "#1f2026",
    );
    const muted = toHex(
      readVar("--code-muted", isDark ? "#8a8a90" : "#777984"),
      isDark ? "#8a8a90" : "#777984",
    );
    const selection = readVar("--code-selection", isDark ? "#ffffff20" : "#5266d829");
    const command = toHex(
      readVar("--jargon-syntax-command", isDark ? "#8fa4ef" : "#5266d8"),
      isDark ? "#8fa4ef" : "#5266d8",
    );
    const condition = toHex(
      readVar("--jargon-syntax-condition", isDark ? "#f585bb" : "#c4498b"),
      isDark ? "#f585bb" : "#c4498b",
    );
    const comment = toHex(
      readVar("--jargon-syntax-comment", isDark ? "#8a8a90" : "#777984"),
      isDark ? "#8a8a90" : "#777984",
    );
    const string = toHex(
      readVar("--jargon-syntax-string", isDark ? "#8ad0a8" : "#25845a"),
      isDark ? "#8ad0a8" : "#25845a",
    );
    const number = toHex(
      readVar("--jargon-syntax-number", isDark ? "#f0a868" : "#b86b00"),
      isDark ? "#f0a868" : "#b86b00",
    );
    const bracket = toHex(
      readVar("--jargon-syntax-bracket", isDark ? "#8a8a90" : "#777984"),
      isDark ? "#8a8a90" : "#777984",
    );
    monaco.editor.defineTheme(JARGON_DARK_THEME, {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: comment.slice(1), fontStyle: "italic" },
        { token: "keyword", foreground: command.slice(1) },
        { token: "jargon-command", foreground: command.slice(1), fontStyle: "bold" },
        { token: "jargon-condition", foreground: condition.slice(1), fontStyle: "bold" },
        { token: "string", foreground: string.slice(1) },
        { token: "number", foreground: number.slice(1) },
        { token: "delimiter.bracket", foreground: bracket.slice(1) },
      ],
      colors: {
        "editor.background": bg,
        "editor.foreground": fg,
        "editorLineNumber.foreground": muted,
        "editorCursor.foreground": fg,
        "editor.selectionBackground": selection,
        "editor.inactiveSelectionBackground": selection,
      },
    });
    monaco.editor.defineTheme(JARGON_LIGHT_THEME, {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: comment.slice(1), fontStyle: "italic" },
        { token: "keyword", foreground: command.slice(1) },
        { token: "jargon-command", foreground: command.slice(1), fontStyle: "bold" },
        { token: "jargon-condition", foreground: condition.slice(1), fontStyle: "bold" },
        { token: "string", foreground: string.slice(1) },
        { token: "number", foreground: number.slice(1) },
        { token: "delimiter.bracket", foreground: bracket.slice(1) },
      ],
      colors: {
        "editor.background": bg,
        "editor.foreground": fg,
        "editorLineNumber.foreground": muted,
        "editorCursor.foreground": fg,
        "editor.selectionBackground": selection,
        "editor.inactiveSelectionBackground": selection,
      },
    });
    monaco.editor.setTheme(isDark ? JARGON_DARK_THEME : JARGON_LIGHT_THEME);
  };

  const handleMonacoMount = (_editor: unknown, monaco: typeof import("monaco-editor")) => {
    monacoRef.current = monaco;
    registerJargonLanguage(monaco);
    applyMonacoTheme(monaco);
  };

  useLayoutEffect(() => {
    if (monacoRef.current) applyMonacoTheme(monacoRef.current);
  }, [resolved]);

  useEffect(() => {
    if (!initialCode || initialCode === lastSeedRef.current) return;
    lastSeedRef.current = initialCode;
    setCode(initialCode);
    setLang(initialLanguage);
  }, [initialCode, initialLanguage]);

  // smooth height morph between text & code panels
  useLayoutEffect(() => {
    const wrap = morphRef.current;
    const target = mode === "text" ? textPanelRef.current : codePanelRef.current;
    if (!wrap || !target) return;
    const fromH = wrap.offsetHeight;
    const toH = target.scrollHeight;
    gsap.fromTo(
      wrap,
      { height: fromH },
      {
        height: toH,
        duration: 0.36,
        ease: "power3.out",
        onComplete: () => {
          requestAnimationFrame(() => {
            if (morphRef.current) morphRef.current.style.height = "auto";
          });
        },
      },
    );
    gsap.fromTo(
      target,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", delay: 0.06 },
    );
  }, [mode]);

  // Stable manual resize: window-level listeners keep drag smooth outside the handle.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      setEditorHeight(clampEditorHeight(start.h + start.y - e.clientY));
    };

    const onUp = () => {
      dragStartRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, maxEditorH]);

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, h: editorHeight };
    setDragging(true);
  };

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
      setVoiceError("Dictation is not available in this browser.");
      setVoiceSupported(false);
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    dictationBaseRef.current = text.trim();
    dictationStartedAtRef.current = Date.now();
    setVoiceError("");
    setDictationUsed(false);
    setDictationConfidence(null);

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
      setVoiceError(event.message || friendlySpeechError(event.error));
      setDictating(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setDictating(false);
    };

    try {
      recognition.start();
      setDictating(true);
      emitVoiceEvent({ event_type: "dictation_started", input_modality: "dictated" });
    } catch (error) {
      recognitionRef.current = null;
      setDictating(false);
      setVoiceError((error as Error).message || "Dictation could not start.");
    }
  };

  const send = () => {
    const t = text.trim();
    // Also blocked while a code run is executing: a text turn in flight when the run
    // resolves would collide with the run's mentor review.
    if (!t || sending || running) return;
    const isDictated = dictationUsed;
    onSendText(t, {
      inputModality: isDictated ? "dictated" : "typed",
      transcriptConfidence: isDictated ? dictationConfidence : null,
    });
    if (isDictated) {
      emitVoiceEvent({
        event_type: "dictation_submitted",
        input_modality: "dictated",
        transcript: t,
        transcript_confidence: dictationConfidence,
        duration_seconds: dictationStartedAtRef.current
          ? Math.max(0, Math.round((Date.now() - dictationStartedAtRef.current) / 1000))
          : null,
      });
    }
    setText("");
    setDictationUsed(false);
    setDictationConfidence(null);
    setVoiceError("");
  };

  useImperativeHandle(ref, () => ({
    loadCode({ code, language }) {
      setCode(code);
      setLang(language);
      setMode("code");
      requestAnimationFrame(() => {
        morphRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    },
  }));

  const run = async () => {
    // In-flight lock: never start a run while a tutor turn is still pending. Two rapid
    // runs (e.g. a timeout then a retry) could otherwise each fire a turn whose responses
    // resolve out of order, landing a stale reply after the newer one.
    if (running || sending) return;
    setRunning(true);
    try {
      const result = onRunCode
        ? await onRunCode(code, lang)
        : lang === "python"
          ? await runPython(code)
          : await runJavaScript(code);
      onSendCodeResult(code, lang, result);
    } catch (error) {
      onSendCodeResult(code, lang, {
        ok: false,
        output: (error as Error).message || "Could not run this code.",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="w-full">
      <GradientCard className="composer-elev">
        <div ref={morphRef} className="overflow-hidden px-4 py-3">
          {mode === "text" ? (
            <div ref={textPanelRef} className="space-y-2">
              <div className="flex items-end gap-2">
                <Popover
                  open={plusOpen}
                  onClose={() => setPlusOpen(false)}
                  placement="top-start"
                  panelClassName="w-[184px] rounded-card border border-border bg-depth-card p-1.5 shadow-raised"
                  trigger={
                    <button
                      type="button"
                      aria-label="Add"
                      aria-expanded={plusOpen}
                      title="Add"
                      onClick={() => setPlusOpen((v) => !v)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Plus className="h-[17px] w-[17px]" strokeWidth={1.7} />
                    </button>
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      setMode("code");
                    }}
                    className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
                  >
                    <Code2 className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
                    Write code
                  </button>
                </Popover>
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (!e.target.value.trim()) {
                      setDictationUsed(false);
                      setDictationConfidence(null);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder={"Ask anything\u2026 try \u201Cshow me a for loop\u201D"}
                  className="max-h-[160px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[14.5px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
                />
                <button
                  type="button"
                  onClick={toggleDictation}
                  disabled={sending || !voiceSupported}
                  aria-label={dictating ? "Stop dictation" : "Start dictation"}
                  title={
                    voiceSupported
                      ? dictating
                        ? "Stop dictation"
                        : "Dictate answer"
                      : "Dictation is not available in this browser"
                  }
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                    dictating
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {dictating ? (
                    <MicOff className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  ) : (
                    <Mic className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  )}
                </button>
                {/* ONE primary slot, ChatGPT-style: an empty box offers talk-out-loud; typing
                    swaps it to Send. Same size and styling both ways — no layout shift. Enter on
                    empty stays a no-op (send() guards); voice starts by click/tap only. */}
                {!text.trim() && !dictating && canStartVoice && onStartVoice ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Never run two captures at once: kill any dictation session before the
                      // live voice panel takes the mic.
                      recognitionRef.current?.abort();
                      recognitionRef.current = null;
                      setDictating(false);
                      onStartVoice();
                    }}
                    disabled={sending || running}
                    aria-label="Talk with the Mentor out loud"
                    title="Talk with the Mentor out loud"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
                  >
                    <AudioLines className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  </button>
                ) : (
                  <button
                    onClick={send}
                    disabled={sending || !text.trim()}
                    aria-label="Send"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
                  >
                    <Send className="h-[14px] w-[14px]" strokeWidth={1.8} />
                  </button>
                )}
              </div>
              {dictating || voiceError || dictationConfidence !== null ? (
                <div className="px-10 text-[11.5px] text-muted-foreground">
                  {dictating
                    ? "Listening... your words will stay editable before sending."
                    : voiceError ||
                      (dictationConfidence !== null ? "Dictated answer ready to edit." : "")}
                </div>
              ) : null}
            </div>
          ) : (
            <div ref={codePanelRef}>
              <div className="mb-2 flex items-center gap-2">
                <LangToggle lang={lang} onChange={setLang} />
                <span className="text-[11.5px] text-muted-foreground">
                  {lang === "jargon"
                    ? running
                      ? "Running Jargon\u2026"
                      : "Jargon runs on the live classroom engine."
                    : lang === "python"
                      ? running
                        ? "Booting Python\u2026"
                        : "Python runs in your browser via Pyodide."
                      : "JavaScript runs in a sandbox."}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    aria-label="Close editor"
                    onClick={() => setMode("text")}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-[14px] w-[14px]" strokeWidth={1.8} />
                  </button>
                  <button
                    onClick={run}
                    disabled={running || sending}
                    className={`flex min-h-8 min-w-[58px] items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-opacity disabled:opacity-100 ${
                      running ? "bg-transparent text-foreground" : "bg-foreground text-background"
                    } ${sending && !running ? "opacity-50" : ""}`}
                  >
                    {running ? (
                      <span aria-label="Running" className="run-bounce-loader">
                        <span className="run-bounce-dot" />
                        <span className="run-bounce-dot" />
                        <span className="run-bounce-dot" />
                      </span>
                    ) : (
                      <>
                        <Play className="h-[12px] w-[12px]" strokeWidth={2} /> Run
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize editor"
                title="Drag to resize"
                onPointerDown={onHandlePointerDown}
                className="group mb-1 flex h-2.5 cursor-ns-resize items-center justify-center touch-none select-none"
              >
                <div className="h-[3px] w-10 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/60" />
              </div>
              <div
                className="overflow-hidden rounded-lg border border-border bg-muted/40"
                style={{
                  height: editorHeight,
                  transition: dragging ? "none" : "height 140ms ease-out",
                }}
              >
                <Suspense
                  fallback={
                    <div className="px-3 py-6 text-[12px] text-muted-foreground">
                      Loading editor\u2026
                    </div>
                  }
                >
                  <MonacoEditor
                    height="100%"
                    language={lang === "jargon" ? JARGON_LANGUAGE_ID : lang}
                    value={code}
                    onChange={(v) => setCode(v ?? "")}
                    theme={resolved === "dark" ? JARGON_DARK_THEME : JARGON_LIGHT_THEME}
                    onMount={handleMonacoMount}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      lineNumbers: "off",
                      scrollBeyondLastLine: false,
                      padding: { top: 12, bottom: 12 },
                      renderLineHighlight: "none",
                      overviewRulerLanes: 0,
                      scrollbar: { vertical: "auto", horizontal: "hidden" },
                    }}
                  />
                </Suspense>
              </div>
            </div>
          )}
        </div>
      </GradientCard>
    </div>
  );
});

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const langs: Lang[] = ["jargon", "javascript", "python"];
  const rowRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const idx = langs.indexOf(lang);
    const btn = btnRefs.current[idx];
    if (!btn) return;
    gsap.to(pill, {
      x: btn.offsetLeft,
      width: btn.offsetWidth,
      duration: 0.32,
      ease: "power3.out",
    });
  }, [lang]);

  return (
    <div
      ref={rowRef}
      className="relative flex rounded-full border border-border p-[2px] text-[11.5px]"
    >
      <div
        ref={pillRef}
        aria-hidden
        className="absolute left-0 top-[2px] h-[calc(100%-4px)] rounded-full bg-foreground"
        style={{ width: 0 }}
      />
      {langs.map((l, i) => {
        const active = lang === l;
        return (
          <button
            key={l}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            onClick={() => onChange(l)}
            className={`relative z-10 rounded-full px-2.5 py-[3px] transition-colors ${
              active ? "text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {l === "jargon" ? "Jargon" : l === "javascript" ? "JS" : "Py"}
          </button>
        );
      })}
    </div>
  );
}
