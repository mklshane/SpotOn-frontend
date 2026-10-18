import * as FileSystem from '@/lib/fs';
import * as SecureStore from '@/lib/secure-store';
import type { Sex, UserProfile } from '@/api/types';

export type PendingAvatar = { kind: 'upload'; uri: string } | { kind: 'remove' };
export type PendingProfile = {
  revision: string;
  fields: {
    full_name: string;
    date_of_birth: string;
    sex: Sex;
    fitzpatrick_skin_type?: number;
    phone?: string;
  };
  avatar?: PendingAvatar;
  discardedAvatarUris?: string[];
};

const keyFor = (userId: string) => `spoton.profile.pending.${userId}`;
const avatarDir = (userId: string) =>
  `${FileSystem.documentDirectory}profile-avatars/${encodeURIComponent(userId)}/`;
const toStoredUri = (uri: string) => uri.startsWith(FileSystem.documentDirectory ?? '\0')
  ? uri.slice((FileSystem.documentDirectory ?? '').length) : uri;
const toDisplayUri = (uri: string) => uri.startsWith('profile-avatars/')
  ? `${FileSystem.documentDirectory}${uri}` : uri;

export async function readPendingProfile(userId: string): Promise<PendingProfile | null> {
  const raw = await SecureStore.getItemAsync(keyFor(userId));
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as PendingProfile;
    if (!pending?.revision || !pending?.fields) return null;
    if (pending.avatar?.kind === 'upload') pending.avatar.uri = toDisplayUri(pending.avatar.uri);
    pending.discardedAvatarUris = pending.discardedAvatarUris?.map(toDisplayUri);
    return pending;
  } catch {
    return null;
  }
}

export async function keepAvatarForSync(userId: string, sourceUri: string): Promise<string> {
  const dir = avatarDir(userId);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const uri = `${dir}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await FileSystem.copyAsync({ from: sourceUri, to: uri });
  return uri;
}

export async function writePendingProfile(userId: string, pending: PendingProfile): Promise<void> {
  const previous = await readPendingProfile(userId);
  pending.discardedAvatarUris = [...(previous?.discardedAvatarUris ?? [])];
  if (previous?.avatar?.kind === 'upload' &&
      (pending.avatar?.kind !== 'upload' || previous.avatar.uri !== pending.avatar.uri)) {
    pending.discardedAvatarUris.push(previous.avatar.uri);
  }
  await SecureStore.setItemAsync(keyFor(userId), JSON.stringify({
    ...pending,
    avatar: pending.avatar?.kind === 'upload'
      ? { ...pending.avatar, uri: toStoredUri(pending.avatar.uri) } : pending.avatar,
    discardedAvatarUris: pending.discardedAvatarUris.map(toStoredUri),
  }));
}

export async function clearPendingProfile(userId: string, revision: string): Promise<boolean> {
  const current = await readPendingProfile(userId);
  if (current?.revision !== revision) return false;
  await SecureStore.deleteItemAsync(keyFor(userId));
  if (current.avatar?.kind === 'upload') {
    await FileSystem.deleteAsync(current.avatar.uri, { idempotent: true });
  }
  for (const uri of current.discardedAvatarUris ?? []) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
  return true;
}

export async function removePendingProfile(userId: string): Promise<void> {
  const current = await readPendingProfile(userId);
  await SecureStore.deleteItemAsync(keyFor(userId));
  if (current?.avatar?.kind === 'upload') {
    await FileSystem.deleteAsync(current.avatar.uri, { idempotent: true });
  }
  for (const uri of current?.discardedAvatarUris ?? []) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

export function applyPendingProfile(user: UserProfile, pending: PendingProfile | null): UserProfile {
  if (!pending) return user;
  return {
    ...user,
    ...pending.fields,
    avatar_url: pending.avatar?.kind === 'remove'
      ? null
      : pending.avatar?.kind === 'upload'
        ? pending.avatar.uri
        : user.avatar_url,
  };
}
