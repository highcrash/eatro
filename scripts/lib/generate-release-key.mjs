#!/usr/bin/env node
/**
 * One-time: generate the ed25519 keypair used to sign release zips.
 *
 *   - Prints the PRIVATE key (PEM PKCS#8) + PUBLIC key (base64url, raw
 *     32 bytes) to stdout.
 *   - Private key → store in your password manager AND export as
 *     RELEASE_SIGNING_PRIVATE_KEY when running `pnpm codecanyon:package`.
 *   - Public key  → paste into
 *     apps/api/src/updater/updater.constants.ts, signingPublicKey field.
 *     Commit it, rebuild. Every zip packaged afterwards will verify
 *     against it on buyers' installs.
 *
 * Rotation: generate a new pair + ship a release that bumps the
 * public half AND keeps the old one in a trusted-keys list (if you
 * add one later). Without a trusted-keys list, buyers on the old
 * build will refuse zips signed with the new key — so rotate
 * together with a release that was signed by the OLD key.
 *
 * Run:  node scripts/lib/generate-release-key.mjs
 */

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const pubB64u = pubRaw
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

console.log('── PRIVATE KEY (keep secret, never commit) ─────────────────');
console.log(privPem.toString().trim());
console.log();
console.log('── PUBLIC KEY (paste into updater.constants.ts) ────────────');
console.log(pubB64u);
console.log();
console.log('── Next steps ──────────────────────────────────────────────');
console.log('1. Put the private key in a password manager.');
console.log('2. Export it for packaging:');
console.log('     export RELEASE_SIGNING_PRIVATE_KEY="$(cat path/to/key.pem)"');
console.log('3. Edit apps/api/src/updater/updater.constants.ts:');
console.log(`     signingPublicKey: '${pubB64u}',`);
console.log('4. Commit, then `pnpm codecanyon:package` — the zip will be signed');
console.log('   and verify cleanly on every buyer install built from that commit.');
