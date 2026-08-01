import { useState } from "react";
import { ChevronDown, LayoutDashboard } from "lucide-react";
import { Popover } from "@/components/Popover";
import type { StudentClass } from "@/lib/types";

// The Home sidebar's body: an Overview row + the student's classes. Selecting a class opens
// its summary page in the main area; the selected class also scopes the Learn tree. Purely
// presentational — the shell supplies data and callbacks.

export function classMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

export function ClassAvatar({ name, size = 8 }: { name: string; size?: 7 | 8 | 10 }) {
  const sizeClass = size === 10 ? "h-10 w-10 text-meta" : size === 7 ? "h-7 w-7" : "h-8 w-8";
  return (
    <span
      aria-hidden
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full border border-border text-overline font-bold text-muted-foreground`}
      style={{
        background: "radial-gradient(circle at 32% 28%, var(--depth-field), var(--depth-sub))",
      }}
    >
      {classMonogram(name)}
    </span>
  );
}

export type ClassListProps = {
  classes: StudentClass[];
  selectedClassId: string | null;
  // Due counts per class (from the shell's assessment bundle).
  dueByClass: Map<string, number>;
  // null = the plain Home overview (no class selected).
  onSelectClass: (classId: string | null) => void;
};

export function ClassList({ classes, selectedClassId, dueByClass, onSelectClass }: ClassListProps) {
  return (
    <nav aria-label="Classes" className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onSelectClass(null)}
        aria-current={selectedClassId === null ? "page" : undefined}
        className={`flex items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body transition-colors duration-(--dur-fast) ${
          selectedClassId === null
            ? "bg-muted font-semibold text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`}
      >
        <LayoutDashboard className="h-[15px] w-[15px] shrink-0" strokeWidth={1.6} />
        Overview
      </button>

      <div className="mb-1 mt-2 px-2.5 font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
        Classes
      </div>
      {classes.map((klass) => {
        const active = klass.id === selectedClassId;
        const due = dueByClass.get(klass.id) ?? 0;
        return (
          <button
            key={klass.id}
            type="button"
            onClick={() => onSelectClass(klass.id)}
            aria-current={active ? "page" : undefined}
            className={`relative flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors duration-(--dur-fast) ${
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            {/* Aurora marks the ONE live thing — here, the selected class. */}
            {active ? <span className="aurora-glow -inset-1.5 opacity-50" aria-hidden /> : null}
            <ClassAvatar name={klass.name} size={7} />
            <span className="relative min-w-0 flex-1">
              <span
                className={`block truncate text-body ${active ? "font-semibold text-foreground" : ""}`}
              >
                {klass.name}
              </span>
              {klass.organizationName ? (
                <span className="block truncate text-overline text-muted-foreground">
                  {klass.organizationName}
                </span>
              ) : null}
            </span>
            {due > 0 ? (
              <span
                className="ds-tag relative shrink-0 px-1.5 py-0.5 text-[10px]"
                style={{
                  ["--tag-bg" as string]: "var(--mode-open)",
                  ["--tag-ink" as string]: "var(--mode-open-ink)",
                }}
                aria-label={`${due} due`}
              >
                {due}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

// The Learn sidebar's class switcher: which class's units the tree below is showing.
export function ClassSwitcher({
  classes,
  selectedClassId,
  onSelectClass,
}: {
  classes: StudentClass[];
  selectedClassId: string | null;
  onSelectClass: (classId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = classes.find((k) => k.id === selectedClassId) ?? classes[0];
  if (!current || classes.length === 0) return null;

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-start"
      panelClassName="w-[220px] rounded-card border border-border bg-background p-1.5"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Class: ${current.name}`}
          className="mb-1 flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
        >
          <span className="min-w-0 flex-1 truncate font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
            {current.name}
          </span>
          {classes.length > 1 ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2} />
          ) : null}
        </button>
      }
    >
      {classes.map((klass) => (
        <button
          key={klass.id}
          type="button"
          onClick={() => {
            setOpen(false);
            onSelectClass(klass.id);
          }}
          className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body transition-colors duration-(--dur-fast) hover:bg-muted ${
            klass.id === current.id ? "font-semibold text-foreground" : "text-muted-foreground"
          }`}
        >
          <ClassAvatar name={klass.name} size={7} />
          <span className="min-w-0 flex-1 truncate">{klass.name}</span>
        </button>
      ))}
    </Popover>
  );
}
