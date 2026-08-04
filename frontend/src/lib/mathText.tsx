import { useMemo } from "react";
import katex from "katex";

// R29 — MATH DISPLAY. Mathematics gets the same first-class treatment code already has:
// a real typeset rendering, not ASCII squinting. `$...$` is inline math inside prose,
// `$$...$$` is a display equation on its own centered line. KaTeX renders to HTML that
// we inject through a single audited seam (see MathSpan): KaTeX's own output is the only
// thing that ever reaches dangerouslySetInnerHTML, produced from a string we hand it with
// trust:false + strict:false, so a malformed formula renders as a visible error token
// rather than throwing or escaping into markup.
//
// Why a hand-rolled splitter instead of a markdown-math plugin: the transcript's prose
// pipeline (sentence pacing, vocab highlighting, the safe inline-markdown subset) works on
// plain strings. Math has to slot into THAT, per text run, without pulling in a parser that
// would want to own the whole pipeline.

export type MathRun =
  | { kind: "text"; text: string }
  | { kind: "math"; tex: string; display: boolean };

// $$…$$ first (greedy pairs of doubles), then single $…$ that is NOT part of a $$ pair.
//
// Prose contains dollars that are money, not mathematics, and "it cost $5 and $8 total"
// must not typeset " 5 and " as a formula. Three rules make the single-dollar form safe:
// the body may not START or END with whitespace, it may not span a newline, and the
// closing $ may not be followed by a digit — which is what rejects the money case, since
// there the "closing" delimiter is really the next price's opening one.
const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^\s$](?:[^$\n]*[^\s$])?)\$(?![0-9])/g;

export function splitMath(text: string): MathRun[] {
  const runs: MathRun[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  MATH_RE.lastIndex = 0;
  while ((match = MATH_RE.exec(text))) {
    if (match.index > cursor) runs.push({ kind: "text", text: text.slice(cursor, match.index) });
    const display = match[1] !== undefined;
    runs.push({ kind: "math", tex: (display ? match[1] : match[2]).trim(), display });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) runs.push({ kind: "text", text: text.slice(cursor) });
  return runs;
}

export function hasMath(text: string): boolean {
  MATH_RE.lastIndex = 0;
  return MATH_RE.test(text);
}

// The ONE injection seam in the math path. The html is always KaTeX's own output for the
// given source: renderToString with throwOnError:false returns a styled error node for bad
// input rather than raising, and trust:false disables \href/\htmlClass/\includegraphics —
// the macros that could otherwise emit attacker-chosen markup or URLs.
function MathSpan({ tex, display }: { tex: string; display: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: false,
        output: "html",
      });
    } catch {
      return "";
    }
  }, [tex, display]);
  if (!html) {
    // Total failure (never expected — throwOnError:false handles bad TeX): show the source
    // so the student still sees the formula the mentor meant to write.
    return <code className="font-mono text-[0.9em]">{tex}</code>;
  }
  return (
    <span
      className={display ? "math-display" : "math-inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Renders one text run, math-aware. `renderText` is how the CALLER wants ordinary prose
// rendered (vocab highlighting, inline markdown, plain text — the transcript and the
// welcome/step surfaces each pass their own), so math slots into any pipeline without
// duplicating it.
export function renderWithMath(
  text: string,
  renderText: (part: string, key: string) => React.ReactNode,
  keyBase = "m",
): React.ReactNode[] {
  if (!hasMath(text)) return [renderText(text, `${keyBase}-0`)];
  return splitMath(text).map((run, i) =>
    run.kind === "math" ? (
      <MathSpan key={`${keyBase}-${i}`} tex={run.tex} display={run.display} />
    ) : (
      renderText(run.text, `${keyBase}-${i}`)
    ),
  );
}

// Standalone equation, for surfaces that hold a formula and nothing else (the composer's
// live preview, a step prompt's display line).
export function MathPreview({ tex, display = true }: { tex: string; display?: boolean }) {
  return <MathSpan tex={tex} display={display} />;
}
