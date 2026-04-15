import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface RegisterResult {
  deviceId: string;
  deviceToken: string; // returned ONCE — never stored in plain text server-side
  deviceName: string;
  branch: { id: string; name: string };
  cashiers: Array<{ id: string; name: string; email: string; role: string }>;
}

@Injectable()
export class DeviceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Register a new Windows terminal against a specific branch. */
  async register(
    email: string,
    password: string,
    branchId: string,
    deviceName: string,
  ): Promise<RegisterResult> {
    // Authenticate the requester. Must be an OWNER or MANAGER of the branch they claim.
    const staff = await this.prisma.staff.findFirst({
      where: { email, deletedAt: null, isActive: true },
    });
    if (!staff) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, staff.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (staff.role !== 'OWNER' && staff.role !== 'MANAGER') {
      throw new UnauthorizedException('Only OWNER or MANAGER can pair a terminal');
    }
    if (staff.branchId !== branchId) {
      throw new UnauthorizedException('Requester does not belong to the requested branch');
    }

    const trimmedName = (deviceName ?? '').trim();
    if (!trimmedName) throw new BadRequestException('deviceName is required');

    // 256-bit token, opaque to the server after this call.
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, 10);

    const device = await this.prisma.device.create({
      data: {
        branchId,
        name: trimmedName,
        tokenHash,
        createdById: staff.id,
        lastSeenAt: new Date(),
      },
    });

    const [branch, cashiers] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } }),
      this.prisma.staff.findMany({
        where: { branchId, deletedAt: null, isActive: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');

    return {
      deviceId: device.id,
      deviceToken: rawToken,
      deviceName: device.name,
      branch,
      cashiers,
    };
  }

  /**
   * Given a raw device token, locate the matching active device row.
   * Returns null when no match or revoked. Updates lastSeenAt when found.
   */
  async verifyToken(rawToken: string): Promise<{ id: string; branchId: string; name: string } | null> {
    if (!rawToken || rawToken.length < 32) return null;
    // We can't bcrypt-compare against every row, so scan active devices.
    // For a POS system this set is small (tens at most).
    const candidates = await this.prisma.device.findMany({
      where: { isActive: true, revokedAt: null },
      select: { id: true, branchId: true, name: true, tokenHash: true },
    });
    for (const d of candidates) {
      if (await bcrypt.compare(rawToken, d.tokenHash)) {
        await this.prisma.device.update({
          where: { id: d.id },
          data: { lastSeenAt: new Date() },
        });
        return { id: d.id, branchId: d.branchId, name: d.name };
      }
    }
    return null;
  }

  /** Admin list — all devices across the branch scope. */
  async listForBranch(branchId: string) {
    return this.prisma.device.findMany({
      where: { branchId },
      orderBy: [{ isActive: 'desc' }, { lastSeenAt: 'desc' }],
      select: {
        id: true,
        name: true,
        isActive: true,
        lastSeenAt: true,
        createdAt: true,
        revokedAt: true,
        createdById: true,
      },
    });
  }

  async revoke(deviceId: string, branchId: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || device.branchId !== branchId) throw new NotFoundException('Device not found');
    return this.prisma.device.update({
      where: { id: deviceId },
      data: { isActive: false, revokedAt: new Date() },
    });
  }

  /** Desktop calls this on each launch to refresh the cashier list for its lock screen. */
  async listCashiersForToken(deviceToken: string): Promise<Array<{ id: string; name: string; email: string; role: string }>> {
    const device = await this.verifyToken(deviceToken);
    if (!device) throw new UnauthorizedException('Terminal is not paired or has been revoked');
    return this.prisma.staff.findMany({
      where: { branchId: device.branchId, deletedAt: null, isActive: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Cheap liveness probe used by the desktop shell every minute. */
  async heartbeat(deviceToken: string): Promise<{ active: true; deviceId: string; branchId: string }> {
    const device = await this.verifyToken(deviceToken);
    if (!device) throw new UnauthorizedException('Terminal is not paired or has been revoked');
    return { active: true, deviceId: device.id, branchId: device.branchId };
  }

  async rename(deviceId: string, branchId: string, name: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || device.branchId !== branchId) throw new NotFoundException('Device not found');
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Name required');
    return this.prisma.device.update({
      where: { id: deviceId },
      data: { name: trimmed },
    });
  }
}
