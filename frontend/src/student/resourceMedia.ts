import { getLessonResourceSignedUrl } from "@/lib/api";
import type { LessonChatResource } from "@/lib/types";

// Shared media plumbing for the two resource surfaces (the inline ResourceCard and the
// MediaStage): URL resolution, the nocookie rewrite, and telemetry helpers. One module so
// the invariants (lazy signing, nocookie-only embeds) cannot drift between them.

// Mirrors the resource_interactions event_type CHECK constraint (0009), which has
// carried "downloaded" since the foundation — the client union just never used it
// until artifact export shipped.
export type ResourceEventType =
  | "shown"
  | "opened"
  | "played"
  | "paused"
  | "completed"
  | "downloaded";
export type ResourceProgress = { progress_seconds?: number; progress_percent?: number };

// The nocookie rewrite: any recognizable YouTube URL becomes a youtube-nocookie.com embed.
// An unrecognizable URL yields "" and callers fall back to the plain open-in-tab path
// rather than framing an arbitrary page.
export function youtubeEmbedUrl(rawUrl: string): string {
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

// Resolve the URL a resource opens at. Uploads sign lazily and FRESH — a signed_url
// persisted in a turn payload has expired by replay, so it is only a fallback when signing
// itself fails. YouTube rewrites to the nocookie embed host.
export async function resolveResourceUrl(resource: LessonChatResource): Promise<string> {
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
}

export function mediaProgress(element: HTMLMediaElement): ResourceProgress {
  return {
    progress_seconds: Math.round(element.currentTime || 0),
    progress_percent:
      element.duration && Number.isFinite(element.duration)
        ? Math.min(100, Math.round((element.currentTime / element.duration) * 100))
        : undefined,
  };
}
