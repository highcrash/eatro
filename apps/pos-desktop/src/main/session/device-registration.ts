/**
 * Wraps the POST /devices/register endpoint, persisting the result into the
 * encrypted local config store. Called from the First-Run Setup screen.
 */
import { writeConfig, clearConfig, type DesktopConfig } from '../config/store';
import { replaceCashiers, type CashierEntry } from './cashier-cache';

export interface RegisterDeviceInput {
  serverUrl: string;
  email: string;
  password: string;
  branchId: string;
  deviceName: string;
}

interface RegisterResponse {
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  branch: { id: string; name: string };
  cashiers: CashierEntry[];
}

export async function registerDevice(input: RegisterDeviceInput): Promise<DesktopConfig> {
  const serverUrl = normaliseServerUrl(input.serverUrl);
  const url = `${serverUrl}/api/v1/devices/register`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      branchId: input.branchId,
      deviceName: input.deviceName,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg = `Registration failed (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) msg = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
    } catch {
      if (body) msg = body;
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as RegisterResponse;

  const cfg: DesktopConfig = {
    serverUrl,
    deviceId: data.deviceId,
    deviceName: data.deviceName,
    deviceToken: data.deviceToken,
    branch: data.branch,
    pairedAt: new Date().toISOString(),
  };

  await writeConfig(cfg);

  // Prime the cashier cache so the lock screen works immediately after pairing,
  // even before the first /devices/cashiers refresh fires.
  if (Array.isArray(data.cashiers)) {
    try { replaceCashiers(data.cashiers); } catch (err) {
      console.warn('[desktop] failed to cache cashiers on pairing:', (err as Error).message);
    }
  }

  return cfg;
}

export async function unpair(): Promise<void> {
  await clearConfig();
}

/**
 * Fetch branches available to the supplied credentials. Used by the
 * First-Run Setup screen to populate a branch dropdown before registration.
 * Uses the standard /auth/login flow to authenticate, then /branches.
 */
export async function fetchBranchesForOwner(
  serverUrl: string,
  email: string,
  password: string,
): Promise<Array<{ id: string; name: string }>> {
  const base = normaliseServerUrl(serverUrl);
  const loginRes = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    let msg = `Login failed (HTTP ${loginRes.status})`;
    try {
      const parsed = (await loginRes.json()) as { message?: string | string[] };
      if (parsed?.message) msg = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
    } catch { /* use default */ }
    throw new Error(msg);
  }
  const loginBody = (await loginRes.json()) as {
    accessToken: string;
    user: { role: string; branchId: string };
  };
  if (loginBody.user.role !== 'OWNER' && loginBody.user.role !== 'MANAGER') {
    throw new Error('Only OWNER or MANAGER can pair a terminal');
  }

  // For v1: pair against the owner's current branch. If multi-branch UX is
  // needed later we fetch /branches and show a picker here.
  return [{ id: loginBody.user.branchId, name: '' /* filled by caller if needed */ }];
}

function normaliseServerUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (url.endsWith('/')) url = url.slice(0, -1);
  // Strip trailing /api or /api/v1 if the user pasted the full base — we append it ourselves.
  url = url.replace(/\/api(\/v1)?$/i, '');
  return url;
}
