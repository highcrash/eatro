import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StockUnit } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { JwtPayload } from '@restora/types';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { CategoryService } from '../menu/category.service';
import { MenuService } from '../menu/menu.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecipeService } from '../recipe/recipe.service';
import { ActorSynthesisService } from './actor-synthesis';
import { CurrentApiClient } from './decorators/current-api-client.decorator';
import { Scopes } from './decorators/scopes.decorator';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ScopesGuard } from './guards/scopes.guard';
import { ExternalService } from './external.service';
import type { ApiClient } from './types/api-client.type';

// Body classes must be declared above the controller — see the TDZ note on
// SendSmsDto in external.controller.ts.

const MENU_ITEM_TYPES = ['FOOD', 'BEVERAGE', 'MODIFIER'] as const;
const STOCK_UNITS = Object.values(StockUnit) as string[];
const MAX_PRICE_TAKA = 1_000_000;

class RecipeLineBody {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  ingredientId!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100_000)
  quantity!: number;

  /** Omit to use the ingredient's own stock unit. */
  @IsOptional()
  @IsIn(STOCK_UNITS)
  unit?: string;
}

class UpsertRecipeBody {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineBody)
  items!: RecipeLineBody[];
}

class CreateMenuItemBody {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  categoryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(MENU_ITEM_TYPES)
  type!: (typeof MENU_ITEM_TYPES)[number];

  /** Whole taka (e.g. 280 or 280.50). Converted to paisa server-side. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE_TAKA)
  priceTaka!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  tags?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsBoolean()
  websiteVisible?: boolean;
}

class UpdateMenuItemBody {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(MENU_ITEM_TYPES)
  type?: (typeof MENU_ITEM_TYPES)[number];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE_TAKA)
  priceTaka?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  tags?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsBoolean()
  websiteVisible?: boolean;

  /** Position within its category / among sibling variants (ascending). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

class UpdateCategoryBody {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Top-level category to nest under, or null to make this top-level. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string | null;
}

type RecipeWithItems = {
  notes: string | null;
  items: Array<{ quantity: { toNumber(): number }; unit: string; ingredient: { id: string; name: string } }>;
};

/// Menu + recipe write surface for API keys (used by the local Claude MCP
/// connector). Writes reuse MenuService / RecipeService and log to the
/// Activity Log as the staff member who issued the key, tagged with the
/// key's name so key-made changes are distinguishable from UI edits.
@ApiTags('External API / v1')
@ApiBearerAuth()
@Controller({ path: 'external', version: '1' })
@UseGuards(ApiKeyGuard, ScopesGuard)
export class ExternalMenuController {
  constructor(
    private readonly external: ExternalService,
    private readonly menu: MenuService,
    private readonly categories: CategoryService,
    private readonly recipes: RecipeService,
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly actorSynth: ActorSynthesisService,
  ) {}

  // ─── Menu ─────────────────────────────────────────────────────────────

  @Get('business/menu/categories')
  @Scopes('menu:read')
  @ApiOperation({ summary: 'Menu categories (id + name) for creating / moving items' })
  async listCategories(@CurrentApiClient() client: ApiClient) {
    const categories = await this.prisma.menuCategory.findMany({
      where: { branchId: client.branchId, deletedAt: null },
      select: { id: true, name: true, parentId: true, isActive: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return this.envelope(client.branchId, { categories });
  }

  @Patch('business/menu/categories/:id')
  @Scopes('menu:write')
  @ApiOperation({ summary: 'Rename, reorder or (de)activate a menu category. Returns before + after.' })
  async updateCategory(
    @CurrentApiClient() client: ApiClient,
    @Param('id') id: string,
    @Body() body: UpdateCategoryBody,
  ) {
    const sent = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as UpdateCategoryBody;
    const changed = Object.keys(sent);
    if (changed.length === 0) throw new BadRequestException('Nothing to update');
    if (sent.name !== undefined) sent.name = sent.name.trim();
    const before = await this.categories.findOne(id, client.branchId);
    if (sent.parentId) await this.assertParentCategory(client.branchId, id, sent.parentId);
    const { actor, via } = await this.actorFor(client);
    const after = await this.categories.update(id, client.branchId, sent);
    void this.activityLog.log({
      branchId: client.branchId,
      actor,
      category: 'MENU',
      action: 'UPDATE',
      entityType: 'menuCategory',
      entityId: after.id,
      entityName: after.name,
      before: before as never,
      after: after as never,
      summary:
        sent.name !== undefined && sent.name !== before.name
          ? `Renamed menu category "${before.name}" → "${after.name}" ${via}`
          : `Updated menu category "${after.name}" (${changed.join(', ')}) ${via}`,
    });
    return this.envelope(client.branchId, { before, after });
  }

  @Get('business/menu/items/:id')
  @Scopes('menu:read')
  @ApiOperation({ summary: 'One menu item, prices in paisa' })
  async getMenuItem(@CurrentApiClient() client: ApiClient, @Param('id') id: string) {
    const item = await this.menu.findOne(id, client.branchId);
    return this.envelope(client.branchId, { item });
  }

  @Post('business/menu/items')
  @Scopes('menu:write')
  @ApiOperation({ summary: 'Create a menu item (price in taka)' })
  async createMenuItem(@CurrentApiClient() client: ApiClient, @Body() body: CreateMenuItemBody) {
    await this.assertCategory(client.branchId, body.categoryId);
    const { actor, via } = await this.actorFor(client);
    const { priceTaka, ...rest } = body;
    const created = await this.menu.create(client.branchId, { ...rest, price: toPaisa(priceTaka) } as never);
    void this.activityLog.log({
      branchId: client.branchId,
      actor,
      category: 'MENU',
      action: 'CREATE',
      entityType: 'menuItem',
      entityId: created.id,
      entityName: created.name,
      after: created as never,
      summary: `Created menu item "${created.name}" ${via}`,
    });
    return this.envelope(client.branchId, { after: created });
  }

  @Patch('business/menu/items/:id')
  @Scopes('menu:write')
  @ApiOperation({ summary: 'Update a menu item (price in taka). Returns before + after.' })
  async updateMenuItem(
    @CurrentApiClient() client: ApiClient,
    @Param('id') id: string,
    @Body() body: UpdateMenuItemBody,
  ) {
    // The validation pipe instantiates the body class, so every declared
    // field exists as a key even when the caller didn't send it.
    const sent = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as UpdateMenuItemBody;
    const changed = Object.keys(sent);
    if (changed.length === 0) throw new BadRequestException('Nothing to update');
    if (sent.categoryId) await this.assertCategory(client.branchId, sent.categoryId);
    const before = await this.menu.findOne(id, client.branchId);
    const { actor, via } = await this.actorFor(client);
    const { priceTaka, ...rest } = sent;
    const dto = priceTaka === undefined ? rest : { ...rest, price: toPaisa(priceTaka) };
    const after = await this.menu.update(id, client.branchId, dto as never);
    void this.activityLog.log({
      branchId: client.branchId,
      actor,
      category: 'MENU',
      action: 'UPDATE',
      entityType: 'menuItem',
      entityId: after.id,
      entityName: after.name,
      before: before as never,
      after: after as never,
      summary: `Updated menu item "${after.name}" (${changed.join(', ')}) ${via}`,
    });
    return this.envelope(client.branchId, { before, after });
  }

  @Delete('business/menu/items/:id')
  @Scopes('menu:write')
  @ApiOperation({ summary: 'Soft-delete a menu item. Returns the item as it was.' })
  async deleteMenuItem(@CurrentApiClient() client: ApiClient, @Param('id') id: string) {
    const before = await this.menu.findOne(id, client.branchId);
    const { actor, via } = await this.actorFor(client);
    await this.menu.remove(id, client.branchId);
    void this.activityLog.log({
      branchId: client.branchId,
      actor,
      category: 'MENU',
      action: 'DELETE',
      entityType: 'menuItem',
      entityId: before.id,
      entityName: before.name,
      before: before as never,
      summary: `Deleted menu item "${before.name}" ${via}`,
    });
    return this.envelope(client.branchId, { deleted: true, before });
  }

  // ─── Ingredients + recipes ────────────────────────────────────────────

  @Get('business/ingredients')
  @Scopes('recipes:read')
  @ApiOperation({ summary: 'Ingredients usable in recipes (id, name, unit, cost in paisa per unit)' })
  @ApiQuery({ name: 'search', required: false, description: 'Case-insensitive name contains filter' })
  async listIngredients(@CurrentApiClient() client: ApiClient, @Query('search') search?: string) {
    const term = search?.trim().slice(0, 100);
    const ingredients = await this.prisma.ingredient.findMany({
      where: {
        branchId: client.branchId,
        deletedAt: null,
        isActive: true,
        category: { not: 'SUPPLY' },
        ...(term ? { name: { contains: term, mode: 'insensitive' as const } } : {}),
      },
      select: { id: true, name: true, unit: true, category: true, costPerUnit: true, hasVariants: true, parentId: true },
      orderBy: { name: 'asc' },
      take: 300,
    });
    return this.envelope(client.branchId, {
      ingredients: ingredients.map((i) => ({ ...i, costPerUnit: i.costPerUnit.toNumber() })),
    });
  }

  @Get('business/recipes/:menuItemId')
  @Scopes('recipes:read')
  @ApiOperation({ summary: 'Recipe for a menu item, with cost per serving (paisa)' })
  async getRecipe(@CurrentApiClient() client: ApiClient, @Param('menuItemId') menuItemId: string) {
    const recipe = await this.recipes.findByMenuItem(menuItemId, client.branchId);
    const cost = recipe ? await this.recipes.getCostPerServing(menuItemId, client.branchId) : null;
    return this.envelope(client.branchId, { recipe: snapshotRecipe(recipe), cost });
  }

  @Put('business/recipes/:menuItemId')
  @Scopes('recipes:write')
  @ApiOperation({
    summary: 'Replace the whole recipe for a menu item. Returns before + after.',
    description: 'Send every ingredient line, not just the changed one — lines missing from the body are removed.',
  })
  async upsertRecipe(
    @CurrentApiClient() client: ApiClient,
    @Param('menuItemId') menuItemId: string,
    @Body() body: UpsertRecipeBody,
  ) {
    const ids = [...new Set(body.items.map((i) => i.ingredientId))];
    if (ids.length !== body.items.length) {
      throw new BadRequestException('Each ingredient may appear only once in a recipe');
    }
    // RecipeService.upsert doesn't check ingredient ownership and defaults a
    // missing unit to G, which is wrong for PCS/ML ingredients.
    const owned = await this.prisma.ingredient.findMany({
      where: { id: { in: ids }, branchId: client.branchId, deletedAt: null },
      select: { id: true, unit: true },
    });
    const unitById = new Map(owned.map((i) => [i.id, i.unit as string]));
    const missing = ids.filter((id) => !unitById.has(id));
    if (missing.length > 0) throw new BadRequestException(`Unknown ingredient id(s): ${missing.join(', ')}`);

    const before = await this.recipes.findByMenuItem(menuItemId, client.branchId);
    const { actor, via } = await this.actorFor(client);
    await this.recipes.upsert(menuItemId, client.branchId, {
      notes: body.notes,
      items: body.items.map((i) => ({
        ingredientId: i.ingredientId,
        quantity: i.quantity,
        unit: i.unit ?? unitById.get(i.ingredientId),
      })),
    });
    const after = await this.recipes.findByMenuItem(menuItemId, client.branchId);
    const menuItem = await this.menu.findOne(menuItemId, client.branchId);
    const beforeCount = before?.items.length ?? 0;
    const afterCount = after?.items.length ?? 0;
    void this.activityLog.log({
      branchId: client.branchId,
      actor,
      category: 'RECIPE',
      action: before ? 'UPDATE' : 'CREATE',
      entityType: 'recipe',
      entityId: menuItemId,
      entityName: `Recipe — ${menuItem.name}`,
      before: snapshotRecipe(before) as never,
      after: snapshotRecipe(after) as never,
      summary: `${before ? 'Updated' : 'Created'} recipe for "${menuItem.name}" (${beforeCount} → ${afterCount} ingredients) ${via}`,
    });
    return this.envelope(client.branchId, { before: snapshotRecipe(before), after: snapshotRecipe(after) });
  }

  @Delete('business/recipes/:menuItemId')
  @Scopes('recipes:write')
  @ApiOperation({
    summary: 'Delete the recipe for a menu item (permanent). Returns the recipe as it was.',
    description: 'Recipe rows are hard-deleted. Keep the returned `before` to restore it with PUT.',
  })
  async deleteRecipe(@CurrentApiClient() client: ApiClient, @Param('menuItemId') menuItemId: string) {
    const before = await this.recipes.findByMenuItem(menuItemId, client.branchId);
    if (!before) throw new NotFoundException('This menu item has no recipe');
    const menuItem = await this.menu.findOne(menuItemId, client.branchId);
    const { actor, via } = await this.actorFor(client);
    await this.recipes.remove(menuItemId, client.branchId);
    void this.activityLog.log({
      branchId: client.branchId,
      actor,
      category: 'RECIPE',
      action: 'DELETE',
      entityType: 'recipe',
      entityId: menuItemId,
      entityName: `Recipe — ${menuItem.name}`,
      before: snapshotRecipe(before) as never,
      summary: `Removed recipe from "${menuItem.name}" (${before.items.length} ingredients cleared) ${via}`,
    });
    return this.envelope(client.branchId, { deleted: true, before: snapshotRecipe(before) });
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  private async actorFor(client: ApiClient): Promise<{ actor: JwtPayload; via: string }> {
    const [actor, key] = await Promise.all([
      this.actorSynth.fromApiKey(client.keyId, client.branchId),
      this.prisma.externalApiKey.findUnique({ where: { id: client.keyId }, select: { name: true } }),
    ]);
    return { actor, via: `(via API key "${key?.name ?? client.keyId}")` };
  }

  private async assertCategory(branchId: string, categoryId: string) {
    const found = await this.prisma.menuCategory.findFirst({
      where: { id: categoryId, branchId, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw new BadRequestException(`Unknown category id: ${categoryId}`);
  }

  /** Menus are two levels deep: a sub-category's parent must be top-level. */
  private async assertParentCategory(branchId: string, categoryId: string, parentId: string) {
    if (parentId === categoryId) throw new BadRequestException('A category cannot be its own parent');
    const parent = await this.prisma.menuCategory.findFirst({
      where: { id: parentId, branchId, deletedAt: null },
      select: { parentId: true },
    });
    if (!parent) throw new BadRequestException(`Unknown category id: ${parentId}`);
    if (parent.parentId) throw new BadRequestException('Parent must be a top-level category');
    const children = await this.prisma.menuCategory.count({ where: { parentId: categoryId, deletedAt: null } });
    if (children > 0) throw new BadRequestException(`Category has ${children} sub-categories; it cannot become a sub-category itself`);
  }

  private async envelope<T>(branchId: string, data: T) {
    const meta = await this.external.getBranchMetaContext(branchId);
    return {
      data,
      meta: { branchId, generatedAt: new Date().toISOString(), currency: meta.currency, timezone: meta.timezone },
    };
  }
}

function toPaisa(taka: number): number {
  return Math.round(taka * 100);
}

function snapshotRecipe(recipe: RecipeWithItems | null) {
  if (!recipe) return null;
  return {
    notes: recipe.notes ?? null,
    items: recipe.items.map((it) => ({
      ingredientId: it.ingredient.id,
      ingredientName: it.ingredient.name,
      quantity: it.quantity.toNumber(),
      unit: it.unit,
    })),
  };
}
