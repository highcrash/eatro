import { ipcMain, app } from 'electron';
import { readConfig, getPrinters, setPrinters, type PrintersConfig } from '../config/store';
import { registerDevice, unpair, type RegisterDeviceInput } from '../session/device-registration';
import { getCachedCashiers } from '../session/cashier-cache';
import {
  refreshCashiers,
  pinLoginWithServer,
  passwordLoginOnDevice,
} from '../session/cashier-login';
import { getPinStatus, setPin, verifyPin, clearPin } from '../session/pin-store';
import { clearSession, getSessionUser } from '../session/session';
import { listOsPrinters } from '../printing/html-print';
import { testPrint } from '../printing/test-print';
import { printKitchenTicket } from '../printing/kitchen';
import { printReceipt, openCashDrawer, type ReceiptInput } from '../printing/receipt';
import { printA4Report } from '../printing/a4-report';
import type { KitchenTicketInput } from '@restora/utils';
import { onlineDetector } from '../sync/online-detector';
import { apiFetch, type ApiFetchInput } from '../sync/api-proxy';
import { counts, listFailed, retry, retryAllFailed, dismiss, clearAll } from '../sync/outbox';
import { forceDrain } from '../sync/sync-worker';
import { BrowserWindow } from 'electron';
import { refreshUploadProxyServer } from '../upload-proxy';
import { getLastUpdateStatus, triggerCheck, installAndRestart } from '../updater';
import { captureDiagnosticsSnapshot } from '../diagnostics';
import { isRevoked, clearRevoked } from '../session/device-heartbeat';

export function registerIpcHandlers(): void {
  // Config ----------------------------------------------------------------

  ipcMain.handle('config:get', async () => {
    const cfg = await readConfig();
    if (!cfg) return null;
    return {
      serverUrl: cfg.serverUrl,
      deviceId: cfg.deviceId,
      deviceName: cfg.deviceName,
      branch: cfg.branch,
      pairedAt: cfg.pairedAt,
    };
  });

  ipcMain.handle('config:is-paired', async () => {
    const cfg = await readConfig();
    return cfg != null;
  });

  // Device pairing --------------------------------------------------------

  ipcMain.handle('device:register', async (_e, input: RegisterDeviceInput) => {
    const cfg = await registerDevice(input);
    await refreshUploadProxyServer();
    return {
      serverUrl: cfg.serverUrl,
      deviceId: cfg.deviceId,
      deviceName: cfg.deviceName,
      branch: cfg.branch,
      pairedAt: cfg.pairedAt,
    };
  });

  ipcMain.handle('device:unpair', async () => {
    clearSession();
    await unpair();
    // Clear the revoked flag too — the owner is unpairing on purpose, and
    // after re-pair the new token is fresh and should start clean.
    clearRevoked();
    await refreshUploadProxyServer();
    return { ok: true };
  });

  // Cashier list ----------------------------------------------------------

  ipcMain.handle('cashier:list', async () => {
    // Try a fresh server pull first; fall back to cached list on failure.
    await refreshCashiers();
    const cashiers = getCachedCashiers();
    return cashiers.map((c) => {
      const status = getPinStatus(c.id);
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        role: c.role,
        hasPin: status.hasPin,
      };
    });
  });

  ipcMain.handle('cashier:pin-status', (_e, staffId: string) => {
    return getPinStatus(staffId);
  });

  ipcMain.handle('cashier:verify-pin', async (_e, { staffId, pin }: { staffId: string; pin: string }) => {
    const result = await verifyPin(staffId, pin);
    if (!result.ok) return result;
    try {
      const user = await pinLoginWithServer(staffId);
      return { ok: true, user };
    } catch (err) {
      return { ok: false, reason: 'server', message: (err as Error).message };
    }
  });

  ipcMain.handle(
    'cashier:set-pin',
    async (_e, { email, password, pin }: { email: string; password: string; pin: string }) => {
      try {
        const user = await passwordLoginOnDevice(email, password);
        await setPin(user.id, pin);
        return { ok: true, user };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    'cashier:change-pin',
    async (_e, { staffId, currentPin, newPin }: { staffId: string; currentPin: string; newPin: string }) => {
      try {
        const verify = await verifyPin(staffId, currentPin);
        if (!verify.ok) {
          if (verify.reason === 'wrong') return { ok: false, message: 'Current PIN is wrong' };
          if (verify.reason === 'locked') return { ok: false, message: 'PIN is temporarily locked. Try again later.' };
          if (verify.reason === 'no-pin') return { ok: false, message: 'No PIN set for this user yet' };
          return { ok: false, message: 'Could not verify current PIN' };
        }
        await setPin(staffId, newPin);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    },
  );

  ipcMain.handle('cashier:forget-pin', (_e, staffId: string) => {
    clearPin(staffId);
    return { ok: true };
  });

  // Session ---------------------------------------------------------------

  ipcMain.handle('session:current', () => {
    return getSessionUser();
  });

  ipcMain.handle('session:signout', () => {
    clearSession();
    return { ok: true };
  });

  // Printer configuration & print jobs -----------------------------------

  ipcMain.handle('printers:list-os', async () => listOsPrinters());

  ipcMain.handle('printers:get', async () => getPrinters());

  ipcMain.handle('printers:set', async (_e, next: PrintersConfig) => {
    await setPrinters(next);
    return await getPrinters();
  });

  ipcMain.handle('printers:test', async (_e, slot: 'kitchen' | 'bill' | 'reports') => {
    try {
      await testPrint(slot);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  ipcMain.handle('printers:open-cash-drawer', async () => {
    try {
      await openCashDrawer();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  // Job dispatch — the POS renderer will call these once Phase 5 lands.
  ipcMain.handle('print:kitchen', async (_e, ticket: KitchenTicketInput) => {
    try {
      await printKitchenTicket(ticket);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  ipcMain.handle(
    'print:receipt',
    async (_e, args: { receipt: ReceiptInput; openCashDrawer?: boolean }) => {
      try {
        await printReceipt(args.receipt, { openCashDrawer: args.openCashDrawer });
        return { ok: true };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    },
  );

  ipcMain.handle('print:report-a4', async (_e, args: { html: string; landscape?: boolean }) => {
    try {
      await printA4Report(args.html, { landscape: args.landscape });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  // API proxy + sync --------------------------------------------------------

  ipcMain.handle('api:fetch', async (_e, input: ApiFetchInput) => apiFetch(input));

  ipcMain.handle('sync:status', () => ({
    online: onlineDetector.isOnline(),
    rawStatus: onlineDetector.currentStatus(),
    ...counts(),
  }));

  ipcMain.handle('sync:failed-list', () => listFailed().map((r) => ({
    id: r.id,
    method: r.method,
    path: r.path,
    attempts: r.attempts,
    lastError: r.lastError,
    createdAtMs: r.createdAtMs,
  })));

  ipcMain.handle('sync:retry', (_e, id: string) => {
    retry(id);
    void forceDrain();
    return { ok: true };
  });

  ipcMain.handle('sync:retry-all-failed', () => {
    const reset = retryAllFailed();
    void forceDrain();
    return { reset };
  });

  ipcMain.handle('sync:dismiss', (_e, id: string) => {
    dismiss(id);
    return { ok: true };
  });

  ipcMain.handle('sync:drain-now', async () => forceDrain());

  ipcMain.handle('sync:force-offline', () => {
    onlineDetector.forceOffline();
    return { ok: true };
  });

  ipcMain.handle('sync:probe', async () => ({ status: await onlineDetector.forceProbe() }));

  ipcMain.handle('sync:clear-outbox', () => {
    clearAll();
    return { ok: true };
  });

  // App version + auto-update --------------------------------------------

  ipcMain.handle('app:version', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
  }));

  // Diagnostics -----------------------------------------------------------

  ipcMain.handle('diagnostics:snapshot', () => captureDiagnosticsSnapshot());

  // Device revoke -----------------------------------------------------------

  ipcMain.handle('device:is-revoked', () => isRevoked());
  ipcMain.handle('device:clear-revoked', () => {
    clearRevoked();
    return { ok: true };
  });

  ipcMain.handle('update:status', () => getLastUpdateStatus());
  ipcMain.handle('update:check', async () => triggerCheck());
  ipcMain.handle('update:install', () => {
    installAndRestart();
    return { ok: true };
  });
}

/**
 * Broadcast a `sync:status-changed` event to every renderer whenever the
 * detector or outbox state shifts.
 */
export function wireSyncBroadcast(): void {
  const broadcast = () => {
    const payload = {
      online: onlineDetector.isOnline(),
      rawStatus: onlineDetector.currentStatus(),
      ...counts(),
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('sync:status-changed', payload);
    }
  };
  onlineDetector.on('change', broadcast);
  // Also broadcast every 2s while the pending/failed set might be changing —
  // cheap and beats plumbing fine-grained change notifications from the outbox.
  setInterval(broadcast, 2000);
}
