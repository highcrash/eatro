import { Controller, Get, Post, Patch, Put, Delete, Param, Body, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import type { CreateMenuItemDto, UpdateMenuItemDto, UpsertAddonGroupDto, JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MenuService } from './menu.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@ApiTags('Menu')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('menu')
export class MenuController {
  constructor(
    private readonly menuService: MenuService,
    private readonly activityLog: ActivityLogService,
  ) {}

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
  async promoteCustomItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { categoryId?: string; name?: string; websiteVisible?: boolean; price?: number },
  ) {
    const before = await this.menuService.findOne(id, user.branchId).catch(() => null);
    const updated = await this.menuService.promoteCustomItem(id, user.branchId, dto ?? {});
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'UPDATE',
      entityType: 'menuItem',
      entityId: updated.id,
      entityName: updated.name,
      before: before as any,
      after: updated as any,
      summary: `Promoted custom item to regular menu`,
    });
    return updated;
  }

  @Post()
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async create(@Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false })) dto: CreateMenuItemDto, @CurrentUser() user: JwtPayload) {
    const created = await this.menuService.create(user.branchId, dto as any);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'CREATE',
      entityType: 'menuItem',
      entityId: created.id,
      entityName: created.name,
      after: created as any,
      summary: `Created menu item "${created.name}"`,
    });
    return created;
  }

  @Post('bulk')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async bulkCreate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { rows: { categoryName: string; name: string; price: number; description?: string; tags?: string; kitchenSection?: string }[] },
  ) {
    const result = await this.menuService.bulkCreate(user.branchId, dto.rows);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'CREATE',
      entityType: 'menuItem',
      entityId: 'bulk',
      entityName: `Bulk import (${dto.rows.length} rows)`,
      after: result as any,
      summary: `CSV bulk import: ${dto.rows.length} row(s)`,
    });
    return result;
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async update(@Param('id') id: string, @Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false })) dto: UpdateMenuItemDto, @CurrentUser() user: JwtPayload) {
    const before = await this.menuService.findOne(id, user.branchId).catch(() => null);
    const updated = await this.menuService.update(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'UPDATE',
      entityType: 'menuItem',
      entityId: updated.id,
      entityName: updated.name,
      before: before as any,
      after: updated as any,
      summary: this.summariseMenuChange(before as any, updated as any),
    });
    return updated;
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const before = await this.menuService.findOne(id, user.branchId).catch(() => null);
    const result = await this.menuService.remove(id, user.branchId);
    if (before) {
      void this.activityLog.log({
        branchId: user.branchId,
        actor: user,
        category: 'MENU',
        action: 'DELETE',
        entityType: 'menuItem',
        entityId: before.id,
        entityName: before.name,
        before: before as any,
        summary: `Deleted menu item "${before.name}"`,
      });
    }
    return result;
  }

  @Put(':id/combo-items')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async setComboItems(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { items: { includedItemId: string; quantity: number }[] },
  ) {
    const updated = await this.menuService.setComboItems(id, user.branchId, dto.items);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'UPDATE',
      entityType: 'menuItem',
      entityId: id,
      entityName: (updated as any)?.name ?? id,
      after: { comboItems: dto.items } as any,
      summary: `Updated combo items (${dto.items.length})`,
    });
    return updated;
  }

  @Put(':id/linked-items')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async setLinkedItems(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { items: { linkedMenuId: string; type: string; triggerQuantity: number; freeQuantity: number }[] },
  ) {
    const updated = await this.menuService.setLinkedItems(id, user.branchId, dto.items);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'UPDATE',
      entityType: 'menuItem',
      entityId: id,
      entityName: (updated as any)?.name ?? id,
      after: { linkedItems: dto.items } as any,
      summary: `Updated linked items (${dto.items.length})`,
    });
    return updated;
  }

  // ─── Addon groups (Phase 3) ───────────────────────────────────────────────

  @Get(':id/addon-groups')
  listAddonGroups(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.listAddonGroups(id, user.branchId);
  }

  @Post(':id/addon-groups')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async createAddonGroup(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertAddonGroupDto) {
    const created = await this.menuService.createAddonGroup(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'CREATE',
      entityType: 'addonGroup',
      entityId: (created as any).id,
      entityName: (created as any).name ?? 'addon group',
      after: created as any,
      summary: `Added addon group "${(created as any).name}"`,
    });
    return created;
  }

  @Patch('addon-groups/:groupId')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async updateAddonGroup(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertAddonGroupDto) {
    const updated = await this.menuService.updateAddonGroup(groupId, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'UPDATE',
      entityType: 'addonGroup',
      entityId: groupId,
      entityName: (updated as any)?.name ?? 'addon group',
      after: updated as any,
      summary: `Updated addon group "${(updated as any)?.name ?? groupId}"`,
    });
    return updated;
  }

  @Delete('addon-groups/:groupId')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async removeAddonGroup(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload) {
    const result = await this.menuService.removeAddonGroup(groupId, user.branchId);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'DELETE',
      entityType: 'addonGroup',
      entityId: groupId,
      entityName: 'addon group',
      summary: `Deleted addon group ${groupId}`,
    });
    return result;
  }

  /**
   * Compose a one-line headline for a menu-item update so the audit
   * feed reads "price ৳10.00 → ৳12.00" instead of just "Updated".
   * Falls back to the field-name list when the change isn't pricing.
   */
  private summariseMenuChange(before: any, after: any): string | undefined {
    if (!before || !after) return undefined;
    const changes: string[] = [];
    if (Number(before.price) !== Number(after.price)) {
      changes.push(`price ${(Number(before.price) / 100).toFixed(2)} → ${(Number(after.price) / 100).toFixed(2)}`);
    }
    if (before.name !== after.name) changes.push(`name "${before.name}" → "${after.name}"`);
    if (before.isAvailable !== after.isAvailable) changes.push(after.isAvailable ? 'made available' : 'made unavailable');
    if (before.websiteVisible !== after.websiteVisible) changes.push(after.websiteVisible ? 'website visible' : 'website hidden');
    if (before.imageUrl !== after.imageUrl) changes.push('image changed');
    if ((before.description ?? '') !== (after.description ?? '')) changes.push('description changed');
    if (changes.length === 0) return undefined;
    return changes.slice(0, 3).join(', ');
  }
}
