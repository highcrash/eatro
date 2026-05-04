import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

/**
 * Auto-update lifecycle:
 *   - on app launch (non-dev), check the feed configured in
 *     electron-builder.yml (currently a GitHub release on highcrash/eatro)
 *   - download in the background; when ready, notify the renderer and
 *     wait for the cashier to accept before restarting
 *   - status is broadcast as `update:status` IPC events so the renderer
 *     can render a non-blocking toast
 *
 * During `pnpm dev:desktop` the updater is suppressed — auto-installs
 * during development would be chaos.
 */

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; currentVersion: string }
  | { kind: 'available'; version: string; releaseNotes?: string }
  | { kind: 'downloading'; percent: number; speed?: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

let lastStatus: UpdateStatus = { kind: 'idle' };

export function getLastUpdateStatus(): UpdateStatus {
  return lastStatus;
}

function broadcast(status: UpdateStatus): void {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:status', status);
  }
}

export function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    log.info('[updater] dev build — auto-update disabled');
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // we prompt the cashier first
  // Force the consumer-side channel name. electron-builder.yml sets
  // `publish.channel: stable` which renames the published manifest to
  // latest-stable.yml, BUT it doesn't always propagate the channel into
  // the bundled app-update.yml — electron-updater then falls back to
  // polling latest.yml and 404s. Setting it explicitly here pins the
  // installed app to its branch's manifest forever, regardless of how
  // electron-builder generates app-update.yml.
  autoUpdater.channel = 'stable';

  autoUpdater.on('checking-for-update', () => broadcast({ kind: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    broadcast({
      kind: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    }),
  );
  autoUpdater.on('update-not-available', () =>
    broadcast({ kind: 'none', currentVersion: app.getVersion() }),
  );
  autoUpdater.on('download-progress', (p) =>
    broadcast({ kind: 'downloading', percent: Math.round(p.percent), speed: p.bytesPerSecond }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ kind: 'ready', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    broadcast({ kind: 'error', message: err?.message ?? 'update failed' }),
  );

  // Fire the first check 15 seconds after launch so boot isn't blocked on HTTP.
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.error('[updater] check failed:', err);
      broadcast({ kind: 'error', message: err?.message ?? 'check failed' });
    });
  }, 15_000);

  // Re-check every 6 hours. Restaurants run the terminal all day.
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => log.error('[updater] periodic check failed:', err));
  }, 6 * 60 * 60 * 1000);
}

export async function triggerCheck(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    broadcast({ kind: 'none', currentVersion: app.getVersion() });
    return lastStatus;
  }
  try {
    broadcast({ kind: 'checking' });
    await autoUpdater.checkForUpdates();
    return lastStatus;
  } catch (err) {
    broadcast({ kind: 'error', message: (err as Error).message });
    return lastStatus;
  }
}

export function installAndRestart(): void {
  autoUpdater.quitAndInstall(false, true);
}
