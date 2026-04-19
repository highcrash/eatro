import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as bypassing the LicenseGuard. Used for endpoints that
 * MUST be reachable even when the license is locked or missing:
 *
 *   - /license/*           — the gate's own activate / status / deactivate
 *   - /install/*           — the install wizard runs on a fresh DB before
 *                            any license exists
 *   - /public/*            — restaurant marketing pages (Facebook OG etc)
 *   - /health, /metrics    — load balancer + monitoring probes
 *
 * Mutation routes that are @Public() still go through THE REST of the
 * security stack — the @Public marker only short-circuits the license
 * check, not auth, throttling, or input validation.
 */
export const PUBLIC_ROUTE_KEY = 'license:public-route';
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE_KEY, true);
