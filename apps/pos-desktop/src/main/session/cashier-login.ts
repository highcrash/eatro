import { readConfig } from '../config/store';
import { setSession, type AuthenticatedUser } from './session';
import { replaceCashiers, type CashierEntry } from './cashier-cache';

/**
 * Fetch + cache the current cashier list from the server. Best-effort:
 * errors are swallowed (offline case) and the stale cached list is used.
 */
export async function refreshCashiers(): Promise<CashierEntry[]> {
  const cfg = await readConfig();
  if (!cfg) return [];
  try {
    const res = await fetch(`${cfg.serverUrl}/api/v1/devices/cashiers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: cfg.deviceToken }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as CashierEntry[];
    replaceCashiers(list);
    return list;
  } catch (err) {
    console.warn('[desktop] cashier refresh failed, using cached list:', (err as Error).message);
    return [];
  }
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    branchId: string;
    branchName: string;
  };
}

/**
 * PIN-based login: already-verified PIN locally, now exchange deviceToken +
 * staffId for a real cashier session with the server.
 */
export async function pinLoginWithServer(staffId: string): Promise<AuthenticatedUser> {
  const cfg = await readConfig();
  if (!cfg) throw new Error('Terminal is not paired');
  const res = await fetch(`${cfg.serverUrl}/api/v1/auth/pin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken: cfg.deviceToken, staffId }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'PIN login failed'));
  const data = (await res.json()) as LoginResponse;
  setSession({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
  return data.user;
}

/**
 * First-time cashier setup on this terminal: prove identity by password,
 * receive a real session, then caller sets the local PIN.
 */
export async function passwordLoginOnDevice(
  email: string,
  password: string,
): Promise<AuthenticatedUser> {
  const cfg = await readConfig();
  if (!cfg) throw new Error('Terminal is not paired');
  const res = await fetch(`${cfg.serverUrl}/api/v1/auth/password-login-on-device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken: cfg.deviceToken, email, password }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'Login failed'));
  const data = (await res.json()) as LoginResponse;
  setSession({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
  return data.user;
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.text();
    if (!body) return `${fallback} (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) {
        return Array.isArray(parsed.message) ? parsed.message.join(', ') : String(parsed.message);
      }
    } catch { /* fall through to raw body */ }
    return body;
  } catch {
    return `${fallback} (HTTP ${res.status})`;
  }
}
