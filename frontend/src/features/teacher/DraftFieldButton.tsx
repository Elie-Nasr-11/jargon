import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { draftTextField, getSession, type DraftableField } from "@/lib/api";

// R76: the assist that belongs next to every field a teacher writes into.
//
// Owner: "at every building point there should be an ai assistant to help draft content
// (steps, titles, summaries, ...)". Before this, drafting existed only for a whole
// lesson and a whole step list — the big, rare acts — while the small writing that makes
// up most of authoring had no help at all.
//
// Two rules keep it honest. It never writes to the server: it hands the field a draft and
// the teacher's own save is still the only thing that commits, so an assist can always be
// ignored or edited away. And it passes the field's CURRENT value, so pressing it on a
// filled field improves what is there rather than replacing it with something unrelated.
export function DraftFieldButton({
  field,
  current,
  lessonId,
  classId,
  organizationId,
  referenceText,
  disabled,
  label = "Draft",
  onDraft,
}: {
  field: DraftableField;
  current?: string;
  lessonId?: string | null;
  classId?: string | null;
  organizationId?: string | null;
  referenceText?: string;
  disabled?: boolean;
  label?: string;
  onDraft: (text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = () => {
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to use the assistant.");
        const text = await draftTextField({
          accessToken: session.access_token,
          field,
          lessonId,
          classId,
          organizationId,
          referenceText,
          current: current?.trim() || undefined,
        });
        if (text) onDraft(text);
        else setError("Nothing came back — try again.");
      } catch (err) {
        setError((err as Error).message || "The assistant could not draft that.");
      } finally {
        setLoading(false);
      }
    })();
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={disabled || loading}
        title={current?.trim() ? "Improve what's written" : "Draft this for me"}
        className="btn btn-ghost btn-sm"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        {current?.trim() ? "Improve" : label}
      </button>
      {error ? <span className="text-meta text-danger">{error}</span> : null}
    </span>
  );
}
