import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, Check, RefreshCw, Sparkles, X } from "lucide-react";
import {
  extractLessonKnowledge,
  getSession,
  listLessonKnowledge,
  reviewLessonKnowledge,
} from "@/lib/api";
import type {
  KnowledgeIdeaRow,
  KnowledgeLinkRow,
  KnowledgeFigureRow,
  KnowledgePracticeRow,
  KnowledgeVocabRow,
} from "@/lib/types";

// Brain-first Phase D (docs/BRAIN_FIRST_PLAN.md): the studio-lite Knowledge card.
// One button drafts a knowledge graph (ideas / vocab / links / practice) from the
// lesson's steps and approved resources via curriculum-admin extract_knowledge;
// each draft row is then published or discarded here. Published rows are what the
// mentor's brain reads — nothing reaches students without passing this review.

type KnowledgeKind = "idea" | "vocab" | "link" | "practice" | "figure";

type KnowledgeRows = {
  ideas: KnowledgeIdeaRow[];
  vocab: KnowledgeVocabRow[];
  links: KnowledgeLinkRow[];
  practice: KnowledgePracticeRow[];
  figures: KnowledgeFigureRow[];
};

const EMPTY_ROWS: KnowledgeRows = { ideas: [], vocab: [], links: [], practice: [], figures: [] };

async function requireToken(): Promise<string> {
  const session = await getSession();
  if (!session?.access_token) throw new Error("Sign in again to manage knowledge.");
  return session.access_token;
}

export function KnowledgeCard({ lessonId }: { lessonId: string }) {
  const [rows, setRows] = useState<KnowledgeRows>(EMPTY_ROWS);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await requireToken();
      const data = await listLessonKnowledge({ accessToken: token, lessonId });
      setRows({
        ideas: data.ideas || [],
        vocab: data.vocab || [],
        links: data.links || [],
        practice: data.practice || [],
        figures: data.figures || [],
      });
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load lesson knowledge.");
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    setRows(EMPTY_ROWS);
    setLoaded(false);
    setNotice("");
    void load();
  }, [load]);

  const onExtract = async () => {
    setExtracting(true);
    setError("");
    setNotice("");
    try {
      const token = await requireToken();
      const data = await extractLessonKnowledge({ accessToken: token, lessonId });
      const d = data.drafted;
      setNotice(
        d
          ? `Drafted ${d.ideas} idea${d.ideas === 1 ? "" : "s"}, ${d.vocab} vocab, ${d.links} link${d.links === 1 ? "" : "s"}, ${d.practice} practice item${d.practice === 1 ? "" : "s"}.`
          : "Extraction finished.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  };

  const onReview = async (kind: KnowledgeKind, id: string, decision: "publish" | "discard") => {
    setBusyId(id);
    setError("");
    try {
      const token = await requireToken();
      await reviewLessonKnowledge({ accessToken: token, lessonId, kind, id, decision });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review failed.");
    } finally {
      setBusyId(null);
    }
  };

  const draftCount =
    rows.ideas.filter((r) => r.status === "draft").length +
    rows.vocab.filter((r) => r.status === "draft").length +
    rows.links.filter((r) => r.status === "draft").length +
    rows.practice.filter((r) => r.status === "draft").length +
    rows.figures.filter((r) => r.status === "draft").length;
  const total =
    rows.ideas.length +
    rows.vocab.length +
    rows.links.length +
    rows.practice.length +
    rows.figures.length;

  return (
    <section className="rounded-card border border-border bg-depth-sub p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-title font-medium text-foreground">
          <BrainCircuit className="h-4 w-4" strokeWidth={1.7} />
          Knowledge
          {draftCount > 0 ? (
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-meta text-muted-foreground">
              {draftCount} to review
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || extracting}
            aria-label="Reload knowledge"
            title="Reload"
            className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              strokeWidth={1.7}
            />
          </button>
          <button
            type="button"
            onClick={() => void onExtract()}
            disabled={extracting || loading}
            className="inline-flex items-center gap-2 rounded-full border border-foreground/25 bg-foreground px-3 py-1.5 text-meta text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
            {extracting ? "Reading lesson..." : "Draft knowledge"}
          </button>
        </div>
      </div>

      <p className="mb-3 text-meta text-muted-foreground">
        The mentor teaches from what is published here: ideas become trackable strengths, vocab gets
        defined on tap, links connect lessons, and practice items are used verbatim before anything
        generated.
      </p>

      {error ? <p className="mb-3 text-meta text-destructive">{error}</p> : null}
      {notice ? <p className="mb-3 text-meta text-muted-foreground">{notice}</p> : null}

      {loaded && total === 0 && !loading ? (
        <div className="rounded-card border border-dashed border-border px-3 py-6 text-center text-meta text-muted-foreground">
          Nothing extracted yet. Draft knowledge reads the steps and approved resources, then
          proposes ideas, vocab, links, and practice for review.
        </div>
      ) : (
        <div className="grid gap-4">
          <KnowledgeGroup
            label="Ideas"
            count={rows.ideas.length}
            rows={rows.ideas.map((row) => ({
              id: row.id,
              status: row.status,
              title: row.title,
              detail: row.one_liner || row.key,
              mono: row.key,
            }))}
            kind="idea"
            busyId={busyId}
            onReview={onReview}
          />
          <KnowledgeGroup
            label="Vocabulary"
            count={rows.vocab.length}
            rows={rows.vocab.map((row) => ({
              id: row.id,
              status: row.status,
              title: row.term,
              detail: row.definition,
            }))}
            kind="vocab"
            busyId={busyId}
            onReview={onReview}
          />
          <KnowledgeGroup
            label="Links"
            count={rows.links.length}
            rows={rows.links.map((row) => ({
              id: row.id,
              status: row.status,
              title: `${row.from_key} → ${row.to_key}`,
              detail: row.note || row.kind,
              mono: row.kind,
            }))}
            kind="link"
            busyId={busyId}
            onReview={onReview}
          />
          <KnowledgeGroup
            label="Figures"
            count={rows.figures.length}
            rows={rows.figures.map((row) => ({
              id: row.id,
              status: row.status,
              title: row.title,
              detail: row.caption || row.image_url,
              mono: row.idea_key || undefined,
              thumb: row.image_url,
            }))}
            kind="figure"
            busyId={busyId}
            onReview={onReview}
          />
          <KnowledgeGroup
            label="Practice"
            count={rows.practice.length}
            rows={rows.practice.map((row) => ({
              id: row.id,
              status: row.status,
              title: row.prompt,
              detail: row.expected ? `Expects: ${row.expected}` : row.idea_key,
              mono: row.difficulty,
            }))}
            kind="practice"
            busyId={busyId}
            onReview={onReview}
          />
        </div>
      )}
    </section>
  );
}

type GroupRow = {
  id: string;
  status: string;
  title: string;
  detail: string;
  mono?: string;
  // R30: figures show the actual crop — approving an image you cannot see is guesswork.
  thumb?: string;
};

function KnowledgeGroup({
  label,
  count,
  rows,
  kind,
  busyId,
  onReview,
}: {
  label: string;
  count: number;
  rows: GroupRow[];
  kind: KnowledgeKind;
  busyId: string | null;
  onReview: (kind: KnowledgeKind, id: string, decision: "publish" | "discard") => Promise<void>;
}) {
  if (count === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <span className="text-meta text-muted-foreground/70">{count}</span>
      </div>
      <div className="grid gap-1.5">
        {rows.map((row) => {
          const isDraft = row.status === "draft";
          const busy = busyId === row.id;
          return (
            <div
              key={row.id}
              className={`flex items-start justify-between gap-3 rounded-control border px-3 py-2 ${
                isDraft ? "border-border bg-depth-card" : "border-transparent"
              }`}
            >
              <div className="flex min-w-0 gap-3">
                {row.thumb ? (
                  <img
                    src={row.thumb}
                    alt=""
                    className="h-14 w-20 shrink-0 rounded border border-border bg-white object-contain"
                  />
                ) : null}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body text-foreground">{row.title}</span>
                    {row.mono ? (
                      <span className="shrink-0 font-mono text-meta text-muted-foreground/70">
                        {row.mono}
                      </span>
                    ) : null}
                  </div>
                  {row.detail ? (
                    <p className="mt-0.5 line-clamp-2 text-meta text-muted-foreground">
                      {row.detail}
                    </p>
                  ) : null}
                </div>
              </div>
              {isDraft ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void onReview(kind, row.id, "publish")}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-meta text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" strokeWidth={2} />
                    Publish
                  </button>
                  <button
                    type="button"
                    onClick={() => void onReview(kind, row.id, "discard")}
                    disabled={busy}
                    aria-label="Discard draft"
                    title="Discard"
                    className="rounded-full border border-border p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </div>
              ) : (
                <span className="shrink-0 font-mono text-meta text-muted-foreground/70">
                  {row.status}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
