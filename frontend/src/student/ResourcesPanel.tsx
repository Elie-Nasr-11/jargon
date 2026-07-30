import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchLessonResources } from "@/lib/api";
import { ResourceCard } from "@/student/ResourceCard";
import type { LessonChatResource } from "@/lib/types";

// The Resources destination: the current lesson's published materials. Two sources, merged:
//   * the lesson's full published catalog (fetchLessonResources — RLS-gated direct read), and
//   * anything the mentor attached THIS session (envelope resources, passed down), which may
//     carry a fresher signed_url.
// Session copies win on id collision so an already-signed URL is preferred over lazy signing.
//
// Every card is a ResourceCard, so the signed-url-only invariant and shown/opened telemetry
// hold here exactly as they do in the transcript.

export type ResourcesPanelProps = {
  lessonId: string | null;
  sessionId: string | null;
  sessionResources: LessonChatResource[];
};

export function ResourcesPanel({ lessonId, sessionId, sessionResources }: ResourcesPanelProps) {
  const [catalog, setCatalog] = useState<LessonChatResource[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!lessonId) {
      setCatalog([]);
      return;
    }
    setCatalog(null);
    void fetchLessonResources(lessonId)
      .then((rows) => !cancelled && setCatalog(rows))
      .catch(() => {
        if (!cancelled) {
          setCatalog([]);
          setError("Couldn't load this lesson's materials.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const merged = useMemo(() => {
    const byId = new Map<string, LessonChatResource>();
    for (const resource of catalog ?? []) byId.set(resource.id, resource);
    for (const resource of sessionResources) byId.set(resource.id, resource);
    return Array.from(byId.values());
  }, [catalog, sessionResources]);

  if (catalog === null) {
    return (
      <p className="flex items-center gap-2 text-body text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading materials…
      </p>
    );
  }
  if (!merged.length) {
    return (
      <p className="rounded-card border border-dashed border-border bg-depth-sub p-6 text-body text-muted-foreground">
        {error || "Materials your teacher shares appear here as you reach them in the lesson."}
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      {error ? <p className="text-meta text-danger">{error}</p> : null}
      {merged.map((resource) => (
        <ResourceCard
          key={resource.id}
          resource={resource}
          lessonId={lessonId}
          sessionId={sessionId}
        />
      ))}
    </div>
  );
}
