import { useAuth } from './auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const API_BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** Staff stay signed in for weeks: a stale access token is swapped using the refresh token. */
async function refresh(): Promise<boolean> {
  const { refreshToken, setAccessToken, clear } = useAuth.getState();
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      if (!res.ok) {
        clear();
        return false;
      }
      const body = (await res.json()) as { accessToken: string };
      setAccessToken(body.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const token = useAuth.getState().accessToken;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && path !== '/auth/login' && (await refresh())) return request<T>(method, path, body, false);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(err.message) ? err.message.join(', ') : err.message;
    throw new ApiError(message || `Something went wrong (${res.status})`, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
};
