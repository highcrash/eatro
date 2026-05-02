import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { BranchSettingsService } from './branch-settings.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Controller('branch-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BranchSettingsController {
  constructor(
    private readonly svc: BranchSettingsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER')
  get(@CurrentUser() user: JwtPayload) {
    return this.svc.getOrCreate(user.branchId);
  }

  @Patch()
  @Roles('OWNER', 'MANAGER')
  async update(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      useKds?: boolean;
      customMenuCostMargin?: number | null;
      customMenuNegotiateMargin?: number | null;
      customMenuMaxMargin?: number | null;
      qrAllowSelfRemoveIngredients?: boolean;
      tableTimerOrderToStartMin?: number | null;
      tableTimerStartToDoneMin?: number | null;
      tableTimerServedToClearMin?: number | null;
    },
  ) {
    const before = await this.svc.getOrCreate(user.branchId).catch(() => null);
    const updated = await this.svc.update(user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'SETTINGS', action: 'UPDATE',
      entityType: 'branchSettings', entityId: user.branchId, entityName: 'Branch settings',
      before: before as any, after: updated as any,
      summary: `Updated branch settings (${Object.keys(dto).join(', ')})`,
    });
    return updated;
  }
}
