// The ONE place scores/dates/relative times get formatted for the student surface. Before this,
// six local formatters disagreed on whether a score > 1 was already a percentage — the same
// grade could render differently across the gradebook, calendar, profile, and quiz result.

// Scores are stored 0..1; legacy rows may carry 0..100. Normalize both to a whole percent.
export function formatScore(score: number | null | undefined, fallback = "—"): string {
  if (score === null || score === undefined || Number.isNaN(score)) return fallback;
  const value = score <= 1 ? score * 100 : score;
  return `${Math.round(value)}%`;
}

// Short day label ("Jul 6") for due dates and submissions.
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Compact "just now / 5m ago / 3h ago / 2d ago" for feeds.
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
