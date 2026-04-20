/**
 * Desktop license constants — BAKED at build time, not env-read.
 *
 * Same anti-tamper rationale as apps/api/src/license/license.constants.ts:
 * a buyer can edit .env on their box, but they can't trivially edit the
 * compiled main process bundle. So we hard-code:
 *   - the license server URL
 *   - the desktop product SKU
 *   - the bundled ed25519 public key + kid
 *
 * The license server hosts BOTH product SKUs (web + desktop) under one
 * admin panel; each has its own SigningKey row + envatoItemId mapping.
 * Desktop activations are bound to a Windows machine ID (the
 * fingerprint), one license per install.
 */
export const DESKTOP_LICENSE_CONSTANTS = {
  serverUrl: 'https://api.neawaslic.top/api/v1',
  productSku: 'restora-pos-desktop-cc',
  publicKey: 'm40iVQ6ZKU9GpfIzgzlRV1d8MFyOPYQZqscT-gTt1QY',
  publicKeyKid: 'HfODolgi',
} as const;
