/**
 * Ask Jargon — the assistant, as a sidebar.
 *
 * Mechanism C of the rebuild brief ("one command surface, not N buttons") shipped in
 * R85 as a ⌘K palette: a list of commands in a box in the middle of the screen. It
 * did the job and felt like a menu. An assistant is a place you talk to something,
 * and it lives down the right-hand side — so this is a panel, and a conversation.
 *
 * It is a flex sibling of the page inside TeacherShell, not an overlay, so opening it
 * SHRINKS the page instead of covering it. (On narrow screens there is no room to
 * shrink into, so it takes the screen.) That is the difference between a sidebar and
 * a thing sitting on top of your work.
 *
 * The four non-negotiables are unchanged and structural:
 *   Never writes      — a turn ends in a PROPOSAL; the teacher's Save still commits.
 *   Always attributed — every proposal names the field it is for and says nothing is
 *                       saved yet.
 *   Always reversible — Use this keeps the previous value; Undo puts it back.
 *   Grounded          — the model is given the field's current text and the lesson.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2, PanelRightClose, Sparkles, X } from "lucide-react";
import { AutoTextarea } from "@/components/AutoTextarea";
import { draftTextField, getSession, type DraftableField } from "@/lib/api";
import { draftScopeArgs, type AssistScope } from "@/features/teacher/assist/scope";

/**
 * What the assistant is looking at — both how to SAY it and what to scope requests to.
 *
 * The scope lives in the same object as the name on purpose. curriculum-admin refuses a
 * draft that names neither a lesson nor an organization, so a context that describes a
 * screen without saying what it is scoped to is not a context this panel can use. R87
 * shipped with the scope as somebody else's problem and the panel simply dropped it —
 * every request came back "lesson_id or organization_id is required." AssistScope is
 * that server rule written as a type: a call site must supply one of the two.
 */
export type AssistContext = { kind: string; name: string } & AssistScope;

/** A field the assistant may propose into. The screen owns it; this panel only asks. */
export type AssistTarget = {
  id: string;
  /** How the teacher refers to it: "Objective", "Title". */
  label: string;
  field: DraftableField;
  /** The live value, so a request can improve rather than replace. */
  current: string;
  apply: (text: string) => void;
};

/** A starter — what this screen is good at, phrased as the teacher would say it. */
export type AssistSuggestion = {
  id: string;
  label: string;
  prompt: string;
  targetId: string;
};

/** Something that is not a proposal: opens a dialog, navigates. Rare by design. */
export type AssistAction = { id: string; label: string; run: () => void };

type Turn =
  | { id: string; role: "you"; text: string }
  | { id: string; role: "jargon"; kind: "thinking" }
  | { id: string; role: "jargon"; kind: "failed"; text: string }
  | {
      id: string;
      role: "jargon";
      kind: "proposal";
      text: string;
      targetId: string;
      previous: string;
      applied: boolean;
    };

const uid = () => Math.random().toString(36).slice(2);
const escapeForWordSearch = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isOpenChord(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
}

export function AskJargon({
  context,
  targets,
  suggestions,
  actions = [],
}: {
  context: AssistContext;
  targets: AssistTarget[];
  suggestions: AssistSuggestion[];
  actions?: AssistAction[];
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isOpenChord(event)) {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const target = useMemo(
    () => targets.find((entry) => entry.id === targetId) ?? targets[0] ?? null,
    [targets, targetId],
  );
  const targetById = useMemo(() => new Map(targets.map((entry) => [entry.id, entry])), [targets]);

  /**
   * A typed request that names a field goes to that field.
   *
   * "Make the objective shorter" has already said what it is about. Asking the teacher
   * to ALSO flip a pill — and answering about the title when they don't — is the panel
   * being pedantic with a sentence it understood. Found by walking: after using the
   * "Rewrite the title" starter, a typed request about the objective came back labelled
   * TITLE. The earliest label mentioned wins, which is how the sentences read: "rewrite
   * the title so it matches the objective" is a request about the title. A mis-route
   * costs nothing — every proposal names its field, and nothing is saved either way.
   */
  const routeByWords = (prompt: string): string | null => {
    const text = prompt.toLowerCase();
    let best: { id: string; at: number } | null = null;
    for (const entry of targets) {
      const at = text.search(new RegExp(`\\b${escapeForWordSearch(entry.label.toLowerCase())}\\b`));
      if (at >= 0 && (!best || at < best.at)) best = { id: entry.id, at };
    }
    return best?.id ?? null;
  };

  const ask = async (prompt: string, wantedTargetId?: string) => {
    // A starter already declared its field; a typed sentence is read for one.
    const picked = targetById.get(wantedTargetId ?? routeByWords(prompt) ?? targetId) ?? target;
    if (!picked || !prompt.trim() || busy) return;
    if (picked.id !== targetId) setTargetId(picked.id);
    const thinkingId = uid();
    setTurns((current) => [
      ...current,
      { id: uid(), role: "you", text: prompt.trim() },
      { id: thinkingId, role: "jargon", kind: "thinking" },
    ]);
    setDraft("");
    setBusy(true);
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to use the assistant.");
      const text = await draftTextField({
        accessToken: session.access_token,
        field: picked.field,
        ...draftScopeArgs(context),
        current: picked.current.trim() || undefined,
        prompt: prompt.trim(),
      });
      const trimmed = text.trim();
      setTurns((current) =>
        current.map((turn) =>
          turn.id === thinkingId
            ? trimmed
              ? {
                  id: thinkingId,
                  role: "jargon" as const,
                  kind: "proposal" as const,
                  text: trimmed,
                  targetId: picked.id,
                  previous: picked.current,
                  applied: false,
                }
              : {
                  id: thinkingId,
                  role: "jargon" as const,
                  kind: "failed" as const,
                  text: "Nothing came back. Try saying it a different way.",
                }
            : turn,
        ),
      );
    } catch (error) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === thinkingId
            ? {
                id: thinkingId,
                role: "jargon" as const,
                kind: "failed" as const,
                text: (error as Error).message || "That did not work.",
              }
            : turn,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask Jargon"
        className="group fixed bottom-5 right-5 z-[var(--z-header)] flex items-center gap-2 rounded-pill border border-border bg-depth-card py-2.5 pl-3.5 pr-3 text-meta text-muted-foreground shadow-raised transition-all duration-(--dur) hover:border-primary/40 hover:text-foreground hover:shadow-lg"
      >
        <Sparkles
          className="h-4 w-4 text-primary transition-transform duration-(--dur) group-hover:scale-110"
          strokeWidth={1.8}
        />
        <span className="font-medium">Ask Jargon</span>
        <kbd className="rounded border border-border px-1 font-mono text-[10px] leading-[1.4] text-muted-foreground">
          ⌘K
        </kbd>
      </button>
    );
  }

  return (
    <aside
      aria-label="Ask Jargon"
      className="assist-panel fixed inset-y-0 right-0 z-[var(--z-header)] flex w-full max-w-[420px] flex-col border-l border-border bg-depth-card shadow-raised lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:shadow-none"
    >
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium text-foreground">Ask Jargon</span>
          <span className="block truncate text-meta text-muted-foreground">
            {context.kind} · {context.name}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Ask Jargon"
          className="shrink-0 rounded-control p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <PanelRightClose className="hidden h-4 w-4 lg:block" strokeWidth={1.7} />
          <X className="h-4 w-4 lg:hidden" strokeWidth={1.7} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="mb-auto grid gap-3">
            <p className="text-body leading-relaxed text-foreground">
              What would you like to change about this {context.kind.toLowerCase()}?
            </p>
            <p className="text-meta leading-relaxed text-muted-foreground">
              Say it in your own words, or start from one of these. Everything comes back as a
              proposal — nothing changes until you accept it.
            </p>
            <div className="grid gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => void ask(suggestion.prompt, suggestion.targetId)}
                  className="rounded-control border border-border bg-depth-sub px-3 py-2 text-left text-meta text-foreground transition-colors hover:border-primary/40 hover:bg-muted/50"
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
            {actions.length ? (
              <div className="mt-1 border-t border-border/60 pt-3">
                <div className="mb-1.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Or open
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => {
                        action.run();
                        setOpen(false);
                      }}
                      className="rounded-pill border border-border px-3 py-1 text-meta text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3">
            {turns.map((turn) =>
              turn.role === "you" ? (
                <p
                  key={turn.id}
                  className="justify-self-end rounded-card rounded-br-sm bg-primary px-3 py-2 text-meta leading-relaxed text-primary-foreground"
                >
                  {turn.text}
                </p>
              ) : turn.kind === "thinking" ? (
                <p
                  key={turn.id}
                  className="flex items-center gap-2 text-meta text-muted-foreground"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  Working on it…
                </p>
              ) : turn.kind === "failed" ? (
                <p key={turn.id} className="text-meta text-danger">
                  {turn.text}
                </p>
              ) : (
                <ProposalTurn
                  key={turn.id}
                  turn={turn}
                  targetLabel={targetById.get(turn.targetId)?.label ?? "this field"}
                  onUse={() => {
                    targetById.get(turn.targetId)?.apply(turn.text);
                    setTurns((current) =>
                      current.map((entry) =>
                        entry.id === turn.id && entry.role === "jargon"
                          ? { ...entry, applied: true }
                          : entry,
                      ),
                    );
                  }}
                  onUndo={() => {
                    targetById.get(turn.targetId)?.apply(turn.previous);
                    setTurns((current) =>
                      current.map((entry) =>
                        entry.id === turn.id && entry.role === "jargon"
                          ? { ...entry, applied: false }
                          : entry,
                      ),
                    );
                  }}
                />
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-3">
        {targets.length > 1 ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-muted-foreground">Change</span>
            {targets.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTargetId(entry.id)}
                className={`rounded-pill border px-2.5 py-0.5 text-meta transition-colors ${
                  entry.id === targetId
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2 rounded-card border border-border bg-depth-field px-2.5 py-2 transition-colors focus-within:border-primary">
          <AutoTextarea
            ref={inputRef}
            value={draft}
            onChange={setDraft}
            maxLines={6}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft);
              }
            }}
            placeholder={target ? `Ask for a new ${target.label.toLowerCase()}…` : "Ask…"}
            aria-label="Ask Jargon"
            className="min-w-0 flex-1 bg-transparent text-meta leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="button"
            onClick={() => void ask(draft)}
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-35"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>
        <p className="mt-1.5 px-0.5 text-meta text-muted-foreground">
          Proposals only — nothing is saved until you press Save.
        </p>
      </div>
    </aside>
  );
}

function ProposalTurn({
  turn,
  targetLabel,
  onUse,
  onUndo,
}: {
  turn: Extract<Turn, { kind: "proposal" }>;
  targetLabel: string;
  onUse: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="rounded-card border border-primary/30 bg-primary/[0.04] p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-primary" strokeWidth={2} />
        {targetLabel}
      </div>
      <p className="text-meta italic leading-relaxed text-foreground">{turn.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {turn.applied ? (
          <>
            <span className="text-meta text-success">In the field</span>
            <button
              type="button"
              onClick={onUndo}
              className="text-meta text-primary underline-offset-2 hover:underline"
            >
              Undo
            </button>
          </>
        ) : (
          <button type="button" onClick={onUse} className="btn btn-primary btn-sm">
            Use this
          </button>
        )}
        <span className="text-meta text-muted-foreground">
          {turn.applied ? "Your Save still commits it." : "Nothing is saved yet."}
        </span>
      </div>
    </div>
  );
}
