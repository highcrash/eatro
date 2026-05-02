import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { CashierPermissions, JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsService } from './permissions.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

/**
 * Phase 6 — Cashier permissions admin endpoints.
 *
 * Read is allowed for OWNER/MANAGER/CASHIER (POS reads it on boot to know
 * which buttons to render). Write is OWNER only.
 */
@Controller('cashier-permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PermissionsController {
  constructor(
    private readonly service: PermissionsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  get(@CurrentUser() user: JwtPayload) {
    // Merge branch default with the caller's custom-role overrides so the
    // POS UI sees the effective matrix. OWNER/MANAGER always bypass the
    // matrix on the write path but still see the raw branch default here
    // (custom-role overrides apply only to CASHIER/ADVISOR/WAITER).
    return this.service.getPermissionsForStaff(user.branchId, user.customRoleId ?? null);
  }

  @Patch()
  @Roles('OWNER')
  async update(@CurrentUser() user: JwtPayload, @Body() perms: CashierPermissions) {
    const before = await this.service.getPermissionsForStaff(user.branchId, null).catch(() => null);
    const updated = await this.service.updatePermissions(user.branchId, perms);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'PERMISSIONS', action: 'UPDATE',
      entityType: 'cashierPermissions', entityId: user.branchId, entityName: 'Cashier Permissions matrix',
      before: before as any, after: updated as any,
      summary: 'Updated cashier permissions matrix',
    });
    return updated;
  }
}
