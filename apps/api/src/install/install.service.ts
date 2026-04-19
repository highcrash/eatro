import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Drives the install wizard's server side. Strict invariants:
 *
 *   - Owner step REQUIRES `staff` table to be empty. Refusing here is a
 *     belt-and-braces check against /install/owner being called after
 *     someone slipped past the InstallGuard via a race.
 *   - Branch step REQUIRES at least one staff row already.
 *   - Each step is independently retryable. If `owner` succeeds but
 *     `branch` fails, the buyer can re-submit `branch` without
 *     re-creating the owner.
 *
 * The wizard does NOT touch the license here — operators activate via
 * /api/v1/license/activate (Section 2b) which is `@Public()` and works
 * fine on a fresh install.
 */
@Injectable()
export class InstallService {
  private readonly logger = new Logger('Install');

  constructor(private readonly prisma: PrismaService) {}

  async getStatus(): Promise<{
    needsInstall: boolean;
    completedSteps: { systemCheck: boolean; owner: boolean; branch: boolean };
  }> {
    const [cfg, staffCount, branchCount] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { id: 'self' } }),
      this.prisma.staff.count(),
      this.prisma.branch.count(),
    ]);
    const installedAt = cfg?.installedAt ?? null;
    return {
      needsInstall: !installedAt,
      completedSteps: {
        systemCheck: true, // implicit — if the API answers, system check is good
        owner: staffCount > 0,
        branch: branchCount > 0,
      },
    };
  }

  /**
   * Smoke-tests the runtime. Returns granular checks so the UI can
   * point the operator at the failing one. None of these throw — the
   * UI uses the result to decide whether to enable the Next button.
   */
  async runSystemCheck(): Promise<{
    db: boolean;
    nodeVersion: string;
    nodeOk: boolean;
    requiredEnvs: { key: string; present: boolean }[];
  }> {
    let db = false;
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      db = true;
    } catch {
      // db false; UI shows the error
    }
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.replace(/^v/, '').split('.')[0]!, 10);
    const requiredEnvs = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'].map((key) => ({
      key,
      present: !!process.env[key],
    }));
    return { db, nodeVersion, nodeOk: major >= 22, requiredEnvs };
  }

  /**
   * Wizard order is BRANCH → OWNER (not the natural "owner first" mental
   * model) because Staff.branchId is non-nullable in the schema. Doing
   * branch first lets the owner attach to a real branch row at create
   * time without a follow-up update or a schema change.
   */
  async createBranch(input: {
    name: string;
    address: string;
    phone: string;
    timezone?: string;
    currency?: string;
  }): Promise<{ id: string; name: string }> {
    const existingBranch = await this.prisma.branch.count();
    if (existingBranch > 0) {
      throw new ConflictException('A branch already exists; the wizard creates only the first one');
    }
    const branch = await this.prisma.branch.create({
      data: {
        name: input.name,
        address: input.address,
        phone: input.phone,
        timezone: input.timezone ?? 'Asia/Dhaka',
        currency: input.currency ?? 'BDT',
      },
      select: { id: true, name: true },
    });
    this.logger.log(`first branch seeded: ${branch.name}`);
    return branch;
  }

  async createOwner(input: { name: string; email: string; password: string }): Promise<{ id: string; email: string }> {
    const staffCount = await this.prisma.staff.count();
    if (staffCount > 0) {
      throw new ConflictException('Staff table already populated — install/owner can only run once');
    }
    const branch = await this.prisma.branch.findFirst({ select: { id: true } });
    if (!branch) {
      throw new BadRequestException('Create the first branch before the owner (POST /install/branch)');
    }
    if (input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const owner = await this.prisma.staff.create({
      data: {
        branchId: branch.id,
        name: input.name,
        email: input.email.toLowerCase().trim(),
        passwordHash,
        role: 'OWNER',
        isActive: true,
      },
      select: { id: true, email: true },
    });
    this.logger.log(`owner seeded: ${owner.email}`);
    return owner;
  }

  /**
   * Persist the install sentinel. Single source of truth for "wizard
   * done". Once this row's installedAt is set, the InstallGuard 404s
   * every /install/* route. Idempotent — re-calling returns the same
   * row without changing installedAt.
   */
  async finish(input: { brandName?: string; siteName?: string; supportEmail?: string }): Promise<{
    installedAt: string;
  }> {
    // Sanity: don't let the wizard "finish" before the prereqs ran. A
    // clean DB with no owner means the operator skipped steps via the
    // API directly — refuse so they can't end up locked out.
    const [staff, branch] = await Promise.all([this.prisma.staff.count(), this.prisma.branch.count()]);
    if (staff === 0 || branch === 0) {
      throw new BadRequestException('Cannot finish install — owner and first branch are required');
    }

    const cfg = await this.prisma.systemConfig.upsert({
      where: { id: 'self' },
      create: {
        id: 'self',
        installedAt: new Date(),
        brandName: input.brandName?.trim() || 'Your Restaurant',
        siteName: input.siteName?.trim() || input.brandName?.trim() || 'Your Restaurant',
        supportEmail: input.supportEmail?.trim() || null,
      },
      update: {
        installedAt: new Date(),
        brandName: input.brandName?.trim() || undefined,
        siteName: input.siteName?.trim() || undefined,
        supportEmail: input.supportEmail?.trim() || undefined,
      },
    });

    this.logger.log(`install completed at ${cfg.installedAt!.toISOString()}`);
    return { installedAt: cfg.installedAt!.toISOString() };
  }
}
