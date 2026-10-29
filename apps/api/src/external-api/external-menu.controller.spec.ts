import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalApiModule } from './external-api.module';

/**
 * Integration test for the API-key menu/recipe write surface used by the
 * local Claude MCP connector. Runs against the local dev Postgres with
 * disposable fixtures (own category, menu item, ingredients, keys).
 */
describe('ExternalMenuController (API-key menu + recipe writes)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let origin: string;

  const runId = Date.now().toString(36);
  const base = '/api/v1/external/business';
  let branchId: string;
  let categoryId: string;
  let menuItemId: string;
  let createdMenuItemId: string | null = null;
  let gramIngredientId: string;
  let pcsIngredientId: string;
  const keyIds: string[] = [];
  let writeKey: string;
  let readKey: string;

  async function makeKey(name: string, scopes: string[], createdById: string) {
    const prefix = randomBytes(4).toString('hex');
    const secret = randomBytes(24).toString('base64url');
    const row = await prisma.externalApiKey.create({
      data: { branchId, name, prefix, keyHash: await bcrypt.hash(secret, 10), scopes, createdById },
    });
    keyIds.push(row.id);
    return `rk_${prefix}_${secret}`;
  }

  async function call(method: string, path: string, key: string, body?: unknown) {
    const res = await fetch(`${origin}${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, ExternalApiModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = moduleRef.get(PrismaService);

    const owner = await prisma.staff.findFirstOrThrow({ where: { role: 'OWNER', isActive: true } });
    branchId = owner.branchId;

    categoryId = (await prisma.menuCategory.create({ data: { branchId, name: `Test MCP Cat ${runId}` } })).id;
    menuItemId = (
      await prisma.menuItem.create({
        data: { branchId, categoryId, name: `Test MCP Item ${runId}`, type: 'FOOD', price: 25_000 },
      })
    ).id;
    gramIngredientId = (
      await prisma.ingredient.create({ data: { branchId, name: `Test MCP Butter ${runId}`, unit: 'G', costPerUnit: 2 } })
    ).id;
    pcsIngredientId = (
      await prisma.ingredient.create({ data: { branchId, name: `Test MCP Egg ${runId}`, unit: 'PCS', costPerUnit: 1500 } })
    ).id;

    writeKey = await makeKey(`Test MCP write ${runId}`, ['menu:read', 'menu:write', 'recipes:read', 'recipes:write'], owner.id);
    readKey = await makeKey(`Test MCP read ${runId}`, ['menu:read', 'recipes:read'], owner.id);
  });

  afterAll(async () => {
    const itemIds = [menuItemId, createdMenuItemId].filter(Boolean) as string[];
    await prisma.activityLog.deleteMany({ where: { entityId: { in: itemIds } } });
    await prisma.recipe.deleteMany({ where: { menuItemId: { in: itemIds } } });
    await prisma.menuItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.ingredient.deleteMany({ where: { id: { in: [gramIngredientId, pcsIngredientId] } } });
    await prisma.menuCategory.deleteMany({ where: { id: categoryId } });
    await prisma.externalApiKey.deleteMany({ where: { id: { in: keyIds } } });
    await app.close();
  });

  it('rejects recipe writes from a key without recipes:write', async () => {
    const res = await call('PUT', `/recipes/${menuItemId}`, readKey, {
      items: [{ ingredientId: gramIngredientId, quantity: 10 }],
    });
    expect(res.status).toBe(403);
    expect(await prisma.recipe.findUnique({ where: { menuItemId } })).toBeNull();
  });

  it('rejects invalid recipe bodies', async () => {
    const put = (body: unknown) => call('PUT', `/recipes/${menuItemId}`, writeKey, body);
    expect((await put({ items: [{ ingredientId: gramIngredientId, quantity: -1 }] })).status).toBe(400);
    expect((await put({ items: [{ ingredientId: gramIngredientId, quantity: 1, unit: 'BUCKET' }] })).status).toBe(400);
    expect((await put({ items: [{ ingredientId: 'does-not-exist', quantity: 1 }] })).status).toBe(400);
    expect((await put({ items: [], sneaky: true })).status).toBe(400);
    expect(
      (
        await put({
          items: [
            { ingredientId: gramIngredientId, quantity: 1 },
            { ingredientId: gramIngredientId, quantity: 2 },
          ],
        })
      ).status,
    ).toBe(400);
    expect(await prisma.recipe.findUnique({ where: { menuItemId } })).toBeNull();
  });

  it('creates a recipe, defaults each unit to the ingredient unit, and audit-logs with the key name', async () => {
    const res = await call('PUT', `/recipes/${menuItemId}`, writeKey, {
      items: [
        { ingredientId: gramIngredientId, quantity: 20 },
        { ingredientId: pcsIngredientId, quantity: 2 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.before).toBeNull();
    const after = res.body.data.after.items as Array<{ ingredientId: string; quantity: number; unit: string }>;
    expect(after.find((i) => i.ingredientId === gramIngredientId)).toMatchObject({ quantity: 20, unit: 'G' });
    expect(after.find((i) => i.ingredientId === pcsIngredientId)).toMatchObject({ quantity: 2, unit: 'PCS' });

    const log = await waitFor(
      () => prisma.activityLog.findFirst({ where: { entityId: menuItemId, entityType: 'recipe', action: 'CREATE' } }),
      (row) => row !== null,
    );
    expect(log?.summary).toContain(`via API key "Test MCP write ${runId}"`);
  });

  it('replaces the whole recipe and returns before + after', async () => {
    const res = await call('PUT', `/recipes/${menuItemId}`, writeKey, {
      items: [{ ingredientId: gramIngredientId, quantity: 25 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.before.items).toHaveLength(2);
    expect(res.body.data.after.items).toEqual([
      expect.objectContaining({ ingredientId: gramIngredientId, quantity: 25, unit: 'G' }),
    ]);
  });

  it('updates the price in taka and stores paisa', async () => {
    const res = await call('PATCH', `/menu/items/${menuItemId}`, writeKey, { priceTaka: 280.5 });
    expect(res.status).toBe(200);
    expect(Number(res.body.data.before.price)).toBe(25_000);
    const row = await prisma.menuItem.findUniqueOrThrow({ where: { id: menuItemId } });
    expect(row.price.toNumber()).toBe(28_050);

    const log = await waitFor(
      () => prisma.activityLog.findFirst({ where: { entityId: menuItemId, entityType: 'menuItem', action: 'UPDATE' } }),
      (r) => r !== null,
    );
    expect(log?.summary).toContain('(priceTaka)');
  });

  it('rejects an empty menu item update', async () => {
    expect((await call('PATCH', `/menu/items/${menuItemId}`, writeKey, {})).status).toBe(400);
  });

  it('creates a menu item in a known category only', async () => {
    const bad = await call('POST', '/menu/items', writeKey, { categoryId: 'nope', name: 'X', type: 'FOOD', priceTaka: 10 });
    expect(bad.status).toBe(400);
    const res = await call('POST', '/menu/items', writeKey, {
      categoryId,
      name: `Test MCP Created ${runId}`,
      type: 'BEVERAGE',
      priceTaka: 120,
    });
    expect(res.status).toBe(201);
    createdMenuItemId = res.body.data.after.id;
    const row = await prisma.menuItem.findUniqueOrThrow({ where: { id: createdMenuItemId! } });
    expect(row.price.toNumber()).toBe(12_000);
  });

  it('deletes a recipe, returning it for undo; a second delete is 404', async () => {
    const res = await call('DELETE', `/recipes/${menuItemId}`, writeKey);
    expect(res.status).toBe(200);
    expect(res.body.data.before.items).toHaveLength(1);
    expect(await prisma.recipe.findUnique({ where: { menuItemId } })).toBeNull();
    expect((await call('DELETE', `/recipes/${menuItemId}`, writeKey)).status).toBe(404);
  });

  it('soft-deletes a menu item only with menu:write', async () => {
    expect((await call('DELETE', `/menu/items/${createdMenuItemId}`, readKey)).status).toBe(403);
    expect((await call('DELETE', `/menu/items/${createdMenuItemId}`, writeKey)).status).toBe(200);
    const row = await prisma.menuItem.findUniqueOrThrow({ where: { id: createdMenuItemId! } });
    expect(row.deletedAt).not.toBeNull();
  });
});

async function waitFor<T>(fetchFn: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5000, intervalMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await fetchFn();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    value = await fetchFn();
  }
  return value;
}
