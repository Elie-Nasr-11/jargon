import { useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  Music,
  Play,
  type LucideIcon,
} from "lucide-react";
import { getLessonResourceSignedUrl, recordResourceInteraction } from "@/lib/api";
import { parseArtifactConfig } from "@/lib/artifact-schema";
import { ArtifactFrame } from "@/components/ArtifactFrame";
import { DeckRenderer } from "@/components/DeckRenderer";
import { store } from "@/lib/jargon-store";
import { useConversationChannel } from "@/student/useConversation";
import type { LessonChatResource } from "@/lib/types";

// The universal renderer for a material the mentor or a teacher attached (DESIGN_V6 §5) —
// the SAME component renders inline in the transcript and in the Resources destination, so
// the security and telemetry invariants hold in both places by construction.
//
// The media table, with the old surface's hard-won invariants intact:
//   pdf                → inline iframe via a SIGNED URL (signed-url only — never a public path)
//   youtube            → youtube-nocookie.com/embed iframe (the nocookie rewrite)
//   video / audio      → native elements with played/paused/completed telemetry incl.
//                        progress_seconds/progress_percent
//   image              → inline img
//   artifact html_sim  → ArtifactFrame (poster→Run gate; sandbox="allow-scripts" ONLY;
//                        srcdoc from a TEXT fetch — the signed URL is never a navigable link,
//                        so artifacts get NO Open action here, ever)
//   artifact deck      → DeckRenderer (native render, per-slide read-aloud, completed telemetry)
//   link/document/rest → card + window.open noopener
//
// URL policy, one invariant (signed-url only for uploads): uploads are signed LAZILY at the
// moment of open/run — never on mount (listing materials must not mint URLs nobody opens), and
// never trusted from a persisted envelope (a stored signed URL has long expired by replay, so a
// reloaded transcript re-signs and renders identically to the live turn).
//
// Telemetry: every card fires recordResourceInteraction — `shown` once on mount, then one event
// per interaction — feeding the mentor's "don't claim they watched it" honesty rule.
// Fire-and-forget: a telemetry failure never blocks the student.

const ICONS: Partial<Record<string, LucideIcon>> = {
  pdf: FileText,
  document: FileText,
  video: Film,
  youtube: Film,
  audio: Music,
  image: ImageIcon,
  link: Link2,
  artifact: Play,
};

// The kinds that render inside the card when opened; everything else opens a tab.
const INLINE_KINDS = new Set(["pdf", "youtube", "video", "audio", "image"]);

// The nocookie rewrite: any recognizable YouTube URL becomes a youtube-nocookie.com embed.
// An unrecognizable URL yields "" and the card falls back to the plain open-in-tab path
// rather than framing an arbitrary page.
function youtubeEmbedUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1)
        : host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com"
          ? url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop()
          : "";
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : "";
  } catch {
    return "";
  }
}

type ResourceEventType = "shown" | "opened" | "played" | "paused" | "completed";
type ResourceProgress = { progress_seconds?: number; progress_percent?: number };

function mediaProgress(element: HTMLMediaElement): ResourceProgress {
  return {
    progress_seconds: Math.round(element.currentTime || 0),
    progress_percent:
      element.duration && Number.isFinite(element.duration)
        ? Math.min(100, Math.round((element.currentTime / element.duration) * 100))
        : undefined,
  };
}

export function ResourceCard({
  resource,
  lessonId,
  sessionId,
}: {
  resource: LessonChatResource;
  // Optional telemetry context — surfaces that know where the card lives pass them through.
  lessonId?: string | null;
  sessionId?: string | null;
}) {
  const Icon = ICONS[resource.resource_type] ?? FileText;
  const [opening, setOpening] = useState(false);
  // The inline player URL, set only after the student taps Open (lazy signing).
  const [inlineUrl, setInlineUrl] = useState("");

  // Deck read-aloud context. The channel is the app-level conversation singleton, so the same
  // card works in the transcript and in the Resources panel without new props on either.
  const channel = useConversationChannel();
  const voice = store.getVoice();

  // Artifacts carry a validated config; parse is idempotent (envelope resources arrive
  // server-sanitized, catalog/persisted reads carry raw metadata subtrees).
  const artifact = useMemo(
    () => (resource.resource_type === "artifact" ? parseArtifactConfig(resource.artifact) : null),
    [resource],
  );

  // Telemetry context in a ref so the `shown` effect keys on the resource identity alone —
  // a lessonId/sessionId identity change must not re-fire "shown" for a card already on screen.
  const ctxRef = useRef({ lessonId, sessionId });
  ctxRef.current = { lessonId, sessionId };

  const track = (event_type: ResourceEventType, progress?: ResourceProgress) => {
    void recordResourceInteraction({
      resource_id: resource.id,
      lesson_id: ctxRef.current.lessonId ?? null,
      session_id: ctxRef.current.sessionId ?? null,
      event_type,
      ...progress,
    }).catch(() => {
      // Telemetry is best-effort — never let it surface to the student.
    });
  };

  useEffect(() => {
    void recordResourceInteraction({
      resource_id: resource.id,
      lesson_id: ctxRef.current.lessonId ?? null,
      session_id: ctxRef.current.sessionId ?? null,
      event_type: "shown",
    }).catch(() => {});
  }, [resource.id]);

  const isArtifact = resource.resource_type === "artifact";
  const rendersInline = !isArtifact && INLINE_KINDS.has(resource.resource_type);

  // Resolve the URL the student is opening. Uploads sign lazily and FRESH — a signed_url
  // persisted in a turn payload has expired by replay, so it is only a fallback when signing
  // itself fails. YouTube rewrites to the nocookie embed host.
  const resolveUrl = async (): Promise<string> => {
    if (resource.resource_type === "youtube") {
      return youtubeEmbedUrl(resource.external_url || "") || resource.external_url || "";
    }
    if (
      resource.source_type === "external_url" ||
      (!resource.storage_path && resource.external_url)
    ) {
      return resource.external_url || "";
    }
    if (resource.storage_path) {
      try {
        return await getLessonResourceSignedUrl({
          source_type: "upload",
          storage_bucket: resource.storage_bucket ?? null,
          storage_path: resource.storage_path,
        });
      } catch {
        return resource.signed_url || "";
      }
    }
    return resource.signed_url || "";
  };

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const url = await resolveUrl();
      if (!url) return;
      track("opened");
      if (rendersInline) {
        setInlineUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch {
      // Resolution can fail (revoked, purged) — the button simply re-enables; the card stays.
    } finally {
      setOpening(false);
    }
  };

  // Artifacts have NO Open action: raw HTML must never open in a tab — the ArtifactFrame's
  // Run gate is the only affordance, and it consumes the document as TEXT, never as a URL.
  const canOpen =
    !isArtifact && Boolean(resource.storage_path || resource.external_url || resource.signed_url);

  const canReadDeckAloud = Boolean(channel.accessToken && channel.lessonId);

  return (
    <article className="rounded-card border border-border bg-depth-card p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-depth-sub text-muted-foreground">
          <Icon className="h-[15px] w-[15px]" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
              {resource.title}
            </span>
            <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
              {isArtifact ? "activity" : resource.resource_type}
            </span>
          </div>
          {resource.description ? (
            <p className="mt-0.5 text-meta text-muted-foreground">{resource.description}</p>
          ) : null}
          {/* The teacher's instructions are the point of attaching it, so they read as emphasis
              rather than as more grey metadata. */}
          {resource.student_instructions ? (
            <p className="mt-1.5 text-meta text-foreground">{resource.student_instructions}</p>
          ) : null}
          {canOpen && !inlineUrl ? (
            <button
              type="button"
              onClick={() => void open()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-control border border-border px-2 py-1 text-meta text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
            >
              {opening ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.7} />
              ) : rendersInline ? (
                <Play className="h-3.5 w-3.5" strokeWidth={1.7} />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              Open
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- Inline players (opened lazily; the tap IS the signing moment) ---- */}
      {inlineUrl ? (
        <div className="mt-3 overflow-hidden rounded-control border border-border bg-code-background">
          {resource.resource_type === "pdf" || resource.resource_type === "youtube" ? (
            <iframe
              title={resource.title}
              src={inlineUrl}
              className="h-[320px] w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : resource.resource_type === "video" ? (
            <video
              src={inlineUrl}
              className="max-h-[360px] w-full"
              controls
              onPlay={(event) => track("played", mediaProgress(event.currentTarget))}
              onPause={(event) => track("paused", mediaProgress(event.currentTarget))}
              onEnded={(event) => track("completed", mediaProgress(event.currentTarget))}
            />
          ) : resource.resource_type === "audio" ? (
            <audio
              src={inlineUrl}
              className="w-full p-3"
              controls
              onPlay={(event) => track("played", mediaProgress(event.currentTarget))}
              onPause={(event) => track("paused", mediaProgress(event.currentTarget))}
              onEnded={(event) => track("completed", mediaProgress(event.currentTarget))}
            />
          ) : resource.resource_type === "image" ? (
            <img
              src={inlineUrl}
              alt={resource.title}
              className="max-h-[360px] w-full object-contain"
            />
          ) : null}
        </div>
      ) : null}

      {/* ---- Artifacts (their own security posture; never the generic paths above) ---- */}
      {artifact?.kind === "html_sim" ? (
        <div className="mt-3">
          <ArtifactFrame
            title={resource.title}
            artifact={artifact}
            fetchHtml={async () => {
              // The document travels as TEXT into a sandboxed srcdoc — the signed URL is
              // consumed here and never exposed as something navigable.
              track("opened");
              const url = await getLessonResourceSignedUrl({
                source_type: "upload",
                storage_bucket: resource.storage_bucket ?? null,
                storage_path: resource.storage_path ?? null,
              });
              if (!url) throw new Error("Artifact URL is missing.");
              const response = await fetch(url);
              if (!response.ok) throw new Error("Artifact fetch failed.");
              return response.text();
            }}
            onTelemetry={(event) => track(event)}
          />
        </div>
      ) : artifact?.kind === "deck" && artifact.deck ? (
        <div className="mt-3">
          <DeckRenderer
            deck={artifact.deck}
            title={resource.title}
            voice={voice}
            accessToken={channel.accessToken}
            lessonId={channel.lessonId ?? ctxRef.current.lessonId ?? ""}
            sessionId={channel.sessionId ?? ctxRef.current.sessionId ?? null}
            onVoiceEvent={channel.voiceEvent}
            readAloud={canReadDeckAloud}
            onCompleted={() => track("completed", { progress_percent: 100 })}
          />
        </div>
      ) : isArtifact ? (
        <p className="mt-2 text-meta text-muted-foreground">
          This activity isn&rsquo;t available right now.
        </p>
      ) : null}
    </article>
  );
}
