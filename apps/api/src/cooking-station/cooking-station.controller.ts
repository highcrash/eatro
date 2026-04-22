import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { CookingStationService } from './cooking-station.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('cooking-stations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CookingStationController {
  constructor(private readonly service: CookingStationService) {}

  // READ — Advisor needs this for menu-item bulk edit (Kitchen Section
  // dropdown). They can't manage stations, but they need to see them.
  @Get()
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.branchId);
  }

  // Mutations stay OWNER/MANAGER — advisors view the list, not edit it.
  @Post()
  @Roles('OWNER', 'MANAGER')
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; printerName?: string | null; printerIp?: string | null; printerPort?: number | null; sortOrder?: number; vatEnabled?: boolean },
  ) {
    return this.service.create(user.branchId, body);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { name?: string; printerName?: string | null; printerIp?: string | null; printerPort?: number | null; sortOrder?: number; isActive?: boolean; vatEnabled?: boolean },
  ) {
    return this.service.update(id, user.branchId, body);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.branchId);
  }
}
