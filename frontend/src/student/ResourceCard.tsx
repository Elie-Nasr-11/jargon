import { useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  Music,
  Play,
  type LucideIcon,
} from "lucide-react";
import { getLessonResourceSignedUrl, recordResourceInteraction } from "@/lib/api";
import { parseArtifactConfig } from "@/lib/artifact-schema";
import { ArtifactFrame } from "@/components/ArtifactFrame";
import { DeckRenderer } from "@/components/DeckRenderer";
import { store } from "@/lib/jargon-store";
import { isStageable, useMediaStage } from "@/student/MediaStage";
import {
  mediaProgress,
  resolveResourceUrl,
  type ResourceEventType,
  type ResourceProgress,
} from "@/student/resourceMedia";
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

// URL resolution, the nocookie rewrite, and telemetry helpers live in resourceMedia.ts,
// shared with the MediaStage so the invariants cannot drift between the two surfaces.

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

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const url = await resolveResourceUrl(resource);
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

  // The media stage (side panel / full screen) — offered only where a provider is mounted and the
  // kind can actually stage.
  const mediaStage = useMediaStage();
  const canStage = mediaStage !== null && isStageable(resource);

  // THE CARD IS THE BUTTON. Tapping a stageable media card raises the side panel directly;
  // where no stage is mounted the tap falls back to the old open() (inline player / new tab).
  // Artifacts stay non-clickable at card level — their body is interactive (Run gate, deck
  // controls), so they keep the small expand overlay instead. Once an inline player is up,
  // the card stops being a button so its controls own every click.
  const cardClick =
    !isArtifact && !inlineUrl && (canStage || canOpen)
      ? () => {
          if (canStage) mediaStage!.open(resource, "side");
          else void open();
        }
      : null;

  return (
    <article
      onClick={cardClick ?? undefined}
      role={cardClick ? "button" : undefined}
      tabIndex={cardClick ? 0 : undefined}
      aria-label={cardClick ? `Open ${resource.title}` : undefined}
      onKeyDown={
        cardClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                cardClick();
              }
            }
          : undefined
      }
      className={`hvp rounded-card border border-border bg-depth-card p-3.5 ${
        cardClick
          ? "cursor-pointer transition-colors duration-(--dur-fast) hover:border-foreground/25"
          : ""
      }`}
    >
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
          {/* No Open button — the card itself is the action. This row is just the hover
              hint (.hvr) saying what the tap will do. */}
          {cardClick ? (
            <div className="hvr mt-2 flex items-center gap-1.5 text-meta text-muted-foreground">
              {opening ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.7} />
              ) : canStage ? (
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.7} />
              ) : rendersInline ? (
                <Play className="h-3.5 w-3.5" strokeWidth={1.7} />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              {canStage ? "Open in panel" : "Open"}
            </div>
          ) : null}
        </div>
      </div>

      {/* ---- Inline players (the no-stage fallback: opened lazily by the card tap; with a
              stage mounted the tap goes straight to the side panel and this never renders) ---- */}
      {inlineUrl ? (
        <div className="relative mt-3 overflow-hidden rounded-control border border-border bg-code-background">
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
        <div className="relative mt-3">
          {canStage ? (
            <button
              type="button"
              onClick={() => mediaStage!.open(resource, "side")}
              aria-label={`Expand ${resource.title}`}
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
            >
              <Maximize2 className="h-[13px] w-[13px]" strokeWidth={1.8} />
            </button>
          ) : null}
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
        <div className="relative mt-3">
          {canStage ? (
            <button
              type="button"
              onClick={() => mediaStage!.open(resource, "side")}
              aria-label={`Expand ${resource.title}`}
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
            >
              <Maximize2 className="h-[13px] w-[13px]" strokeWidth={1.8} />
            </button>
          ) : null}
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
