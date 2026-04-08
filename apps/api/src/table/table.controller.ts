import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import type { JwtPayload, TableStatus } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TableService } from './table.service';

@ApiTags('Tables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tables')
export class TableController {
  constructor(private readonly tableService: TableService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.tableService.findAll(user.branchId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@Body() body: { tableNumber: string; capacity: number; floorPlanX?: number; floorPlanY?: number }, @CurrentUser() user: JwtPayload) {
    return this.tableService.create(user.branchId, body);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: TableStatus }, @CurrentUser() user: JwtPayload) {
    return this.tableService.updateStatus(id, user.branchId, body.status);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tableService.remove(id, user.branchId);
  }
}
