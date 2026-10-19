/**
 * Pure rules for the optional "Help improve SpotOn" research sharing.
 *
 * Kept import-free (types aside) so scripts/test-research-core.mjs can compile and pin it with the
 * project's own tsc, the same way test-tps.mjs pins tps-core.ts. Everything that decides WHAT
 * leaves the phone lives here; research-queue.ts only does the I/O.
 *
 * The API contract is SpotOn-backend routers/research.py (POST /research/samples). The server
 * re-validates every field - these checks exist so a sample that would be rejected is never sent,
 * and so nothing outside the agreed list can be sent by accident.
 */
import type { Answer, LesionClass, QuestionId, TriageTier } from './triage/tps-core';

/**
 * Bump whenever the consent copy changes (research-consent-sheet.tsx, privacy §6/§10/§16). A user
 * who agreed to an older version is asked again, and uploads pause until they answer - the server
 * rejects a sample whose version differs from the user's current consent (409).
 */
export const RESEARCH_CONSENT_VERSION = '2026-10-v1';

/**
 * When shared samples are deleted. PLACEHOLDER - confirm with the adviser / ethics board and keep
 * it in step with privacy.tsx §11 before RESEARCH_SHARING_ENABLED is turned on in production.
 */
export const RESEARCH_RETENTION_END = 'December 2027';

/**
 * A server-side transient failure (401 after refresh, 408, 429, 5xx) is retried this many times,
 * then the sample is dropped. With the backoff below that rides out ~4 h of API outage. Being
 * OFFLINE never counts: a sample waits for the connection however long it takes.
 */
export const MAX_UPLOAD_ATTEMPTS = 10;
/** Server limit is 600_000 bytes; a 512 px JPEG is ~50-150 KB, so this only catches a broken encode. */
export const MAX_SAMPLE_BYTES = 600_000;
export const SAMPLE_MAX_SIDE = 512;
export const SAMPLE_JPEG_QUALITY = 0.85;

/** Skin-gate cut-offs (skin-gate.ts probabilities). Anything face-like or not-skin is never sent. */
export const FACE_SKIP_AT = 0.3;
export const SKIN_MIN = 0.5;

/** Regions whose photos can identify a person (face, scalp/hairline). Never shared. */
export const BLOCKED_REGIONS: readonly string[] = ['Head / Face', 'Back of head'];

/**
 * Every label resolveRegionFromPoint (body-regions.ts) can produce, in English. The server stores
 * anything else as null. Listed here rather than imported because body-regions.ts pulls in three.js.
 */
export const RESEARCH_REGIONS: readonly string[] = [
  'Head / Face', 'Back of head', 'Neck', 'Nape',
  'Left upper arm', 'Left elbow', 'Left forearm', 'Left hand',
  'Right upper arm', 'Right elbow', 'Right forearm', 'Right hand',
  'Left thigh', 'Left lower leg', 'Left foot',
  'Right thigh', 'Right lower leg', 'Right foot',
  'Chest', 'Upper back', 'Abdomen', 'Mid back', 'Lower abdomen', 'Lower back',
];

export const QUESTION_IDS: readonly QuestionId[] = [
  'evolution', 'bleeding_nonhealing', 'irregular_border', 'spontaneous_bleeding',
  'rough_scaly', 'larger_7mm', 'ugly_duckling', 'persistent_2mo',
];
export const CLASS_KEYS: readonly LesionClass[] = ['MEL', 'BCC', 'SCC', 'OTHER', 'BENIGN'];
const TIERS: readonly TriageTier[] = ['low', 'moderate', 'high', 'critical'];
const ANSWERS: readonly Answer[] = ['yes', 'no', 'unsure'];
const SEXES = ['male', 'female', 'intersex', 'other', 'prefer_not_to_say'] as const;

export type AgeBand = '18-29' | '30-39' | '40-49' | '50-59' | '60-69' | '70+';

/** The subset of UserProfile these rules read. Every field optional: old cached profiles lack them. */
export type ResearchUser = {
  date_of_birth?: string | null;
  sex?: string | null;
  fitzpatrick_skin_type?: number | null;
  research_consent?: boolean;
  research_consent_version?: string | null;
  research_sharing_enabled?: boolean;
};

/**
 * May this account's new screenings be shared right now? Missing fields (a profile cached from a
 * server without migration 021) read as "no". A consent to an older version also reads as "no"
 * until the user answers the new ask.
 */
export function canShareResearch(user: ResearchUser | null | undefined): boolean {
  return Boolean(
    user?.research_sharing_enabled &&
      user.research_consent === true &&
      user.research_consent_version === RESEARCH_CONSENT_VERSION,
  );
}

/**
 * Should the one-time ask appear? Only with the server flag on, only if this account has not
 * answered the current version on the server (Share or a Settings change), and not dismissed it
 * locally with "Not now" (`localAnsweredVersion`).
 */
export function shouldAskResearch(
  user: ResearchUser | null | undefined,
  localAnsweredVersion: string | null,
): boolean {
  if (!user?.research_sharing_enabled) return false;
  if (user.research_consent_version === RESEARCH_CONSENT_VERSION) return false;
  return localAnsweredVersion !== RESEARCH_CONSENT_VERSION;
}

/**
 * Ten-year age band from an ISO date of birth. The birth date itself never leaves the phone.
 * Under 18 (the app is 18+) and unparseable dates give null rather than a guess.
 */
export function ageBand(dateOfBirth: string | null | undefined, now: Date): AgeBand | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age--;
  if (!Number.isFinite(age) || age < 18 || age > 130) return null;
  if (age < 30) return '18-29';
  if (age < 40) return '30-39';
  if (age < 50) return '40-49';
  if (age < 60) return '50-59';
  if (age < 70) return '60-69';
  return '70+';
}

/** `YYYY-MM` of an ISO timestamp, in UTC. The exact date and time are never sent. */
export function capturedMonth(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The English label for a stored `mark.region`.
 *
 * body-regions.ts runs its labels through t() at tap time, so a mark placed while the app was in
 * Filipino is stored in Filipino. `toFilipino` is translate(en, undefined, 'fil'); matching the
 * stored text against it maps back. Unknown text gives null, which the server also stores as null.
 */
export function englishRegion(
  stored: string | null | undefined,
  toFilipino: (english: string) => string,
): string | null {
  if (!stored) return null;
  const s = stored.trim();
  for (const en of RESEARCH_REGIONS) {
    if (en === s || toFilipino(en) === s) return en;
  }
  return null;
}

export function isBlockedRegion(english: string | null): boolean {
  return english != null && BLOCKED_REGIONS.includes(english);
}

/** Why the skin gate rules a prepared photo out, or null when it may be shared. */
export function skinGateSkipReason(p: { skin: number; face: number }): string | null {
  if (!Number.isFinite(p.face) || !Number.isFinite(p.skin)) return 'gate-invalid';
  if (p.face >= FACE_SKIP_AT) return 'face';
  if (p.skin < SKIN_MIN) return 'not-skin';
  return null;
}

/**
 * What to do with a sample after the server answered `status` (0 = no response at all).
 * - sent:    stored (201) or already stored (200 duplicate)
 * - consent: 403/409 - the server no longer accepts this account's samples (consent withdrawn
 *            elsewhere, flag off, or a version mismatch). Stop draining and refetch /me.
 * - failed:  413/415/422 or any other 4xx - this sample can never succeed. No retry.
 * - retry:   offline, timeout, 401 after a refresh, 429, 5xx.
 */
/** 'offline' = no response at all: wait for the connection, without using up an attempt. */
export type UploadOutcome = 'sent' | 'consent' | 'failed' | 'retry' | 'offline';

export function classifyUploadStatus(status: number): UploadOutcome {
  if (status === 0) return 'offline';
  if (status >= 200 && status < 300) return 'sent';
  if (status === 403 || status === 409) return 'consent';
  if (status === 401 || status === 408 || status === 429 || status >= 500) return 'retry';
  return 'failed';
}

/** How long to wait before the next drain after `attempts` transient failures: 30s, 1m, 2m, 4m... */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
}

export type SampleMeta = {
  client_sample_id: string;
  consent_version: string;
  body_region: string | null;
  age_band: AgeBand | null;
  sex: (typeof SEXES)[number] | null;
  fitzpatrick: number | null;
  answers: Partial<Record<QuestionId, Answer>>;
  probs: Record<LesionClass, number>;
  top_class: LesionClass;
  tier: TriageTier;
  model_version: string;
  captured_month: string;
};

export type SampleSource = {
  id: string;
  createdAt: string;
  /** Already mapped through englishRegion. */
  region: string | null;
  answers: Record<string, string>;
  probs: Record<string, number>;
  topClass: string;
  tier: string;
  modelVersion: string;
};

/**
 * The `meta` field of POST /research/samples - and nothing else. Built from an allow-list, so a
 * new column on the screening or the profile cannot leak into a sample by being spread in.
 * Returns null when the screening cannot form a valid sample (the caller marks it skipped).
 */
export function buildSampleMeta(s: SampleSource, user: ResearchUser, now: Date): SampleMeta | null {
  const month = capturedMonth(s.createdAt);
  if (!month || !s.id || s.id.length > 64) return null;
  if (!CLASS_KEYS.includes(s.topClass as LesionClass)) return null;
  if (!TIERS.includes(s.tier as TriageTier)) return null;

  const probs = {} as Record<LesionClass, number>;
  for (const k of CLASS_KEYS) {
    const v = s.probs?.[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    probs[k] = Math.min(1, Math.max(0, v));
  }

  const answers: Partial<Record<QuestionId, Answer>> = {};
  for (const q of QUESTION_IDS) {
    const a = s.answers?.[q];
    if (ANSWERS.includes(a as Answer)) answers[q] = a as Answer;
  }

  const fitz = user.fitzpatrick_skin_type;
  const sex = SEXES.find((x) => x === user.sex) ?? null;
  return {
    client_sample_id: s.id,
    consent_version: RESEARCH_CONSENT_VERSION,
    body_region: s.region && RESEARCH_REGIONS.includes(s.region) ? s.region : null,
    age_band: ageBand(user.date_of_birth, now),
    sex,
    fitzpatrick: typeof fitz === 'number' && Number.isInteger(fitz) && fitz >= 1 && fitz <= 6 ? fitz : null,
    answers,
    probs,
    top_class: s.topClass as LesionClass,
    tier: s.tier as TriageTier,
    model_version: (s.modelVersion || 'unknown').slice(0, 64),
    captured_month: month,
  };
}
