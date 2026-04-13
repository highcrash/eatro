import { useAuthStore } from '../store/auth.store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().accessToken;

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
    if (res.status === 401) {
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
                ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
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
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File, fieldName = 'file') => {
    const formData = new FormData();
    formData.append(fieldName, file);
    return request<T>(path, { method: 'POST', body: formData });
  },
  uploadWithFields: <T>(path: string, file: File, fields: Record<string, string>, fieldName = 'file') => {
    const formData = new FormData();
    formData.append(fieldName, file);
    for (const [k, v] of Object.entries(fields)) formData.append(k, v);
    return request<T>(path, { method: 'POST', body: formData });
  },
  downloadBlob: async (path: string): Promise<{ blob: Blob; filename: string }> => {
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const cd = res.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(cd);
    return { blob: await res.blob(), filename: match?.[1] ?? 'backup.json.gz' };
  },
};
