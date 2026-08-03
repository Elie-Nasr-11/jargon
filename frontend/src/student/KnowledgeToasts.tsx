import { useEffect } from "react";
import { BookOpen, Link2, Sparkles, X } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";
import { useConversationChannel, type KnowledgeToast } from "@/student/useConversation";

// Learning framework (F2/F3) notification surfaces, mounted by ChatWindow:
//   VOCAB — the definition dropdown, sliding from the TOP CENTER on a term's first
//   encounter (and on tapping any highlighted term later).
//   LINK / IDEA — the "your brain just grew" toasts, top right, with a spark and a
//   "See it in your brain" jump to the Home map where the new arc/star lives.
// All of these appear only after the streamed reply settles (owner decision — the
// events ride the envelope, which resolves post-stream). Auto-dismiss; tap X to close
// early; reduced motion renders them static.

const VOCAB_DISMISS_MS = 6_500;
const LINK_DISMISS_MS = 9_000;

function useAutoDismiss(toast: KnowledgeToast, dismiss: (id: string) => void) {
  useEffect(() => {
    const ms = toast.kind === "vocab" ? VOCAB_DISMISS_MS : LINK_DISMISS_MS;
    const timer = window.setTimeout(() => dismiss(toast.id), ms);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);
}

function VocabBanner({
  toast,
  dismiss,
}: {
  toast: Extract<KnowledgeToast, { kind: "vocab" }>;
  dismiss: (id: string) => void;
}) {
  useAutoDismiss(toast, dismiss);
  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-md items-start gap-2.5 rounded-card border border-border bg-depth-card px-3.5 py-2.5 shadow-card ${
        prefersReducedMotion() ? "" : "ktoast-drop"
      }`}
    >
      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-body font-semibold text-foreground">{toast.event.term}</span>
          {toast.event.subject ? (
            <span className="font-mono text-overline uppercase tracking-[0.12em] text-muted-foreground">
              {toast.event.subject}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-meta text-muted-foreground">{toast.event.definition}</p>
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss definition"
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

function GrowthToast({
  toast,
  dismiss,
  onSeeBrain,
}: {
  toast: Extract<KnowledgeToast, { kind: "link" | "idea" }>;
  dismiss: (id: string) => void;
  onSeeBrain?: () => void;
}) {
  useAutoDismiss(toast, dismiss);
  const isLink = toast.kind === "link";
  const headline = isLink
    ? `New link: ${toast.event.from_title} ↔ ${toast.event.to_title}`
    : `New idea: ${toast.event.title}`;
  const detail = isLink ? toast.event.note : toast.event.one_liner;
  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-card border px-3.5 py-2.5 shadow-card ${
        prefersReducedMotion() ? "" : "ktoast-pop"
      }`}
      style={{
        borderColor: "color-mix(in oklab, var(--grad-1) 45%, transparent)",
        background: "color-mix(in oklab, var(--grad-1) 10%, var(--depth-card))",
      }}
    >
      {isLink ? (
        <Link2
          className="ktoast-spark mt-0.5 h-4 w-4 shrink-0"
          strokeWidth={1.8}
          style={{ color: "var(--grad-1)" }}
        />
      ) : (
        <Sparkles
          className="ktoast-spark mt-0.5 h-4 w-4 shrink-0"
          strokeWidth={1.8}
          style={{ color: "var(--grad-1)" }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-body font-semibold text-foreground">{headline}</div>
        {detail ? <p className="mt-0.5 text-meta text-muted-foreground">{detail}</p> : null}
        {onSeeBrain ? (
          <button
            type="button"
            onClick={() => {
              dismiss(toast.id);
              onSeeBrain();
            }}
            className="mt-1.5 rounded-pill border border-border px-2.5 py-0.5 text-meta font-semibold text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
          >
            See it in your brain
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

export function KnowledgeToasts({ onSeeBrain }: { onSeeBrain?: () => void }) {
  const channel = useConversationChannel();
  if (!channel.knowledgeToasts.length) return null;
  const vocab = channel.knowledgeToasts.filter((t) => t.kind === "vocab");
  const growth = channel.knowledgeToasts.filter((t) => t.kind !== "vocab");
  return (
    <>
      {/* Vocab: the dropdown from the top center. */}
      <div className="pointer-events-none absolute inset-x-0 top-2 z-[var(--z-overlay)] flex flex-col items-center gap-2">
        {vocab.map((toast) => (
          <VocabBanner
            key={toast.id}
            toast={toast as Extract<KnowledgeToast, { kind: "vocab" }>}
            dismiss={channel.dismissToast}
          />
        ))}
      </div>
      {/* Growth: links + new ideas, top right. */}
      <div className="pointer-events-none absolute right-3 top-2 z-[var(--z-overlay)] flex flex-col items-end gap-2">
        {growth.map((toast) => (
          <GrowthToast
            key={toast.id}
            toast={toast as Extract<KnowledgeToast, { kind: "link" | "idea" }>}
            dismiss={channel.dismissToast}
            onSeeBrain={onSeeBrain}
          />
        ))}
      </div>
    </>
  );
}
