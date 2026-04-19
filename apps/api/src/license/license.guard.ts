import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { LicenseService } from './license.service';
import { PUBLIC_ROUTE_KEY } from './public.decorator';

/**
 * Global guard. Runs before every request. Three checks, in order:
 *
 *   1. `@Public()` route          → bypass everything
 *   2. Host-vs-activated-domain    → 403 DOMAIN_MISMATCH on mismatch
 *   3. Mode-vs-verb               → GETs allowed in any non-revoked mode
 *                                   POSTs require active or grace
 *
 * Special-case modes:
 *   missing  → all GETs/POSTs blocked except @Public() routes (so
 *              /license/activate stays reachable via /license/* @Public)
 *   active   → all allowed
 *   grace    → all allowed; the response carries an `X-License-Grace`
 *              header so the admin UI can show a banner
 *   locked   → GET allowed; POST → 503 LICENSE_LOCKED
 *
 * Returning false from a guard would 403 with no body — we throw
 * structured exceptions so the admin UI can render the right banner
 * and the desktop client can prompt for re-activation.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  private readonly logger = new Logger('LicenseGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly license: LicenseService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();

    // ── Host check ────────────────────────────────────────────────
    if (!this.license.hostAllowed(req.headers.host)) {
      throw new ForbiddenException({
        result: 'DOMAIN_MISMATCH',
        message: `This install isn't licensed for ${req.headers.host}`,
      });
    }

    // ── Verdict check ─────────────────────────────────────────────
    const verdict = this.license.currentVerdict();

    if (verdict.mode === 'active' || verdict.mode === 'grace') {
      // Surface grace days so the UI can warn the operator.
      if (verdict.mode === 'grace') {
        const res = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
        res.setHeader('X-License-Grace', String(verdict.graceDaysRemaining));
      }
      return true;
    }

    // Mode is 'locked' or 'missing'. Allow GETs for read-only access
    // (operator can still consult historical sales etc) but block
    // every mutation.
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    this.logger.warn(`blocked ${method} ${req.url} — verdict=${verdict.mode}`);
    throw new ServiceUnavailableException({
      result: 'LICENSE_LOCKED',
      message:
        verdict.mode === 'missing'
          ? 'No active license — POST /license/activate to bring this install online.'
          : `License ${verdict.status ?? 'locked'} — ${verdict.reason}`,
      mode: verdict.mode,
      domain: verdict.domain,
    });
  }
}
