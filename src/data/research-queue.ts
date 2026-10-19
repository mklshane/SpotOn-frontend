/**
 * Upload queue for the optional "Help improve SpotOn" research sharing.
 *
 * The queue is three columns on `screenings` (schema v20): research_status NULL | 'pending' |
 * 'sent' | 'skipped' | 'failed', research_shared_at, research_attempts. A row is only ever marked
 * 'pending' by `enqueueResearchSample`, which the save path calls for a screening saved while the
 * account has consented - so history from before consent is never uploaded, by construction.
 *
 * Everything here is fire-and-forget from the scan flow's point of view: no function the save path
 * calls may throw into it or make it wait on the network. Failures are logged and retried later.
 *
 * Per sample, in order (each step can only remove the sample, never add data):
 *   1. region guard - head/face/scalp marks are never shared (research-core BLOCKED_REGIONS)
 *   2. re-encode the primary crop to <=512 px JPEG q0.85 on the phone. A fresh encode carries no
 *      EXIF, so GPS, camera model and capture time are gone before anything is sent
 *   3. skin gate on the re-encoded image - a face (>= 0.3) or not-skin (< 0.5) is skipped
 *   4. meta from an allow-list (research-core buildSampleMeta): age band, never the birth date
 *   5. multipart POST /research/samples with refresh-on-401, same as the avatar upload in profile.ts
 */
import { Platform } from 'react-native';

import { ApiError } from '@/api/client';
import type { UserProfile } from '@/api/types';
import { API_BASE_URL } from '@/config';
import { getActiveAccountId } from '@/lib/account-scope';
import { translate } from '@/lib/i18n';
import {
  MAX_SAMPLE_BYTES,
  MAX_UPLOAD_ATTEMPTS,
  SAMPLE_JPEG_QUALITY,
  SAMPLE_MAX_SIDE,
  buildSampleMeta,
  canShareResearch,
  classifyUploadStatus,
  englishRegion,
  isBlockedRegion,
  retryDelayMs,
  skinGateSkipReason,
  type SampleMeta,
  type UploadOutcome,
} from '@/lib/research-core';

import { getDb } from './db';
import { getScreening } from './screening-repo';

export type ResearchStatus = 'pending' | 'sent' | 'skipped' | 'failed';

// ---------------------------------------------------------------- account context
/**
 * The signed-in profile, pushed in by ScanHistoryProvider. The drain re-reads it before every
 * sample, so withdrawing in Settings (or signing out) stops an in-flight drain at the next item.
 */
let currentUser: UserProfile | null = null;
/** Called with a fresh /me after the server refused a sample for consent reasons (403/409). */
let onProfileRefreshed: ((user: UserProfile) => void) | null = null;

export function setResearchContext(
  user: UserProfile | null,
  onProfile: ((user: UserProfile) => void) | null,
): void {
  currentUser = user;
  onProfileRefreshed = onProfile;
}

// ---------------------------------------------------------------- queue rows
/** Mark a just-saved screening for sharing. Only call this for a screening saved under consent. */
export async function enqueueResearchSample(screeningId: string, userId: string): Promise<void> {
  const db = await getDb();
  // A retried save rewrites the row (INSERT OR REPLACE), which resets these columns anyway; the
  // guard keeps a sample the server already has from being sent twice in any other path.
  await db.runAsync(
    `UPDATE screenings SET research_status = 'pending', research_attempts = 0
      WHERE id = ? AND user_id = ? AND (research_status IS NULL OR research_status <> 'sent')`,
    screeningId,
    userId,
  );
}

async function setStatus(
  id: string,
  userId: string,
  status: ResearchStatus,
  attempts?: number,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE screenings
        SET research_status = ?, research_shared_at = ?,
            research_attempts = COALESCE(?, research_attempts)
      WHERE id = ? AND user_id = ? AND research_status = 'pending'`,
    status,
    status === 'sent' ? new Date().toISOString() : null,
    attempts ?? null,
    id,
    userId,
  );
}

/**
 * Forget every queued and sent marker for an account - on withdrawal, after which the server holds
 * nothing for it. Pending samples are dropped, not sent later: consent ended before they left.
 */
export async function clearResearchQueue(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE screenings SET research_status = NULL, research_shared_at = NULL, research_attempts = 0
      WHERE user_id = ? AND research_status IS NOT NULL`,
    userId,
  );
}

/** After "Delete my shared photos": the server copies are gone, so drop the 'sent' markers. */
export async function forgetSentSamples(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE screenings SET research_status = NULL, research_shared_at = NULL
      WHERE user_id = ? AND research_status = 'sent'`,
    userId,
  );
}

async function listPending(userId: string): Promise<{ id: string; attempts: number }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; research_attempts: number | null }>(
    `SELECT id, research_attempts FROM screenings
      WHERE user_id = ? AND research_status = 'pending' ORDER BY created_at ASC LIMIT 10`,
    userId,
  );
  return rows.map((r) => ({ id: r.id, attempts: r.research_attempts ?? 0 }));
}

// ---------------------------------------------------------------- preparing a sample
type Prepared =
  | { kind: 'ready'; uri: string; meta: SampleMeta }
  | { kind: 'skip'; reason: string };

async function prepareSample(screeningId: string, user: UserProfile): Promise<Prepared | null> {
  const record = await getScreening(screeningId, user.id);
  if (!record) return null; // deleted since it was queued

  const region = englishRegion(record.mark?.region, (en) => translate(en, undefined, 'fil'));
  if (isBlockedRegion(region)) return { kind: 'skip', reason: 'region' };

  const primary = record.images[0];
  if (!primary?.uri) return { kind: 'skip', reason: 'no-image' };
  // Development demo-model screenings are not real observations.
  if (primary.demoModel) return { kind: 'skip', reason: 'demo' };

  const meta = buildSampleMeta(
    {
      id: record.id,
      createdAt: record.createdAt,
      region,
      answers: record.questionnaire.answers,
      probs: record.classification.probs,
      topClass: record.classification.topClass,
      tier: record.triage.tier,
      modelVersion: record.classification.modelVersion,
    },
    user,
    new Date(),
  );
  if (!meta) return { kind: 'skip', reason: 'meta' };

  // Lazy: the encoder and the skin-gate model are only needed once something is actually queued.
  const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
  // A no-op pass reads the size (and is already the output when the crop is small enough).
  let out = await manipulateAsync(primary.uri, [], { compress: SAMPLE_JPEG_QUALITY, format: SaveFormat.JPEG });
  const longest = Math.max(out.width, out.height);
  if (longest > SAMPLE_MAX_SIDE) {
    const resize = out.width >= out.height ? { width: SAMPLE_MAX_SIDE } : { height: SAMPLE_MAX_SIDE };
    out = await manipulateAsync(primary.uri, [{ resize }], { compress: SAMPLE_JPEG_QUALITY, format: SaveFormat.JPEG });
  }

  const { classifySkin } = await import('@/lib/skin-gate');
  const gate = skinGateSkipReason(await classifySkin(out.uri));
  if (gate) return { kind: 'skip', reason: gate };

  return { kind: 'ready', uri: out.uri, meta };
}

// ---------------------------------------------------------------- upload
/** HTTP status of the upload, or 0 when no response came back at all (offline, timeout). */
async function uploadSample(uri: string, meta: SampleMeta): Promise<number> {
  const { getAccessToken, refresh } = await import('@/lib/auth-api');
  const metaJson = JSON.stringify(meta);

  const send = async (token: string): Promise<number> => {
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      if (blob.size > MAX_SAMPLE_BYTES) return 413;
      const form = new FormData();
      form.append('file', blob, 'sample.jpg');
      form.append('meta', metaJson);
      const res = await fetch(`${API_BASE_URL}/research/samples`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        body: form,
      });
      return res.status;
    }
    const FileSystem = await import('@/lib/fs');
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && 'size' in info && typeof info.size === 'number' && info.size > MAX_SAMPLE_BYTES) {
      return 413;
    }
    const res = await FileSystem.uploadAsync(`${API_BASE_URL}/research/samples`, uri, {
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      httpMethod: 'POST',
      parameters: { meta: metaJson },
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    return res.status;
  };

  try {
    let token = getAccessToken();
    if (!token) return 401;
    let status = await send(token);
    if (status === 401) {
      token = await refresh();
      if (token) status = await send(token);
    }
    return status;
  } catch (e) {
    console.warn('[research] upload did not reach the server', e);
    return 0;
  }
}

async function removeTemp(uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
    return;
  }
  const FileSystem = await import('@/lib/fs');
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

/** Process one queued sample. Returns what the drain should do next. */
async function processOne(
  item: { id: string; attempts: number },
  user: UserProfile,
): Promise<UploadOutcome | 'skipped' | 'gone'> {
  let prepared: Prepared | null;
  try {
    prepared = await prepareSample(item.id, user);
  } catch (e) {
    // The encoder or the skin-gate model failed. Never upload an unchecked photo: count it as a
    // transient failure so it is retried, and dropped after MAX_UPLOAD_ATTEMPTS.
    console.warn('[research] could not prepare sample', e);
    return 'retry';
  }
  if (!prepared) return 'gone';
  if (prepared.kind === 'skip') {
    console.info(`[research] sample not shared (${prepared.reason})`);
    await setStatus(item.id, user.id, 'skipped');
    return 'skipped';
  }
  try {
    const status = await uploadSample(prepared.uri, prepared.meta);
    const outcome = classifyUploadStatus(status);
    if (outcome === 'sent') await setStatus(item.id, user.id, 'sent');
    else if (outcome === 'failed' || outcome === 'consent') {
      console.warn(`[research] sample rejected (${status})`);
      await setStatus(item.id, user.id, 'failed');
    }
    return outcome;
  } finally {
    await removeTemp(prepared.uri);
  }
}

// ---------------------------------------------------------------- drain
let draining: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Still the same consenting, signed-in account? Checked before every sample. */
function stillSharing(userId: string): UserProfile | null {
  const user = currentUser;
  if (!user || user.id !== userId || getActiveAccountId() !== userId) return null;
  return canShareResearch(user) ? user : null;
}

async function refreshProfileAfterRefusal(userId: string): Promise<void> {
  try {
    const { fetchProfile } = await import('@/lib/profile');
    const me = await fetchProfile();
    if (me.id === userId && getActiveAccountId() === userId) onProfileRefreshed?.(me);
  } catch (e) {
    console.warn('[research] could not refresh profile', e);
  }
}

async function drainOnce(userId: string): Promise<void> {
  for (;;) {
    if (!stillSharing(userId)) return;
    const batch = await listPending(userId);
    if (batch.length === 0) return;
    for (const item of batch) {
      const user = stillSharing(userId);
      if (!user) return;
      const outcome = await processOne(item, user);
      if (outcome === 'consent') {
        // The server stopped accepting this account's samples (withdrawn on another device, a
        // newer consent version, or the flag turned off). Catch up locally; the next ask or a
        // Settings change decides what happens to the rest of the queue.
        await refreshProfileAfterRefusal(userId);
        return;
      }
      if (outcome === 'offline') {
        // No connection. Leave it pending with its attempt count untouched; reconnecting or
        // reopening the app drains again (syncResearchOnReconnect), and this timer is a backstop.
        scheduleRetry(userId, 0, OFFLINE_RECHECK_MS);
        return;
      }
      if (outcome === 'retry') {
        const attempts = item.attempts + 1;
        if (attempts >= MAX_UPLOAD_ATTEMPTS) {
          await setStatus(item.id, userId, 'failed', attempts);
          continue;
        }
        await setStatus(item.id, userId, 'pending', attempts);
        // Probably offline or the server is waking up - stop hammering it and come back later.
        scheduleRetry(userId, attempts);
        return;
      }
    }
  }
}

/** Backstop re-check while offline, for when no reconnect event arrives. */
const OFFLINE_RECHECK_MS = 5 * 60_000;

function scheduleRetry(userId: string, attempts: number, delayMs = retryDelayMs(attempts)): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    drainResearchQueue(userId);
  }, delayMs);
}

/**
 * Upload whatever is queued for this account. Safe to call any time and as often as you like:
 * concurrent calls share one run, and it never throws or rejects.
 */
export function drainResearchQueue(userId: string): void {
  if (draining || !stillSharing(userId)) return;
  draining = drainOnce(userId)
    .catch((e) => console.warn('[research] drain failed', e instanceof ApiError ? e.message : e))
    .finally(() => { draining = null; });
}

/** Stop any scheduled retry (sign-out, withdrawal). An in-flight sample finishes on its own. */
export function cancelResearchRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}
