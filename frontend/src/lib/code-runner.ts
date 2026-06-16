import type { LocalRunResult } from "@/lib/types";

export async function runJavaScript(code: string): Promise<LocalRunResult> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.style.display = "none";
    const token = Math.random().toString(36).slice(2);
    const src = `
      <script>
        const logs = [];
        const fmt = (v) => {
          try { return typeof v === "string" ? v : JSON.stringify(v, null, 2); }
          catch { return String(v); }
        };
        ["log", "warn", "error", "info"].forEach((k) => {
          const original = console[k];
          console[k] = (...args) => {
            logs.push(args.map(fmt).join(" "));
            original && original(...args);
          };
        });
        let err = null;
        try {
          const result = (function(){ ${code}\n })();
          if (result !== undefined) logs.push(fmt(result));
        } catch (error) {
          err = String(error && error.stack || error);
        }
        parent.postMessage({ token: "${token}", output: logs.join("\\n"), err }, "*");
      <\/script>
    `;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        token?: string;
        output?: string;
        err?: string | null;
      };
      if (!data || data.token !== token) return;
      window.removeEventListener("message", onMessage);
      iframe.remove();
      resolve({
        language: "javascript",
        ok: !data.err,
        output: `${data.err ? `${data.err}\n` : ""}${data.output || ""}`.trim(),
      });
    };
    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
    iframe.srcdoc = src;
    window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      iframe.remove();
      resolve({
        language: "javascript",
        ok: false,
        output: "Timed out after 5s",
      });
    }, 5000);
  });
}

let pyodidePromise: Promise<any> | null = null;

async function loadPyodide(): Promise<any> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-pyodide]");
    const init = () => {
      const runtime = window as unknown as {
        loadPyodide: (options: { indexURL: string }) => Promise<unknown>;
      };
      runtime
        .loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" })
        .then(resolve)
        .catch(reject);
    };
    if (existing) {
      init();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
    script.dataset.pyodide = "true";
    script.onload = init;
    script.onerror = () => reject(new Error("Failed to load Pyodide"));
    document.head.appendChild(script);
  });
  return pyodidePromise;
}

export async function runPython(code: string): Promise<LocalRunResult> {
  try {
    const py = await loadPyodide();
    let stdout = "";
    py.setStdout({ batched: (line: string) => (stdout += `${line}\n`) });
    py.setStderr({ batched: (line: string) => (stdout += `${line}\n`) });
    const result = await py.runPythonAsync(code);
    if (result !== undefined && result !== null) stdout += String(result);
    return {
      language: "python",
      ok: true,
      output: stdout.trimEnd(),
    };
  } catch (error) {
    return {
      language: "python",
      ok: false,
      output: String((error as Error).message || error),
    };
  }
}
