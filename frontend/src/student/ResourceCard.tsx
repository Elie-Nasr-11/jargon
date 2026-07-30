import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  FileText,
  Film,
  Image,
  Link2,
  Loader2,
  Music,
  type LucideIcon,
} from "lucide-react";
import { getLessonResourceSignedUrl, recordResourceInteraction } from "@/lib/api";
import type { LessonChatResource } from "@/lib/types";

// A material the mentor or a teacher attached, rendered inline in the transcript and in the
// Resources destination.
//
// Without this the mentor can say "have a look at this" and nothing appears — the resource would
// only be reachable from the Resources panel, which is not where the student is looking.
//
// Two URL paths, one invariant (DESIGN_V6 §5: signed-url only for uploads):
//   * envelope resources arrive with signed_url already minted server-side — used as-is;
//   * direct catalog reads (fetchLessonResources) carry only a storage path — Open signs
//     lazily on click, so listing a lesson's materials never mints URLs nobody opens.
//
// Telemetry: every card fires recordResourceInteraction — `shown` once on mount, `opened` per
// open — feeding the mentor's "don't claim they watched it" honesty rule. Best-effort: a
// telemetry failure never blocks the open.
//
// Deliberately NOT handling resource_type "artifact". Interactive artifacts need the sandboxed
// ArtifactFrame and DeckRenderer, which are a separate feature with their own security posture;
// an artifact renders here as a plain card with no Open action rather than being half-shown.

const ICONS: Partial<Record<string, LucideIcon>> = {
  pdf: FileText,
  document: FileText,
  video: Film,
  audio: Music,
  image: Image,
  link: Link2,
};

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

  // Telemetry context in a ref so the `shown` effect keys on the resource identity alone —
  // a lessonId/sessionId identity change must not re-fire "shown" for a card already on screen.
  const ctxRef = useRef({ lessonId, sessionId });
  ctxRef.current = { lessonId, sessionId };

  const track = (event_type: "shown" | "opened") => {
    void recordResourceInteraction({
      resource_id: resource.id,
      lesson_id: ctxRef.current.lessonId ?? null,
      session_id: ctxRef.current.sessionId ?? null,
      event_type,
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
  // The envelope signs uploads server-side; links carry their own URL; catalog reads carry a
  // storage path we sign on demand. An artifact has none of these here, so no Open action.
  const directHref = isArtifact ? null : resource.signed_url || resource.external_url;
  const canSignLazily = !isArtifact && !directHref && Boolean(resource.storage_path);

  const openLazily = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const url = await getLessonResourceSignedUrl({
        source_type: "upload",
        storage_bucket: resource.storage_bucket ?? null,
        storage_path: resource.storage_path,
      });
      if (!url) return;
      track("opened");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // Signing can fail (revoked, purged) — the button simply re-enables; the card stays.
    } finally {
      setOpening(false);
    }
  };

  const openClass =
    "mt-2 inline-flex items-center gap-1.5 rounded-control border border-border px-2 py-1 text-meta text-foreground transition-colors duration-(--dur-fast) hover:bg-muted";

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
              {resource.resource_type}
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
          {directHref ? (
            <a
              href={directHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("opened")}
              className={openClass}
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} /> Open
            </a>
          ) : canSignLazily ? (
            <button type="button" onClick={() => void openLazily()} className={openClass}>
              {opening ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.7} />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              Open
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
