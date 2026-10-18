import { api, ApiError } from "@/api/client";
import type { Sex, UserProfile } from "@/api/types";
import * as FileSystem from '@/lib/fs';
import { cacheProfile, getAccessToken, refresh } from '@/lib/auth-api';
import { getActiveAccountId } from '@/lib/account-scope';
import { API_BASE_URL } from '@/config';
import { isOnlineNow } from '@/hooks/use-connectivity';
import {
  applyPendingProfile, clearPendingProfile, keepAvatarForSync,
  readPendingProfile, writePendingProfile, type PendingProfile,
} from '@/lib/profile-pending';
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

export function fetchProfile(): Promise<UserProfile> {
  return api.get<UserProfile>("/me", undefined, true);
}

/** Both required demographics must be present before profile setup is complete. */
export function isProfileComplete(user: UserProfile): boolean {
  return user.date_of_birth != null && user.sex != null;
}

export type ProfileInput = {
  fullName?: string;
  dateOfBirth: string; // ISO "YYYY-MM-DD"
  sex: Sex;
  phone?: string;
  fitzpatrickSkinType?: number; // 1-6
  /**
   * `undefined` - not touched, leave the stored avatar as-is.
   * `null` - the user removed their photo, clear it.
   * `string` - a new local file URI (from the image picker) to upload.
   */
  avatarUri?: string | null;
};

export type SaveProfileResult = {
  user: UserProfile;
  status: 'synced' | 'pending' | 'rejected';
  error?: string;
};

/** Keep the JPEG below the API's 1 MB limit, even for detailed source photos. */
async function prepareAvatar(localUri: string): Promise<string> {
  for (const [width, compress] of [[512, 0.75], [384, 0.6], [256, 0.45]] as const) {
    const result = await manipulateAsync(localUri, [{ resize: { width } }], {
      compress, format: SaveFormat.JPEG,
    });
    const info = await FileSystem.getInfoAsync(result.uri);
    if (info.exists && info.size < 900_000) return result.uri;
  }
  throw new Error('This photo is too large. Please choose a different one.');
}

async function uploadAvatar(localUri: string): Promise<void> {
  if (Platform.OS === "web") {
    const formData = new FormData();
    const blob = await (await fetch(localUri)).blob();
    formData.append("file", blob, "avatar.jpg");
    await api.post<UserProfile>("/me/avatar", formData);
    return;
  }
  const send = async (token: string) => FileSystem.uploadAsync(
    `${API_BASE_URL}/me/avatar`, localUri, {
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      httpMethod: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    },
  );
  let token = getAccessToken();
  if (!token) throw new Error('Please sign in again to save your photo.');
  let response = await send(token);
  if (response.status === 401) {
    token = await refresh();
    if (token) response = await send(token);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(response.status, response.body);
  }
}

export function isProfileNetworkError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500 || [408, 429].includes(error.status);
  return error instanceof Error && /network|fetch|load failed|connect|timed? ?out|unreachable|offline|internet|resolve host|socket|dns/i.test(error.message);
}

const inFlight = new Map<string, Promise<SaveProfileResult | null>>();

/** Replay the latest pending edit. Newer revisions are never cleared by an older request. */
export async function syncPendingProfile(userId: string): Promise<SaveProfileResult | null> {
  const running = inFlight.get(userId);
  if (running) return running;
  const job = (async (): Promise<SaveProfileResult | null> => {
    const pending = await readPendingProfile(userId);
    if (!pending || !(await isOnlineNow().catch(() => false))) return null;
    if (getActiveAccountId() !== userId) return null;
    try {
      await api.patch<UserProfile>('/me', pending.fields);
      if (pending.avatar?.kind === 'remove') await api.delete<UserProfile>('/me/avatar');
      if (pending.avatar?.kind === 'upload') await uploadAvatar(pending.avatar.uri);
      const serverUser = await fetchProfile();
      if (serverUser.id !== userId || getActiveAccountId() !== userId) return null;
      await clearPendingProfile(userId, pending.revision);
      const latest = await readPendingProfile(userId);
      const user = applyPendingProfile(serverUser, latest);
      if (getActiveAccountId() !== userId) return null;
      await cacheProfile(user);
      return { user, status: latest ? 'pending' : 'synced' };
    } catch (error) {
      if (isProfileNetworkError(error)) return null;
      const user = await fetchProfile().catch(() => null);
      if (!user || user.id !== userId || getActiveAccountId() !== userId) return null;
      return {
        user: applyPendingProfile(user, await readPendingProfile(userId)),
        status: 'rejected',
        error: error instanceof ApiError ? error.detail : error instanceof Error ? error.message : 'Could not save profile.',
      };
    }
  })();
  inFlight.set(userId, job);
  try { return await job; } finally { inFlight.delete(userId); }
}

export async function saveProfile({
  fullName,
  dateOfBirth,
  sex,
  phone,
  fitzpatrickSkinType,
  avatarUri,
}: ProfileInput, currentUser: UserProfile): Promise<SaveProfileResult> {
  const previous = await readPendingProfile(currentUser.id);
  let avatar = previous?.avatar;
  if (avatarUri === null) avatar = { kind: 'remove' };
  else if (avatarUri) {
    const prepared = await prepareAvatar(avatarUri);
    avatar = { kind: 'upload', uri: await keepAvatarForSync(currentUser.id, prepared) };
  }
  const pending: PendingProfile = {
    revision: `${Date.now()}-${Math.random()}`,
    fields: {
      full_name: fullName?.trim() || currentUser.full_name || '',
      date_of_birth: dateOfBirth,
      sex,
      ...(fitzpatrickSkinType != null ? { fitzpatrick_skin_type: fitzpatrickSkinType } : {}),
      ...(phone?.trim() ? { phone: phone.trim() } : {}),
    },
    avatar,
  };
  await writePendingProfile(currentUser.id, pending);
  const user = applyPendingProfile(currentUser, pending);
  await cacheProfile(user);
  let synced = await syncPendingProfile(currentUser.id);
  if (synced?.status === 'pending') {
    // An older request was finishing while this edit was queued. Send this revision too.
    synced = await syncPendingProfile(currentUser.id) ?? synced;
  }
  return synced ?? { user, status: 'pending' };
}

/**
 * Where an authenticated user should land: the profile step if incomplete, else
 * the app. Defaults to the app on network error so offline users aren't blocked.
 */
export async function routeAfterAuth(applyProfile?: (user: UserProfile) => void): Promise<
  "/(auth)/complete-profile" | "/home"
> {
  try {
    const me = await fetchProfile();
    applyProfile?.(me);
    return isProfileComplete(me) ? "/home" : "/(auth)/complete-profile";
  } catch {
    return "/home";
  }
}
