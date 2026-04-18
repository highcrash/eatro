import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminJwtPayload } from './admin-jwt.strategy';

/**
 * Injects the authenticated admin's JWT payload into a controller method:
 *   someEndpoint(@CurrentAdmin() admin: AdminJwtPayload) { ... }
 *
 * passport-jwt stashes the return value of AdminJwtStrategy.validate()
 * at req.user; this decorator just surfaces it with types.
 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminJwtPayload => {
    const req = ctx.switchToHttp().getRequest<{ user: AdminJwtPayload }>();
    return req.user;
  },
);
