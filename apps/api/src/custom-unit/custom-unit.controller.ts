import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { CustomUnitService } from './custom-unit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('custom-units')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomUnitController {
  constructor(private readonly svc: CustomUnitService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN')
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.list(user.branchId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@CurrentUser() user: JwtPayload, @Body() dto: { code: string; label: string }) {
    return this.svc.create(user.branchId, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.remove(id, user.branchId);
  }
}
