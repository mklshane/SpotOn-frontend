import { api, ApiError } from '@/api/client';

/**
 * Best-guess endpoints for account/security and data actions. The backend may
 * not have these deployed yet — callers should use `isNotDeployed()` to show a
 * friendly "not available yet" message instead of a generic error on a 404.
 */

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

export async function deleteAccount(): Promise<void> {
  await api.delete('/me');
}

export async function requestDataExport(): Promise<void> {
  await api.post('/me/export');
}

/** True when the failure means "this endpoint isn't deployed yet" rather than a real error. */
export function isNotDeployed(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
