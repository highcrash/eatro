import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpcHandlers, wireSyncBroadcast } from './ipc/handlers';
import { setMainWindowForPrinting } from './printing/html-print';
import { onlineDetector } from './sync/online-detector';
import { startSyncWorker } from './sync/sync-worker';
import { installUploadProxy } from './upload-proxy';
import { setupAutoUpdater } from './updater';

// Phase 1 — Electron main process with device pairing + encrypted config.
// Later phases add printer, SQLite outbox, etc.

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setMainWindowForPrinting(win);

  win.once('ready-to-show', () => {
    win.show();
    // Intentional: Phase 0 smoke signal so the scaffolding can be verified end-to-end.
    // Remove this line once Phase 1 ships real startup logging.
    console.log('desktop-shell-ready');
  });

  // In dev the renderer is served by Vite; in a packaged build it comes from the ASAR.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(async () => {
  registerIpcHandlers();
  wireSyncBroadcast();
  startSyncWorker();
  onlineDetector.start();
  await installUploadProxy();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  onlineDetector.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
