import { ExternalLink, FileText, Film, Image, Link2, Music, type LucideIcon } from "lucide-react";
import type { LessonChatResource } from "@/lib/types";

// A material the mentor attached to this turn, rendered inline in the transcript.
//
// Without this the mentor can say "have a look at this" and nothing appears — the resource would
// only be reachable from the Resources panel, which is not where the student is looking.
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

export function ResourceCard({ resource }: { resource: LessonChatResource }) {
  const Icon = ICONS[resource.resource_type] ?? FileText;
  // The envelope signs uploads server-side; links carry their own URL. An artifact has neither
  // here, so it simply gets no Open action.
  const href =
    resource.resource_type === "artifact" ? null : resource.signed_url || resource.external_url;

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
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-control border border-border px-2 py-1 text-meta text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} /> Open
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
