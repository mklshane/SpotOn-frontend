import { api, ApiError } from '@/api/client';

/**
 * Best-guess endpoints for the account data actions. The backend may not have
 * these deployed yet - callers should use `isNotDeployed()` to show a friendly
 * "not available yet" message instead of a generic error on a 404.
 *
 * Changing a password is NOT one of these: it lives in `auth-api`, because the
 * server rotates the session's tokens and they have to be persisted.
 */

export async function deleteAccount(): Promise<void> {
  await api.delete('/me');
}

export async function requestDataExport(): Promise<void> {
  await api.post('/me/export');
}

/**
 * True when the failure means "this endpoint isn't deployed yet" rather than a real error.
 *
 * 405 counts: when the path exists but the verb doesn't, FastAPI answers "Method Not Allowed"
 * rather than 404, which is what `DELETE /me` showed the user before it was implemented.
 */
export function isNotDeployed(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}
