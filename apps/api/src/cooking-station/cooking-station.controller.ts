import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { CookingStationService } from './cooking-station.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('cooking-stations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class CookingStationController {
  constructor(private readonly service: CookingStationService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.branchId);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; printerName?: string; printerIp?: string },
  ) {
    return this.service.create(user.branchId, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { name?: string; printerName?: string; printerIp?: string; isActive?: boolean },
  ) {
    return this.service.update(id, user.branchId, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.branchId);
  }
}
