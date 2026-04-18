import { useAuthStore } from '../store/auth.store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_LICENSE_API_BASE_URL as string | undefined) ?? '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  const isFormData = init?.body instanceof FormData;

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    // 401 on an admin endpoint = token expired / invalidated. Clear and
    // re-render into LoginPage. The license-admin token has no refresh —
    // shorter lifetime, one-prompt re-login is acceptable UX.
    if (res.status === 401 && path !== '/admin/login') {
      useAuthStore.getState().clearAuth();
    }
    const error = await res.json().catch(() => ({ message: res.statusText }));
    const err = error as { message?: string; result?: string };
    throw new Error(err.message ?? err.result ?? res.statusText);
  }

  // Some endpoints return 204 No Content; don't explode JSON-parsing.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File, fieldName = 'file') => {
    const form = new FormData();
    form.append(fieldName, file);
    return request<T>(path, { method: 'POST', body: form });
  },
};
