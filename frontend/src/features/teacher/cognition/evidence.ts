/**
 * Reading the evidence a scored response already carries.
 *
 * The judge has written `evidence` and `signals` on every turn since R90, and the
 * teacher has never seen either: the panel fetched both, typed both, and rendered
 * neither. That made §8 ("the system should identify AI-supplied concepts, reasoning,
 * vocabulary, examples, sentence structure, and student-originated additions") a claim
 * the product made to itself. These helpers turn the stored shapes into what a teacher
 * reads, and they hold the one rule that governs how: counts and quotes, never a score.
 *
 * Everything here tolerates missing keys. Rows written before R99 carry the two older
 * free-text attribution strings and no per-category lists; rows written before this
 * release have no `sentences` either. An absent field renders as nothing, never as 0.
 */

/** The five things §8 asks the system to separate, in the document's own order. */
export const ATTRIBUTION_CATEGORIES = [
  "concepts",
  "reasoning",
  "vocabulary",
  "examples",
  "sentence_structure",
] as const;

export type AttributionCategory = (typeof ATTRIBUTION_CATEGORIES)[number];

export const ATTRIBUTION_LABELS: Record<AttributionCategory, string> = {
  concepts: "Concepts",
  reasoning: "Reasoning",
  vocabulary: "Vocabulary",
  examples: "Examples",
  sentence_structure: "Sentence shape",
};

export type AttributionSide = { category: AttributionCategory; label: string; quotes: string[] };

function quoteList(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === "string" && value.trim() ? [value.trim()] : [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 6);
}

/**
 * One side of the §8 split — what the tutor supplied, or what the student added —
 * as the categories that actually hold something. An empty result means the judge had
 * nothing to attribute on that side, which is itself readable ("nothing came from the
 * tutor"), so the caller decides whether to say so.
 */
export function attributionSide(
  evidence: Record<string, unknown> | null | undefined,
  side: "ai_supplied" | "student_originated",
): AttributionSide[] {
  const attribution = evidence?.attribution;
  if (!attribution || typeof attribution !== "object") return [];
  const bucket = (attribution as Record<string, unknown>)[side];
  if (!bucket || typeof bucket !== "object") return [];
  const rows: AttributionSide[] = [];
  for (const category of ATTRIBUTION_CATEGORIES) {
    const quotes = quoteList((bucket as Record<string, unknown>)[category]);
    if (quotes.length) rows.push({ category, label: ATTRIBUTION_LABELS[category], quotes });
  }
  return rows;
}

/** The pre-R99 free-text fallback, so old rows still show their attribution. */
export function attributionFallback(
  evidence: Record<string, unknown> | null | undefined,
  side: "ai_supplied" | "student_originated",
): string {
  const value = evidence?.[side];
  return typeof value === "string" ? value.trim() : "";
}

/** Per-dimension quotes: the 3-12 words the judge said grounded each score. */
export function dimensionQuotes(
  evidence: Record<string, unknown> | null | undefined,
  dimensions: readonly string[],
): Array<{ dimension: string; quote: string }> {
  if (!evidence) return [];
  const rows: Array<{ dimension: string; quote: string }> = [];
  for (const dimension of dimensions) {
    const value = evidence[dimension];
    if (typeof value === "string" && value.trim()) rows.push({ dimension, quote: value.trim() });
  }
  return rows;
}

const SIGNAL_NOUNS: Array<[string, string, string]> = [
  ["words", "word", "words"],
  ["sentences", "sentence", "sentences"],
  ["propositions", "idea", "ideas"],
  ["subject_terms", "subject term", "subject terms"],
  ["causal_links", "causal link", "causal links"],
  ["comparisons", "comparison", "comparisons"],
  ["conditionals", "conditional", "conditionals"],
  ["examples", "example", "examples"],
  ["self_corrections", "self-correction", "self-corrections"],
  ["concepts_introduced", "new concept", "new concepts"],
];

/**
 * §12's underlay as one line a teacher can skim: "42 words · 3 sentences · 2 causal
 * links". Zero-valued signals are dropped rather than printed, because "0 comparisons"
 * on a two-word answer is noise, not a finding.
 */
export function signalsLine(signals: Record<string, unknown> | null | undefined): string {
  if (!signals) return "";
  const parts: string[] = [];
  for (const [key, one, many] of SIGNAL_NOUNS) {
    const value = Number(signals[key]);
    if (!Number.isFinite(value) || value <= 0) continue;
    parts.push(`${value} ${value === 1 ? one : many}`);
  }
  return parts.join(" · ");
}

/**
 * §8's traceable share, in words.
 *
 * Deliberately not a percentage. The rubric's whole shape is that a number standing
 * alone invites being read as a grade (§15), and "68% AI-supplied" is exactly the
 * sentence a teacher would repeat to a parent. Three bands say the same thing without
 * inviting the arithmetic.
 */
export function traceableShareLabel(signals: Record<string, unknown> | null | undefined): string {
  const raw = Number(signals?.ai_traceable_share);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return "";
  if (raw <= 0.33) return "Mostly their own thinking";
  if (raw <= 0.66) return "About half came from the tutor";
  return "Mostly reproduced from the tutor";
}
