import Constants from 'expo-constants';

import { ApiError, api } from '@/api/client';
import type { UserProfile } from '@/api/types';
import { getMeta, setMeta } from '@/data/db';
import { accountStorageKey } from '@/lib/account-scope';
import { getLocale } from '@/lib/i18n';
import {
  RESEARCH_CONSENT_VERSION,
  canShareResearch,
  shouldAskResearch,
} from '@/lib/research-core';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * Account side of the optional "Help improve SpotOn" research sharing: the consent call, the
 * shared-photo count/delete calls, and whether to show the one-time ask. The upload queue itself
 * is data/research-queue.ts; the rules both follow are lib/research-core.ts.
 */
export { RESEARCH_CONSENT_VERSION, canShareResearch };

type ConsentResponse = { user: UserProfile; deleted_samples: number };

const promptKey = (userId: string) => accountStorageKey(userId, STORAGE_KEYS.researchPromptVersion);
const pendingKey = (userId: string) => accountStorageKey(userId, STORAGE_KEYS.researchPendingGrant);

/**
 * True when the request never got an answer from the API itself: no connection, a timeout, Render
 * waking up or a host error page. The flag-off refusal is a JSON 503 from our API and is NOT this.
 */
function unreachable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true; // fetch threw: offline / DNS / timeout
  if (e.status === 0 || e.isHtml) return true;
  return e.status === 408 || e.status === 429 || e.status === 502 || e.status === 504 || e.status === 500;
}

/**
 * Record a Share / withdraw decision on the server (an append-only consent row there) and return
 * the updated profile - the caller passes it to `setUser`. Withdrawing deletes every sample the
 * account already shared, server-side, and the local queue state with it.
 */
export async function setResearchConsent(
  user: UserProfile,
  granted: boolean,
): Promise<{ user: UserProfile; deletedSamples: number }> {
  const res = await api.post<ConsentResponse>('/me/research-consent', {
    granted,
    consent_version: RESEARCH_CONSENT_VERSION,
    app_version: (Constants.expoConfig?.version ?? '').slice(0, 32) || null,
    locale: getLocale(),
  });
  // Recorded on the server, so any Share still waiting for a connection is settled - and a refusal
  // below never reaches this line, which is why the flush keeps it only on `unreachable`.
  await setMeta(pendingKey(user.id), '').catch(() => {});
  // Answered on the server, so the local "asked" marker is moot - but setting it keeps the sheet
  // from flashing back if a cached profile older than this answer is restored offline.
  await markResearchPromptAnswered(user.id).catch(() => {});
  if (!granted) {
    const { clearResearchQueue } = await import('@/data/research-queue');
    await clearResearchQueue(user.id).catch((e) => console.warn('[research] could not clear queue', e));
  }
  return { user: res.user, deletedSamples: res.deleted_samples ?? 0 };
}

/**
 * "Share" from the one-time ask, which must never show a failure on the result screen. Online, it
 * records consent and returns the new profile. Offline, it remembers the choice on the phone and
 * returns null; `flushPendingResearchConsent` sends it once there is a connection. Nothing is
 * queued or uploaded until the server has recorded consent. Throws only for a real refusal.
 */
export async function shareFromAsk(user: UserProfile): Promise<UserProfile | null> {
  try {
    return (await setResearchConsent(user, true)).user;
  } catch (e) {
    if (!unreachable(e)) throw e;
    await setMeta(pendingKey(user.id), RESEARCH_CONSENT_VERSION);
    await markResearchPromptAnswered(user.id).catch(() => {});
    return null;
  }
}

/**
 * Send a Share that was tapped offline. Returns the updated profile when the server recorded it,
 * otherwise null (nothing pending, still offline, or refused - a refusal drops the pending choice).
 */
export async function flushPendingResearchConsent(user: UserProfile): Promise<UserProfile | null> {
  const pending = await getMeta(pendingKey(user.id)).catch(() => null);
  if (!pending) return null;
  const stale = pending !== RESEARCH_CONSENT_VERSION || !user.research_sharing_enabled;
  if (stale || canShareResearch(user)) {
    // Copy changed since, the feature was switched off, or consent is already on: nothing to send.
    // A stale choice was for different wording, so the ask will simply come up again.
    await setMeta(pendingKey(user.id), '').catch(() => {});
    if (stale) await setMeta(promptKey(user.id), '').catch(() => {});
    return null;
  }
  try {
    return (await setResearchConsent(user, true)).user;
  } catch (e) {
    if (unreachable(e)) return null; // try again on the next reconnect
    console.warn('[research] pending consent refused', e);
    await setMeta(pendingKey(user.id), '').catch(() => {});
    return null;
  }
}

/** How many of this account's photos are currently held for research. */
export async function countMySharedSamples(): Promise<number> {
  const res = await api.get<{ count: number }>('/research/samples/mine/count', undefined, true);
  return res.count ?? 0;
}

/** Delete every shared photo but keep sharing on for future screenings. Returns how many went. */
export async function deleteMySharedSamples(userId: string): Promise<number> {
  const res = await api.delete<{ deleted: number }>('/research/samples/mine');
  const { forgetSentSamples } = await import('@/data/research-queue');
  await forgetSentSamples(userId).catch(() => {});
  return res.deleted ?? 0;
}

/** True when the one-time "Help improve SpotOn" sheet should be shown to this account now. */
export async function needsResearchPrompt(user: UserProfile | null): Promise<boolean> {
  if (!user?.research_sharing_enabled) return false; // skip the read entirely when the flag is off
  const answered = await getMeta(promptKey(user.id)).catch(() => null);
  return shouldAskResearch(user, answered);
}

/** Remember that this account saw the ask for the current version ("Not now" stays local). */
export function markResearchPromptAnswered(userId: string): Promise<void> {
  return setMeta(promptKey(userId), RESEARCH_CONSENT_VERSION);
}
