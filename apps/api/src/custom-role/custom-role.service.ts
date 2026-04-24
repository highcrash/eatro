/**
 * Admin-configurable custom role presets.
 *
 * Every staff still has a required built-in `UserRole` (the security
 * anchor). A CustomRole is a labelling + navigation-tightening overlay
 * that can HIDE admin pages the base role would otherwise see and / or
 * tighten the POS cashier-ops matrix per role. It never elevates — all
 * @Roles() guards and JWT checks continue to run against the base role.
 *
 * Per-branch scope so a "Head Chef" in Dhaka is independent from the same
 * label in Chittagong; matches how BranchSetting.cashierPermissions is
 * already modelled.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreateCustomRoleDto, UpdateCustomRoleDto, CustomRoleNavOverrides, UserRole } from '@restora/types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Allowlist of nav paths the admin RolesPage can toggle per custom role.
 * Keep it in sync with apps/admin/src/layouts/AdminLayout.tsx NAV_GROUPS.
 * We store the allowlist HERE so the server can validate submitted
 * overrides without importing admin-side constants.
 *
 * Each path maps to the set of base UserRoles currently allowed to reach it
 * via the existing admin nav. A custom role's adminNavOverrides can only
 * toggle paths whose base-role set contains this custom role's baseRole —
 * that's how we enforce "can never reveal what the base role can't see".
 */
const NAV_PATH_BASE_ROLES: Record<string, ReadonlyArray<UserRole>> = {
  '/dashboard': ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER', 'ADVISOR'],
  '/menu': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/tables': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/orders': ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER', 'ADVISOR'],
  '/recipes': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/pre-ready': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/reservations': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/qr-codes': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/inventory': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/suppliers': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/purchasing': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/shopping-list': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/waste': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/reports': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/reports/sales': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/reports/daily': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/reports/voids': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/reports/mushak': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/discounts': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/expenses': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/accounts': ['OWNER', 'MANAGER'],
  '/customers': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/staff': ['OWNER', 'MANAGER'],
  '/attendance': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/payroll': ['OWNER', 'MANAGER'],
  '/leave': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/cooking-stations': ['OWNER', 'MANAGER'],
  '/branches': ['OWNER', 'MANAGER'],
  '/cashier-permissions': ['OWNER', 'MANAGER'],
  '/website': ['OWNER', 'MANAGER'],
  '/settings': ['OWNER', 'MANAGER'],
  '/sms': ['OWNER', 'MANAGER', 'ADVISOR'],
  '/roles': ['OWNER', 'MANAGER'],
  '/devices': ['OWNER', 'MANAGER'],
  '/data-cleanup': ['OWNER'],
  '/backups': ['OWNER'],
};

@Injectable()
export class CustomRoleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List for admin RolesPage. Includes deleted=false only.
   */
  async listForBranch(branchId: string) {
    return this.prisma.customRole.findMany({
      where: { branchId, deletedAt: null },
      orderBy: [{ baseRole: 'asc' }, { name: 'asc' }],
    });
  }

  /** Public picker — used by StaffPage dropdown. Active only. */
  async listActiveForBranch(branchId: string) {
    return this.prisma.customRole.findMany({
      where: { branchId, deletedAt: null, isActive: true },
      select: { id: true, name: true, baseRole: true, description: true },
      orderBy: [{ baseRole: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string, branchId: string) {
    const role = await this.prisma.customRole.findFirst({
      where: { id, branchId, deletedAt: null },
    });
    if (!role) throw new NotFoundException(`Custom role ${id} not found`);
    return role;
  }

  async create(branchId: string, dto: CreateCustomRoleDto) {
    this.validate(dto.baseRole, dto.adminNavOverrides);
    return this.prisma.customRole.create({
      data: {
        branchId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        baseRole: dto.baseRole,
        adminNavOverrides: (dto.adminNavOverrides ?? null) as unknown as Prisma.InputJsonValue,
        posPermissions: (dto.posPermissions ?? null) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: string, branchId: string, dto: UpdateCustomRoleDto) {
    const existing = await this.findOne(id, branchId);
    const effectiveBase = dto.baseRole ?? existing.baseRole;
    if (dto.adminNavOverrides !== undefined) {
      this.validate(effectiveBase, dto.adminNavOverrides);
    }
    return this.prisma.customRole.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.baseRole !== undefined ? { baseRole: dto.baseRole } : {}),
        ...(dto.adminNavOverrides !== undefined ? { adminNavOverrides: (dto.adminNavOverrides ?? null) as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.posPermissions !== undefined ? { posPermissions: (dto.posPermissions ?? null) as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /**
   * Soft-delete. The staff.customRoleId FK is ON DELETE SET NULL so
   * assigned staff continue to function on their base role after the
   * role is deleted — no cascading auth breakage.
   */
  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.customRole.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Reject overrides that reference unknown nav paths or try to toggle a
   * path the base role doesn't already have access to. This is the
   * server-side half of the "can only tighten, never elevate" invariant.
   */
  private validate(baseRole: UserRole, overrides: CustomRoleNavOverrides | null | undefined) {
    if (!overrides) return;
    for (const path of Object.keys(overrides)) {
      const allowedForPath = NAV_PATH_BASE_ROLES[path];
      if (!allowedForPath) {
        throw new BadRequestException(`Unknown nav path in overrides: ${path}`);
      }
      if (!allowedForPath.includes(baseRole)) {
        throw new BadRequestException(
          `Base role ${baseRole} cannot access ${path} — custom role cannot grant access the base role doesn't have.`,
        );
      }
    }
  }

  /**
   * Expose the allowlist to the admin RolesPage so it can render only the
   * nav items the selected base role could possibly toggle. Keeps the
   * allowlist single-sourced here and mirrors AdminLayout's NAV_GROUPS.
   */
  static getNavPathBaseRoles() {
    return NAV_PATH_BASE_ROLES;
  }
}
