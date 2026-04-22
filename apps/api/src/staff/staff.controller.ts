import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import type { CreateStaffDto, UpdateStaffDto, JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StaffService } from './staff.service';

@ApiTags('Staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  // List-only: needed by ADVISOR too (Leave / Attendance staff pickers).
  // No passwords, salary, or audit fields are returned — see
  // staffService.findAll's select clause. Write endpoints below stay
  // OWNER/MANAGER so advisors can't edit staff records themselves.
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.staffService.findAll(user.branchId);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.staffService.findOne(id, user.branchId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@Body() dto: CreateStaffDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.create(user.branchId, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto, @CurrentUser() user: JwtPayload) {
    return this.staffService.update(id, user.branchId, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.staffService.remove(id, user.branchId);
  }
}
