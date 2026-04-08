import { Injectable, NotFoundException } from '@nestjs/common';

import type { CreateMenuItemDto, UpdateMenuItemDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';

const comboAndLinkedInclude = {
  category: true,
  cookingStation: { select: { id: true, name: true } },
  comboItems: { include: { includedItem: { select: { id: true, name: true, price: true } } } },
  linkedItems: { include: { linkedMenu: { select: { id: true, name: true, price: true } } } },
};

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(branchId: string) {
    return this.prisma.menuItem.findMany({
      where: { branchId, deletedAt: null },
      include: comboAndLinkedInclude,
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });
  }

  async findOne(id: string, branchId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, branchId, deletedAt: null },
      include: comboAndLinkedInclude,
    });
    if (!item) throw new NotFoundException(`Menu item ${id} not found`);
    return item;
  }

  create(branchId: string, dto: CreateMenuItemDto) {
    return this.prisma.menuItem.create({
      data: { ...dto, branchId },
      include: comboAndLinkedInclude,
    });
  }

  async update(id: string, branchId: string, dto: UpdateMenuItemDto) {
    await this.findOne(id, branchId);
    return this.prisma.menuItem.update({
      where: { id },
      data: dto,
      include: comboAndLinkedInclude,
    });
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.menuItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Combo Items ───────────────────────────────────────────────────────────

  async setComboItems(
    menuItemId: string,
    branchId: string,
    items: { includedItemId: string; quantity: number }[],
  ) {
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId, deletedAt: null },
    });
    if (!menuItem) throw new NotFoundException();

    // Mark as combo
    await this.prisma.menuItem.update({
      where: { id: menuItemId },
      data: { isCombo: true },
    });

    // Replace all combo items
    await this.prisma.comboItem.deleteMany({ where: { comboMenuId: menuItemId } });
    if (items.length > 0) {
      await this.prisma.comboItem.createMany({
        data: items.map((i) => ({
          comboMenuId: menuItemId,
          includedItemId: i.includedItemId,
          quantity: i.quantity,
        })),
      });
    }

    return this.findOne(menuItemId, branchId);
  }

  // ─── Linked Items (Free / Complementary) ───────────────────────────────────

  async setLinkedItems(
    menuItemId: string,
    branchId: string,
    items: { linkedMenuId: string; type: string; triggerQuantity: number; freeQuantity: number }[],
  ) {
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId, deletedAt: null },
    });
    if (!menuItem) throw new NotFoundException();

    await this.prisma.linkedItem.deleteMany({ where: { parentMenuId: menuItemId } });
    if (items.length > 0) {
      await this.prisma.linkedItem.createMany({
        data: items.map((i) => ({
          parentMenuId: menuItemId,
          linkedMenuId: i.linkedMenuId,
          type: i.type as any,
          triggerQuantity: i.triggerQuantity,
          freeQuantity: i.freeQuantity,
        })),
      });
    }

    return this.findOne(menuItemId, branchId);
  }
}
