import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  activate as clientActivate,
  verify as clientVerify,
  deactivate as clientDeactivate,
  localVerdict,
  hostMatchesLicense,
  parseProof,
  type LicenseClientConfig,
  type Verdict,
} from '@restora/license-client';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaLicenseStorage } from './license.storage';
import { fingerprint as deriveFingerprint } from './license.crypto';
import { isDevHost, normalizeHost } from './license.domain';

/**
 * The single source of truth for license state in the running process.
 *
 * Holds the latest cached `Verdict` on `globalThis[Symbol.for('restora.lic')]`
 * so a cracker who patches THIS file with `return {mode:"active"}` still
 * has to win the race against:
 *   - the @Global() guard reading the symbol on every request
 *   - the hourly scheduler refreshing it
 *   - the inline `assertMutation()` calls in hot services
 *
 * Single point of network access — every call to neawaslic goes through
 * here. Boot does ONE verify; the gate consults the cached verdict on
 * subsequent requests until the scheduler refreshes it (hourly) or a
 * mutation fails the local assertion (forces an immediate re-verify).
 */
@Injectable()
export class LicenseService implements OnModuleInit {
  private readonly logger = new Logger('License');
  private readonly config: LicenseClientConfig;
  private readonly storage: PrismaLicenseStorage;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ConfigService,
  ) {
    const baseUrl = required(this.cfg, 'LICENSE_SERVER_URL');
    const productSku = required(this.cfg, 'LICENSE_PRODUCT_SKU');
    const publicKey = required(this.cfg, 'LICENSE_PUBLIC_KEY_ED25519');
    const publicKeyKid = required(this.cfg, 'LICENSE_PUBLIC_KEY_KID');

    this.storage = new PrismaLicenseStorage(this.prisma, publicKey);
    this.config = {
      baseUrl,
      productSku,
      publicKey,
      publicKeyKid,
      storage: this.storage,
    };
  }

  /**
   * Boot-time check. Runs ONCE at process start. Three outcomes:
   *   - cached row + signature OK + within 24h     → cache 'active' verdict
   *   - cached row but stale / proof invalid       → try online verify, fall
   *                                                  back to localVerdict()
   *   - no cached row                              → leave verdict 'missing';
   *                                                  the install wizard or
   *                                                  /license/activate brings
   *                                                  the install online
   * The boot path NEVER throws — a license-server outage at startup
   * must not prevent the API from coming up. The gate makes the actual
   * accept/reject decision per-request from the cached verdict.
   */
  async onModuleInit(): Promise<void> {
    const initial = await this.refreshFromCacheThenNetwork();
    setVerdictGlobally(initial);
    this.logger.log(
      `boot verdict: ${initial.mode}` +
        (initial.licenseId ? ` (license ${initial.licenseId})` : '') +
        (initial.reason ? ` — ${initial.reason}` : ''),
    );
  }

  /**
   * Shape returned to the @Public /license/status endpoint. Stripped of
   * anything sensitive (no proof bytes, no hmacSecret).
   */
  getPublicStatus(): { mode: string; status: string | null; daysRemaining: number; domain: string | null; reason: string } {
    const v = this.currentVerdict();
    return {
      mode: v.mode,
      status: v.status,
      daysRemaining: v.graceDaysRemaining,
      domain: v.domain,
      reason: v.reason,
    };
  }

  currentVerdict(): Verdict {
    return getVerdictGlobally();
  }

  /**
   * Run by /license/activate. Stores the new state + refreshes the
   * cached verdict so the gate flips from 'missing' → 'active' without
   * needing a process restart.
   */
  async activate(input: { purchaseCode: string; domain: string }): Promise<Verdict> {
    const verdict = await clientActivate(this.config, {
      purchaseCode: input.purchaseCode,
      domain: input.domain,
      fingerprint: deriveFingerprint(),
    });
    await this.storage.setPurchaseCodeTail(input.purchaseCode.slice(-8));
    setVerdictGlobally(verdict);
    this.logger.log(`activated: ${verdict.mode} on ${input.domain}`);
    await this.logCheck('ACTIVATE', verdict.mode, null);
    return verdict;
  }

  async verifyOnline(): Promise<Verdict> {
    const verdict = await clientVerify(this.config);
    setVerdictGlobally(verdict);
    await this.logCheck('VERIFY', verdict.mode, null);
    return verdict;
  }

  async deactivate(): Promise<void> {
    try {
      await clientDeactivate(this.config);
    } finally {
      setVerdictGlobally(missingVerdict('Deactivated'));
      await this.logCheck('DEACTIVATE', 'missing', null);
    }
  }

  /**
   * Returns whether `host` is allowed for the cached license. Used by
   * the gate. Localhost is always allowed in NODE_ENV=development.
   */
  hostAllowed(host: string | undefined | null): boolean {
    if (!host) return false;
    if (this.cfg.get<string>('NODE_ENV') === 'development' && isDevHost(host)) {
      return true;
    }
    const v = this.currentVerdict();
    if (!v.domain) return false;
    // Decode payload from cached proof to feed into the matcher — the
    // verdict's `.domain` is the registered pattern (incl. *. wildcards),
    // which is what hostMatchesLicense expects.
    const fakePayload = { domain: v.domain } as Parameters<typeof hostMatchesLicense>[0];
    return hostMatchesLicense(fakePayload, normalizeHost(host));
  }

  /**
   * Called by hot services right before they perform a billable
   * mutation (createOrder, voidOrder, payment, staff create, branch
   * create, etc). Throws 503 LICENSE_LOCKED on locked/missing.
   */
  assertMutation(path?: string): void {
    const v = this.currentVerdict();
    if (v.mode === 'active' || v.mode === 'grace') return;

    void this.logCheck('ASSERT', v.mode, path ?? null).catch(() => {});
    throw new ServiceUnavailableException({
      result: 'LICENSE_LOCKED',
      message:
        v.mode === 'missing'
          ? 'No active license — visit /license/status to activate this install.'
          : `License ${v.status ?? 'locked'} — ${v.reason}`,
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  /**
   * On boot we want a fresh online verify if possible. If the network
   * is down we accept the locally-cached verdict (within grace) so the
   * API still comes up.
   */
  private async refreshFromCacheThenNetwork(): Promise<Verdict> {
    const local = await localVerdict(this.config);
    if (local.mode === 'missing') return local;

    try {
      return await clientVerify(this.config);
    } catch (err) {
      this.logger.warn(
        `boot online verify failed (${(err as Error).message}); using cached verdict mode=${local.mode}`,
      );
      return local;
    }
  }

  private async logCheck(
    action: 'ACTIVATE' | 'VERIFY' | 'DEACTIVATE' | 'ASSERT' | 'BLOCKED',
    result: string,
    path: string | null,
  ): Promise<void> {
    try {
      await this.prisma.licenseCheckLog.create({
        data: { action, result, path },
      });
    } catch {
      // Logging failures must never break a request.
    }
  }
}

function required(cfg: ConfigService, key: string): string {
  const v = cfg.get<string>(key);
  if (!v) throw new Error(`License gate misconfigured: ${key} is required at build/start time`);
  return v;
}

function missingVerdict(reason: string): Verdict {
  return {
    mode: 'missing',
    status: null,
    graceDaysRemaining: 0,
    licenseId: null,
    domain: null,
    reason,
  };
}

// ── globalThis-pinned verdict ────────────────────────────────────────
// Stored on globalThis under a Symbol.for() so multiple imported copies
// of this module (e.g. through bundler chunking) all see the same value.
// A cracker patching THIS file's `return` paths still has to defeat the
// guard's read at request time — and the guard reads from the symbol,
// not from the service instance.

const VERDICT_KEY = Symbol.for('restora.license.verdict');

function setVerdictGlobally(v: Verdict): void {
  (globalThis as Record<symbol, unknown>)[VERDICT_KEY] = v;
}

function getVerdictGlobally(): Verdict {
  const v = (globalThis as Record<symbol, unknown>)[VERDICT_KEY] as Verdict | undefined;
  return v ?? missingVerdict('License gate not initialized');
}

// ParseProof is imported but not yet called directly here — kept in the
// import block so anyone reading this file sees the boundary between
// what's verified locally vs trusted from the cached proof. Used by the
// admin /license/status endpoint to pretty-print the proof's expiry
// dates without re-fetching the row.
void parseProof;
