import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Fields safe to expose on the public website. Keep this list tight —
// everything NOT listed here stays internal. In particular:
//   - `costPrice` is cost of goods; NEVER leak it.
//   - `cookingStationId` exposes internal kitchen routing.
//   - `createdAt` / `updatedAt` / `deletedAt` are internal timestamps.
//   - `websiteVisible` / `isCombo` are internal flags.
// Any new MenuItem column with sensitive defaults (COGS, profit, internal
// flags) MUST be added as exclusions, not included by default.
//
// `type` (FOOD/BEVERAGE) and `isAvailable` ARE exposed because the
// public apps branch on them for display (emoji + filter). They don't
// reveal anything a customer can't see by looking at the menu.
const PUBLIC_MENU_ITEM_SELECT = {
  id: true,
  branchId: true,
  categoryId: true,
  name: true,
  slug: true,
  seoTitle: true,
  seoDescription: true,
  description: true,
  type: true,
  price: true,
  imageUrl: true,
  tags: true,
  isAvailable: true,
  sortOrder: true,
  pieces: true,
  prepTime: true,
  spiceLevel: true,
  // Variant flags so the website can render the right UI:
  //   - isVariantParent + non-empty variants[] → render variant tabs
  //   - variantParentId !== null → this is a child variant
  // Public payload only exposes the booleans + child id list; admins
  // never see the full picker-shell internals on the customer site.
  isVariantParent: true,
  variantParentId: true,
  variants: {
    where: { deletedAt: null, isAvailable: true },
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      imageUrl: true,
      tags: true,
      pieces: true,
      prepTime: true,
      spiceLevel: true,
      sortOrder: true,
    },
  },
  // Addon groups + their options. The QR / website needs this to
  // render the "pick a side / sauce" UI that POS has. Addon items
  // themselves are filtered out of the standalone menu (isAddon=false
  // in itemWhere) so they only appear here as group options.
  addonGroups: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      name: true,
      minPicks: true,
      maxPicks: true,
      sortOrder: true,
      options: {
        orderBy: { sortOrder: 'asc' as const },
        select: {
          id: true,
          addonItemId: true,
          sortOrder: true,
          addon: { select: { id: true, name: true, price: true, isAvailable: true } },
        },
      },
    },
  },
} as const;

// Categories for the public menu — just presentational fields.
const PUBLIC_CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  icon: true,
  parentId: true,
  sortOrder: true,
} as const;

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  /** Calculate discounted prices for menu items based on active MenuItemDiscounts */
  private async applyDiscounts<T extends { id: string; price: any }>(branchId: string, items: T[]): Promise<(T & { discountedPrice: number | null; discountType: string | null; discountValue: number | null })[]> {
    if (items.length === 0) return items.map((i) => ({ ...i, discountedPrice: null, discountType: null, discountValue: null }));
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
    const activeDiscounts = discounts.filter((d) => {
      if (!d.applicableDays) return true;
      try { const days: string[] = JSON.parse(d.applicableDays); return days.includes(dayName); } catch { return true; }
    });

    return items.map((item) => {
      const discount = activeDiscounts.find((d) => d.menuItemId === item.id);
      if (!discount) return { ...item, discountedPrice: null, discountType: null, discountValue: null, discountEndDate: null, discountApplicableDays: null };
      const price = Number(item.price);
      const discountedPrice = discount.type === 'FLAT'
        ? Math.max(0, price - Number(discount.value))
        : Math.round(price * (1 - Number(discount.value) / 100));
      let applicableDays: string[] | null = null;
      try { applicableDays = discount.applicableDays ? JSON.parse(discount.applicableDays) : null; } catch { /* */ }
      return {
        ...item,
        discountedPrice,
        discountType: discount.type,
        discountValue: Number(discount.value),
        discountEndDate: discount.endDate.toISOString(),
        discountApplicableDays: applicableDays,
      };
    });
  }

  async getTableInfo(tableId: string) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id: tableId, deletedAt: null },
      include: { branch: true },
    });
    if (!table) throw new NotFoundException('Table not found');

    // Check for active (non-finished) order on this table
    const activeOrder = await this.prisma.order.findFirst({
      where: {
        tableId,
        deletedAt: null,
        status: { notIn: ['PAID', 'VOID'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return {
      id: table.id,
      tableNumber: table.tableNumber,
      branchId: table.branchId,
      branchName: table.branch.name,
      status: table.status,
      activeOrderId: activeOrder?.id ?? null,
    };
  }

  async getBranches() {
    return this.prisma.branch.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, address: true, phone: true },
    });
  }

  async getBranchById(branchId: string) {
    return this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, name: true, address: true, phone: true, logoUrl: true },
    });
  }

  async getMenu(branchId: string) {
    // Menu page = ALL categories the admin hasn't explicitly hidden.
    // featuredCategoryIds only controls the HOMEPAGE preview (applied client-side
    // on the web app), never the full menu page — admin wants the complete menu
    // browsable even when a subset is featured on the home page.
    const content = await this.prisma.websiteContent.findUnique({ where: { branchId } });
    const hiddenCatIds: string[] = content?.hiddenCategoryIds ? this.safeParseArray(content.hiddenCategoryIds) : [];
    const hiddenItemIds: string[] = content?.hiddenItemIds ? this.safeParseArray(content.hiddenItemIds) : [];

    const catWhere: any = {
      branchId,
      isActive: true,
      deletedAt: null,
      websiteVisible: true,
    };
    if (hiddenCatIds.length > 0) catWhere.id = { notIn: hiddenCatIds };

    const itemWhere: any = {
      branchId,
      isAvailable: true,
      deletedAt: null,
      websiteVisible: true,
      isAddon: false,
      // Show parents + standalones in the grid; hide individual
      // variants — the website renders them as tabs on the parent's
      // detail page so customers see "Hargao" once with a Prawn /
      // Chicken switcher instead of two separate cards. Standalones
      // (no parent) and variant parents both have variantParentId =
      // null, so this filter keeps both.
      variantParentId: null,
    };
    if (hiddenItemIds.length > 0) itemWhere.id = { notIn: hiddenItemIds };

    const [categories, items] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: catWhere,
        orderBy: { sortOrder: 'asc' },
        select: PUBLIC_CATEGORY_SELECT,
      }),
      this.prisma.menuItem.findMany({
        where: itemWhere,
        orderBy: { sortOrder: 'asc' },
        select: PUBLIC_MENU_ITEM_SELECT,
      }),
    ]);

    const itemsWithDiscount = await this.applyDiscounts(branchId, items);
    return { categories, items: itemsWithDiscount };
  }

  /**
   * Print-menu variant of `getMenu` — same visibility filters, but each
   * item carries a small `keyIngredients[]` payload so the
   * `/menu-print` page can render an A4 hardcopy with picture +
   * ingredient pills without doing N+1 fetches.
   *
   * Quantities + units are intentionally OMITTED (same recipe
   * confidentiality reasoning as `getMenuItem` — exposing portion
   * sizes lets competitors clone the dish). We cap the list at
   * `KEY_INGREDIENT_LIMIT` so a 20-ingredient curry doesn't blow out
   * the print card.
   */
  async getMenuForPrint(branchId: string) {
    const KEY_INGREDIENT_LIMIT = 5;

    const content = await this.prisma.websiteContent.findUnique({ where: { branchId } });
    const hiddenCatIds: string[] = content?.hiddenCategoryIds ? this.safeParseArray(content.hiddenCategoryIds) : [];
    const hiddenItemIds: string[] = content?.hiddenItemIds ? this.safeParseArray(content.hiddenItemIds) : [];

    const catWhere: any = {
      branchId, isActive: true, deletedAt: null, websiteVisible: true,
    };
    if (hiddenCatIds.length > 0) catWhere.id = { notIn: hiddenCatIds };

    const itemWhere: any = {
      branchId, isAvailable: true, deletedAt: null,
      websiteVisible: true, isAddon: false, variantParentId: null,
    };
    if (hiddenItemIds.length > 0) itemWhere.id = { notIn: hiddenItemIds };

    const [categories, items] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: catWhere, orderBy: { sortOrder: 'asc' }, select: PUBLIC_CATEGORY_SELECT,
      }),
      this.prisma.menuItem.findMany({
        where: itemWhere, orderBy: { sortOrder: 'asc' },
        select: {
          ...PUBLIC_MENU_ITEM_SELECT,
          recipe: {
            select: {
              items: {
                select: {
                  ingredient: { select: { id: true, name: true, imageUrl: true, showOnWebsite: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    // websiteDisplayName aliasing — same raw-SQL fallback as
    // getMenuItem so the endpoint works against an older generated
    // Prisma client too. Single round-trip across ALL ingredients.
    const allIngredientIds = Array.from(new Set(
      (items as any[]).flatMap((i) => (i.recipe?.items ?? []).map((ri: any) => ri.ingredient.id)),
    ));
    const aliasMap = await this.fetchIngredientDisplayNames(allIngredientIds);

    const itemsWithDiscount = await this.applyDiscounts(branchId, items);

    const enriched = (itemsWithDiscount as any[]).map((item) => {
      const keyIngredients = (item.recipe?.items ?? [])
        .filter((ri: any) => ri.ingredient.showOnWebsite)
        .slice(0, KEY_INGREDIENT_LIMIT)
        .map((ri: any) => {
          const alias = aliasMap.get(ri.ingredient.id);
          return {
            id: ri.ingredient.id,
            name: alias && alias.trim() ? alias : ri.ingredient.name,
            imageUrl: ri.ingredient.imageUrl,
          };
        });
      const { recipe: _drop, ...rest } = item;
      return { ...rest, keyIngredients };
    });

    return { categories, items: enriched };
  }

  /** Fetch websiteDisplayName for a batch of ingredient ids via raw
   *  SQL — the column was added to the schema after some local
   *  Prisma clients were generated, so going through `$queryRaw`
   *  keeps the endpoint usable on stale checkouts. */
  private async fetchIngredientDisplayNames(ingredientIds: string[]): Promise<Map<string, string | null>> {
    if (ingredientIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; websiteDisplayName: string | null }>>`
      SELECT "id", "websiteDisplayName" FROM "ingredients"
      WHERE "id" = ANY(${ingredientIds}::text[])
    `;
    return new Map(rows.map((r) => [r.id, r.websiteDisplayName]));
  }

  private safeParseArray(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  async getMenuItem(branchId: string, itemIdOrSlug: string) {
    // Support lookup by ID or slug. Use an explicit select so costPrice
    // and internal fields never leak, then pull recipe ingredients
    // separately with their own narrow select.
    const item = await this.prisma.menuItem.findFirst({
      where: {
        branchId,
        deletedAt: null,
        OR: [{ id: itemIdOrSlug }, { slug: itemIdOrSlug }],
      },
      select: {
        ...PUBLIC_MENU_ITEM_SELECT,
        category: { select: PUBLIC_CATEGORY_SELECT },
        recipe: {
          select: {
            items: {
              select: {
                // Omit quantity + unit so competitors can't reverse-engineer
                // portioning. Customers see the ingredient list only.
                // websiteDisplayName overrides `name` on the public payload
                // when set — admin uses this to show better-reading names
                // to customers (e.g. "Aromatic Garlic" instead of internal
                // "Garlic Powder") without renaming the inventory record.
                ingredient: { select: { id: true, name: true, imageUrl: true, showOnWebsite: true } },
              },
            },
          },
        },
      },
    });
    if (!item) return null;

    // Pull websiteDisplayName via raw SQL so the endpoint works even
    // when the generated Prisma client is older than the column. The
    // result is keyed by ingredient id so we can splice it onto each
    // recipe ingredient below.
    const ingredientIds = ((item as any).recipe?.items ?? []).map((ri: any) => ri.ingredient.id);
    const displayNames = ingredientIds.length > 0
      ? await this.prisma.$queryRaw<Array<{ id: string; websiteDisplayName: string | null }>>`
          SELECT "id", "websiteDisplayName" FROM "ingredients"
          WHERE "id" = ANY(${ingredientIds}::text[])
        `
      : [];
    const displayNameById = new Map<string, string | null>(displayNames.map((r) => [r.id, r.websiteDisplayName]));

    // Apply discount
    const [itemWithDiscount] = await this.applyDiscounts(branchId, [item]);

    // Filter ingredients by showOnWebsite. Quantity + unit are intentionally
    // stripped — exposing them lets competitors copy recipes. Admin-set
    // "pieces" on MenuItem is already the customer-facing portioning hint.
    // Server-side websiteDisplayName fallback: any non-empty alias replaces
    // the inventory `name`, so the website + qr-order code can keep
    // reading `ingredient.name` unchanged.
    const ingredients = (item as any).recipe?.items
      ?.filter((ri: any) => ri.ingredient.showOnWebsite)
      .map((ri: any) => {
        const alias = displayNameById.get(ri.ingredient.id);
        return {
          id: ri.ingredient.id,
          name: alias && alias.trim() ? alias : ri.ingredient.name,
          imageUrl: ri.ingredient.imageUrl,
        };
      }) ?? [];

    // Strip the raw recipe object — only the filtered `ingredients` array
    // should be visible on the public detail endpoint.
    const { recipe: _recipe, ...rest } = itemWithDiscount as any;
    return { ...rest, ingredients };
  }

  async getRecommended(branchId: string, categoryId?: string) {
    // Get recommended tag from CMS
    const content = await this.prisma.websiteContent.findUnique({ where: { branchId } });
    const tag = content?.recommendedTag ?? 'Chef Special';

    if (categoryId) {
      // "You might also like" — top selling from same category
      const topItems = await this.prisma.orderItem.groupBy({
        by: ['menuItemId'],
        where: { order: { branchId, status: 'PAID' }, menuItem: { categoryId, deletedAt: null, isAvailable: true, websiteVisible: true, isVariantParent: false, isAddon: false } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 8,
      });
      const ids = topItems.map((t) => t.menuItemId);
      if (ids.length > 0) {
        const items = await this.prisma.menuItem.findMany({
          where: { id: { in: ids }, deletedAt: null },
          select: { ...PUBLIC_MENU_ITEM_SELECT, category: { select: PUBLIC_CATEGORY_SELECT } },
        });
        return this.applyDiscounts(branchId, items);
      }
    }

    // Items tagged with recommendedTag
    const tagged = await this.prisma.menuItem.findMany({
      where: { branchId, deletedAt: null, isAvailable: true, websiteVisible: true, isVariantParent: false, isAddon: false, tags: { contains: tag } },
      select: { ...PUBLIC_MENU_ITEM_SELECT, category: { select: PUBLIC_CATEGORY_SELECT } },
      take: 10,
    });
    if (tagged.length > 0) return this.applyDiscounts(branchId, tagged);

    // Fallback: top selling items
    const topAll = await this.prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: { order: { branchId, status: 'PAID' }, menuItem: { deletedAt: null, isAvailable: true, isVariantParent: false, isAddon: false } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    });
    const fallbackIds = topAll.map((t) => t.menuItemId);
    const fallbackItems = await this.prisma.menuItem.findMany({
      where: { id: { in: fallbackIds }, deletedAt: null },
      select: { ...PUBLIC_MENU_ITEM_SELECT, category: { select: PUBLIC_CATEGORY_SELECT } },
    });
    return this.applyDiscounts(branchId, fallbackItems);
  }

  async getDiscountedItems(branchId: string) {
    const now = new Date();
    const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][now.getDay()];
    const discounts = await this.prisma.menuItemDiscount.findMany({
      where: { isActive: true, startDate: { lte: now }, endDate: { gte: now }, menuItem: { branchId, deletedAt: null, isAvailable: true, websiteVisible: true, isVariantParent: false, isAddon: false } },
      select: {
        type: true,
        value: true,
        endDate: true,
        applicableDays: true,
        menuItem: {
          select: { ...PUBLIC_MENU_ITEM_SELECT, category: { select: PUBLIC_CATEGORY_SELECT } },
        },
      },
    });
    const active = discounts.filter((d) => {
      if (!d.applicableDays) return true;
      try { return (JSON.parse(d.applicableDays) as string[]).includes(dayName); } catch { return true; }
    });
    return active.map((d) => {
      const price = Number(d.menuItem.price);
      const discountedPrice = d.type === 'FLAT' ? Math.max(0, price - Number(d.value)) : Math.round(price * (1 - Number(d.value) / 100));
      let applicableDays: string[] | null = null;
      try { applicableDays = d.applicableDays ? JSON.parse(d.applicableDays) : null; } catch { /* */ }
      return {
        ...d.menuItem,
        discountedPrice,
        discountType: d.type,
        discountValue: Number(d.value),
        discountEndDate: d.endDate.toISOString(),
        discountApplicableDays: applicableDays,
      };
    });
  }

  async getReviews(branchId: string) {
    // Explicit select so orderId/customerId internal pointers don't leak
    // to the public website. Customer name is whitelisted.
    return this.prisma.review.findMany({
      where: { branchId },
      select: {
        id: true,
        foodScore: true,
        serviceScore: true,
        atmosphereScore: true,
        priceScore: true,
        notes: true,
        createdAt: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /**
   * Public-safe BranchSetting slice for the QR app. Returns only the
   * customer-facing toggles — never SMS keys, margin policies, or
   * reservation rules. The QR app uses this to decide whether to
   * render the structured ingredient-removal UI vs the free-text
   * Special Note field.
   */
  async getPublicBranchSettings(branchId: string) {
    const s = await this.prisma.branchSetting.findUnique({
      where: { branchId },
      select: { qrAllowSelfRemoveIngredients: true },
    });
    return {
      qrAllowSelfRemoveIngredients: s?.qrAllowSelfRemoveIngredients ?? false,
    };
  }

  /**
   * Recipe ingredients (id + name only) for the QR Customise picker.
   * Quantities, costs, and supplier info are stripped — the customer
   * just needs the names of what's in the dish to tick what to remove.
   */
  async getPublicRecipe(menuItemId: string) {
    const recipe = await this.prisma.recipe.findUnique({
      where: { menuItemId },
      select: {
        items: {
          select: {
            id: true,
            ingredient: { select: { id: true, name: true } },
          },
        },
      },
    });
    return recipe ?? { items: [] };
  }
}
