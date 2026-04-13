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
    const slug = this.slugify(dto.name);
    return this.prisma.menuItem.create({
      data: { ...dto, branchId, slug },
      include: comboAndLinkedInclude,
    });
  }

  async update(id: string, branchId: string, dto: UpdateMenuItemDto) {
    await this.findOne(id, branchId);
    const data: any = { ...dto };
    // Auto-update slug if name changes and no custom slug
    if (dto.name && !data.slug) data.slug = this.slugify(dto.name);
    return this.prisma.menuItem.update({
      where: { id },
      data,
      include: comboAndLinkedInclude,
    });
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.menuItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Bulk Import ────────────────────────────────────────────────────────────

  async bulkCreate(
    branchId: string,
    rows: { categoryName: string; name: string; type: string; price: number; description?: string; tags?: string }[],
  ) {
    // 1. Collect unique category names and resolve/create them
    const catNames = [...new Set(rows.map((r) => r.categoryName.trim()).filter(Boolean))];
    const existingCats = await this.prisma.menuCategory.findMany({
      where: { branchId, deletedAt: null },
    });
    const catMap = new Map<string, string>();
    for (const c of existingCats) catMap.set(c.name.toLowerCase(), c.id);

    for (const name of catNames) {
      if (!catMap.has(name.toLowerCase())) {
        const created = await this.prisma.menuCategory.create({
          data: { branchId, name, sortOrder: catMap.size },
        });
        catMap.set(name.toLowerCase(), created.id);
      }
    }

    // 2. Create menu items
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const categoryId = catMap.get(row.categoryName.trim().toLowerCase());
      if (!categoryId) {
        errors.push(`Row ${i + 1}: category "${row.categoryName}" not found`);
        skipped++;
        continue;
      }
      const itemType = row.type?.toUpperCase() === 'BEVERAGE' ? 'BEVERAGE' : 'FOOD';
      const price = Math.round(Number(row.price) * 100); // convert to paisa
      if (isNaN(price) || price < 0) {
        errors.push(`Row ${i + 1}: invalid price "${row.price}"`);
        skipped++;
        continue;
      }
      try {
        await this.prisma.menuItem.create({
          data: {
            branchId,
            categoryId,
            name: row.name.trim(),
            type: itemType as any,
            price,
            description: row.description?.trim() || null,
            tags: row.tags?.trim() || null,
          },
        });
        created++;
      } catch (e: any) {
        errors.push(`Row ${i + 1} ("${row.name}"): ${e.message?.slice(0, 80)}`);
        skipped++;
      }
    }

    return { created, skipped, errors };
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
