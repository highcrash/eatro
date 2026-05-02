import { Controller, Get, Post, Patch, Put, Delete, Param, Body, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import type { CreateMenuItemDto, UpdateMenuItemDto, UpsertAddonGroupDto, JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MenuService } from './menu.service';

@ApiTags('Menu')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('includeCustom') includeCustom?: string,
    @Query('includeAddons') includeAddons?: string,
  ) {
    return this.menuService.findAll(user.branchId, includeCustom === 'true', includeAddons === 'true');
  }

  /**
   * Audit feed of POS-created custom items + their full recipes,
   * order count, revenue, and last-sold date. Surfaced on the admin
   * Custom Menu page so owners can review what cashiers built
   * ad-hoc and promote re-usable ones to the regular menu.
   */
  @Get('custom-items')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  findCustomItems(@CurrentUser() user: JwtPayload) {
    return this.menuService.findCustomItems(user.branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.findOne(id, user.branchId);
  }

  /**
   * Convert a one-off POS custom item into a regular menu item the
   * cashier can re-order from the standard picker. Recipe + price are
   * preserved; admin can optionally rename, change category, override
   * price, or toggle website visibility (defaults to visible so the
   * promoted dish actually shows up on the website).
   */
  @Post(':id/promote')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  promoteCustomItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { categoryId?: string; name?: string; websiteVisible?: boolean; price?: number },
  ) {
    return this.menuService.promoteCustomItem(id, user.branchId, dto ?? {});
  }

  @Post()
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  create(@Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false })) dto: CreateMenuItemDto, @CurrentUser() user: JwtPayload) {
    return this.menuService.create(user.branchId, dto as any);
  }

  @Post('bulk')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  bulkCreate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { rows: { categoryName: string; name: string; price: number; description?: string; tags?: string; kitchenSection?: string }[] },
  ) {
    return this.menuService.bulkCreate(user.branchId, dto.rows);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  update(@Param('id') id: string, @Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false })) dto: UpdateMenuItemDto, @CurrentUser() user: JwtPayload) {
    return this.menuService.update(id, user.branchId, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.remove(id, user.branchId);
  }

  @Put(':id/combo-items')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  setComboItems(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { items: { includedItemId: string; quantity: number }[] },
  ) {
    return this.menuService.setComboItems(id, user.branchId, dto.items);
  }

  @Put(':id/linked-items')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  setLinkedItems(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { items: { linkedMenuId: string; type: string; triggerQuantity: number; freeQuantity: number }[] },
  ) {
    return this.menuService.setLinkedItems(id, user.branchId, dto.items);
  }

  // ─── Addon groups (Phase 3) ───────────────────────────────────────────────

  @Get(':id/addon-groups')
  listAddonGroups(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.listAddonGroups(id, user.branchId);
  }

  @Post(':id/addon-groups')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  createAddonGroup(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertAddonGroupDto) {
    return this.menuService.createAddonGroup(id, user.branchId, dto);
  }

  @Patch('addon-groups/:groupId')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  updateAddonGroup(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertAddonGroupDto) {
    return this.menuService.updateAddonGroup(groupId, user.branchId, dto);
  }

  @Delete('addon-groups/:groupId')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  removeAddonGroup(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.removeAddonGroup(groupId, user.branchId);
  }
}
