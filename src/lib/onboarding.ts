import { getMeta, setMeta } from '@/data/db';

const ONBOARDING_KEY = 'has_seen_onboarding';

export async function hasSeenOnboarding(): Promise<boolean> {
  return (await getMeta(ONBOARDING_KEY)) === '1';
}

export async function markOnboardingSeen(): Promise<void> {
  await setMeta(ONBOARDING_KEY, '1');
}

export async function resetOnboarding(): Promise<void> {
  await setMeta(ONBOARDING_KEY, '');
}
