#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = (process.env.EATRO_API_URL ?? 'https://api.eatrobd.com/api/v1').replace(/\/+$/, '');
const API_KEY = process.env.EATRO_API_KEY;

if (!API_KEY || !API_KEY.startsWith('rk_')) {
  console.error('eatro-mcp: EATRO_API_KEY must be set to an External API key (rk_...). Create one in Admin → Integrations.');
  process.exit(1);
}
if (!/^https:\/\//.test(API_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${API_URL}/`)) {
  console.error(`eatro-mcp: refusing to send the API key over plain HTTP to ${API_URL}`);
  process.exit(1);
}

// ─── HTTP ───────────────────────────────────────────────────────────────

async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/external${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: { data?: T; message?: string | string[] } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error page (proxy / gateway)
  }
  if (!res.ok) {
    const detail = json?.message ? [json.message].flat().join('; ') : text.slice(0, 300);
    const hint = res.status === 403 ? ' — the API key is missing the scope for this action.' : '';
    throw new Error(`Eatro API ${res.status}: ${detail}${hint}`);
  }
  return json?.data as T;
}

const enc = encodeURIComponent;
const taka = (paisa: unknown) => (paisa === null || paisa === undefined ? null : Number(paisa) / 100);

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const out = await fn();
    return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
  }
}

// ─── Shapes returned by the API ─────────────────────────────────────────

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  price: unknown;
  isAvailable: boolean;
  websiteVisible?: boolean;
  tags?: string | null;
  isVariantParent?: boolean;
  categoryId: string;
  category?: { id: string; name: string } | null;
  variants?: Array<{ id: string; name: string; price: unknown; isAvailable: boolean; recipe?: { id: string } | null }>;
};
type RecipeSnapshot = {
  notes: string | null;
  items: Array<{ ingredientId: string; ingredientName: string; quantity: number; unit: string }>;
} | null;

const menuItemView = (m: MenuItem) => ({
  id: m.id,
  name: m.name,
  category: m.category?.name ?? m.categoryId,
  type: m.type,
  price_taka: taka(m.price),
  available: m.isAvailable,
  website_visible: m.websiteVisible,
  description: m.description,
  tags: m.tags ?? null,
  ...(m.isVariantParent
    ? {
        variant_parent: true,
        variants: (m.variants ?? []).map((v) => ({ id: v.id, name: v.name, price_taka: taka(v.price), available: v.isAvailable })),
      }
    : {}),
});

const recipeView = (r: RecipeSnapshot) =>
  r === null
    ? null
    : {
        notes: r.notes,
        items: r.items.map((i) => ({ ingredient_id: i.ingredientId, ingredient: i.ingredientName, quantity: i.quantity, unit: i.unit })),
      };

// ─── Server ─────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'eatro', version: '0.1.0' },
  {
    instructions: [
      'Edits the LIVE Eatro restaurant menu and recipes (eatrobd.com, POS, website). Changes take effect immediately.',
      'Prices are in taka. Recipe quantities are per ONE serving; recipe changes alter stock deduction on every new order.',
      'Always look up ids with list_menu / list_ingredients first; never guess ids. If several items match a name, ask the user which one.',
      'set_recipe replaces the whole recipe: call get_recipe first and send every line to keep.',
      'For deletes, call without confirm to get a preview, show it to the user, and only call with confirm=true after they explicitly agree.',
      'After each write, tell the user what changed (before → after).',
    ].join('\n'),
  },
);

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

server.registerTool(
  'list_menu',
  {
    title: 'List menu items',
    description: 'List live menu items with id, category, price (taka) and availability. Optionally filter by name.',
    inputSchema: { search: z.string().max(100).optional().describe('Case-insensitive part of the item name') },
    annotations: READ,
  },
  ({ search }) =>
    run(async () => {
      const { items } = await api<{ items: MenuItem[] }>('GET', '/business/menu');
      const term = search?.trim().toLowerCase();
      const matched = term ? items.filter((m) => m.name.toLowerCase().includes(term)) : items;
      return { count: matched.length, items: matched.slice(0, 300).map(menuItemView) };
    }),
);

server.registerTool(
  'list_categories',
  {
    title: 'List menu categories',
    description: 'List menu categories with ids (needed to create or move a menu item).',
    annotations: READ,
  },
  () => run(() => api('GET', '/business/menu/categories')),
);

server.registerTool(
  'get_menu_item',
  {
    title: 'Get menu item',
    description: 'Full details of one menu item by id.',
    inputSchema: { id: z.string().min(1).max(64) },
    annotations: READ,
  },
  ({ id }) =>
    run(async () => {
      const { item } = await api<{ item: MenuItem }>('GET', `/business/menu/items/${enc(id)}`);
      return menuItemView(item);
    }),
);

server.registerTool(
  'list_ingredients',
  {
    title: 'List ingredients',
    description: 'Ingredients that can be used in recipes, with id, stock unit and cost per unit (taka). Optionally filter by name.',
    inputSchema: { search: z.string().max(100).optional() },
    annotations: READ,
  },
  ({ search }) =>
    run(async () => {
      const q = search?.trim() ? `?search=${enc(search.trim())}` : '';
      const { ingredients } = await api<{
        ingredients: Array<{ id: string; name: string; unit: string; category: string; costPerUnit: number; hasVariants: boolean }>;
      }>('GET', `/business/ingredients${q}`);
      return ingredients.map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        category: i.category,
        cost_per_unit_taka: taka(i.costPerUnit),
        ...(i.hasVariants ? { has_brand_variants: true } : {}),
      }));
    }),
);

server.registerTool(
  'get_recipe',
  {
    title: 'Get recipe',
    description: 'The recipe (ingredients per one serving) and cost per serving for a menu item.',
    inputSchema: { menu_item_id: z.string().min(1).max(64) },
    annotations: READ,
  },
  ({ menu_item_id }) =>
    run(async () => {
      const { recipe, cost } = await api<{ recipe: RecipeSnapshot; cost: { totalCost: number } | null }>(
        'GET',
        `/business/recipes/${enc(menu_item_id)}`,
      );
      if (!recipe) return 'This menu item has no recipe yet.';
      return { ...recipeView(recipe), cost_per_serving_taka: cost ? taka(cost.totalCost) : null };
    }),
);

server.registerTool(
  'set_recipe',
  {
    title: 'Set recipe',
    description:
      'Create or REPLACE the whole recipe of a menu item. Lines not included are removed. Call get_recipe first and include every line to keep. Unit defaults to the ingredient\'s stock unit.',
    inputSchema: {
      menu_item_id: z.string().min(1).max(64),
      items: z
        .array(
          z.object({
            ingredient_id: z.string().min(1).max(64),
            quantity: z.number().positive().max(100_000).describe('Amount per one serving'),
            unit: z.string().max(20).optional().describe('e.g. G, KG, ML, L, PCS. Omit to use the ingredient unit.'),
          }),
        )
        .max(100),
      notes: z.string().max(1000).optional(),
    },
    annotations: DESTRUCTIVE,
  },
  ({ menu_item_id, items, notes }) =>
    run(async () => {
      const res = await api<{ before: RecipeSnapshot; after: RecipeSnapshot }>('PUT', `/business/recipes/${enc(menu_item_id)}`, {
        notes,
        items: items.map((i) => ({ ingredientId: i.ingredient_id, quantity: i.quantity, ...(i.unit ? { unit: i.unit.toUpperCase() } : {}) })),
      });
      return { before: recipeView(res.before), after: recipeView(res.after) };
    }),
);

server.registerTool(
  'create_menu_item',
  {
    title: 'Create menu item',
    description: 'Add a new item to the live menu. Get category_id from list_categories.',
    inputSchema: {
      category_id: z.string().min(1).max(64),
      name: z.string().min(1).max(120),
      type: z.enum(['FOOD', 'BEVERAGE', 'MODIFIER']),
      price_taka: z.number().min(0).max(1_000_000),
      description: z.string().max(2000).optional(),
      tags: z.string().max(300).optional().describe('Comma-separated, e.g. "spicy,chicken"'),
      available: z.boolean().optional(),
      website_visible: z.boolean().optional(),
    },
    annotations: WRITE,
  },
  (a) =>
    run(async () => {
      const { after } = await api<{ after: MenuItem }>('POST', '/business/menu/items', {
        categoryId: a.category_id,
        name: a.name,
        type: a.type,
        priceTaka: a.price_taka,
        description: a.description,
        tags: a.tags,
        isAvailable: a.available,
        websiteVisible: a.website_visible,
      });
      return { created: menuItemView(after) };
    }),
);

server.registerTool(
  'update_menu_item',
  {
    title: 'Update menu item',
    description: 'Change name, description, price, category, type, tags, availability or website visibility of a menu item. Only send fields that change.',
    inputSchema: {
      id: z.string().min(1).max(64),
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(2000).optional(),
      price_taka: z.number().min(0).max(1_000_000).optional(),
      category_id: z.string().min(1).max(64).optional(),
      type: z.enum(['FOOD', 'BEVERAGE', 'MODIFIER']).optional(),
      tags: z.string().max(300).optional(),
      available: z.boolean().optional(),
      website_visible: z.boolean().optional(),
    },
    annotations: WRITE,
  },
  ({ id, ...a }) =>
    run(async () => {
      const body = Object.fromEntries(
        Object.entries({
          name: a.name,
          description: a.description,
          priceTaka: a.price_taka,
          categoryId: a.category_id,
          type: a.type,
          tags: a.tags,
          isAvailable: a.available,
          websiteVisible: a.website_visible,
        }).filter(([, v]) => v !== undefined),
      );
      const res = await api<{ before: MenuItem; after: MenuItem }>('PATCH', `/business/menu/items/${enc(id)}`, body);
      return { before: menuItemView(res.before), after: menuItemView(res.after) };
    }),
);

server.registerTool(
  'delete_recipe',
  {
    title: 'Delete recipe',
    description:
      'PERMANENTLY delete a menu item\'s recipe. Without confirm=true this only returns a preview. Only confirm after the user explicitly agrees.',
    inputSchema: { menu_item_id: z.string().min(1).max(64), confirm: z.boolean().optional() },
    annotations: DESTRUCTIVE,
  },
  ({ menu_item_id, confirm }) =>
    run(async () => {
      if (confirm !== true) {
        const { recipe } = await api<{ recipe: RecipeSnapshot }>('GET', `/business/recipes/${enc(menu_item_id)}`);
        if (!recipe) return 'This menu item has no recipe — nothing to delete.';
        return {
          preview: 'NOT deleted. This recipe would be permanently removed. Ask the user, then call again with confirm=true.',
          recipe: recipeView(recipe),
        };
      }
      const { before } = await api<{ before: RecipeSnapshot }>('DELETE', `/business/recipes/${enc(menu_item_id)}`);
      return { deleted: true, removed_recipe_for_undo: recipeView(before) };
    }),
);

server.registerTool(
  'delete_menu_item',
  {
    title: 'Delete menu item',
    description:
      'Remove a menu item from the live menu (POS, website, QR). Without confirm=true this only returns a preview. Only confirm after the user explicitly agrees.',
    inputSchema: { id: z.string().min(1).max(64), confirm: z.boolean().optional() },
    annotations: DESTRUCTIVE,
  },
  ({ id, confirm }) =>
    run(async () => {
      if (confirm !== true) {
        const { item } = await api<{ item: MenuItem }>('GET', `/business/menu/items/${enc(id)}`);
        return {
          preview: 'NOT deleted. This item would be removed from the menu. Ask the user, then call again with confirm=true.',
          item: menuItemView(item),
        };
      }
      const { before } = await api<{ before: MenuItem }>('DELETE', `/business/menu/items/${enc(id)}`);
      return { deleted: true, item: menuItemView(before) };
    }),
);

await server.connect(new StdioServerTransport());
console.error(`eatro-mcp connected → ${API_URL}`);
