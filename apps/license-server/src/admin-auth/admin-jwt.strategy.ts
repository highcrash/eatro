import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * passport-jwt strategy for admin requests. Token comes from the
 * Authorization: Bearer <jwt> header.
 *
 * Payload shape: { sub: adminUserId, email, role, iat, exp }
 * — validate() just returns the payload; AdminJwtGuard delegates the
 * auth decision entirely to the signed expiry + secret check.
 */
export interface AdminJwtPayload {
  sub: string;
  email: string;
  role: 'OWNER' | 'STAFF';
  iat: number;
  exp: number;
}

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('LICENSE_ADMIN_JWT_SECRET');
    if (!secret) {
      throw new Error('LICENSE_ADMIN_JWT_SECRET is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: AdminJwtPayload): AdminJwtPayload {
    // No DB hit here — the JWT is self-contained and the 8h default
    // lifetime limits the blast radius of a stolen token. If a user
    // needs to be "kicked" mid-session, rotate LICENSE_ADMIN_JWT_SECRET
    // and all tokens invalidate at once.
    return payload;
  }
}
