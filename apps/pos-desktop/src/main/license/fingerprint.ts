import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * Per-machine fingerprint used as the license activation slot key.
 *
 * Goal: stable for the life of the Windows install, unique enough that
 * two machines on the same network don't collide, and immune to a user
 * trivially copy-pasting a license file between two PCs to dual-activate.
 *
 * Source: Windows MachineGuid from the registry, augmented by hostname
 * + a fixed app salt so the same registry value used by another product
 * doesn't yield the same fingerprint here. We avoid `node-machine-id`'s
 * Linux/macOS code paths because this app is Windows-only.
 *
 * On a wiped + reinstalled Windows, MachineGuid regenerates — that's
 * intended; the buyer needs to release the old slot via deactivate
 * (or owner-side via the license-admin) before activating the new install.
 */

let cached: string | null = null;

const APP_SALT = 'restora-pos-desktop:fingerprint:v1';

export function machineFingerprint(): string {
  if (cached) return cached;
  const guid = readWindowsMachineGuid() ?? `fallback:${hostname()}`;
  cached = createHash('sha256')
    .update(APP_SALT)
    .update('|')
    .update(guid)
    .update('|')
    .update(hostname())
    .digest('hex')
    .slice(0, 32); // 128-bit equivalent — plenty for slot uniqueness
  return cached;
}

function readWindowsMachineGuid(): string | null {
  // Lazy native imports — this module is Windows-only at runtime, but the
  // type-check on dev machines (Linux CI) shouldn't crash on top-level
  // require of `node:child_process` against a missing reg.exe.
  if (process.platform !== 'win32') return null;
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const stdout = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const match = stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
