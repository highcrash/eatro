import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { JwtPayload, CreateCustomRoleDto, UpdateCustomRoleDto } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CustomRoleService } from './custom-role.service';

@Controller('custom-roles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomRoleController {
  constructor(private readonly svc: CustomRoleService) {}

  /**
   * Full list for the RolesPage editor. Also used by StaffPage to populate
   * the "Custom role" dropdown — widened to ADVISOR so ADVISOR can see
   * the dropdown values when editing staff. ADVISOR cannot actually
   * create / edit roles (those are gated below).
   */
  @Get()
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.listForBranch(user.branchId);
  }

  /**
   * Admin RolesPage uses this to build the "which nav items can this base
   * role toggle?" checklist. Static per-server so no auth-sensitive data;
   * OWNER/MANAGER only because that's who edits roles anyway.
   */
  @Get('nav-catalog')
  @Roles('OWNER', 'MANAGER')
  navCatalog() {
    return CustomRoleService.getNavPathBaseRoles();
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCustomRoleDto) {
    return this.svc.create(user.branchId, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCustomRoleDto) {
    return this.svc.update(id, user.branchId, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.remove(id, user.branchId);
  }
}
