import { useRef, useState } from "react";
import { MathPreview } from "@/lib/mathText";

// R29 — THE EQUATION PAD. Students doing trigonometry need to write $\frac{\sqrt{3}}{2}$
// and $\theta$, and no student is going to learn LaTeX to answer a question. So the pad is
// a small keyboard: tap a symbol, it lands at the cursor; the live preview shows the
// typeset result as you build it. Insert drops `$...$` into the composer, where it renders
// as real math in the transcript once sent.
//
// Templates carry a `{}` cursor slot (`\frac{}{}`), so tapping a fraction leaves the caret
// inside the numerator instead of after the whole macro — the difference between a pad
// that helps and one that makes you retype.

type Key = { label: string; insert: string; title?: string; wide?: boolean };

const GREEK: Key[] = [
  { label: "θ", insert: "\\theta " },
  { label: "π", insert: "\\pi " },
  { label: "α", insert: "\\alpha " },
  { label: "β", insert: "\\beta " },
  { label: "Δ", insert: "\\Delta " },
  { label: "λ", insert: "\\lambda " },
];

const OPERATORS: Key[] = [
  { label: "×", insert: "\\times " },
  { label: "÷", insert: "\\div " },
  { label: "±", insert: "\\pm " },
  { label: "≤", insert: "\\le " },
  { label: "≥", insert: "\\ge " },
  { label: "≠", insert: "\\ne " },
  { label: "≈", insert: "\\approx " },
  { label: "°", insert: "^{\\circ}" },
  { label: "∞", insert: "\\infty " },
  { label: "→", insert: "\\to " },
];

const STRUCTURES: Key[] = [
  { label: "a/b", insert: "\\frac{}{}", title: "Fraction", wide: true },
  { label: "√", insert: "\\sqrt{}", title: "Square root" },
  { label: "xⁿ", insert: "^{}", title: "Power" },
  { label: "xₙ", insert: "_{}", title: "Subscript" },
  { label: "( )", insert: "\\left(\\right)", title: "Sized brackets", wide: true },
  { label: "Σ", insert: "\\sum_{n=1}^{}", title: "Sum", wide: true },
  { label: "∫", insert: "\\int_{}^{}", title: "Integral" },
];

const FUNCTIONS: Key[] = [
  { label: "sin", insert: "\\sin ", wide: true },
  { label: "cos", insert: "\\cos ", wide: true },
  { label: "tan", insert: "\\tan ", wide: true },
  { label: "log", insert: "\\log ", wide: true },
  { label: "ln", insert: "\\ln ", wide: true },
];

const GROUPS: Array<{ label: string; keys: Key[] }> = [
  { label: "Symbols", keys: GREEK },
  { label: "Operators", keys: OPERATORS },
  { label: "Build", keys: STRUCTURES },
  { label: "Functions", keys: FUNCTIONS },
];

export function EquationPad({
  onInsert,
  onCancel,
}: {
  onInsert: (latex: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Insert at the caret, then place the caret in the template's first empty slot (or after
  // the inserted text when there is none) and hand focus back to the field.
  const insertAtCaret = (snippet: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    setValue(next);
    const slot = snippet.indexOf("{}");
    const caret = start + (slot >= 0 ? slot + 1 : snippet.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const commit = () => {
    const tex = value.trim();
    if (!tex) return;
    onInsert(`$${tex}$`);
    setValue("");
  };

  return (
    <div className="p-1">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
          Equation
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-meta text-muted-foreground transition-colors hover:text-foreground"
        >
          Close
        </button>
      </div>

      {/* The preview is the whole point: students check the SHAPE, not the LaTeX. */}
      <div className="mb-2 flex min-h-[52px] items-center justify-center rounded-control border border-border bg-depth-sub px-2 py-1.5">
        {value.trim() ? (
          <MathPreview tex={value} />
        ) : (
          <span className="text-meta text-muted-foreground">Your equation appears here</span>
        )}
      </div>

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="Type or tap the keys below"
        aria-label="Equation source"
        className="mb-2 w-full rounded-control border border-border bg-transparent px-2 py-1.5 font-mono text-meta text-foreground placeholder:text-muted-foreground focus:outline-none"
      />

      <div className="max-h-52 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="mb-1 px-1 font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground/70">
              {group.label}
            </div>
            <div className="flex flex-wrap gap-1">
              {group.keys.map((key) => (
                <button
                  key={key.label}
                  type="button"
                  title={key.title || key.label}
                  onClick={() => insertAtCaret(key.insert)}
                  className={`flex h-8 items-center justify-center rounded-control border border-border text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted ${
                    key.wide ? "px-2.5" : "w-8"
                  }`}
                >
                  {key.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={commit}
        disabled={!value.trim()}
        className="mt-2 w-full rounded-control bg-primary px-3 py-1.5 text-meta font-bold text-background transition-transform duration-(--dur-fast) hover:scale-[1.01] disabled:opacity-30"
      >
        Insert equation
      </button>
    </div>
  );
}
