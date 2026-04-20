import {
  activate as clientActivate,
  verify as clientVerify,
  deactivate as clientDeactivate,
  localVerdict,
  LicenseApiError,
  type LicenseClientConfig,
  type Verdict,
} from '@restora/license-client';
import { DESKTOP_LICENSE_CONSTANTS } from './constants';
import { dpapiLicenseStorage } from './store';
import { machineFingerprint } from './fingerprint';

/**
 * High-level license service used by IPC + scheduler. Wraps
 * @restora/license-client with three things specific to this desktop:
 *
 *   1. Storage adapter is DPAPI-backed, not plain file.
 *   2. Fingerprint is the Windows MachineGuid (always — IPC callers
 *      can't override it; that prevents a malicious renderer from
 *      activating against a faked fingerprint).
 *   3. Domain field carries the machine fingerprint too — the desktop
 *      product doesn't have a "domain" the way the web edition does,
 *      so we reuse the same column as a per-install identifier.
 *
 * Boot sequence is the same as the web gate:
 *   - on app start, try a server verify (fast — refreshes the proof);
 *     if offline or the server hiccups, fall back to localVerdict()
 *     which returns active|grace|locked|missing from the cached proof.
 *   - hourly thereafter, do the same dance via license/scheduler.ts.
 *
 * The renderer only ever sees the resolved Verdict, never the raw
 * proof or hmacSecret.
 */

let cfg: LicenseClientConfig | null = null;

function config(): LicenseClientConfig {
  if (cfg) return cfg;
  cfg = {
    baseUrl: DESKTOP_LICENSE_CONSTANTS.serverUrl,
    productSku: DESKTOP_LICENSE_CONSTANTS.productSku,
    publicKey: DESKTOP_LICENSE_CONSTANTS.publicKey,
    publicKeyKid: DESKTOP_LICENSE_CONSTANTS.publicKeyKid,
    storage: dpapiLicenseStorage(),
  };
  return cfg;
}

export async function activate(purchaseCode: string): Promise<Verdict> {
  const fp = machineFingerprint();
  return clientActivate(config(), {
    purchaseCode: purchaseCode.trim(),
    domain: fp,        // desktop has no domain — fingerprint doubles as one
    fingerprint: fp,
  });
}

/**
 * Verify against the server, fall back to local verdict if offline.
 * Never throws — caller gets a Verdict either way and can decide what
 * to do (UI prompt, lock screen, etc).
 */
export async function verify(): Promise<Verdict> {
  try {
    return await clientVerify(config());
  } catch (err) {
    if (err instanceof LicenseApiError && err.result === 'NETWORK_ERROR') {
      return localVerdict(config());
    }
    // Other API errors (REVOKED, NOT_FOUND, INVALID_SIGNATURE) — return
    // the local verdict, which has already been updated by the verify
    // path on most outcomes. Worst case: caller sees stale active,
    // hourly cron fixes it within an hour.
    console.warn('[license] verify failed:', (err as Error).message);
    return localVerdict(config());
  }
}

/** Read-only — no network. For the renderer's status polling. */
export async function status(): Promise<Verdict> {
  return localVerdict(config());
}

/**
 * Release the activation slot server-side. After this the buyer can
 * re-activate the same purchase code on a different machine (assuming
 * the code's maxActivations allows another). Local cache is wiped.
 */
export async function deactivate(): Promise<void> {
  try {
    await clientDeactivate(config());
  } catch (err) {
    // Network failure during deactivate — clear local state anyway so
    // the user isn't stuck looking at a "deactivated" UI that still
    // reports active. The server slot stays held until they re-try
    // online; admin can release it manually.
    console.warn('[license] deactivate network error, clearing local state:', (err as Error).message);
  }
  await config().storage.clear();
}
