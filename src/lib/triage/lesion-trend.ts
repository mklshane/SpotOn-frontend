/**
 * Change summary for a tracked lesion.
 *
 * A clinician reads *change*, not a single reading — a stable mole and a mole that went
 * Low → High in three months are completely different situations even when today's tier is the
 * same. This turns a lesion's screenings into the deltas worth showing.
 *
 * Deliberately import-free and structurally typed (no dependency on ScreeningRecord), so it can be
 * compiled standalone by scripts/test-lesion-trend.mjs the way tps-core.ts is by test-tps.mjs.
 */

export type TrendTier = 'low' | 'moderate' | 'high' | 'critical';
export type TrendAnswer = 'yes' | 'no' | 'unsure';

/** The minimum shape this module needs; ScreeningRecord satisfies it structurally. */
export type TrendScreening = {
  id: string;
  createdAt: string;
  classification: { topClass: string; topConfidence: number; probs: Record<string, number> };
  triage: { tier: TrendTier; tps: number; malignantScore: number };
  questionnaire: { answers: Record<string, TrendAnswer> };
};

export type AnswerFlip = {
  id: string;
  from: TrendAnswer;
  to: TrendAnswer;
  /** True when the change is toward the more concerning answer ("no"/"unsure" → "yes"). */
  worsened: boolean;
};

export type LesionTrend = {
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Whole days between the first and most recent screening. */
  spanDays: number;
  /** Days since the most recent screening, relative to `now`. */
  daysSinceLast: number;
  first: TrendScreening | null;
  latest: TrendScreening | null;
  previous: TrendScreening | null;
  tierFrom: TrendTier | null;
  tierTo: TrendTier | null;
  /** +1 more urgent, -1 less urgent, 0 unchanged, null when there's nothing to compare. */
  tierDirection: 1 | 0 | -1 | null;
  /** Change in TPS from the first screening to the latest. */
  tpsDelta: number | null;
  /** Change in malignant score (BCC+MEL+SCC mass) from the first screening to the latest. */
  malignantDelta: number | null;
  /** True when the predicted class is not the same across every screening. */
  classChanged: boolean;
  /** Answers that differ between the two most recent screenings. */
  answerFlips: AnswerFlip[];
  /** The TPS series, oldest first — the sparkline's input. */
  tpsSeries: { at: string; tps: number; tier: TrendTier }[];
};

const TIER_ORDER: readonly TrendTier[] = ['low', 'moderate', 'high', 'critical'];

/** Position on the urgency ladder; -1 for an unrecognized tier. */
export function tierRank(tier: TrendTier): number {
  return TIER_ORDER.indexOf(tier);
}

const DAY_MS = 86_400_000;

/** Whole days between two ISO timestamps. Negative results clamp to 0. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

/**
 * Summarize a lesion's screenings. Input may be in any order — it is sorted oldest-first here so
 * callers can pass a cache slice without worrying about it.
 *
 * `now` is injected rather than read from the clock so the summary is deterministic under test.
 */
export function summarizeLesionTrend(
  screenings: readonly TrendScreening[],
  now: string = new Date().toISOString(),
): LesionTrend {
  const sorted = [...screenings].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const count = sorted.length;
  const first = count ? sorted[0] : null;
  const latest = count ? sorted[count - 1] : null;
  const previous = count > 1 ? sorted[count - 2] : null;

  const tierFrom = first?.triage.tier ?? null;
  const tierTo = latest?.triage.tier ?? null;
  let tierDirection: LesionTrend['tierDirection'] = null;
  if (count > 1 && tierFrom && tierTo) {
    const d = tierRank(tierTo) - tierRank(tierFrom);
    tierDirection = d > 0 ? 1 : d < 0 ? -1 : 0;
  }

  // Flips are measured between the two most recent screenings — "what changed since last time" —
  // rather than against the first, which would keep re-reporting a change the user already saw.
  const answerFlips: AnswerFlip[] = [];
  if (latest && previous) {
    for (const id of Object.keys(latest.questionnaire.answers)) {
      const to = latest.questionnaire.answers[id];
      const from = previous.questionnaire.answers[id];
      if (from !== undefined && to !== undefined && from !== to) {
        answerFlips.push({ id, from, to, worsened: to === 'yes' });
      }
    }
  }

  return {
    count,
    firstAt: first?.createdAt ?? null,
    lastAt: latest?.createdAt ?? null,
    spanDays: first && latest ? daysBetween(first.createdAt, latest.createdAt) : 0,
    daysSinceLast: latest ? daysBetween(latest.createdAt, now) : 0,
    first,
    latest,
    previous,
    tierFrom,
    tierTo,
    tierDirection,
    tpsDelta: count > 1 && first && latest ? latest.triage.tps - first.triage.tps : null,
    malignantDelta:
      count > 1 && first && latest
        ? latest.triage.malignantScore - first.triage.malignantScore
        : null,
    classChanged: new Set(sorted.map((s) => s.classification.topClass)).size > 1,
    answerFlips,
    tpsSeries: sorted.map((s) => ({ at: s.createdAt, tps: s.triage.tps, tier: s.triage.tier })),
  };
}
