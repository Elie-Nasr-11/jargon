import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Play, RotateCcw, ShieldAlert, Square } from "lucide-react";
import { ModalCard } from "@/components/ModalCard";
import { lintArtifactHtml } from "@/lib/artifact-lint";
import { prefersReducedMotion } from "@/lib/motion";
import type { ArtifactConfig } from "@/lib/artifact-schema";

// Artifacts v1 (P6): the sandboxed runner for teacher-authored html_sim artifacts.
// SECURITY MODEL (mirrors lib/code-runner.ts): the iframe runs with
// sandbox="allow-scripts" ONLY — never allow-same-origin — so the sim executes in an
// opaque origin with no access to the app's cookies, storage, or the Supabase session.
// The document arrives as TEXT (signed-URL fetch → srcdoc); the signed URL is never
// exposed as a navigable link. The static lint is defense-in-depth on top, not the
// boundary. Static tests pin these properties.
//
// Message protocol (child → parent only): the injected bootstrap posts
// { token, type: "ready" } on DOMContentLoaded (must arrive within 5s of render or the
// frame tears down with a Retry affordance) and { token, type: "height", height }
// (clamped 200px–70vh). Parent → child: nothing — Stop simply unmounts the iframe.

const READY_TIMEOUT_MS = 5000;
const MIN_HEIGHT = 200;

function clampHeight(value: number): number {
  const max = Math.round(window.innerHeight * 0.7);
  return Math.min(Math.max(MIN_HEIGHT, Math.round(value)), max);
}

function bootstrapFor(token: string): string {
  return (
    `<script>(function () {
  var TOKEN = ${JSON.stringify(token)};
  function send(msg) { try { parent.postMessage(Object.assign({ token: TOKEN }, msg), "*"); } catch (e) {} }
  function reportHeight() {
    var d = document.documentElement, b = document.body;
    send({ type: "height", height: Math.max(
      d ? d.scrollHeight : 0, d ? d.offsetHeight : 0,
      b ? b.scrollHeight : 0, b ? b.offsetHeight : 0) });
  }
  window.addEventListener("DOMContentLoaded", function () {
    send({ type: "ready" });
    reportHeight();
    if (typeof ResizeObserver === "function") {
      var queued = false;
      var ro = new ResizeObserver(function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; reportHeight(); });
      });
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
    } else { setInterval(reportHeight, 1000); }
  });
})();</` + `script>`
  );
}

// A leading <!doctype> must stay FIRST or the document drops into quirks mode (which
// breaks the height math) — insert the bootstrap right after it, before any sim script.
function composeSrcdoc(artifactHtml: string, bootstrap: string): string {
  const doctype = artifactHtml.match(/^\uFEFF?\s*<!doctype[^>]*>/i);
  if (doctype) {
    return (
      artifactHtml.slice(0, doctype[0].length) + bootstrap + artifactHtml.slice(doctype[0].length)
    );
  }
  return "<!DOCTYPE html>" + bootstrap + artifactHtml;
}

type FrameStatus = "poster" | "loading" | "running" | "blocked" | "failed";

export function ArtifactFrame({
  title,
  artifact,
  fetchHtml,
  onTelemetry,
  autoRun = false,
  fill = false,
}: {
  title: string;
  artifact: ArtifactConfig;
  // The caller signs the URL and fetches the document text (keeps storage concerns out).
  fetchHtml: () => Promise<string>;
  onTelemetry: (event: "played" | "paused") => void;
  // true only for the modal instance, where the user's Expand click was the gesture.
  autoRun?: boolean;
  fill?: boolean;
}) {
  const [status, setStatus] = useState<FrameStatus>(autoRun ? "loading" : "poster");
  const [doc, setDoc] = useState("");
  const [runId, setRunId] = useState(0);
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 320 : clampHeight(artifact.height_hint ?? 320),
  );
  const [expanded, setExpanded] = useState(false);
  const tokenRef = useRef("");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);

  const run = useCallback(async () => {
    onTelemetry("played");
    setStatus("loading");
    let html = "";
    try {
      html = await fetchHtml();
    } catch {
      setStatus("failed");
      return;
    }
    const lint = lintArtifactHtml(html);
    if (!lint.ok) {
      // Details go to the console for teachers/devs; students just see the safety card.
      console.warn("Artifact blocked by safety lint:", lint.violations);
      setStatus("blocked");
      return;
    }
    const token = Math.random().toString(36).slice(2);
    tokenRef.current = token;
    readyRef.current = false;
    setDoc(composeSrcdoc(html, bootstrapFor(token)));
    setRunId((id) => id + 1);
    setStatus("running");
  }, [fetchHtml, onTelemetry]);

  const stop = useCallback(() => {
    tokenRef.current = "";
    setDoc("");
    setStatus("poster");
    onTelemetry("paused");
  }, [onTelemetry]);

  // Auto-run once for the modal instance (the Expand click was the user gesture).
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRun && !autoRanRef.current) {
      autoRanRef.current = true;
      void run();
    }
  }, [autoRun, run]);

  // Handshake + height listener, scoped to the current run. The watchdog tears the
  // frame down if the sim never reports ready (broken doc, infinite pre-DCL loop).
  useEffect(() => {
    if (status !== "running") return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { token?: string; type?: string; height?: number };
      if (!data || data.token !== tokenRef.current) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (data.type === "ready") {
        readyRef.current = true;
      } else if (data.type === "height" && typeof data.height === "number" && !fill) {
        if (Number.isFinite(data.height)) setHeight(clampHeight(data.height));
      }
    };
    window.addEventListener("message", onMessage);
    const watchdog = window.setTimeout(() => {
      if (!readyRef.current) {
        tokenRef.current = "";
        setDoc("");
        setStatus("failed");
      }
    }, READY_TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(watchdog);
    };
  }, [status, runId, fill]);

  const toolbar = (
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
      <span className="min-w-0 truncate text-overline uppercase tracking-[0.08em] text-muted-foreground">
        Interactive activity
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {!fill ? (
          <button
            type="button"
            onClick={() => {
              // One running sim at a time: the modal instance takes over.
              if (status === "running" || status === "loading") stop();
              setExpanded(true);
            }}
            aria-label="Expand"
            title="Expand"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={stop}
          aria-label="Stop activity"
          title="Stop"
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Square className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border bg-depth-field ${fill ? "flex h-full min-h-0 flex-col" : ""}`}
    >
      {status === "poster" ? (
        <div className="flex flex-col items-start gap-2 p-4">
          <div className="text-title text-foreground">{title}</div>
          {artifact.poster_text ? (
            <p className="text-body leading-relaxed text-muted-foreground">
              {artifact.poster_text}
            </p>
          ) : null}
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void run()}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-depth-card px-4 py-2 text-[13px] font-medium text-foreground shadow-card transition-colors hover:bg-muted"
            >
              <Play className="h-3.5 w-3.5" strokeWidth={2} />
              Run
            </button>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              Expand
            </button>
          </div>
        </div>
      ) : null}

      {status === "loading" ? (
        <div aria-live="polite" className="p-4 text-body text-muted-foreground">
          Starting the activity…
        </div>
      ) : null}

      {status === "failed" ? (
        <div
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-3 p-4 text-body text-muted-foreground"
        >
          <span>The activity couldn't start.</span>
          <button
            type="button"
            onClick={() => void run()}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-muted"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.8} />
            Retry
          </button>
        </div>
      ) : null}

      {status === "blocked" ? (
        <div
          aria-live="polite"
          className="flex items-center gap-2.5 p-4 text-body text-muted-foreground"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.8} />
          This activity failed a safety check and can't run.
        </div>
      ) : null}

      {status === "running" ? (
        <div className={fill ? "flex min-h-0 flex-1 flex-col" : ""}>
          {toolbar}
          <iframe
            key={runId}
            ref={iframeRef}
            sandbox="allow-scripts"
            srcDoc={doc}
            title={title}
            referrerPolicy="no-referrer"
            className={`block w-full border-0 ${fill ? "min-h-0 flex-1" : ""} ${
              !fill && !prefersReducedMotion() ? "transition-[height] duration-(--dur)" : ""
            }`}
            style={fill ? undefined : { height }}
          />
        </div>
      ) : null}

      {expanded ? (
        <ModalCard
          open={expanded}
          onOpenChange={(open) => {
            if (!open) {
              setExpanded(false);
              // One running sim at a time: closing the modal returns the inline card
              // to its poster (the modal instance is torn down with the dialog).
              if (status === "running" || status === "loading") stop();
            }
          }}
          title={title}
          size="large"
        >
          {/* ModalCard's body doesn't flex-grow — give the fill frame a real height. */}
          <div className="h-[72dvh] min-h-0">
            <ArtifactFrame
              title={title}
              artifact={artifact}
              fetchHtml={fetchHtml}
              onTelemetry={onTelemetry}
              autoRun
              fill
            />
          </div>
        </ModalCard>
      ) : null}
    </div>
  );
}
