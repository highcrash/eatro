import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import type { LicenseStorage, PersistedState } from '@restora/license-client';

/**
 * DPAPI-encrypted storage adapter for @restora/license-client.
 *
 * Mirrors apps/pos-desktop/src/main/config/store.ts (the device-pairing
 * blob): on Windows, Electron's safeStorage wraps DPAPI per-user, so a
 * file copied to another user account on the same box (or another box)
 * decrypts to garbage. On dev hosts without DPAPI we fall through to
 * plaintext so the app still boots.
 *
 * File: %APPDATA%/Your Restaurant POS/license.enc
 *
 * The on-disk blob is a JSON-serialised PersistedState (the type
 * @restora/license-client defines): { licenseId, hmacSecretB64u,
 * signedProof, lastVerifiedAtMs, kid }. The hmacSecret is the
 * sensitive bit — DPAPI keeps it safe at rest; the proof itself is
 * already ed25519-signed so its confidentiality matters less.
 *
 * Atomic writes: tmpfile + rename, same as license-client's own
 * fileStorage helper. Crash mid-write leaves last-good intact.
 */

const FILE = 'license.enc';

function filePath(): string {
  return join(app.getPath('userData'), FILE);
}

export function dpapiLicenseStorage(): LicenseStorage {
  return {
    async read(): Promise<PersistedState | null> {
      try {
        const buf = await fs.readFile(filePath());
        const plaintext = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(buf)
          : buf.toString('utf8');
        return JSON.parse(plaintext) as PersistedState;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return null;
        // Corrupt or wrong-user file — treat as "no license cached" so
        // the renderer prompts for activation rather than crashing the
        // shell. The user can re-activate; the slot on the server is
        // tied to the machine fingerprint which remains stable.
        console.warn('[license-store] read failed, treating as missing:', (err as Error).message);
        return null;
      }
    },
    async write(state: PersistedState): Promise<void> {
      const path = filePath();
      await fs.mkdir(dirname(path), { recursive: true });
      const plaintext = JSON.stringify(state);
      const payload = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(plaintext)
        : Buffer.from(plaintext, 'utf8');
      const tmp = `${path}.${process.pid}.tmp`;
      await fs.writeFile(tmp, payload, { mode: 0o600 });
      await fs.rename(tmp, path);
    },
    async clear(): Promise<void> {
      try {
        await fs.unlink(filePath());
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err;
      }
    },
  };
}
