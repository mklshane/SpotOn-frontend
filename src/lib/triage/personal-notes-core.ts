/**
 * "For you" notes - the per-account layer on top of a triage result.
 *
 * The tier, timeframe and priority action are the physician-validated TPS output and are the same
 * for everyone with the same scan (tps-core.ts, pinned by test:tps). What differs between people is
 * *why it matters to them*: their own risk factors, age, skin type, where the spot is, and how this
 * spot has changed. This module picks which of those notes apply. It never reads or changes the
 * tier's urgency - only `tier === 'low'` gates the UV tip, which is sun-protection advice rather
 * than a triage statement.
 *
 * Kept apart from the other result-screen copy on purpose:
 *  - symptom answers are already turned into an action by reportedPriorityFinding()
 *    (priority-findings.ts), and
 *  - class-specific guidance lives in getConditionGuide() (condition-guides.ts),
 * so neither is repeated here. This file only covers inputs those two never see.
 *
 * Import-free (like tps-core.ts and lesion-trend.ts) so scripts/test-personal-notes.mjs can compile
 * it standalone. It returns ids, not text: the copy is literal t() calls in personal-notes.ts, so it
 * translates at render time and the i18n coverage test sees every key.
 */

export type NoteTier = 'low' | 'moderate' | 'high' | 'critical';
export type NoteAnswer = 'yes' | 'no' | 'unsure';

export type PersonalNoteId =
  | 'trend_worse'
  | 'history_personal'
  | 'history_family'
  | 'site_acral'
  | 'age_minor'
  | 'age_50'
  | 'sun_exposure'
  | 'site_head'
  | 'skin_dark'
  | 'skin_light'
  | 'site_back'
  | 'trend_stable'
  | 'uv_high';

/**
 * Display order, most decision-relevant first. A change in this spot outranks everything: it is
 * what a clinician reads first (lesion-trend.ts). Personal/family history are the strongest
 * account-level risk factors; reassurance and the UV tip come last.
 */
export const NOTE_PRIORITY: readonly PersonalNoteId[] = [
  'trend_worse',
  'history_personal',
  'history_family',
  'site_acral',
  'age_minor',
  'age_50',
  'sun_exposure',
  'site_head',
  'skin_dark',
  'skin_light',
  'site_back',
  'trend_stable',
  'uv_high',
];

/** Enough to stay a short card under "What this means" rather than a second report. */
export const MAX_NOTES = 4;

/** UV index at which WHO advises extra protection ("very high" starts at 8; 6-7 is "high"). */
export const UV_HIGH = 6;

/** Palms, soles and nails - where acral melanoma appears (body-regions.ts labels, English). */
const ACRAL = /\b(hand|foot)\b/i;
/** Chronically sun-exposed head and neck, where BCC/SCC cluster. */
const HEAD_NECK = /^(Head \/ Face|Back of head|Neck|Nape)$/;
/** Places a person cannot see well on their own. */
const HARD_TO_SEE = /^(Upper back|Mid back|Lower back|Back of head|Nape)$/;

const TIER_RANK: Record<NoteTier, number> = { low: 0, moderate: 1, high: 2, critical: 3 };

/** The two most recent prior screenings' facts this module needs. Structurally typed. */
export type NoteTrend = {
  /** Screenings of this spot including the current one. */
  count: number;
  /** The screening before this one: when it was and what it scored. */
  previousAt: string | null;
  previousTier: NoteTier | null;
  /** True when any symptom answer moved toward the more concerning one since the previous check. */
  answerWorsened: boolean;
  /** True when the two screenings were scored by different classifier versions. */
  modelChanged: boolean;
};

export type PersonalNoteInput = {
  tier: NoteTier;
  /** Stored English region label (BodyMark.region), or null when not marked. */
  region: string | null;
  /** ISO date of birth, or null/undefined when the profile lacks it. */
  dateOfBirth?: string | null;
  fitzpatrick?: number | null;
  personalHistory?: NoteAnswer | null;
  familyHistory?: NoteAnswer | null;
  highSunExposure?: boolean | null;
  trend?: NoteTrend | null;
  /** Today's peak UV (or current UV), when the weather card has it. */
  uvIndex?: number | null;
  /** When the screening was taken - age is measured at this date, not today. */
  at: string;
};

export type PersonalNote = {
  id: PersonalNoteId;
  /** Values the copy interpolates: the previous screening date, today's UV. */
  params?: { since?: string; uv?: number };
};

/** Whole years between an ISO date of birth and `at`; null when either is unparseable. */
export function ageAt(dateOfBirth: string | null | undefined, at: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  const when = new Date(at);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(when.getTime())) return null;
  let age = when.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    when.getUTCMonth() < dob.getUTCMonth() ||
    (when.getUTCMonth() === dob.getUTCMonth() && when.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * Which notes apply, in display order, capped at MAX_NOTES. Every input is optional except the tier
 * and timestamp: a profile without DOB, skin type or risk answers just yields fewer notes.
 */
export function selectPersonalNotes(input: PersonalNoteInput): PersonalNote[] {
  const picked = new Map<PersonalNoteId, PersonalNote>();
  const add = (id: PersonalNoteId, params?: PersonalNote['params']) => picked.set(id, { id, params });

  const trend = input.trend;
  if (trend && trend.count >= 2 && trend.previousTier && trend.previousAt) {
    // A tier rise across a model swap may be the model's doing, not the spot's - lesion-trend.ts
    // makes the UI say so. Answer flips are the user's own report, so they count either way.
    const tierRose = !trend.modelChanged && TIER_RANK[input.tier] > TIER_RANK[trend.previousTier];
    if (tierRose || trend.answerWorsened) {
      add('trend_worse', { since: trend.previousAt });
    } else if (!trend.modelChanged && TIER_RANK[input.tier] === TIER_RANK[trend.previousTier]) {
      add('trend_stable', { since: trend.previousAt });
    }
  }

  if (input.personalHistory === 'yes') add('history_personal');
  if (input.familyHistory === 'yes') add('history_family');
  if (input.highSunExposure === true) add('sun_exposure');

  const region = input.region ?? '';
  if (ACRAL.test(region)) add('site_acral');
  if (HEAD_NECK.test(region)) add('site_head');
  if (HARD_TO_SEE.test(region)) add('site_back');

  const age = ageAt(input.dateOfBirth, input.at);
  if (age != null && age < 18) add('age_minor');
  if (age != null && age >= 50) add('age_50');

  const fitz = input.fitzpatrick;
  if (fitz != null && Number.isInteger(fitz) && fitz >= 1 && fitz <= 6) {
    // The acral note already speaks to darker skin; saying it twice wastes a slot.
    if (fitz >= 4 && !picked.has('site_acral')) add('skin_dark');
    if (fitz <= 3) add('skin_light');
  }

  if (input.tier === 'low' && input.uvIndex != null && Number.isFinite(input.uvIndex) && input.uvIndex >= UV_HIGH) {
    add('uv_high', { uv: Math.round(input.uvIndex) });
  }

  return NOTE_PRIORITY.filter((id) => picked.has(id))
    .slice(0, MAX_NOTES)
    .map((id) => picked.get(id)!);
}
