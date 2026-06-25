import { api } from '@/api/client';
import type { Sex, UserProfile } from '@/api/types';

export function fetchProfile(): Promise<UserProfile> {
  return api.get<UserProfile>('/me', undefined, true);
}

/** A profile counts as complete once a date of birth has been recorded. */
export function isProfileComplete(user: UserProfile): boolean {
  return user.date_of_birth != null;
}

export type ProfileInput = {
  dateOfBirth: string; // ISO "YYYY-MM-DD"
  sex: Sex;
  phone?: string;
};

export async function saveProfile({ dateOfBirth, sex, phone }: ProfileInput): Promise<void> {
  // DOB + sex are accepted by the deployed API today.
  await api.patch('/me', { date_of_birth: dateOfBirth, sex });
  // `phone` requires the UserUpdate change to be redeployed; isolate so a 422
  // before redeploy doesn't fail the whole step.
  const trimmed = phone?.trim();
  if (trimmed) {
    try {
      await api.patch('/me', { phone: trimmed });
    } catch {
      // Backend not yet redeployed with the phone field — skip silently.
    }
  }
}

/**
 * Where an authenticated user should land: the profile step if incomplete, else
 * the app. Defaults to the app on network error so offline users aren't blocked.
 */
export async function routeAfterAuth(): Promise<'/(auth)/complete-profile' | '/home'> {
  try {
    const me = await fetchProfile();
    return isProfileComplete(me) ? '/home' : '/(auth)/complete-profile';
  } catch {
    return '/home';
  }
}
