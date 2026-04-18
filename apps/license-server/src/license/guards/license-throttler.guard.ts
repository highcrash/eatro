import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

import { extractClientIp } from '../client-ip';

/**
 * Activate throttle: 5 / minute / IP.
 *
 * Activate is the brute-force vector — every attempt with a wrong code
 * costs an attacker one bucket entry. 5/min from a single IP is enough
 * for a real reinstall flurry (a buyer rebuilding their VPS) but cuts
 * a brute-forcer down to ~7000 tries/day per IP. Combined with the
 * AbuseTracker's 10-fail block, this caps an unbounded attacker at
 * minutes per IP rotation.
 */
@Injectable()
export class ActivateThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Request): Promise<string> {
    return Promise.resolve(`activate:${extractClientIp(req)}`);
  }
}

/**
 * Verify throttle: 60 / minute / licenseId.
 *
 * Legitimate clients verify on boot + once an hour (per the cron
 * schedule baked into @restora/license-client). 60/min/license is
 * absurdly generous — captures buggy clients in retry loops without
 * affecting normal use. Per-license keying so one noisy install
 * doesn't starve another in the same building.
 */
@Injectable()
export class VerifyThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Request): Promise<string> {
    const licenseId = (req.body as { licenseId?: string } | undefined)?.licenseId;
    if (typeof licenseId === 'string' && licenseId.length > 0) {
      return Promise.resolve(`verify:${licenseId}`);
    }
    // Fall back to IP for malformed requests so a missing licenseId
    // can't be used to bypass the limiter.
    return Promise.resolve(`verify:${extractClientIp(req)}`);
  }
}
