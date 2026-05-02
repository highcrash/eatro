import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';

import type { CreateMenuItemDto, UpdateMenuItemDto, CreateCustomMenuDto, UpsertAddonGroupDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';

const comboAndLinkedInclude = {
  category: true,
  cookingStation: { select: { id: true, name: true } },
  comboItems: { include: { includedItem: { select: { id: true, name: true, price: true } } } },
  linkedItems: { include: { linkedMenu: { select: { id: true, name: true, price: true } } } },
  variants: {
    where: { deletedAt: null },
    select: { id: true, name: true, price: true, isAvailable: true, sortOrder: true, recipe: { select: { id: true } } },
    orderBy: { sortOrder: 'asc' as const },
  },
  addonGroups: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' as const },
    include: {
      options: {
        orderBy: { sortOrder: 'asc' as const },
        include: { addon: { select: { id: true, name: true, price: true, isAvailable: true, recipe: { select: { id: true } } } } },
      },
    },
  },
};

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitConversion: UnitConversionService,
  ) {}

  async findAll(branchId: string, includeCustom = false, includeAddons = false) {
    const items = await this.prisma.menuItem.findMany({
      where: {
        branchId,
        deletedAt: null,
        // Hide POS-created custom items from the standard admin Menu page
        // unless explicitly requested. Reports walk OrderItem rows directly
        // and aren't affected.
        ...(includeCustom ? {} : { isCustom: false }),
        // Addons live in the same table but are managed via the Addons
        // editor on the parent item, so they're hidden from the main
        // grid by default. The /menu endpoint passes includeAddons=true
        // for POS so the picker can resolve addon snapshots when
        // rendering the cart / receipt.
        ...(includeAddons ? {} : { isAddon: false }),
      },
      include: comboAndLinkedInclude,
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });
    return this.stampActiveDiscounts(branchId, items);
  }

  async findOne(id: string, branchId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, branchId, deletedAt: null },
      include: comboAndLinkedInclude,
    });
    if (!item) throw new NotFoundException(`Menu item ${id} not found`);
    const [stamped] = await this.stampActiveDiscounts(branchId, [item]);
    return stamped;
  }

  /**
   * Stamp `discountedPrice / discountType / discountValue` onto each
   * menu item (and each child variant) based on active
   * MenuItemDiscount rows. POS calls /menu and renders price + strike
   * — without this, the cashier saw the regular price even when admin
   * had set a percentage / flat discount on the item. Mirrors the
   * public website's `applyDiscounts` so the POS and the customer site
   * stay in lockstep.
   */
  private async stampActiveDiscounts<T extends { id: string; price: unknown; variants?: Array<{ id: string; price: unknown }> }>(
    branchId: string,
    items: T[],
  ): Promise<Array<T & { discountedPrice: number | null; discountType: string | null; discountValue: number | null }>> {
    if (items.length === 0) return [] as never;
    const now = new Date();
    const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][now.getDay()];
    const discounts = await this.prisma.menuItemDiscount.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
        menuItem: { branchId },
      },
    });
    const active = discounts.filter((d) => {
      if (!d.applicableDays) return true;
      try {
        const days: string[] = JSON.parse(d.applicableDays);
        return days.includes(dayName);
      } catch {
        return true;
      }
    });
    const byMenuItemId = new Map(active.map((d) => [d.menuItemId, d]));
    const apply = (price: number, d: typeof active[number]): number =>
      d.type === 'FLAT'
        ? Math.max(0, price - Number(d.value))
        : Math.round(price * (1 - Number(d.value) / 100));

    return items.map((it) => {
      const d = byMenuItemId.get(it.id);
      const stampedVariants = Array.isArray(it.variants)
        ? it.variants.map((v) => {
            const vd = byMenuItemId.get(v.id);
            if (!vd) return { ...v, discountedPrice: null, discountType: null, discountValue: null };
            const vp = Number(v.price);
            return {
              ...v,
              discountedPrice: apply(vp, vd),
              discountType: vd.type,
              discountValue: Number(vd.value),
            };
          })
        : undefined;
      const out: T & { discountedPrice: number | null; discountType: string | null; discountValue: number | null } = {
        ...it,
        discountedPrice: null,
        discountType: null,
        discountValue: null,
      };
      if (stampedVariants) {
        (out as unknown as { variants: unknown }).variants = stampedVariants;
      }
      if (d) {
        const p = Number(it.price);
        out.discountedPrice = apply(p, d);
        out.discountType = d.type;
        out.discountValue = Number(d.value);
      }
      return out;
    });
  }

  /**
   * Variant + addon invariants enforced on create + update:
   *  - A row cannot be both a parent shell and a child variant.
   *  - A child's parent must exist on the same branch and be a parent
   *    shell (variants are one level deep — no grandparents).
   *  - Promoting an item to a parent shell requires `price=0` (the
   *    shell isn't sold directly; price comes from each variant).
   *    Admin UI hides the price field on parents — server enforces.
   *  - Addons cannot also be variant parents / variant children — they
   *    live as their own concept (selectable via addon groups only).
   */
  private async assertVariantShape(branchId: string, dto: { isVariantParent?: boolean; variantParentId?: string | null; isAddon?: boolean }, currentId?: string) {
    if (dto.isAddon && (dto.isVariantParent || dto.variantParentId)) {
      throw new BadRequestException('An addon cannot also be a variant or a variant parent');
    }
    if (dto.isVariantParent && dto.variantParentId) {
      throw new BadRequestException('A menu item cannot be both a parent shell and a child variant');
    }
    if (dto.variantParentId) {
      const parent = await this.prisma.menuItem.findFirst({
        where: { id: dto.variantParentId, branchId, deletedAt: null },
      });
      if (!parent) {
        throw new BadRequestException('Variant parent not found on this branch');
      }
      if (!parent.isVariantParent) {
        throw new BadRequestException('Target menu item is not a variant parent — toggle "Has Variants" on it first');
      }
      if (parent.id === currentId) {
        throw new BadRequestException('A menu item cannot be its own parent');
      }
    }
  }

  async create(branchId: string, dto: CreateMenuItemDto) {
    await this.assertVariantShape(branchId, dto);
    const slug = this.slugify(dto.name);
    return this.prisma.menuItem.create({
      data: { ...dto, branchId, slug },
      include: comboAndLinkedInclude,
    });
  }

  async update(id: string, branchId: string, dto: UpdateMenuItemDto) {
    const existing = await this.findOne(id, branchId);
    await this.assertVariantShape(branchId, dto, id);

    // If admin is turning OFF parent shell on an item that still has
    // active children, refuse — children would be orphaned. Admin must
    // first move / delete the children explicitly.
    if (dto.isVariantParent === false && existing.isVariantParent) {
      const children = await this.prisma.menuItem.count({
        where: { variantParentId: id, deletedAt: null },
      });
      if (children > 0) {
        throw new BadRequestException(`Cannot disable variants: ${children} child variant(s) still exist. Move or delete them first.`);
      }
    }

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
    // Block deletion of a parent shell that still owns active variants.
    // The children would otherwise have a dangling FK that the migration
    // ON DELETE SET NULL would clear — silently turning them into
    // standalone items in admin. Owner must move / delete children first.
    const childCount = await this.prisma.menuItem.count({
      where: { variantParentId: id, deletedAt: null },
    });
    if (childCount > 0) {
      throw new BadRequestException(`Cannot delete: this menu item has ${childCount} active variant(s). Delete or detach them first.`);
    }
    return this.prisma.menuItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Bulk Import ────────────────────────────────────────────────────────────

  async bulkCreate(
    branchId: string,
    rows: { categoryName: string; name: string; price: number; description?: string; tags?: string; kitchenSection?: string; type?: string }[],
  ) {
    // 1. Resolve / create categories
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

    // 2. Load kitchen sections once — matched by case-insensitive name.
    const stations = await this.prisma.cookingStation.findMany({ where: { branchId, isActive: true } });
    const stationMap = new Map(stations.map((s) => [s.name.toLowerCase(), s.id] as const));

    // 3. Load existing menu items once, keyed by lowercase name, so we can
    //    decide per-row whether to create a new item or update the existing
    //    one. This makes CSV re-uploads safe: export → edit → re-upload
    //    adjusts prices/etc. instead of complaining about duplicates.
    const existingItems = await this.prisma.menuItem.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, name: true },
    });
    const existingByName = new Map(existingItems.map((m) => [m.name.toLowerCase(), m.id] as const));

    // 4. Create / update menu items
    let created = 0;
    let updated = 0;
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
      const price = Math.round(Number(row.price) * 100); // convert to paisa
      if (isNaN(price) || price < 0) {
        errors.push(`Row ${i + 1}: invalid price "${row.price}"`);
        skipped++;
        continue;
      }
      // Kitchen section matched by name. Unknown sections are not an error —
      // they silently fall back to the default kitchen slot on the desktop.
      const sectionKey = row.kitchenSection?.trim().toLowerCase();
      const cookingStationId = sectionKey ? stationMap.get(sectionKey) ?? null : null;
      if (sectionKey && !cookingStationId) {
        errors.push(`Row ${i + 1} ("${row.name}"): kitchen section "${row.kitchenSection}" not found — item saved without one`);
      }

      const nameKey = row.name.trim().toLowerCase();
      const existingId = existingByName.get(nameKey);
      try {
        if (existingId) {
          await this.prisma.menuItem.update({
            where: { id: existingId },
            data: {
              categoryId,
              price,
              description: row.description?.trim() || null,
              tags: row.tags?.trim() || null,
              cookingStationId,
            } as unknown as Parameters<typeof this.prisma.menuItem.update>[0]['data'],
          });
          updated++;
        } else {
          const createdRow = await this.prisma.menuItem.create({
            data: {
              branchId,
              categoryId,
              name: row.name.trim(),
              // MenuItem.type is legacy; admin no longer exposes it and
              // downstream code reads cookingStationId. Default to FOOD so
              // the enum stays happy.
              type: 'FOOD',
              price,
              description: row.description?.trim() || null,
              tags: row.tags?.trim() || null,
              cookingStationId,
            } as unknown as Parameters<typeof this.prisma.menuItem.create>[0]['data'],
          });
          existingByName.set(nameKey, createdRow.id);
          created++;
        }
      } catch (e: any) {
        errors.push(`Row ${i + 1} ("${row.name}"): ${e.message?.slice(0, 80)}`);
        skipped++;
      }
    }

    return { created, updated, skipped, errors };
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

  // ─── POS Customised Menu ──────────────────────────────────────────────────

  /**
   * Recipe-source list for the POS Customised Menu "Copy from recipe"
   * picker. Returns every menu item AND pre-ready item in the branch
   * that has a recipe attached, flattened to a tagged shape the POS
   * can paste from. Quantities are returned in the recipe's own units;
   * for pre-ready items we also include the yieldQuantity so the POS
   * can scale to one produced unit if needed.
   */
  async listRecipeSourcesForBranch(branchId: string): Promise<Array<{
    id: string;
    name: string;
    kind: 'menu' | 'preReady';
    yieldQty: number;
    items: { ingredientId: string; quantity: number; unit: string }[];
  }>> {
    const [menuRecipes, preReadyRecipes] = await Promise.all([
      this.prisma.recipe.findMany({
        where: { menuItem: { branchId, deletedAt: null } },
        include: { menuItem: { select: { id: true, name: true, isCustom: true } }, items: true },
      }),
      this.prisma.preReadyRecipe.findMany({
        where: { preReadyItem: { branchId, deletedAt: null } },
        include: { preReadyItem: { select: { id: true, name: true } }, items: true },
      }),
    ]);

    const menuList = menuRecipes
      // Don't surface previously-saved one-off custom items as copy sources
      // by default — they pollute the picker. Cashiers who want to clone
      // the same custom dish twice can still ask admin to duplicate it.
      .filter((r) => r.menuItem && !r.menuItem.isCustom && r.items.length > 0)
      .map((r) => ({
        id: r.menuItem!.id,
        name: r.menuItem!.name,
        kind: 'menu' as const,
        yieldQty: 1,
        items: r.items.map((i) => ({
          ingredientId: i.ingredientId,
          quantity: i.quantity.toNumber(),
          unit: i.unit as unknown as string,
        })),
      }));

    const prList = preReadyRecipes
      .filter((r) => r.items.length > 0)
      .map((r) => ({
        id: r.preReadyItem!.id,
        name: `[PR] ${r.preReadyItem!.name}`,
        kind: 'preReady' as const,
        yieldQty: r.yieldQuantity.toNumber(),
        items: r.items.map((i) => ({
          ingredientId: i.ingredientId,
          quantity: i.quantity.toNumber(),
          unit: i.unit as unknown as string,
        })),
      }));

    return [...menuList, ...prList].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Cashier-facing list of recent custom items for the Custom Menu
   * dialog's "Recent" picker. Last 20 created in the last 30 days,
   * with just enough fields to either re-add directly to the cart
   * (id, price) or prefill the form for a save-as-new copy (recipe
   * lines + name). No order-stats join — that's the audit endpoint.
   */
  async listRecentCustomItems(branchId: string) {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const items = await this.prisma.menuItem.findMany({
      where: { branchId, deletedAt: null, isCustom: true, createdAt: { gte: since } },
      include: {
        recipe: { include: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return items.map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description,
      price: it.price.toNumber(),
      createdAt: it.createdAt,
      recipe: it.recipe
        ? it.recipe.items.map((ri) => ({
            ingredientId: ri.ingredientId,
            quantity: ri.quantity.toNumber(),
            unit: ri.unit as unknown as string,
          }))
        : [],
    }));
  }

  /**
   * Audit list of POS-created custom items for a branch. Returns the
   * full recipe (ingredient name + cost + qty + unit), order count,
   * total revenue, and last-sold date so the owner can review what
   * cashiers built ad-hoc and decide which are worth promoting to the
   * regular menu. Hidden by default from /menu so a separate endpoint
   * is the right surface.
   */
  async findCustomItems(branchId: string) {
    const items = await this.prisma.menuItem.findMany({
      where: { branchId, deletedAt: null, isCustom: true },
      include: {
        category: { select: { id: true, name: true } },
        recipe: {
          include: {
            items: {
              include: {
                ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (items.length === 0) return [];

    const ids = items.map((i) => i.id);
    const stats = await this.prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        menuItemId: { in: ids },
        order: { branchId, deletedAt: null, status: { notIn: ['VOID', 'REFUNDED'] } },
        voidedAt: null,
      },
      _sum: { quantity: true, totalPrice: true },
      _max: { createdAt: true },
    });
    const statsById = new Map(stats.map((s) => [s.menuItemId, s] as const));

    return items.map((it) => {
      const s = statsById.get(it.id);
      return {
        id: it.id,
        name: it.name,
        description: it.description,
        price: it.price.toNumber(),
        costPrice: it.costPrice ? it.costPrice.toNumber() : 0,
        category: it.category ? { id: it.category.id, name: it.category.name } : null,
        createdAt: it.createdAt,
        recipe: it.recipe
          ? {
              id: it.recipe.id,
              items: it.recipe.items.map((ri) => ({
                ingredientId: ri.ingredientId,
                ingredientName: ri.ingredient.name,
                stockUnit: ri.ingredient.unit,
                costPerStockUnit: ri.ingredient.costPerUnit ? ri.ingredient.costPerUnit.toNumber() : 0,
                quantity: ri.quantity.toNumber(),
                unit: ri.unit,
              })),
            }
          : null,
        soldQuantity: s?._sum?.quantity ? Number(s._sum.quantity) : 0,
        soldRevenue: s?._sum?.totalPrice ? s._sum.totalPrice.toNumber() : 0,
        lastSoldAt: s?._max?.createdAt ?? null,
      };
    });
  }

  /**
   * Promote a POS-created custom item to a regular menu item the
   * cashier can re-order from the standard picker. Flips isCustom=false,
   * optionally moves to a different category and toggles website
   * visibility, optionally renames. The existing Recipe + RecipeItems
   * are preserved as-is — that's the whole point of saving the custom
   * dish for future use. Refuses to promote anything that isn't
   * currently a custom item, so the endpoint can't be abused to mass
   * mutate regular items.
   */
  async promoteCustomItem(
    id: string,
    branchId: string,
    dto: { categoryId?: string; name?: string; websiteVisible?: boolean; price?: number } = {},
  ) {
    const existing = await this.prisma.menuItem.findFirst({
      where: { id, branchId, deletedAt: null },
      select: { id: true, isCustom: true },
    });
    if (!existing) throw new NotFoundException(`Menu item ${id} not found`);
    if (!existing.isCustom) throw new BadRequestException('Item is already a regular menu item');

    if (dto.categoryId) {
      const cat = await this.prisma.menuCategory.findFirst({
        where: { id: dto.categoryId, branchId, deletedAt: null },
        select: { id: true },
      });
      if (!cat) throw new BadRequestException('Target category not found');
    }

    return this.prisma.menuItem.update({
      where: { id },
      data: {
        isCustom: false,
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        websiteVisible: dto.websiteVisible ?? true,
      },
      include: comboAndLinkedInclude,
    });
  }

  /**
   * Get-or-create the auto-managed "Custom Orders" category for a branch.
   * Always websiteVisible=false so the website / QR feed never shows it.
   * Re-uses an existing category named "Custom Orders" (case-insensitive)
   * if one already exists, so admins can rename it freely without losing
   * the linkage as long as they keep the name.
   */
  private async getOrCreateCustomCategory(branchId: string) {
    const existing = await this.prisma.menuCategory.findFirst({
      where: { branchId, deletedAt: null, name: 'Custom Orders' },
    });
    if (existing) return existing;
    return this.prisma.menuCategory.create({
      data: {
        branchId,
        name: 'Custom Orders',
        websiteVisible: false,
        sortOrder: 9999,
      },
    });
  }

  /**
   * Compute COGS for a recipe-line list using current ingredient costs.
   * Mirrors the performance-report cost engine (variant-fallback to the
   * cheapest active variant when the parent has cost = 0).
   *
   * Critical: each recipe line carries its own unit (e.g. recipe says
   * "Salt 6 G" but the ingredient's stock unit is KG). `costPerUnit`
   * is per STOCK unit, so multiplying the raw recipe quantity against
   * costPerUnit without converting under-counts (or over-counts) by
   * the conversion factor. Custom-menu inputs make this especially
   * common — cashier types "1 KG" of an ingredient stocked in G and
   * the COGS read 1/1000th of the real cost. Now every line goes
   * through UnitConversionService.convert(branchId, qty, lineUnit,
   * stockUnit) before the multiplication. Result in paisa.
   */
  private async computeRecipeCogs(
    branchId: string,
    items: { ingredientId: string; quantity: number; unit?: string | null }[],
  ): Promise<number> {
    if (items.length === 0) return 0;
    const ids = [...new Set(items.map((i) => i.ingredientId))];
    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: ids } },
      select: { id: true, costPerUnit: true, unit: true, hasVariants: true },
    });
    const byId = new Map(ingredients.map((i) => [i.id, i] as const));

    const variantCache = new Map<string, { cost: number; unit: string }>();
    const resolveCostAndUnit = async (ingredientId: string): Promise<{ cost: number; unit: string }> => {
      const ing = byId.get(ingredientId);
      if (!ing) return { cost: 0, unit: '' };
      const direct = ing.costPerUnit.toNumber();
      if (direct > 0 || !ing.hasVariants) return { cost: direct, unit: ing.unit as unknown as string };
      if (variantCache.has(ingredientId)) return variantCache.get(ingredientId)!;
      const variants = await this.prisma.ingredient.findMany({
        where: { parentId: ingredientId, isActive: true, deletedAt: null },
        select: { costPerUnit: true, unit: true },
      });
      const positives = variants
        .map((v) => ({ cost: v.costPerUnit.toNumber(), unit: v.unit as unknown as string }))
        .filter((v) => v.cost > 0);
      const picked = positives.length > 0
        ? positives.reduce((a, b) => (a.cost <= b.cost ? a : b))
        : { cost: 0, unit: ing.unit as unknown as string };
      variantCache.set(ingredientId, picked);
      return picked;
    };

    let total = 0;
    for (const it of items) {
      const { cost, unit: stockUnit } = await resolveCostAndUnit(it.ingredientId);
      if (cost === 0) continue;
      const lineUnit = (it.unit ?? '').trim().toUpperCase() || stockUnit;
      // Convert the recipe-line quantity into the ingredient's stock
      // unit. Same-unit short-circuits inside the service; truly
      // incompatible units (e.g. G ↔ PCS) fall back to "use as-is" so
      // the report still produces a number rather than crashing.
      const qtyInStockUnit = lineUnit === stockUnit
        ? it.quantity
        : await this.unitConversion.convert(branchId, it.quantity, lineUnit, stockUnit);
      total += cost * qtyInStockUnit;
    }
    return Math.round(total);
  }

  /**
   * Create a one-shot Customised Menu item from POS. Get-or-creates the
   * hidden "Custom Orders" category, validates the selling price against
   * the branch's three margin policies (cost, negotiate, max), and
   * persists MenuItem + Recipe so the existing addItemsToOrder + recipe
   * deduction pipeline picks it up unchanged. Server defensively re-merges
   * duplicate (ingredientId, unit) lines by summing quantity, mirroring
   * the POS UI's "Salt 2g + Salt 4g = 6g" rule.
   */
  async createCustomFromCashier(branchId: string, dto: CreateCustomMenuDto) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Custom menu name is required');
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Custom menu must include at least one recipe ingredient');
    }
    const sellingPrice = Math.round(Number(dto.sellingPrice) || 0);
    if (sellingPrice <= 0) throw new BadRequestException('Selling price must be greater than zero');

    // Defensive re-merge by (ingredientId, unit) — UI already merges, but
    // a malicious client could submit duplicates that bypass the hint.
    const mergedMap = new Map<string, { ingredientId: string; quantity: number; unit: string }>();
    for (const it of dto.items) {
      const unit = (it.unit ?? '').trim().toUpperCase() || 'G';
      const key = `${it.ingredientId}::${unit}`;
      const existing = mergedMap.get(key);
      if (existing) existing.quantity += Number(it.quantity) || 0;
      else mergedMap.set(key, { ingredientId: it.ingredientId, quantity: Number(it.quantity) || 0, unit });
    }
    const merged = [...mergedMap.values()].filter((r) => r.quantity > 0);
    if (merged.length === 0) throw new BadRequestException('All recipe lines have zero quantity');

    // Compute COGS using merged lines. The merged entries carry both
    // quantity AND unit, so the helper can convert each line into the
    // ingredient's stock unit before applying costPerUnit.
    const cogs = await this.computeRecipeCogs(branchId, merged);

    // Margin policy from BranchSetting.
    const settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    const costMargin = settings?.customMenuCostMargin?.toNumber() ?? null;
    const negotiate = settings?.customMenuNegotiateMargin?.toNumber() ?? null;
    const maxMargin = settings?.customMenuMaxMargin?.toNumber() ?? null;

    const floor = costMargin != null ? Math.round(cogs * (1 + costMargin / 100)) : cogs;
    const absoluteMin = negotiate != null && negotiate > 0
      ? Math.round(floor * (1 - negotiate / 100))
      : floor;
    const ceiling = maxMargin != null ? Math.round(cogs * (1 + maxMargin / 100)) : null;

    if (cogs > 0 && sellingPrice < absoluteMin) {
      throw new BadRequestException(
        `Selling price ${(sellingPrice / 100).toFixed(2)} is below the minimum allowed ${(absoluteMin / 100).toFixed(2)} (cost ${(cogs / 100).toFixed(2)})`,
      );
    }
    if (ceiling != null && sellingPrice > ceiling) {
      throw new BadRequestException(
        `Selling price ${(sellingPrice / 100).toFixed(2)} is above the maximum allowed ${(ceiling / 100).toFixed(2)} (cost ${(cogs / 100).toFixed(2)})`,
      );
    }

    const category = await this.getOrCreateCustomCategory(branchId);

    // Slug needs a unique suffix — multiple "Extra Spicy Chicken" customs
    // would otherwise collide on the (branchId, slug) unique index.
    const slug = `${this.slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;

    const item = await this.prisma.menuItem.create({
      data: {
        branchId,
        categoryId: category.id,
        name,
        description: dto.description ?? null,
        price: sellingPrice,
        costPrice: cogs,
        type: 'FOOD',
        isAvailable: true,
        websiteVisible: false,
        isCustom: true,
        slug,
        recipe: {
          create: {
            items: {
              create: merged.map((m) => ({
                ingredientId: m.ingredientId,
                quantity: m.quantity,
                unit: m.unit as any,
              })),
            },
          },
        },
      },
      include: comboAndLinkedInclude,
    });

    return item;
  }

  // ─── Addon groups (Phase 3) ───────────────────────────────────────────────

  /** All addon groups attached to a menu item, ordered. */
  listAddonGroups(menuItemId: string, branchId: string) {
    return this.prisma.menuItemAddonGroup.findMany({
      where: { menuItemId, branchId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
          include: { addon: { select: { id: true, name: true, price: true, isAvailable: true, recipe: { select: { id: true } } } } },
        },
      },
    });
  }

  /**
   * Validate an UpsertAddonGroupDto: every addonItemId must be a row
   * on the same branch with `isAddon=true` and not soft-deleted. min /
   * max picks must be sane.
   */
  private async assertAddonGroupShape(branchId: string, dto: UpsertAddonGroupDto) {
    const min = Number(dto.minPicks) || 0;
    const max = Number(dto.maxPicks) || 0;
    if (min < 0 || max < 0) throw new BadRequestException('minPicks / maxPicks cannot be negative');
    if (max > 0 && min > max) throw new BadRequestException('minPicks cannot exceed maxPicks');
    if ((dto.addonItemIds?.length ?? 0) === 0) throw new BadRequestException('Add at least one addon option to the group');
    const ids = Array.from(new Set(dto.addonItemIds));
    const rows = await this.prisma.menuItem.findMany({
      where: { id: { in: ids }, branchId, deletedAt: null },
      select: { id: true, isAddon: true, name: true, recipe: { select: { id: true } } },
    });
    if (rows.length !== ids.length) throw new BadRequestException('One or more addon options not found on this branch');
    const notAddon = rows.filter((r) => !r.isAddon);
    if (notAddon.length > 0) {
      throw new BadRequestException(`These items are not flagged as addons: ${notAddon.map((r) => r.name).join(', ')}`);
    }
    return rows;
  }

  /** Create a new addon group on a menu item. */
  async createAddonGroup(menuItemId: string, branchId: string, dto: UpsertAddonGroupDto) {
    await this.findOne(menuItemId, branchId);
    const rows = await this.assertAddonGroupShape(branchId, dto);
    return this.prisma.menuItemAddonGroup.create({
      data: {
        branchId,
        menuItemId,
        name: dto.name.trim(),
        minPicks: Number(dto.minPicks) || 0,
        maxPicks: Number(dto.maxPicks) || 1,
        sortOrder: dto.sortOrder ?? 0,
        options: {
          create: dto.addonItemIds.map((id, idx) => ({
            addonItemId: id,
            sortOrder: idx,
          })),
        },
      },
      include: { options: { include: { addon: { select: { id: true, name: true, price: true, isAvailable: true, recipe: { select: { id: true } } } } } } },
    }).then(async (g) => {
      // Surface which options have no recipe so admin can spot the
      // "addon contributes price but no stock deduction" footgun.
      const noRecipeNames = rows.filter((r) => !r.recipe).map((r) => r.name);
      return { ...g, warnings: noRecipeNames.length > 0 ? [`These addons have no recipe — selecting them won't deduct any stock: ${noRecipeNames.join(', ')}`] : [] };
    });
  }

  /** Replace name + min/max + addon-options of an existing group. */
  async updateAddonGroup(groupId: string, branchId: string, dto: UpsertAddonGroupDto) {
    const existing = await this.prisma.menuItemAddonGroup.findFirst({
      where: { id: groupId, branchId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Addon group not found');
    const rows = await this.assertAddonGroupShape(branchId, dto);
    return this.prisma.menuItemAddonGroup.update({
      where: { id: groupId },
      data: {
        name: dto.name.trim(),
        minPicks: Number(dto.minPicks) || 0,
        maxPicks: Number(dto.maxPicks) || 1,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        // Replace the option set wholesale; simpler than diffing.
        options: {
          deleteMany: {},
          create: dto.addonItemIds.map((id, idx) => ({ addonItemId: id, sortOrder: idx })),
        },
      },
      include: { options: { include: { addon: { select: { id: true, name: true, price: true, isAvailable: true, recipe: { select: { id: true } } } } } } },
    }).then((g) => {
      const noRecipeNames = rows.filter((r) => !r.recipe).map((r) => r.name);
      return { ...g, warnings: noRecipeNames.length > 0 ? [`These addons have no recipe — selecting them won't deduct any stock: ${noRecipeNames.join(', ')}`] : [] };
    });
  }

  async removeAddonGroup(groupId: string, branchId: string) {
    const existing = await this.prisma.menuItemAddonGroup.findFirst({
      where: { id: groupId, branchId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Addon group not found');
    return this.prisma.menuItemAddonGroup.update({
      where: { id: groupId },
      data: { deletedAt: new Date() },
    });
  }
}
