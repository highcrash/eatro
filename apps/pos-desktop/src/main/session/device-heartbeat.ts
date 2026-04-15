import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { readConfig } from '../config/store';
import { onlineDetector } from '../sync/online-detector';

/**
 * Periodic liveness probe against the server's `/devices/heartbeat`
 * endpoint. Fires every minute while online and paired.
 *
 * A 401 response means the admin has revoked this terminal. We flip the
 * `revoked` flag, broadcast `device:revoked` to every renderer window, and
 * stop further probes — the UI will show a hard lock until the owner
 * confirms unpair + re-pair.
 *
 * A network error is NOT treated as revocation; we just log and retry next
 * tick. Revocation is only entered on an actual server-issued 401.
 */

const HEARTBEAT_INTERVAL_MS = 60_000;

let revoked = false;
let timer: NodeJS.Timeout | null = null;
let probing = false;

export function isRevoked(): boolean {
  return revoked;
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('device:revoked');
  }
}

async function probeOnce(): Promise<void> {
  if (revoked || probing) return;
  if (!onlineDetector.isOnline()) return;
  probing = true;
  try {
    const cfg = await readConfig();
    if (!cfg) return;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`${cfg.serverUrl}/api/v1/devices/heartbeat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceToken: cfg.deviceToken }),
      });
      if (res.status === 401) {
        log.warn('[heartbeat] received 401 — terminal has been revoked');
        revoked = true;
        broadcast();
        stopHeartbeat();
        return;
      }
      if (!res.ok) {
        log.warn(`[heartbeat] server returned ${res.status}, treating as transient`);
      }
    } catch (err) {
      // Network blew up — the online detector will pick this up separately.
      log.debug('[heartbeat] probe failed:', (err as Error).message);
    } finally {
      clearTimeout(t);
    }
  } finally {
    probing = false;
  }
}

export function startHeartbeat(): void {
  if (timer) return;
  // Don't fire immediately on app boot — online detector needs a moment to
  // stabilize first. One probe after 10s, then every minute.
  setTimeout(() => void probeOnce(), 10_000);
  timer = setInterval(() => void probeOnce(), HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Clear the revoked flag. Called after a successful re-pair so the next
 * session starts cleanly without needing an app restart.
 */
export function clearRevoked(): void {
  revoked = false;
  if (!timer) startHeartbeat();
}
