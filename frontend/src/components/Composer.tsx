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
import { Code2, Send, Play, X } from "lucide-react";
import { GradientCard } from "./GradientCard";
import { runJavaScript, runPython, type RunResult } from "@/lib/code-runner";
import {
  JARGON_COMMANDS,
  JARGON_CONDITION_PHRASES,
  JARGON_CONDITION_WORDS,
  JARGON_LANGUAGE_ID,
} from "@/lib/jargon-syntax";
import { useTheme } from "@/lib/theme";

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

export type ComposerHandle = {
  loadCode: (input: { code: string; language: ComposerLanguage }) => void;
};

type ComposerProps = {
  onSendText: (text: string) => void;
  onSendCodeResult: (code: string, lang: Lang, result: RunResult) => void;
  onRunCode?: (code: string, lang: Lang) => Promise<RunResult>;
  initialCode?: string;
  initialLanguage?: Lang;
  sending: boolean;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { onSendText, onSendCodeResult, onRunCode, initialCode, initialLanguage = "jargon", sending },
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
  const lastSeedRef = useRef<string | undefined>(initialCode);
  const morphRef = useRef<HTMLDivElement>(null);
  const textPanelRef = useRef<HTMLDivElement>(null);
  const codePanelRef = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);

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
    const bg = toHex(readVar("--surface", "#0b0b0d"), "#0b0b0d");
    const fg = toHex(readVar("--foreground", "#e6e6ea"), "#e6e6ea");
    const muted = toHex(readVar("--muted-foreground", "#8a8a90"), "#8a8a90");
    const accent = toHex(readVar("--accent", "#7c5cff"), "#7c5cff");
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
        { token: "keyword", foreground: accent.slice(1) },
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
        "editor.selectionBackground": "#ffffff20",
        "editor.inactiveSelectionBackground": "#ffffff14",
      },
    });
    monaco.editor.defineTheme(JARGON_LIGHT_THEME, {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: comment.slice(1), fontStyle: "italic" },
        { token: "keyword", foreground: accent.slice(1) },
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
      },
    });
    monaco.editor.setTheme(isDark ? JARGON_DARK_THEME : JARGON_LIGHT_THEME);
  };

  const handleMonacoMount = (_editor: unknown, monaco: typeof import("monaco-editor")) => {
    monacoRef.current = monaco;
    registerJargonLanguage(monaco);
    applyMonacoTheme(monaco);
  };

  useEffect(() => {
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

  const send = () => {
    const t = text.trim();
    if (!t || sending) return;
    onSendText(t);
    setText("");
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
      <GradientCard>
        <div ref={morphRef} className="overflow-hidden px-4 py-3">
          {mode === "text" ? (
            <div ref={textPanelRef} className="flex items-end gap-2">
              <button
                aria-label="Open code editor"
                onClick={() => setMode("code")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Code2 className="h-[16px] w-[16px]" strokeWidth={1.5} />
              </button>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
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
                onClick={send}
                disabled={sending || !text.trim()}
                aria-label="Send"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
              >
                <Send className="h-[14px] w-[14px]" strokeWidth={1.8} />
              </button>
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
                    disabled={running}
                    className={`flex min-h-8 min-w-[58px] items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-opacity disabled:opacity-100 ${
                      running ? "bg-transparent text-foreground" : "bg-foreground text-background"
                    }`}
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
