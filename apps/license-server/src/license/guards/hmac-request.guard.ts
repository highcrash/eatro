import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import type { Request } from 'express';

import { LicenseService } from '../license.service';

/**
 * Validates X-Signature + X-Timestamp on the verify/deactivate endpoints.
 *
 * Wire format (mirrors apps/license-server/src/crypto/hmac.ts):
 *   X-Timestamp: <unix seconds>
 *   X-Signature: base64url(HMAC-SHA256(hmacSecret, "<timestamp>.<rawBody>"))
 *
 * Requires:
 *   - main.ts boots Nest with `rawBody: true` so req.rawBody is populated
 *     by @nestjs/platform-express. Without it the HMAC check would have
 *     to re-stringify the parsed body, which is fragile (whitespace,
 *     key order, number formatting all change the hash).
 *   - The DTO has a `licenseId` string. The guard reads body.licenseId
 *     to look up the secret; if it's missing or the License row's
 *     hmacSecret can't be loaded, 401.
 *
 * On success, attaches `req.licenseHmacOk = true` so downstream code can
 * audit-log "this request was authenticated" cleanly.
 */
@Injectable()
export class HmacRequestGuard implements CanActivate {
  constructor(
    @Inject(forwardRef(() => LicenseService))
    private readonly licenses: LicenseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer; licenseHmacOk?: boolean }>();

    const tsHeader = req.header('x-timestamp');
    const sigHeader = req.header('x-signature');
    if (!tsHeader || !sigHeader) {
      throw new UnauthorizedException({ result: 'SIG_MISSING', message: 'X-Timestamp + X-Signature headers required' });
    }
    const timestamp = Number(tsHeader);

    const body = req.body as { licenseId?: unknown } | undefined;
    const licenseId = typeof body?.licenseId === 'string' ? body.licenseId : null;
    if (!licenseId) {
      throw new UnauthorizedException({ result: 'SIG_NO_LICENSE_ID', message: 'Body must include licenseId for HMAC-protected calls' });
    }

    const hmacSecret = await this.licenses.getHmacSecret(licenseId);
    if (!hmacSecret) {
      throw new UnauthorizedException({ result: 'SIG_FAIL', message: 'License not found or has no secret' });
    }

    // The raw body bytes are what the client signed. If the framework
    // already re-stringified, the comparison would silently fail.
    const rawBody = req.rawBody?.toString('utf8') ?? '';

    // Lazy import keeps the guard's import graph small + sidesteps the
    // need to inject the CryptoService just for one call (HMAC is the
    // hot path for every verify request).
    const { verifyRequest } = await import('../../crypto/hmac');
    const ok = verifyRequest(hmacSecret, timestamp, rawBody, sigHeader);
    if (!ok) {
      throw new UnauthorizedException({ result: 'SIG_FAIL', message: 'Request signature invalid or expired' });
    }
    req.licenseHmacOk = true;
    return true;
  }
}
