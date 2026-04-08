/** Resolves an `/api/v1/...` path to the absolute URL for the current environment. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export function apiUrl(path: string): string {
  // Accept callers passing either '/api/v1/x' (legacy) or '/x'.
  const trimmed = path.startsWith('/api/v1/') ? path.slice('/api/v1'.length) : path;
  return `${BASE}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}
