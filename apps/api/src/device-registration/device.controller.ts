import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { DeviceService } from './device.service';

/**
 * Public terminal-registration endpoint. Invoked by apps/pos-desktop on
 * first run — the owner enters their credentials in the desktop app and it
 * calls this with them. No pre-existing session needed (the owner password
 * is the authentication here). The returned deviceToken is stored on disk
 * and used to mint cashier sessions going forward.
 */
@Controller('devices')
export class DevicePublicController {
  constructor(private readonly svc: DeviceService) {}

  @Post('register')
  register(@Body() dto: { email: string; password: string; branchId: string; deviceName: string }) {
    if (!dto?.email || !dto?.password || !dto?.branchId || !dto?.deviceName) {
      throw new BadRequestException('email, password, branchId, deviceName are required');
    }
    return this.svc.register(dto.email, dto.password, dto.branchId, dto.deviceName);
  }

  @Post('cashiers')
  async listCashiers(@Body() dto: { deviceToken: string }) {
    if (!dto?.deviceToken) throw new BadRequestException('deviceToken required');
    return this.svc.listCashiersForToken(dto.deviceToken);
  }
}

/**
 * Authenticated admin endpoints — list, revoke, rename devices on your branch.
 */
@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeviceAdminController {
  constructor(private readonly svc: DeviceService) {}

  @Get()
  @Roles('OWNER', 'MANAGER')
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.listForBranch(user.branchId);
  }

  @Delete(':id')
  @Roles('OWNER')
  revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.revoke(id, user.branchId);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  rename(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: { name: string }) {
    return this.svc.rename(id, user.branchId, dto.name);
  }
}
