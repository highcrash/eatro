import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';

/**
 * Ed25519 keypair management.
 *
 * Storage rationale: Node's `generateKeyPairSync('ed25519')` hands back
 * KeyObjects, but we need to PERSIST keys (encrypted) and ROTATE them.
 * Two practical formats are PEM and the raw 32-byte seed. Raw seed wins:
 *   - Smaller (32 bytes vs ~120-byte PEM)
 *   - Easier to wrap with AES-GCM (no PEM line-folding to worry about)
 *   - Reconstructible into a KeyObject via DER + createPrivateKey()
 *
 * The DER prefix below is the constant header for an ed25519 PKCS#8
 * private key wrapping a 32-byte seed. Concatenating prefix + seed
 * yields a valid PKCS#8 DER blob that Node's crypto can import.
 */

// PKCS#8 DER prefix for an ed25519 OneAsymmetricKey:
//   SEQUENCE { INTEGER 0, AlgorithmIdentifier { OID 1.3.101.112 },
//              OCTET STRING { OCTET STRING { 32-byte-seed } } }
// — fixed bytes; no allocator surprises.
const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

// SubjectPublicKeyInfo DER prefix for an ed25519 public key.
//   SEQUENCE { AlgorithmIdentifier { OID 1.3.101.112 },
//              BIT STRING { 32-byte-pubkey } }
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface Ed25519Keypair {
  /** raw 32-byte seed */
  privateSeed: Buffer;
  /** raw 32-byte public key */
  publicKey: Buffer;
}

export function generateKeypair(): Ed25519Keypair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  // Export the private key as PKCS#8 DER, slice off the constant prefix
  // to get the 32-byte seed.
  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const privateSeed = Buffer.from(
    privateDer.subarray(privateDer.length - 32),
  );

  // Same trick for the public key — SPKI DER trailing 32 bytes is the key.
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const pubKey = Buffer.from(publicDer.subarray(publicDer.length - 32));

  return { privateSeed, publicKey: pubKey };
}

export function signMessage(message: Buffer, privateSeed: Buffer): Buffer {
  if (privateSeed.length !== 32) {
    throw new Error('signMessage: privateSeed must be exactly 32 bytes');
  }
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, privateSeed]);
  const keyObject = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  // For ed25519, Node's `sign()` requires the digest argument to be null —
  // ed25519 hashes the message internally as part of the signing scheme.
  return sign(null, message, keyObject);
}

export function verifyMessage(
  message: Buffer,
  signature: Buffer,
  publicKey: Buffer,
): boolean {
  if (publicKey.length !== 32) {
    throw new Error('verifyMessage: publicKey must be exactly 32 bytes');
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, publicKey]);
  const keyObject = createPublicKey({ key: der, format: 'der', type: 'spki' });
  return verify(null, message, keyObject, signature);
}

export function publicKeyFromSeed(privateSeed: Buffer): Buffer {
  // The cheap way: import as PKCS#8 and re-export as SPKI. Node derives
  // the public key for us. Useful when we have a seed but need to
  // recompute the public key (e.g. validating a stored row's pair).
  if (privateSeed.length !== 32) {
    throw new Error('publicKeyFromSeed: privateSeed must be exactly 32 bytes');
  }
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, privateSeed]);
  const keyObject = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicDer = createPublicKey(keyObject).export({ format: 'der', type: 'spki' });
  return Buffer.from(publicDer.subarray(publicDer.length - 32));
}
