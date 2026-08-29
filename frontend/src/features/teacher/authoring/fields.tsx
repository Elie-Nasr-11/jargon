/**
 * The authoring surface's field primitives.
 *
 * One labelled input, one labelled textarea, one labelled select, the empty-row
 * hint the outline shows, and the two-way view toggle. Every editor in the
 * studio draws its fields from here so a label reads the same everywhere.
 */

export function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="jargon-input normal-case tracking-normal"
      />
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="jargon-input min-h-[82px] normal-case leading-relaxed tracking-normal"
      />
    </label>
  );
}

export function SelectInput({
  label,
  value,
  options,
  onChange,
  optionLabels,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  optionLabels?: Record<string, string>;
}) {
  return (
    <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="jargon-input normal-case tracking-normal"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EmptyHint({ depth, label }: { depth: number; label: string }) {
  return (
    <div
      className="py-1 text-meta italic text-muted-foreground/70"
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
    >
      {label}
    </div>
  );
}

export function ViewToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-meta transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AI authoring panels — generate a draft (with subject context + attached docs),
// review it, refine specific parts (changes highlighted), then apply.
// ---------------------------------------------------------------------------
