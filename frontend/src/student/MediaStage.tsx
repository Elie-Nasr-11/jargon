import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2, Maximize2, MessageCircle, Minus, PanelBottom, X } from "lucide-react";
import { recordResourceInteraction } from "@/lib/api";
import { parseArtifactConfig } from "@/lib/artifact-schema";
import { getLessonResourceSignedUrl } from "@/lib/api";
import { ArtifactFrame } from "@/components/ArtifactFrame";
import { DeckRenderer } from "@/components/DeckRenderer";
import { store } from "@/lib/jargon-store";
import { mediaProgress, resolveResourceUrl, type ResourceEventType } from "@/student/resourceMedia";
import { useConversationChannel } from "@/student/useConversation";
import type { LessonChatResource } from "@/lib/types";

// The MEDIA STAGE: any resource can leave its inline card and take over part of the main
// area — HALF (media on top, the conversation keeps the bottom half) or FULL (media fills
// the main area; the conversation docks bottom-right as a collapsible widget). The stage
// lives INSIDE <main>, so the sidebar is never covered.
//
// State is a context so any ResourceCard (transcript or Resources panel) can raise the
// stage without prop-threading through the shell. The security posture is unchanged:
// uploads sign lazily at open, artifacts render only through ArtifactFrame/DeckRenderer
// (never a navigable URL), and the same telemetry events fire.

export type MediaStageMode = "half" | "full";
export type MediaStageState = { resource: LessonChatResource; mode: MediaStageMode };

type MediaStageValue = {
  stage: MediaStageState | null;
  open: (resource: LessonChatResource, mode: MediaStageMode) => void;
  setMode: (mode: MediaStageMode) => void;
  close: () => void;
};

const MediaStageContext = createContext<MediaStageValue | null>(null);

// The shell owns the stage (it drives the main-area layout) and provides the same value to
// every ResourceCard below it via MediaStageScope.
export function useMediaStageController(): MediaStageValue {
  const [stage, setStage] = useState<MediaStageState | null>(null);
  return useMemo<MediaStageValue>(
    () => ({
      stage,
      open: (resource, mode) => setStage({ resource, mode }),
      setMode: (mode) => setStage((s) => (s ? { ...s, mode } : s)),
      close: () => setStage(null),
    }),
    [stage],
  );
}

export function MediaStageScope({
  value,
  children,
}: {
  value: MediaStageValue;
  children: ReactNode;
}) {
  return <MediaStageContext.Provider value={value}>{children}</MediaStageContext.Provider>;
}

export function useMediaStage(): MediaStageValue | null {
  return useContext(MediaStageContext);
}

// The kinds the stage can render. Everything else keeps its card-only behavior.
export function isStageable(resource: LessonChatResource): boolean {
  return (
    ["pdf", "youtube", "video", "audio", "image"].includes(resource.resource_type) ||
    (resource.resource_type === "artifact" && !!parseArtifactConfig(resource.artifact))
  );
}

export function MediaStageViewer({
  stage,
  onMode,
  onClose,
}: {
  stage: MediaStageState;
  onMode: (mode: MediaStageMode) => void;
  onClose: () => void;
}) {
  const { resource, mode } = stage;
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const channel = useConversationChannel();
  const voice = store.getVoice();

  const track = (event_type: ResourceEventType, progress?: Record<string, number>) => {
    void recordResourceInteraction({
      resource_id: resource.id,
      lesson_id: channel.lessonId ?? null,
      session_id: channel.sessionId ?? null,
      event_type,
      ...progress,
    }).catch(() => {});
  };
  const trackRef = useRef(track);
  trackRef.current = track;

  const artifact = useMemo(
    () => (resource.resource_type === "artifact" ? parseArtifactConfig(resource.artifact) : null),
    [resource],
  );

  // Resolve on mount / resource change. Artifacts skip this — their document is fetched as
  // TEXT by ArtifactFrame or rendered natively by DeckRenderer.
  useEffect(() => {
    let cancelled = false;
    setUrl("");
    setFailed(false);
    trackRef.current("opened");
    if (resource.resource_type === "artifact") return;
    void resolveResourceUrl(resource)
      .then((resolved) => {
        if (cancelled) return;
        if (resolved) setUrl(resolved);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [resource]);

  // ESC closes the stage — the fastest way back to the conversation.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canReadDeckAloud = Boolean(channel.accessToken && channel.lessonId);

  return (
    <section
      aria-label={`${resource.title} — expanded media`}
      className={`flex min-h-0 flex-col border-b border-border bg-background ${
        mode === "half" ? "h-1/2 shrink-0" : "min-h-0 flex-1"
      }`}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
          {resource.title}
        </span>
        <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
          {resource.resource_type === "artifact" ? "activity" : resource.resource_type}
        </span>
        <button
          type="button"
          onClick={() => onMode("half")}
          aria-label="Half screen"
          aria-pressed={mode === "half"}
          className={`flex h-7 w-7 items-center justify-center rounded-control transition-colors duration-(--dur-fast) ${
            mode === "half"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <PanelBottom className="h-[14px] w-[14px]" strokeWidth={1.7} />
        </button>
        <button
          type="button"
          onClick={() => onMode("full")}
          aria-label="Full screen"
          aria-pressed={mode === "full"}
          className={`flex h-7 w-7 items-center justify-center rounded-control transition-colors duration-(--dur-fast) ${
            mode === "full"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Maximize2 className="h-[14px] w-[14px]" strokeWidth={1.7} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close media"
          className="flex h-7 w-7 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
        >
          <X className="h-[15px] w-[15px]" strokeWidth={1.7} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-code-background">
        {resource.resource_type === "artifact" ? (
          <div className="mx-auto w-full max-w-4xl p-4">
            {artifact?.kind === "html_sim" ? (
              <ArtifactFrame
                title={resource.title}
                artifact={artifact}
                fetchHtml={async () => {
                  track("opened");
                  const signed = await getLessonResourceSignedUrl({
                    source_type: "upload",
                    storage_bucket: resource.storage_bucket ?? null,
                    storage_path: resource.storage_path ?? null,
                  });
                  if (!signed) throw new Error("Artifact URL is missing.");
                  const response = await fetch(signed);
                  if (!response.ok) throw new Error("Artifact fetch failed.");
                  return response.text();
                }}
                onTelemetry={(event) => track(event)}
              />
            ) : artifact?.kind === "deck" && artifact.deck ? (
              <DeckRenderer
                deck={artifact.deck}
                title={resource.title}
                voice={voice}
                accessToken={channel.accessToken}
                lessonId={channel.lessonId ?? ""}
                sessionId={channel.sessionId}
                onVoiceEvent={channel.voiceEvent}
                readAloud={canReadDeckAloud}
                onCompleted={() => track("completed", { progress_percent: 100 })}
              />
            ) : (
              <p className="p-4 text-body text-muted-foreground">
                This activity isn&rsquo;t available right now.
              </p>
            )}
          </div>
        ) : failed ? (
          <p className="p-4 text-body text-muted-foreground">
            This material couldn&rsquo;t be opened. It may have been removed.
          </p>
        ) : !url ? (
          <p className="flex items-center gap-2 p-4 text-body text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening…
          </p>
        ) : resource.resource_type === "pdf" || resource.resource_type === "youtube" ? (
          <iframe
            title={resource.title}
            src={url}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : resource.resource_type === "video" ? (
          <video
            src={url}
            className="h-full w-full object-contain"
            controls
            autoPlay
            onPlay={(event) => track("played", mediaProgress(event.currentTarget))}
            onPause={(event) => track("paused", mediaProgress(event.currentTarget))}
            onEnded={(event) => track("completed", mediaProgress(event.currentTarget))}
          />
        ) : resource.resource_type === "audio" ? (
          <div className="flex h-full items-center justify-center p-6">
            <audio
              src={url}
              className="w-full max-w-xl"
              controls
              onPlay={(event) => track("played", mediaProgress(event.currentTarget))}
              onPause={(event) => track("paused", mediaProgress(event.currentTarget))}
              onEnded={(event) => track("completed", mediaProgress(event.currentTarget))}
            />
          </div>
        ) : resource.resource_type === "image" ? (
          <img src={url} alt={resource.title} className="h-full w-full object-contain" />
        ) : null}
      </div>
    </section>
  );
}

// The conversation's dock while media is full screen: a bottom-right panel that collapses to
// a single round icon. The chat stays fully usable — this is a window onto the same
// conversation, not a second one.
export function ChatDock({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Open the conversation"
        className="absolute bottom-4 right-4 z-[var(--z-header)] flex h-11 w-11 items-center justify-center rounded-full border border-border bg-foreground text-background transition-transform duration-(--dur-fast) hover:scale-105"
      >
        <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.7} />
      </button>
    );
  }

  return (
    <div
      role="complementary"
      aria-label="Conversation"
      className="absolute bottom-4 right-4 z-[var(--z-header)] flex h-[480px] max-h-[calc(100%-2rem)] w-[420px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-card border border-border bg-background"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-meta font-medium text-foreground">Conversation</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Minimize the conversation"
          className="flex h-6 w-6 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
        >
          <Minus className="h-[14px] w-[14px]" strokeWidth={1.8} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
