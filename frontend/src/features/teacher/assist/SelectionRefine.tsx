/**
 * Mechanism D — selection-scoped refinement.
 *
 * Rebuild brief: "Select text in any field → a small inline affordance offers shorter ·
 * simpler · more concrete. Scoped to what you selected, not to the whole field. This is
 * the only place a visible AI control belongs, because the selection already declared
 * the target."
 *
 * That last clause is the whole design. Every other AI control in this product was a
 * button asking "do you want help?" — chrome, and the brief's failure mode 3. This one
 * appears only after the teacher has pointed at something, and it does exactly what the
 * pointing implied. It replaces the selection and nothing else, and Escape (or a click
 * away) restores what was there.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { draftTextField, getSession, type DraftableField } from "@/lib/api";

type Intent = { key: string; label: string; instruction: string };

const INTENTS: Intent[] = [
  {
    key: "shorter",
    label: "shorter",
    instruction: "Rewrite the passage so it says the same thing in fewer words.",
  },
  {
    key: "simpler",
    label: "simpler",
    instruction:
      "Rewrite the passage in plainer language a student of this age reads without help. Keep every fact.",
  },
  {
    key: "concrete",
    label: "more concrete",
    instruction:
      "Rewrite the passage so it names a specific, checkable thing instead of a general one.",
  },
];

/**
 * Wraps one text field. The child is the real <input>/<textarea>; this owns the
 * selection watch and the affordance.
 */
export function SelectionRefine({
  field,
  lessonId,
  value,
  onChange,
  disabled,
  children,
}: {
  field: DraftableField;
  lessonId?: string | null;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // The one undo: what the whole field held before the refinement landed.
  const [undoTo, setUndoTo] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const read = () => {
      const el = host.querySelector("input,textarea") as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (!el || document.activeElement !== el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      // Two characters is not a passage; below that the affordance is just flicker.
      setRange(end - start >= 3 ? { start, end } : null);
    };
    const clear = () => {
      const el = host.querySelector("input,textarea");
      if (el && document.activeElement === el) return;
      setRange(null);
      setError("");
    };
    document.addEventListener("selectionchange", read);
    host.addEventListener("keyup", read);
    host.addEventListener("mouseup", read);
    document.addEventListener("focusin", clear);
    return () => {
      document.removeEventListener("selectionchange", read);
      host.removeEventListener("keyup", read);
      host.removeEventListener("mouseup", read);
      document.removeEventListener("focusin", clear);
    };
  }, []);

  const run = async (intent: Intent) => {
    if (!range) return;
    const selected = value.slice(range.start, range.end);
    if (!selected.trim()) return;
    setBusy(intent.key);
    setError("");
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to use the assistant.");
      const text = await draftTextField({
        accessToken: session.access_token,
        field,
        lessonId,
        // The selection IS the scope: the model is given the passage, not the field.
        current: selected,
        prompt: intent.instruction,
      });
      const trimmed = text.trim();
      if (!trimmed) {
        setError("Nothing came back.");
        return;
      }
      setUndoTo(value);
      onChange(value.slice(0, range.start) + trimmed + value.slice(range.end));
      setRange(null);
    } catch (err) {
      setError((err as Error).message || "Could not rewrite that.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={hostRef} className="relative min-w-0 flex-1">
      {children}
      {range && !disabled ? (
        <div
          role="group"
          aria-label="Rewrite the selection"
          className="absolute right-0 top-full z-20 mt-1 flex items-center gap-1 rounded-pill border border-border bg-depth-card px-1.5 py-1 shadow-raised"
        >
          {INTENTS.map((intent) => (
            <button
              key={intent.key}
              type="button"
              // Mousedown, not click: clicking would blur the field first and the
              // selection would be gone before the handler ran.
              onMouseDown={(event) => {
                event.preventDefault();
                void run(intent);
              }}
              disabled={Boolean(busy)}
              className="rounded-pill px-2 py-0.5 text-meta text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-60"
            >
              {busy === intent.key ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              ) : (
                intent.label
              )}
            </button>
          ))}
        </div>
      ) : null}
      {undoTo !== null ? (
        <div className="absolute right-0 top-full z-20 mt-1 flex items-center gap-2 rounded-pill border border-border bg-depth-card px-2.5 py-1 shadow-raised">
          <span className="text-meta text-muted-foreground">Rewritten</span>
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onChange(undoTo);
              setUndoTo(null);
            }}
            className="text-meta text-primary underline-offset-2 hover:underline"
          >
            Undo
          </button>
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              setUndoTo(null);
            }}
            aria-label="Keep the rewrite"
            className="text-meta text-muted-foreground hover:text-foreground"
          >
            Keep
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="absolute right-0 top-full mt-1 text-meta text-danger">{error}</p>
      ) : null}
    </div>
  );
}
