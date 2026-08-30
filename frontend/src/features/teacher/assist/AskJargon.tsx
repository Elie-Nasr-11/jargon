/**
 * Mechanism C — one command surface, not N buttons.
 *
 * Rebuild brief: "A single ⌘K / 'Ask Jargon' bar, context-aware: on a lesson it offers
 * to rewrite the objective, add a check, simplify the reading level. Discoverable in one
 * place, invisible until wanted, and it scales to fifty capabilities without adding
 * fifty controls."
 *
 * This is the mechanism that lets the twelve buttons go. Each command still lands as a
 * PROPOSAL the teacher accepts or dismisses — the bar runs nothing that writes, which is
 * the first non-negotiable and the reason a command surface is safe to make this
 * reachable. Commands are supplied by the screen, so the lesson decides what "here" can
 * do rather than this file growing a switch over every screen in the product.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Loader2, Search } from "lucide-react";

export type AssistCommand = {
  id: string;
  /** What it does, in the teacher's words. Imperative, names its target. */
  label: string;
  /** The one line under it — what will change, and what will not. */
  detail?: string;
  run: () => Promise<void> | void;
};

/** Cmd+K on a Mac, Ctrl+K everywhere else. */
function isOpenChord(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
}

export function AskJargon({ commands }: { commands: AssistCommand[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isOpenChord(event)) {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery("");
        setActive(0);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.detail ?? ""}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  const invoke = async (command: AssistCommand) => {
    setRunning(command.id);
    try {
      await command.run();
      setOpen(false);
    } finally {
      setRunning(null);
    }
  };

  if (!open) {
    // Invisible until wanted — but never undiscoverable. One quiet line, and the
    // chord that opens it, instead of a control per capability.
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-pill border border-border bg-depth-card px-3.5 py-2 text-meta text-muted-foreground shadow-raised transition-colors hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" strokeWidth={1.8} />
        Ask Jargon
        <kbd className="rounded border border-border px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/25 pt-[18vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Ask Jargon"
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-[560px] overflow-hidden rounded-card border border-border bg-depth-card shadow-raised"
      >
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, matches.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && matches[active]) {
                event.preventDefault();
                void invoke(matches[active]);
              }
            }}
            placeholder="What would you like to do here?"
            aria-label="Ask Jargon"
            className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {matches.length === 0 ? (
            <p className="px-3.5 py-3 text-meta text-muted-foreground">
              Nothing here matches that.
            </p>
          ) : (
            matches.map((command, index) => (
              <button
                key={command.id}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => void invoke(command)}
                disabled={Boolean(running)}
                className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors ${
                  index === active ? "bg-muted/60" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-foreground">{command.label}</span>
                  {command.detail ? (
                    <span className="block text-meta text-muted-foreground">{command.detail}</span>
                  ) : null}
                </span>
                {running === command.id ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2} />
                ) : index === active ? (
                  <CornerDownLeft
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.8}
                  />
                ) : null}
              </button>
            ))
          )}
        </div>
        <p className="border-t border-border px-3.5 py-2 text-meta text-muted-foreground">
          Everything here lands as a proposal you accept or dismiss. Nothing is saved until you
          press Save.
        </p>
      </div>
    </div>
  );
}
