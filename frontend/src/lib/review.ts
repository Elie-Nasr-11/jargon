// Post-v4.0 Phase 4: display formatters for the spaced-review surfaces (chip + profile panel).
// Kept out of the component file so those stay fast-refresh-clean, and pure so they're testable.

export function humanizeSkillKey(key: string): string {
  const cleaned = key.replace(/[-_]+/g, " ").trim();
  if (!cleaned) return key;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function practicedAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "not practiced yet";
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "practiced today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
