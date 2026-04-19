#!/usr/bin/env node
// Manifest signer for the CodeCanyon release zip.
//
// The packager (scripts/package-codecanyon.mjs) builds a JSON
// manifest listing every file + its SHA-256, version, etc. This
// helper signs that manifest with an ed25519 key so the in-app
// updater (Section 6) can verify a re-uploaded zip BEFORE applying
// it — defending against tampered or partial uploads.
//
// Key handling:
//   - Reads RELEASE_SIGNING_PRIVATE_KEY (PEM, PKCS#8) from env.
//   - Outputs manifest.sig next to manifest.json.
//   - Public key PROD copy ships in apps/api/src/updater/public-key.ts
//     (Section 6) — buyers only see the public half.

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , manifestPath, sigOutPath] = process.argv;
if (!manifestPath || !sigOutPath) {
  console.error('usage: sign-manifest.mjs <manifest.json> <out.sig>');
  process.exit(2);
}

const pem = process.env.RELEASE_SIGNING_PRIVATE_KEY;
if (!pem) {
  console.error('RELEASE_SIGNING_PRIVATE_KEY env required (PEM, PKCS#8 ed25519)');
  process.exit(2);
}

const key = createPrivateKey({ key: pem, format: 'pem', type: 'pkcs8' });
const data = readFileSync(manifestPath);
// ed25519: the digest argument MUST be null; the algorithm hashes
// internally as part of the signing scheme.
const sig = sign(null, data, key);
const out = sig.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
writeFileSync(sigOutPath, out, 'utf8');
console.log(`signed: ${manifestPath} → ${sigOutPath} (${out.length} chars base64url)`);
