import { API_BASE_URL } from "../config";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API ${status}: ${body.slice(0, 200)}`);
    this.name = "ApiError";
  }

  /** Best-effort human message from a FastAPI `{ "detail": ... }` body. */
  get detail(): string {
    try {
      const parsed = JSON.parse(this.body);
      if (typeof parsed?.detail === "string") return parsed.detail;
    } catch {
      // not JSON
    }
    return this.body || `Request failed (${this.status}).`;
  }
}

type AuthTokenProvider = () => string | null | Promise<string | null>;
let tokenProvider: AuthTokenProvider | null = null;

/** Auth layer registers this so authed requests carry the access token. */
export function setAuthTokenProvider(fn: AuthTokenProvider | null): void {
  tokenProvider = fn;
}

/** Called once on a 401 to refresh the access token; returns the new token or null. */
type AuthRefreshHandler = () => Promise<string | null>;
let refreshHandler: AuthRefreshHandler | null = null;
export function setAuthRefreshHandler(fn: AuthRefreshHandler | null): void {
  refreshHandler = fn;
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

function queryString(params?: QueryParams): string {
  if (!params) return "";
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    );
  return parts.length ? `?${parts.join("&")}` : "";
}

// Render's free tier can take 30s+ to wake from sleep, and RN's fetch has no
// built-in timeout — an unreachable/slow server would otherwise hang forever,
// which on cold start blocks the splash screen from ever routing anywhere.
const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("timed out");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  method: string,
  path: string,
  opts: {
    params?: QueryParams;
    body?: unknown;
    auth?: boolean;
    _retried?: boolean;
  } = {},
): Promise<T> {
  // A FormData body (file uploads) must be left untouched: it can't be
  // JSON-stringified (that silently drops the file, serializing to "{}"),
  // and its Content-Type — including the multipart boundary — has to be set
  // by `fetch` itself, not by us.
  const isFormData =
    typeof FormData !== "undefined" && opts.body instanceof FormData;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined && !isFormData)
    headers["Content-Type"] = "application/json";
  if (opts.auth && tokenProvider) {
    const token = await tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchWithTimeout(
    `${API_BASE_URL}${path}${queryString(opts.params)}`,
    {
      method,
      headers,
      body:
        opts.body === undefined
          ? undefined
          : isFormData
            ? (opts.body as FormData)
            : JSON.stringify(opts.body),
    },
  );

  // One-shot refresh-and-retry on an expired access token.
  if (res.status === 401 && opts.auth && refreshHandler && !opts._retried) {
    const newToken = await refreshHandler();
    if (newToken) {
      return request<T>(method, path, { ...opts, _retried: true });
    }
  }

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
  delete: <T>(path: string, body?: unknown, auth = true) =>
    request<T>("DELETE", path, { body, auth }),
};
