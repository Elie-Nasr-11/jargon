// Phase B/C client mirror of the server's mastery math (chat fn): an idea's EFFECTIVE
// strength is its stored EMA score with read-time decay — floored at 40%, so knowledge
// fades toward "needs a refresh", never to zero. Keep in sync with the server constants.
export const MASTERY_DECAY_DAYS = 45;
export const MASTERY_DECAY_FLOOR = 0.4;

export type IdeaMasteryRow = {
  idea_key: string;
  score: number;
  attempts: number;
  last_evidence_at: string | null;
};

export function effectiveMastery(score: number, lastEvidenceAt: string | null): number {
  const base = Math.max(0, Math.min(1, Number(score) || 0));
  const at = lastEvidenceAt ? Date.parse(lastEvidenceAt) : NaN;
  if (!Number.isFinite(at)) return base;
  const days = Math.max(0, (Date.now() - at) / 86_400_000);
  return base * Math.max(MASTERY_DECAY_FLOOR, Math.exp(-days / MASTERY_DECAY_DAYS));
}

// The student-facing bands: solid (secure), growing (in progress), refresh (fading or
// never landed). Only rows with attempts > 0 count — no claims without evidence.
export function masteryBands(rows: IdeaMasteryRow[]): {
  solid: number;
  growing: number;
  refresh: number;
  byKey: Map<string, number>;
} {
  const byKey = new Map<string, number>();
  let solid = 0;
  let growing = 0;
  let refresh = 0;
  for (const row of rows) {
    if (!(Number(row.attempts) > 0)) continue;
    const effective = effectiveMastery(row.score, row.last_evidence_at);
    byKey.set(row.idea_key, effective);
    if (effective >= 0.75) solid += 1;
    else if (effective >= 0.4) growing += 1;
    else refresh += 1;
  }
  return { solid, growing, refresh, byKey };
}
