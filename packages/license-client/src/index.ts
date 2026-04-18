/**
 * @restora/license-client — zero-dep client for the self-hosted
 * license server (apps/license-server on the author's `main` branch).
 *
 * This package DOES travel with the CodeCanyon zip. It must have no
 * runtime deps so the buyer's install footprint is small and there's
 * no transitive attack surface.
 *
 * Typical use from a CodeCanyon-fork NestJS app:
 *
 *   import { activate, verify, localVerdict, fileStorage } from '@restora/license-client';
 *
 *   const cfg = {
 *     baseUrl: process.env.LICENSE_SERVER_URL!,
 *     productSku: 'restora-pos-cc',
 *     publicKey: process.env.LICENSE_PUBLIC_KEY!,      // bundled at build
 *     publicKeyKid: process.env.LICENSE_PUBLIC_KEY_KID!,
 *     storage: fileStorage('/var/lib/yourapp/license.json'),
 *   };
 *   const verdict = await verify(cfg).catch(() => localVerdict(cfg));
 */

export {
  activate,
  verify,
  deactivate,
  localVerdict,
  hostMatchesLicense,
  LicenseApiError,
  type ActivateInput,
} from './client';

export type {
  LicenseClientConfig,
  LicenseStorage,
  PersistedState,
  Verdict,
  VerdictMode,
} from './types';

export { fileStorage, memoryStorage } from './storage';

export type { ProofPayload, ParsedProof } from './proof';
export { parseProof } from './proof';

export { domainMatches, normalizeHost, normalizePattern } from './domain-match';
