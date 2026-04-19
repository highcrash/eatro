import { BrowserWindow } from 'electron';
import { verify } from './service';

/**
 * Hourly background license verify. Mirrors the API's `@Cron('0 * * * *')`
 * pattern — refreshes the cached proof so an offline grace window doesn't
 * silently elapse, AND surfaces server-side revocations within ~1 hour
 * even on terminals that never restart.
 *
 * Notifies the renderer when the verdict transitions (active → grace,
 * grace → locked, etc) so the UI can flip into the LicenseRequiredScreen
 * without waiting for the next user-driven status poll.
 */

const HOUR_MS = 60 * 60 * 1_000;

let timer: NodeJS.Timeout | null = null;
let lastMode: string | null = null;

function broadcastIfChanged(mode: string): void {
  if (lastMode === mode) return;
  lastMode = mode;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('desktop:license:verdict-changed', mode);
  }
}

export function startLicenseScheduler(): void {
  if (timer) return;
  // First tick on a 60s delay (not immediately) — main/index.ts also
  // calls verify() during boot, so we don't double-fire on launch.
  timer = setInterval(async () => {
    try {
      const v = await verify();
      broadcastIfChanged(v.mode);
    } catch (err) {
      console.warn('[license] scheduled verify failed:', (err as Error).message);
    }
  }, HOUR_MS);
  // .unref() so this timer doesn't keep the process alive at quit.
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopLicenseScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
