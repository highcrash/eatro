import { useAuthStore } from '../store/auth.store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().accessToken;

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    // Auth verify/login endpoints legitimately return 401 on wrong credentials —
    // never let those clear the session.
    const isAuthCheck = path.startsWith('/auth/verify') || path.startsWith('/auth/verify-self') || path.startsWith('/auth/login');
    if (res.status === 401 && !isAuthCheck) {
      const { refreshToken, setAuth, clearAuth } = useAuthStore.getState();
      if (refreshToken) {
        try {
          const refreshRes = await fetch(`${BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          if (refreshRes.ok) {
            const data = (await refreshRes.json()) as { accessToken: string };
            setAuth(useAuthStore.getState().user!, data.accessToken, refreshToken);
            const retryRes = await fetch(`${BASE}${path}`, {
              ...init,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${data.accessToken}`,
                ...init?.headers,
              },
            });
            if (retryRes.ok) return retryRes.json() as Promise<T>;
          }
        } catch {
          // refresh failed
        }
        clearAuth();
      }
    }
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((error as { message?: string }).message ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
