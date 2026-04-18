import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { decodeKek, wrap, unwrap } from './aes-gcm';
import { decodePepper, deriveLicenseHmacSecret, signRequest, verifyRequest } from './hmac';
import { generateKeypair, publicKeyFromSeed, type Ed25519Keypair } from './ed25519';
import { signProof, parseProof, type ProofPayload, type ParsedProof } from './proof';

/**
 * Single injectable surface for every crypto primitive the rest of the
 * server needs. Loads KEK + pepper once at boot (fails fast on bad env);
 * everything else is pure functions wrapped to make DI ergonomic.
 *
 * Importantly: this service NEVER returns the raw KEK or pepper. Callers
 * pass plaintexts + ciphertexts and get back the other half. That keeps
 * the secrets confined to this module's closure for the process lifetime.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private kek!: Buffer;
  private pepper!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const kekStr = this.config.get<string>('LICENSE_SIGNING_KEK');
    const pepperStr = this.config.get<string>('LICENSE_HMAC_PEPPER');
    if (!kekStr) throw new Error('LICENSE_SIGNING_KEK is not set');
    if (!pepperStr) throw new Error('LICENSE_HMAC_PEPPER is not set');
    this.kek = decodeKek(kekStr);
    this.pepper = decodePepper(pepperStr);
    this.logger.log('Crypto service initialised (KEK + HMAC pepper loaded)');
  }

  // ── AES-GCM key wrapping for at-rest secrets ──────────────────────────
  wrap(plaintext: Buffer): string {
    return wrap(plaintext, this.kek);
  }

  unwrap(envelope: string): Buffer {
    return unwrap(envelope, this.kek);
  }

  // ── Per-license HMAC secret derivation ────────────────────────────────
  deriveLicenseHmacSecret(licenseId: string): Buffer {
    return deriveLicenseHmacSecret(licenseId, this.pepper);
  }

  // ── Request signing / verification (used by HMAC guard) ───────────────
  signRequest(hmacSecret: Buffer, timestamp: number, rawBody: string): string {
    return signRequest(hmacSecret, timestamp, rawBody);
  }

  verifyRequest(
    hmacSecret: Buffer,
    timestamp: number,
    rawBody: string,
    signatureB64u: string,
  ): boolean {
    return verifyRequest(hmacSecret, timestamp, rawBody, signatureB64u);
  }

  // ── Ed25519 keypairs (Product signing keys) ───────────────────────────
  generateProductKeypair(): Ed25519Keypair {
    return generateKeypair();
  }

  publicKeyFromSeed(privateSeed: Buffer): Buffer {
    return publicKeyFromSeed(privateSeed);
  }

  // ── Signed proofs (issued on activate/verify) ─────────────────────────
  signProof(payload: ProofPayload, privateSeed: Buffer): string {
    return signProof(payload, privateSeed);
  }

  parseProof(token: string, publicKey: Buffer): ParsedProof {
    return parseProof(token, publicKey);
  }

  // ── Misc helpers ──────────────────────────────────────────────────────
  /** Random base64url string for proof nonces, kids, etc. */
  randomToken(byteLen = 9): string {
    return randomBytes(byteLen).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
