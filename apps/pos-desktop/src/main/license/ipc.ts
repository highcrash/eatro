import { ipcMain } from 'electron';
import { LicenseApiError, type Verdict } from '@restora/license-client';
import { activate, status, deactivate } from './service';

/**
 * IPC bridge for the renderer-side license screens. Three handlers:
 *
 *   license:status     — local-only verdict snapshot (no network)
 *   license:activate   — POST /licenses/activate, persist proof, return verdict
 *   license:deactivate — POST /licenses/deactivate, clear local cache
 *
 * Activation errors come back to the renderer as a structured object
 * (not a thrown exception) so the LicenseStep UI can show the server's
 * message verbatim — "Code already activated on another device",
 * "Code revoked", etc — instead of a generic "something went wrong".
 *
 * The fingerprint NEVER crosses this bridge — service.activate() reads
 * it directly from the OS so a malicious renderer can't impersonate a
 * different machine.
 */
export function registerLicenseIpc(): void {
  ipcMain.handle('license:status', async (): Promise<Verdict> => {
    return status();
  });

  ipcMain.handle('license:activate', async (_e, purchaseCode: unknown) => {
    if (typeof purchaseCode !== 'string' || purchaseCode.trim().length < 8) {
      return { error: true, result: 'INVALID_INPUT', message: 'Purchase code is required.' };
    }
    try {
      return await activate(purchaseCode);
    } catch (err) {
      if (err instanceof LicenseApiError) {
        return { error: true, result: err.result, message: err.message };
      }
      return {
        error: true,
        result: 'UNKNOWN',
        message: (err as Error).message ?? 'Activation failed for an unknown reason.',
      };
    }
  });

  ipcMain.handle('license:deactivate', async () => {
    await deactivate();
    return { ok: true as const };
  });
}
