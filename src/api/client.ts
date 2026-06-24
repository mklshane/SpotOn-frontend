/**
 * Minimal typed fetch client for the SpotOn backend.
 *
 * Directory/sync endpoints are public; `/me` (added later) needs a Supabase
 * Bearer token — register a provider via `setAuthTokenProvider` so the auth layer
 * can inject the token without this module depending on it.
 *
 * Query strings are built manually (not via `URL`) for React Native compatibility.
 */
import { API_BASE_URL } from "../config";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API ${status}: ${body.slice(0, 200)}`);
    this.name = "ApiError";
  }
}

type AuthTokenProvider = () => string | null | Promise<string | null>;
let tokenProvider: AuthTokenProvider | null = null;

/** Auth layer calls this once so authed requests carry the Supabase token. */
export function setAuthTokenProvider(fn: AuthTokenProvider | null): void {
  tokenProvider = fn;
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

function queryString(params?: QueryParams): string {
  if (!params) return "";
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

async function request<T>(
  method: string,
  path: string,
  opts: { params?: QueryParams; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth && tokenProvider) {
    const token = await tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}${queryString(opts.params)}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    throw new ApiError(res.status, await res.text().catch(() => ""));
  }
  // 204 / empty bodies
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, params?: QueryParams, auth = false) =>
    request<T>("GET", path, { params, auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>("POST", path, { body, auth }),
  patch: <T>(path: string, body?: unknown, auth = true) =>
    request<T>("PATCH", path, { body, auth }),
};
