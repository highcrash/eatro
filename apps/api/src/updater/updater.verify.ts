import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Signature + manifest verification for an extracted release zip.
 *
 * The packager writes two files at the zip root:
 *   manifest.json — { name, version, builtAt, files[{path,sha256,size}] }
 *   manifest.sig  — base64url ed25519 signature over manifest.json's bytes
 *
 * We verify:
 *   1. manifest.sig matches manifest.json under the bundled pubkey
 *   2. every file listed in manifest.files exists at the right path
 *   3. every file's sha256 matches the manifest (tamper / truncation)
 *
 * Returns the parsed manifest on success. Throws an Error with a
 * human-readable reason on any failure — the controller maps that
 * to a 400 Bad Request with the reason in the body so the admin
 * UI can surface it inline.
 */

export interface Manifest {
  name: string;
  version: string;
  builtAt: string;
  files: { path: string; sha256: string; size: number }[];
}

// ed25519 raw 32-byte key → SPKI DER wrapper so Node's verify()
// accepts it. Prefix is the fixed AlgorithmIdentifier for
// id-Ed25519 (1.3.101.112). Same trick as the license-client uses.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export async function verifyRelease(
  stagingPath: string,
  publicKeyB64u: string,
): Promise<Manifest> {
  if (!publicKeyB64u) {
    throw new Error(
      'Updater public key is not configured. The current build cannot accept any release zip — ' +
        'the packager needs UPDATER_CONSTANTS.signingPublicKey set before producing release builds.',
    );
  }

  const manifestBuf = await readFile(join(stagingPath, 'manifest.json')).catch(() => {
    throw new Error('Release zip is missing manifest.json at its root.');
  });
  const sigStr = await readFile(join(stagingPath, 'manifest.sig'), 'utf8').catch(() => {
    throw new Error('Release zip is missing manifest.sig — either unsigned (reject) or corrupted.');
  });

  // ─── signature check ────────────────────────────────────────────────
  const sig = base64urlDecode(sigStr.trim());
  const pubRaw = base64urlDecode(publicKeyB64u);
  if (pubRaw.length !== 32) {
    throw new Error('Updater public key decoded to wrong length (expected 32 bytes).');
  }
  const spki = Buffer.concat([SPKI_PREFIX, pubRaw]);
  const keyObject = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const sigOk = verify(null, manifestBuf, keyObject, sig);
  if (!sigOk) {
    throw new Error(
      'Release signature did not verify under the bundled public key. ' +
        'Either the zip came from a different seller/build, or it was tampered with after signing.',
    );
  }

  // ─── parse + sanity ─────────────────────────────────────────────────
  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestBuf.toString('utf8')) as Manifest;
  } catch {
    throw new Error('manifest.json is not valid JSON.');
  }
  if (!manifest.version || !manifest.files?.length) {
    throw new Error('manifest.json is missing required fields (version, files[]).');
  }

  // ─── file-by-file hash check ────────────────────────────────────────
  // Expensive but cheap in practice: ~800 files × single sha256 pass,
  // total sub-second for a 1.3 MB zip. Catches truncation + swapping
  // a single file inside the zip post-signing.
  for (const entry of manifest.files) {
    if (entry.path === 'manifest.json' || entry.path === 'manifest.sig') continue;
    const buf = await readFile(join(stagingPath, entry.path)).catch(() => null);
    if (!buf) {
      throw new Error(`Release zip is missing file listed in manifest: ${entry.path}`);
    }
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== entry.sha256) {
      throw new Error(
        `File hash mismatch: ${entry.path} (manifest ${entry.sha256.slice(0, 12)}…, got ${sha.slice(0, 12)}…)`,
      );
    }
  }

  return manifest;
}

function base64urlDecode(s: string): Buffer {
  const standard = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}
