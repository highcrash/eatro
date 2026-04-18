import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Single-admin login for the license-admin UI.
 *
 * Seed behaviour: on first boot, if the admin_users table is empty, we
 * insert one row from ADMIN_EMAIL + ADMIN_PASSWORD_HASH. After that
 * seed, env password changes are ignored (admin owns their password
 * via the UI). This matches the bootstrap pattern for a one-person
 * control panel — clean first-boot, nothing manual.
 *
 * JWT payload: { sub: adminUser.id, email, role }. Secret from
 * LICENSE_ADMIN_JWT_SECRET, expiry from LICENSE_ADMIN_JWT_EXPIRES_IN
 * (8h default). No refresh token — admin tokens are short-lived and
 * a re-login is one password prompt.
 */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedFirstAdmin();
  }

  private async seedFirstAdmin(): Promise<void> {
    const count = await this.prisma.adminUser.count();
    if (count > 0) return;

    const email = this.config.get<string>('ADMIN_EMAIL');
    const passwordHash = this.config.get<string>('ADMIN_PASSWORD_HASH');
    if (!email || !passwordHash) {
      this.logger.warn(
        'admin_users table empty + ADMIN_EMAIL/ADMIN_PASSWORD_HASH unset. ' +
        'Seed one admin manually before the UI becomes usable.',
      );
      return;
    }

    await this.prisma.adminUser.create({
      data: { email: email.toLowerCase(), passwordHash, role: 'OWNER' },
    });
    this.logger.log(`Seeded initial admin: ${email}`);
  }

  async login(email: string, password: string): Promise<{ token: string; expiresIn: string }> {
    const user = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    // Timing-uniform response: always hash even on miss, so an attacker
    // can't distinguish "no such user" from "wrong password" by timing.
    const fakeHash = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Gt3/rLKRZh4yE3n6cGh4pO6Y/6aJO';
    const hashToCheck = user?.passwordHash ?? fakeHash;
    const ok = await bcrypt.compare(password, hashToCheck);
    if (!user || !ok) {
      throw new UnauthorizedException({ result: 'BAD_CREDENTIALS', message: 'Email or password incorrect' });
    }

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const expiresIn = this.config.get<string>('LICENSE_ADMIN_JWT_EXPIRES_IN', '8h');
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn },
    );
    return { token, expiresIn };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ result: 'BAD_CREDENTIALS' });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException({ result: 'BAD_CREDENTIALS', message: 'Current password is wrong' });
    if (newPassword.length < 10) {
      throw new UnauthorizedException({ result: 'WEAK_PASSWORD', message: 'New password must be at least 10 characters' });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });
  }
}
