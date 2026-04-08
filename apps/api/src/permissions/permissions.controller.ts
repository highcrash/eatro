import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { CashierPermissions, JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsService } from './permissions.service';

/**
 * Phase 6 — Cashier permissions admin endpoints.
 *
 * Read is allowed for OWNER/MANAGER/CASHIER (POS reads it on boot to know
 * which buttons to render). Write is OWNER only.
 */
@Controller('cashier-permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PermissionsController {
  constructor(private readonly service: PermissionsService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  get(@CurrentUser() user: JwtPayload) {
    return this.service.getPermissions(user.branchId);
  }

  @Patch()
  @Roles('OWNER')
  update(@CurrentUser() user: JwtPayload, @Body() perms: CashierPermissions) {
    return this.service.updatePermissions(user.branchId, perms);
  }
}
