/**
 * Public types exported by @restora/license-client. These are the
 * contract the CodeCanyon-fork API and POS-desktop consume — keeping
 * them in one file makes the surface area obvious at a glance.
 */

export interface LicenseStorage {
  read(): Promise<PersistedState | null> | PersistedState | null;
  write(state: PersistedState): Promise<void> | void;
  clear(): Promise<void> | void;
}

export interface PersistedState {
  licenseId: string;
  hmacSecretB64u: string;
  signedProof: string;
  /**
   * When the installed app last called verify() successfully. Offline
   * grace is measured from this timestamp, NOT from `issuedAt` inside
   * the proof — so a clock-rewinding adversary can't extend grace.
   */
  lastVerifiedAtMs: number;
  /** The kid the stored proof was signed under. Used to decide whether
   *  to fetch /products/:sku/public-key again after rotation. */
  kid: string;
}

export interface LicenseClientConfig {
  /** e.g. https://license.eatrobd.com/api/v1 — no trailing slash. */
  baseUrl: string;
  /** e.g. 'restora-pos-cc'. */
  productSku: string;
  /** Bundled at build time. base64url of the 32-byte raw ed25519 key. */
  publicKey: string;
  /** Must match the kid the server signed with, or the client fetches
   *  /products/:sku/public-key to discover the new pair. */
  publicKeyKid: string;
  /** Callback to load/save cached state. Node: file-backed; browser:
   *  localStorage + HMAC; desktop: DPAPI-encrypted file. */
  storage: LicenseStorage;
  /** Override for tests. Defaults to Date.now(). */
  now?: () => number;
  /** Override for tests / polyfills. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

export type VerdictMode = 'active' | 'grace' | 'locked' | 'missing';

export interface Verdict {
  mode: VerdictMode;
  /** Granular status from the last-seen proof. null when mode=missing. */
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PENDING' | null;
  /** Whole days remaining in the offline grace window. 0 when active
   *  online (no grace used yet) or when already locked. */
  graceDaysRemaining: number;
  licenseId: string | null;
  domain: string | null;
  /** Human-readable reason — surface in the UI when mode != active. */
  reason: string;
}
