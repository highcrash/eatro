import { Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  parseCashierPermissions,
  DEFAULT_CASHIER_PERMISSIONS,
  type CashierPermissions,
  type CashierAction,
  type ApprovalMode,
} from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  /** Read effective permissions for a branch (auto-creates BranchSetting). */
  async getPermissions(branchId: string): Promise<CashierPermissions> {
    let settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings) settings = await this.prisma.branchSetting.create({ data: { branchId } });
    // cashierPermissions is a new column; cast through unknown to bypass possibly-stale Prisma types.
    const raw = (settings as unknown as { cashierPermissions: string | null }).cashierPermissions;
    return parseCashierPermissions(raw);
  }

  /**
   * Read the effective matrix for a specific staff member — branch default
   * merged with the staff's custom-role overrides (if any). The UI uses
   * this so cashiers see the buttons their role actually allows. The
   * server still re-runs requirePermission() on each mutation as the
   * authoritative check; this getter is purely the display-layer merge.
   */
  async getPermissionsForStaff(branchId: string, customRoleId: string | null | undefined): Promise<CashierPermissions> {
    const base = await this.getPermissions(branchId);
    if (!customRoleId) return base;
    const customRole = await this.prisma.customRole.findFirst({
      where: { id: customRoleId, branchId, deletedAt: null, isActive: true },
      select: { posPermissions: true },
    });
    const overrides = (customRole?.posPermissions ?? null) as Partial<CashierPermissions> | null;
    if (!overrides) return base;
    // Shallow merge per-action. Each ActionPermission is replaced wholesale
    // when overridden — granular merge isn't needed for v1 and avoids
    // surprising behaviour where only some fields (enabled vs approval)
    // come from different sources.
    return { ...base, ...overrides } as CashierPermissions;
  }

  async updatePermissions(branchId: string, perms: CashierPermissions): Promise<CashierPermissions> {
    let settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings) settings = await this.prisma.branchSetting.create({ data: { branchId } });
    // Merge with defaults so a partial update doesn't drop fields.
    const merged: CashierPermissions = { ...DEFAULT_CASHIER_PERMISSIONS, ...perms };
    await this.prisma.branchSetting.update({
      where: { branchId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { cashierPermissions: JSON.stringify(merged) } as any,
    });
    return merged;
  }

  /**
   * Enforce a cashier permission gate.
   * - Owners and Managers always pass (admin-equivalent).
   * - CASHIER, ADVISOR, and WAITER all run through the configurable
   *   cashier-permission matrix on the POS side. Advisors + waiters
   *   get the same approval flow cashiers have for these operational
   *   actions (create PO, receive goods, return, pay supplier, log
   *   expense, etc.) — the owner configures one policy and it
   *   applies to anyone who isn't OWNER/MANAGER. Advisor's broader
   *   admin powers are orthogonal and come from @Roles() decorators
   *   on the admin-side endpoints.
   * - For gated roles the action's approval mode determines the flow:
   *   - NONE  → throw 403 (button is hidden in POS but defend the API)
   *   - AUTO  → pass with no challenge
   *   - OTP   → require a verified action OTP (passed in dto.actionOtp), else throw 401
   */
  async requirePermission(
    branchId: string,
    role: string,
    action: CashierAction,
    actionOtp?: string,
    customRoleId?: string | null,
  ): Promise<void> {
    if (role === 'OWNER' || role === 'MANAGER') return;
    if (role !== 'CASHIER' && role !== 'ADVISOR' && role !== 'WAITER') {
      throw new ForbiddenException('Role not allowed');
    }

    // Custom role may tighten the per-branch matrix for this staff member.
    // If no customRoleId is passed, behaviour is identical to before.
    const perms = await this.getPermissionsForStaff(branchId, customRoleId);
    const cfg = perms[action];
    if (!cfg.enabled) throw new ForbiddenException(`Action "${action}" is disabled for cashier`);

    const mode: ApprovalMode = cfg.approval;
    if (mode === 'NONE') throw new ForbiddenException('This action requires a manager');
    if (mode === 'AUTO') return;

    // OTP required
    if (!actionOtp) throw new UnauthorizedException('Manager OTP required');
    const result = this.sms.verifyActionOtp(branchId, action, actionOtp);
    if (!result.valid) throw new UnauthorizedException(result.error ?? 'Invalid OTP');
  }

  /**
   * Resolve the effective approval mode for an expense category, falling back
   * to the action-level mode when there's no category override.
   */
  async resolveExpenseApproval(branchId: string, category: string): Promise<{ enabled: boolean; mode: ApprovalMode }> {
    const perms = await this.getPermissions(branchId);
    const cfg = perms.createExpense;
    if (!cfg.enabled) return { enabled: false, mode: 'NONE' };
    if (cfg.allowedCategories.length > 0 && !cfg.allowedCategories.includes(category)) {
      return { enabled: false, mode: 'NONE' };
    }
    const mode = cfg.categoryApproval[category] ?? cfg.approval;
    return { enabled: true, mode };
  }
}
