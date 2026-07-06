import { Suspense, lazy } from "react";
import { useTheme } from "@/lib/theme";

// A lightweight Monaco code field for forms (assignment submissions, quiz code answers), so
// students get ONE code-editing experience instead of plain <textarea>s beside the chat's full
// editor. Deliberately minimal: no language services wiring — monospace, line numbers, indent,
// bracket matching. The chat Composer keeps its richer Jargon-aware setup.

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.default })),
);

export function CodeArea({
  value,
  onChange,
  height = 160,
  readOnly = false,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const { resolved } = useTheme();
  const fallback = (
    <textarea
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={{ height, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      className="w-full bg-transparent px-3 py-2 text-[12.5px] leading-relaxed text-[var(--code-foreground)] outline-none placeholder:text-muted-foreground"
    />
  );
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-[var(--code-background)]">
      <Suspense fallback={fallback}>
        <MonacoEditor
          height={height}
          theme={resolved === "dark" ? "vs-dark" : "light"}
          value={value}
          onChange={(next) => onChange(next ?? "")}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
            padding: { top: 10, bottom: 10 },
            overviewRulerLanes: 0,
            renderLineHighlight: "none",
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          }}
        />
      </Suspense>
    </div>
  );
}
