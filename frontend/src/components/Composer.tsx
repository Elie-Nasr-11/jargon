import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Code2, MessageSquareText, Play, Send } from "lucide-react";
import { runJavaScript, runPython } from "@/lib/code-runner";
import type {
  CodeExecutionResult,
  JargonRunResponse,
  TypedChatAnswer,
} from "@/lib/types";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((module) => ({ default: module.default })),
);

export type ComposerLanguage = "jargon" | "javascript" | "python";

type ComposerProps = {
  responseMode: "text" | "code" | "multiple_choice" | "file";
  starterCode: string;
  starterLanguage: ComposerLanguage;
  prompt?: string;
  choices: Array<{ id?: string; label?: string; text?: string; value?: string }>;
  sending: boolean;
  onSendText: (text: string) => Promise<void> | void;
  onSendChoice: (choiceId: string, label: string) => Promise<void> | void;
  onSubmitCode: (answer: TypedChatAnswer) => Promise<void> | void;
  onRunJargon: (code: string, answers: string[]) => Promise<JargonRunResponse>;
};

function stringifyRunResult(result: CodeExecutionResult | null) {
  if (!result) return "";
  return result.output || "(no output)";
}

function toRunPayload(result: CodeExecutionResult | null) {
  if (!result) return null;
  if (result.language === "jargon") return result.raw;
  return {
    language: result.language,
    ok: result.ok,
    output: result.output,
  };
}

function resultMeta(result: CodeExecutionResult | null) {
  if (!result) return "";
  if (result.language === "jargon") {
    return `${result.raw.status} • Jargon`;
  }
  return `${result.ok ? "ok" : "error"} • ${result.language === "python" ? "Python" : "JavaScript"}`;
}

export function Composer({
  responseMode,
  starterCode,
  starterLanguage,
  prompt,
  choices,
  sending,
  onSendText,
  onSendChoice,
  onSubmitCode,
  onRunJargon,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<ComposerLanguage>(starterLanguage);
  const [code, setCode] = useState(starterCode);
  const [running, setRunning] = useState(false);
  const [manualCodeOpen, setManualCodeOpen] = useState(responseMode === "code");
  const [runResult, setRunResult] = useState<CodeExecutionResult | null>(null);
  const [askValue, setAskValue] = useState("");
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const pendingAnswersRef = useRef<string[]>([]);

  useEffect(() => {
    setLanguage(starterLanguage);
    setCode(starterCode);
    setRunResult(null);
    setPendingAsk(null);
    setAskValue("");
    pendingAnswersRef.current = [];
    setManualCodeOpen(responseMode === "code");
  }, [starterCode, starterLanguage, responseMode]);

  const effectiveMode = useMemo(() => {
    if (responseMode === "multiple_choice") return "multiple_choice";
    if (responseMode === "file") return "file";
    if (responseMode === "code" || manualCodeOpen) return "code";
    return "text";
  }, [manualCodeOpen, responseMode]);

  const submitText = async () => {
    const value = text.trim();
    if (!value || sending) return;
    await onSendText(value);
    setText("");
  };

  const runCode = async (answers: string[] = pendingAnswersRef.current) => {
    setRunning(true);
    try {
      if (language === "jargon") {
        const raw = await onRunJargon(code, answers);
        const output = [...(raw.output || []), ...(raw.errors || []).map((item) => `[ERROR] ${item}`)]
          .join("\n")
          .trim();
        setRunResult({
          language: "jargon",
          ok: raw.status === "ok" || raw.status === "waiting_for_input",
          output,
          raw,
        });
        if (raw.status === "waiting_for_input" && raw.ask) {
          setPendingAsk(raw.ask);
        } else {
          setPendingAsk(null);
        }
      } else if (language === "python") {
        setRunResult(await runPython(code));
        setPendingAsk(null);
      } else {
        setRunResult(await runJavaScript(code));
        setPendingAsk(null);
      }
    } finally {
      setRunning(false);
    }
  };

  const continueAsk = async () => {
    const next = askValue.trim();
    if (!next) return;
    pendingAnswersRef.current = [...pendingAnswersRef.current, next];
    setAskValue("");
    await runCode(pendingAnswersRef.current);
  };

  const submitCode = async () => {
    await onSubmitCode({
      mode: "code",
      code,
      run_result: {
        language,
        ...(toRunPayload(runResult) || {}),
      },
    });
  };

  return (
    <div className="composer-shell">
      <div className="composer-inner">
        <div className="composer-topline">
          <div>
            <div className="composer-label">Active answer</div>
            <div className="composer-hint">{prompt || "Stay with the current lesson and respond step by step."}</div>
          </div>
          {effectiveMode === "text" && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => setManualCodeOpen(true)}
            >
              <Code2 size={15} /> Open editor
            </button>
          )}
          {effectiveMode === "code" && responseMode !== "code" && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => setManualCodeOpen(false)}
            >
              <MessageSquareText size={15} /> Text mode
            </button>
          )}
        </div>

        {effectiveMode === "multiple_choice" && (
          <div className="choice-grid">
            {choices.map((choice, index) => {
              const label = choice.label || choice.text || choice.value || `Choice ${index + 1}`;
              const id = choice.id || choice.value || label;
              return (
                <button
                  key={`${id}-${index}`}
                  type="button"
                  className="choice-button"
                  onClick={() => onSendChoice(id, label)}
                  disabled={sending}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {effectiveMode === "file" && (
          <div className="detail-block">
            <div className="detail-kicker">File mode</div>
            <div className="detail-value">
              File uploads stay deferred in v1. Use the lesson chat or code surface for now.
            </div>
          </div>
        )}

        {effectiveMode === "text" && (
          <>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submitText();
                }
              }}
              className="composer-textarea"
              placeholder="Reply to your mentor here…"
            />
            <div className="split-actions" style={{ marginTop: "12px" }}>
              <button
                type="button"
                className="primary-button"
                onClick={() => void submitText()}
                disabled={sending || !text.trim()}
              >
                <Send size={15} /> Submit
              </button>
            </div>
          </>
        )}

        {effectiveMode === "code" && (
          <>
            <div className="composer-inline">
              <div className="lang-toggle">
                {(["jargon", "javascript", "python"] as ComposerLanguage[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`lang-pill ${language === value ? "active" : ""}`}
                    onClick={() => setLanguage(value)}
                  >
                    {value === "javascript" ? "JavaScript" : value === "python" ? "Python" : "Jargon"}
                  </button>
                ))}
              </div>
              <div className="composer-hint">
                {language === "jargon"
                  ? "Runs through the live Jargon engine."
                  : language === "python"
                    ? "Runs locally in-browser via Pyodide."
                    : "Runs locally in a sandboxed iframe."}
              </div>
            </div>

            <div className="editor-host">
              <Suspense fallback={<div style={{ padding: 16 }}>Loading editor…</div>}>
                <MonacoEditor
                  height="280px"
                  language={language === "jargon" ? "python" : language}
                  value={code}
                  onChange={(value) => setCode(value ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "off",
                    scrollBeyondLastLine: false,
                    padding: { top: 14, bottom: 14 },
                  }}
                  theme="vs-dark"
                />
              </Suspense>
            </div>

            <div className="split-actions" style={{ marginTop: "12px" }}>
              <button
                type="button"
                className="glass-button"
                onClick={() => void runCode()}
                disabled={running}
              >
                <Play size={15} /> {running ? "Running…" : "Run"}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void submitCode()}
                disabled={sending || !code.trim()}
              >
                <Send size={15} /> Submit
              </button>
            </div>

            {runResult && (
              <div className="run-output">
                <div className="composer-label" style={{ marginBottom: "8px" }}>
                  {resultMeta(runResult)}
                </div>
                <pre>{stringifyRunResult(runResult)}</pre>
              </div>
            )}

            {pendingAsk && (
              <div className="ask-box">
                <div className="composer-label">Jargon input requested</div>
                <div className="composer-hint">{pendingAsk}</div>
                <input
                  className="ask-input"
                  value={askValue}
                  onChange={(event) => setAskValue(event.target.value)}
                  placeholder="Type the answer the program is asking for"
                />
                <div className="split-actions">
                  <button
                    type="button"
                    className="glass-button"
                    onClick={() => void continueAsk()}
                    disabled={!askValue.trim() || running}
                  >
                    Continue run
                  </button>
                </div>
              </div>
            )}

            <div className="utility-note">
              Submitting code sends the source and latest run result to the lesson mentor.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
