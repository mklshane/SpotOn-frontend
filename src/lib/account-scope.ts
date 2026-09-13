let activeAccountId: string | null = null;

/** Keep account-aware device storage aligned with the one authenticated session. */
export function setActiveAccountId(userId: string | null): void {
  activeAccountId = userId;
}

export function getActiveAccountId(): string | null {
  return activeAccountId;
}

/** SQLite metadata keys are namespaced by the backend's stable user UUID. */
export function accountStorageKey(userId: string, key: string): string {
  return `account:${encodeURIComponent(userId)}:${key}`;
}
