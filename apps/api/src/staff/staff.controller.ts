import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import type { CreateStaffDto, UpdateStaffDto, JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StaffService } from './staff.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@ApiTags('Staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly activityLog: ActivityLogService,
  ) {}

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
  async create(@Body() dto: CreateStaffDto, @CurrentUser() user: JwtPayload) {
    const created = await this.staffService.create(user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'STAFF', action: 'CREATE',
      entityType: 'staff', entityId: created.id, entityName: created.name,
      after: created as any,
      summary: `Created staff "${created.name}" (${created.role})`,
    });
    return created;
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  async update(@Param('id') id: string, @Body() dto: UpdateStaffDto, @CurrentUser() user: JwtPayload) {
    const before = await this.staffService.findOne(id, user.branchId).catch(() => null);
    const updated = await this.staffService.update(id, user.branchId, dto);
    const summary = (dto as any).password ? `Reset password for "${updated.name}"` : `Updated staff "${updated.name}"`;
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'STAFF', action: 'UPDATE',
      entityType: 'staff', entityId: updated.id, entityName: updated.name,
      before: before as any, after: updated as any,
      summary,
    });
    return updated;
  }

  @Delete(':id')
  @Roles('OWNER')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const before = await this.staffService.findOne(id, user.branchId).catch(() => null);
    const result = await this.staffService.remove(id, user.branchId);
    if (before) {
      void this.activityLog.log({
        branchId: user.branchId, actor: user, category: 'STAFF', action: 'DELETE',
        entityType: 'staff', entityId: before.id, entityName: before.name,
        before: before as any,
        summary: `Removed staff "${before.name}"`,
      });
    }
    return result;
  }
}
