import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

/**
 * Auto-update lifecycle:
 *   - on app launch (non-dev), check the feed configured in
 *     electron-builder.yml (currently a GitHub release on your-org/your-repo)
 *   - download in the background; when ready, notify the renderer and
 *     wait for the cashier to accept before restarting
 *   - status is broadcast as `update:status` IPC events so the renderer
 *     can render a non-blocking toast
 *
 * During `pnpm dev:desktop` the updater is suppressed — auto-installs
 * during development would be chaos.
 *
 * Codecanyon edition: buyers don't have access to the seller's GitHub
 * releases, and we ship one .exe per sale via Lemon Squeezy. The
 * placeholder publish URL in electron-builder.yml would 404 on every
 * launch — the toast surfaced "Update failed 404" and confused buyers.
 * Set DISABLE_AUTO_UPDATER=true to skip every check; the toast stays
 * idle, and buyers update by re-downloading the exe from the seller
 * when a new release ships.
 */
const DISABLE_AUTO_UPDATER = true;

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
  if (DISABLE_AUTO_UPDATER) {
    log.info('[updater] codecanyon build — auto-update disabled (buyers re-download)');
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // we prompt the cashier first

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
  if (!app.isPackaged || DISABLE_AUTO_UPDATER) {
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
