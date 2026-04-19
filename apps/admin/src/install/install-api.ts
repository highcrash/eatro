/**
 * Unauthenticated fetch wrapper for /api/v1/install/*.
 *
 * Parallel to apps/admin/src/lib/api.ts, but STRIPPED of the auth
 * token plumbing — the wizard runs before any staff exists. We also
 * skip the automatic refresh-on-401 path for the same reason.
 *
 * Keeping this separate (rather than teaching api.ts to handle an
 * "unauthenticated mode") avoids growing conditional logic in the
 * main hot-path wrapper.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export interface InstallStatus {
  needsInstall: boolean;
  completedSteps: { systemCheck: boolean; owner: boolean; branch: boolean };
}

export interface SystemCheck {
  db: boolean;
  nodeVersion: string;
  nodeOk: boolean;
  requiredEnvs: { key: string; present: boolean }[];
}

export class InstallApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'InstallApiError';
    this.status = status;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message ?? res.statusText;
    throw new InstallApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new InstallApiError(res.status, `GET ${path} failed: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const installApi = {
  status: () => getJson<InstallStatus>('/install/status'),
  systemCheck: () => postJson<SystemCheck>('/install/system-check', {}),
  // License activation — same endpoint as Settings → License, but the
  // wizard calls it BEFORE creating any real data (branch / owner).
  // If it fails, the buyer hasn't committed anything and can retry.
  activateLicense: (dto: { purchaseCode: string; domain: string }) =>
    postJson<{ mode: string; status: string | null; domain: string | null; daysRemaining: number }>(
      '/license/activate',
      dto,
    ),
  licenseStatus: () =>
    getJson<{ mode: string; status: string | null; daysRemaining: number; domain: string | null; reason: string }>(
      '/license/status',
    ),
  createBranch: (dto: { name: string; address: string; phone: string; timezone?: string; currency?: string }) =>
    postJson<{ id: string; name: string }>('/install/branch', dto),
  createOwner: (dto: { name: string; email: string; password: string }) =>
    postJson<{ id: string; email: string }>('/install/owner', dto),
  finish: (dto: { brandName?: string; siteName?: string; supportEmail?: string }) =>
    postJson<{ installedAt: string }>('/install/finish', dto),
};
