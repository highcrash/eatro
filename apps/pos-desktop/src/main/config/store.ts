import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Encrypted local config store.
 *
 * On Windows, Electron's safeStorage backs onto DPAPI (Data Protection API)
 * with per-user scope — the ciphertext can only be decrypted by the same
 * Windows user on the same machine.
 *
 * File location: %APPDATA%/Restora POS/config.enc
 *
 * We keep the schema small: anything secret (deviceToken) is encrypted;
 * non-secret but useful metadata (serverUrl, deviceName, branch) is
 * included in the same blob for convenience and because the blob is also
 * protected.
 */

export type PrinterSlot =
  | { mode: 'disabled' }
  | { mode: 'network'; host: string; port: number }
  | { mode: 'os-printer'; deviceName: string };

export interface PrintersConfig {
  kitchen: PrinterSlot;
  bill: PrinterSlot;
  reports: PrinterSlot;
  openCashDrawerOnCashPayment: boolean;
}

export const DEFAULT_PRINTERS: PrintersConfig = {
  kitchen: { mode: 'disabled' },
  bill: { mode: 'disabled' },
  reports: { mode: 'disabled' },
  openCashDrawerOnCashPayment: true,
};

export interface DesktopConfig {
  serverUrl: string;
  deviceId: string;
  deviceName: string;
  deviceToken: string; // opaque bearer token, treat as secret
  branch: { id: string; name: string };
  pairedAt: string; // ISO timestamp
  printers?: PrintersConfig; // added in Phase 3 — missing on older configs
}

const CONFIG_FILE = 'config.enc';

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE);
}

export async function readConfig(): Promise<DesktopConfig | null> {
  try {
    const buf = await fs.readFile(configPath());
    if (!safeStorage.isEncryptionAvailable()) {
      // On a dev machine without DPAPI (e.g. first boot of Linux CI) we may
      // have stored plaintext. Fall back to plain read so dev still works.
      return JSON.parse(buf.toString('utf8')) as DesktopConfig;
    }
    const plaintext = safeStorage.decryptString(buf);
    return JSON.parse(plaintext) as DesktopConfig;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    // Corrupt or wrong-user file — treat as "no config" so the user can re-pair.
    console.warn('[desktop] config read failed, treating as unpaired:', (err as Error).message);
    return null;
  }
}

export async function writeConfig(cfg: DesktopConfig): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const plaintext = JSON.stringify(cfg);
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plaintext)
    : Buffer.from(plaintext, 'utf8');
  await fs.writeFile(configPath(), payload, { mode: 0o600 });
}

export async function clearConfig(): Promise<void> {
  try {
    await fs.unlink(configPath());
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }
}

export async function getPrinters(): Promise<PrintersConfig> {
  const cfg = await readConfig();
  return cfg?.printers ?? DEFAULT_PRINTERS;
}

export async function setPrinters(next: PrintersConfig): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) throw new Error('Terminal is not paired — pair it first before configuring printers.');
  await writeConfig({ ...cfg, printers: next });
}
