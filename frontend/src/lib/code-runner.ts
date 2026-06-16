// Sandboxed in-browser code execution.

export type RunResult = { ok: boolean; output: string };

export async function runJavaScript(code: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.style.display = "none";
    const token = Math.random().toString(36).slice(2);
    const src = `
      <script>
        const logs = [];
        const fmt = (v) => {
          try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); }
          catch { return String(v); }
        };
        ['log','warn','error','info'].forEach(k => {
          const orig = console[k];
          console[k] = (...args) => { logs.push(args.map(fmt).join(' ')); orig && orig(...args); };
        });
        let err = null;
        try {
          const result = (function(){ ${code}\n })();
          if (result !== undefined) logs.push(fmt(result));
        } catch (e) { err = String(e && e.stack || e); }
        parent.postMessage({ token: '${token}', output: logs.join('\\n'), err }, '*');
      </script>
    `;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { token?: string; output?: string; err?: string | null };
      if (!d || d.token !== token) return;
      window.removeEventListener("message", onMsg);
      iframe.remove();
      resolve({
        ok: !d.err,
        output: (d.err ? d.err + "\n" : "") + (d.output ?? ""),
      });
    };
    window.addEventListener("message", onMsg);
    document.body.appendChild(iframe);
    iframe.srcdoc = src;
    setTimeout(() => {
      window.removeEventListener("message", onMsg);
      iframe.remove();
      resolve({ ok: false, output: "Timed out after 5s" });
    }, 5000);
  });
}

type PyodideRuntime = {
  setStdout: (options: { batched: (text: string) => void }) => void;
  setStderr: (options: { batched: (text: string) => void }) => void;
  runPythonAsync: (code: string) => Promise<unknown>;
};

let pyodidePromise: Promise<PyodideRuntime> | null = null;
async function loadPyodide(): Promise<PyodideRuntime> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-pyodide]");
    const init = () => {
      const w = window as unknown as {
        loadPyodide: (o: { indexURL: string }) => Promise<PyodideRuntime>;
      };
      w.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" })
        .then(resolve)
        .catch(reject);
    };
    if (existing) {
      init();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
    s.dataset.pyodide = "true";
    s.onload = init;
    s.onerror = () => reject(new Error("Failed to load Pyodide"));
    document.head.appendChild(s);
  });
  return pyodidePromise;
}

export async function runPython(code: string): Promise<RunResult> {
  try {
    const py = await loadPyodide();
    let stdout = "";
    py.setStdout({ batched: (s: string) => (stdout += s + "\n") });
    py.setStderr({ batched: (s: string) => (stdout += s + "\n") });
    const result = await py.runPythonAsync(code);
    if (result !== undefined && result !== null) stdout += String(result);
    return { ok: true, output: stdout.trimEnd() };
  } catch (e) {
    return { ok: false, output: String((e as Error).message ?? e) };
  }
}
