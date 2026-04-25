import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { BranchSettingsService } from './branch-settings.service';

@Controller('branch-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BranchSettingsController {
  constructor(private readonly svc: BranchSettingsService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER')
  get(@CurrentUser() user: JwtPayload) {
    return this.svc.getOrCreate(user.branchId);
  }

  @Patch()
  @Roles('OWNER', 'MANAGER')
  update(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      useKds?: boolean;
      customMenuCostMargin?: number | null;
      customMenuNegotiateMargin?: number | null;
      customMenuMaxMargin?: number | null;
    },
  ) {
    return this.svc.update(user.branchId, dto);
  }
}
