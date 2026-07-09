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
  fullName?: string;
  dateOfBirth: string; // ISO "YYYY-MM-DD"
  sex: Sex;
  phone?: string;
  fitzpatrickSkinType?: number; // 1-6
};

export type SaveProfileResult = {
  /** Server-authoritative profile, re-fetched after all PATCH attempts — never assembled from local input. */
  user: UserProfile;
  /** Field names (matching the API's snake_case) that failed to save, if any. */
  failedFields: string[];
};

export async function saveProfile({
  fullName,
  dateOfBirth,
  sex,
  phone,
  fitzpatrickSkinType,
}: ProfileInput): Promise<SaveProfileResult> {
  const failedFields: string[] = [];

  // DOB + sex are accepted by the deployed API today.
  await api.patch('/me', { date_of_birth: dateOfBirth, sex });

  // Each of the following isolates its own PATCH so a 404/422 on one field
  // (e.g. before the backend redeploys with that field) doesn't fail the others.
  const trimmedName = fullName?.trim();
  if (trimmedName) {
    try {
      await api.patch('/me', { full_name: trimmedName });
    } catch {
      failedFields.push('full_name');
    }
  }

  const trimmedPhone = phone?.trim();
  if (trimmedPhone) {
    try {
      await api.patch('/me', { phone: trimmedPhone });
    } catch {
      failedFields.push('phone');
    }
  }

  if (fitzpatrickSkinType != null) {
    try {
      await api.patch('/me', { fitzpatrick_skin_type: fitzpatrickSkinType });
    } catch {
      failedFields.push('fitzpatrick_skin_type');
    }
  }

  const user = await fetchProfile();
  return { user, failedFields };
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
