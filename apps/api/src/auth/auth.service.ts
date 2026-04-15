import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';

import type { JwtPayload, LoginResponse } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceService } from '../device-registration/device.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly devices: DeviceService,
  ) {}

  /**
   * Desktop terminal: establish a cashier session using a paired device
   * token + staff identity. The PIN itself is verified locally in the
   * desktop app (bcrypt hash stored on the PC) — the server trusts that if
   * the desktop presents both a valid deviceToken AND the correct staffId
   * for that device's branch, the cashier has proven identity on-device.
   */
  async pinLogin(deviceToken: string, staffId: string): Promise<LoginResponse> {
    const device = await this.devices.verifyToken(deviceToken);
    if (!device) throw new UnauthorizedException('Terminal is not paired or has been revoked');

    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, branchId: device.branchId, deletedAt: null, isActive: true },
      include: { branch: { select: { name: true } } },
    });
    if (!staff) throw new UnauthorizedException('Staff not found on this terminal\'s branch');

    return this.login(staff);
  }

  /**
   * First-time cashier setup on a new terminal: cashier proves identity
   * with password + deviceToken. On success they can then set a local PIN.
   * Same response shape as regular login.
   */
  async passwordLoginOnDevice(
    deviceToken: string,
    email: string,
    password: string,
  ): Promise<LoginResponse> {
    const device = await this.devices.verifyToken(deviceToken);
    if (!device) throw new UnauthorizedException('Terminal is not paired or has been revoked');

    const staff = await this.validateUser(email, password);
    if (!staff) throw new UnauthorizedException('Invalid credentials');
    if (staff.branchId !== device.branchId) {
      throw new UnauthorizedException('This staff member does not belong to this terminal\'s branch');
    }
    return this.login(staff);
  }

  async validateUser(email: string, password: string): Promise<{ id: string; email: string; role: string; branchId: string; name: string; branch: { name: string } } | null> {
    const staff = await this.prisma.staff.findFirst({
      where: { email, deletedAt: null, isActive: true },
      include: { branch: { select: { name: true } } },
    });
    if (!staff) return null;

    const valid = await bcrypt.compare(password, staff.passwordHash);
    if (!valid) return null;

    return staff;
  }

  async login(staff: { id: string; email: string; role: string; branchId: string; name: string; branch: { name: string } }): Promise<LoginResponse> {
    const payload: JwtPayload = {
      sub: staff.id,
      email: staff.email,
      role: staff.role as JwtPayload['role'],
      branchId: staff.branchId,
    };

    const accessToken = this.jwt.sign(payload);
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role as JwtPayload['role'],
        branchId: staff.branchId,
        branchName: staff.branch.name,
      },
    };
  }

  async verifyCredentials(email: string, password: string): Promise<{ id: string; name: string; role: string }> {
    const staff = await this.validateUser(email, password);
    if (!staff) throw new UnauthorizedException('Invalid credentials');
    if (staff.role !== 'MANAGER' && staff.role !== 'OWNER') {
      throw new UnauthorizedException('Manager or Owner credentials required');
    }
    return { id: staff.id, name: staff.name, role: staff.role };
  }

  /** Confirm any authenticated user's own password (cashier/waiter included). */
  async verifySelfPassword(email: string, password: string): Promise<{ id: string; name: string; role: string }> {
    const staff = await this.validateUser(email, password);
    if (!staff) throw new UnauthorizedException('Invalid credentials');
    return { id: staff.id, name: staff.name, role: staff.role };
  }

  /** OWNER-only: mint a new JWT scoped to the chosen branch. */
  async switchBranch(staffId: string, currentRole: string, targetBranchId: string): Promise<LoginResponse> {
    if (currentRole !== 'OWNER') {
      throw new UnauthorizedException('Only OWNER can switch branches');
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: targetBranchId, deletedAt: null, isActive: true },
    });
    if (!branch) throw new UnauthorizedException('Branch not found or inactive');

    const staff = await this.prisma.staff.findFirstOrThrow({
      where: { id: staffId, deletedAt: null },
    });

    const payload: JwtPayload = {
      sub: staff.id,
      email: staff.email,
      role: staff.role as JwtPayload['role'],
      branchId: targetBranchId,
    };
    const accessToken = this.jwt.sign(payload);
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role as JwtPayload['role'],
        branchId: targetBranchId,
        branchName: branch.name,
      },
    };
  }

  async refreshToken(token: string): Promise<{ accessToken: string }> {
    try {
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });

      const newPayload: JwtPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        branchId: payload.branchId,
      };

      return { accessToken: this.jwt.sign(newPayload) };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
