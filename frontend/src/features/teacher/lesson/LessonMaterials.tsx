/**
 * Section 4 of 4: the material this lesson teaches from, ranked.
 *
 * Closest first: what a step actually shows a student, then what is on the
 * lesson, then what came out of the book — that last group collapsed, because it
 * is usually large, rarely edited, and only looked at to check the import.
 */
import { useEffect, useState } from "react";
import { BookOpen, Paperclip, Plus } from "lucide-react";
import { Collapsible } from "@/components/Collapsible";
import { getSession, listLessonKnowledge } from "@/lib/api";
import type { KnowledgeFigureRow, LessonActivity, LessonResource } from "@/lib/types";

export function LessonMaterials({
  lessonId,
  materials,
  steps,
  bookLabel,
  busy,
  onAdd,
  onOpen,
}: {
  lessonId: string;
  materials: LessonResource[];
  steps: LessonActivity[];
  bookLabel: string;
  busy: boolean;
  onAdd: () => void;
  onOpen: (resourceId: string) => void;
}) {
  const stepNumber = new Map(steps.map((step, index) => [step.id, index + 1]));
  const onStep = materials.filter((material) => material.activity_id);
  const onLesson = materials.filter((material) => !material.activity_id);

  return (
    <section className="rounded-card border border-border bg-depth-card p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title font-medium text-foreground">Material</h2>
        <button type="button" onClick={onAdd} disabled={busy} className="btn btn-secondary btn-sm">
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Add material
        </button>
      </div>

      {materials.length === 0 ? (
        <p className="text-meta text-muted-foreground">
          Nothing attached. Anything you add here can be shown by a step, and the assistant
          reads it when it drafts.
        </p>
      ) : (
        <div className="grid gap-1.5">
          {onStep.map((material) => (
            <MaterialRow
              key={material.id}
              material={material}
              where={`on step ${stepNumber.get(String(material.activity_id)) ?? "?"}`}
              onOpen={onOpen}
            />
          ))}
          {onLesson.map((material) => (
            <MaterialRow
              key={material.id}
              material={material}
              where="on this lesson"
              onOpen={onOpen}
            />
          ))}
        </div>
      )}

      {bookLabel ? <BookFigures lessonId={lessonId} bookLabel={bookLabel} /> : null}
    </section>
  );
}

function MaterialRow({
  material,
  where,
  onOpen,
}: {
  material: LessonResource;
  where: string;
  onOpen: (resourceId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(material.id)}
      className="flex items-center gap-2.5 rounded-control border border-border bg-depth-sub px-3 py-2 text-left transition-colors hover:border-primary"
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
      <span className="min-w-0 flex-1 truncate text-meta text-foreground">{material.title}</span>
      <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
        {where}
      </span>
    </button>
  );
}

/** The pages the importer cropped. Loaded only when a teacher opens the group. */
function BookFigures({ lessonId, bookLabel }: { lessonId: string; bookLabel: string }) {
  const [open, setOpen] = useState(false);
  const [figures, setFigures] = useState<KnowledgeFigureRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || figures) return;
    void (async () => {
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to read this lesson's figures.");
        const result = await listLessonKnowledge({
          accessToken: session.access_token,
          lessonId,
        });
        setFigures(result.figures || []);
      } catch (err) {
        setError((err as Error).message || "Could not read the book figures.");
      }
    })();
  }, [open, figures, lessonId]);

  return (
    <div className="mt-3 border-t border-border/60 pt-2">
      <Collapsible
        open={open}
        onToggle={() => setOpen((value) => !value)}
        title={
          <span className="flex items-center gap-1.5 text-body text-foreground">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.7} />
            From the book
          </span>
        }
        meta={<span className="shrink-0 text-meta text-muted-foreground">{bookLabel}</span>}
        headerClassName="rounded-control px-1.5 py-2 transition-colors hover:bg-muted/60"
        bodyClassName="pt-2"
      >
        {error ? <p className="text-meta text-danger">{error}</p> : null}
        {!figures && !error ? (
          <p className="text-meta text-muted-foreground">Reading the book…</p>
        ) : null}
        {figures?.length === 0 ? (
          <p className="text-meta text-muted-foreground">
            No figures were cropped from these pages.
          </p>
        ) : null}
        {figures?.length ? (
          <div className="grid gap-1.5">
            {figures.map((figure) => (
              <div
                key={figure.id}
                className="flex items-center gap-2.5 rounded-control border border-border bg-depth-sub px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                  {figure.title}
                </span>
                <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                  {figure.status}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Collapsible>
    </div>
  );
}
