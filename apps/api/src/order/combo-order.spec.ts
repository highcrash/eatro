import { Test } from '@nestjs/testing';
import { MenuModule } from '../menu/menu.module';
import { MenuService } from '../menu/menu.service';
import { PrismaService } from '../prisma/prisma.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { OrderModule } from './order.module';
import { OrderService } from './order.service';

/**
 * Combos end to end against the local dev Postgres with disposable
 * fixtures: a combo of one Pizza plus a "Fizz ×4" choice slot across
 * Coke / Sprite / Fanta. Ordering it must deduct the parts' recipes
 * (with the guest's drink split), voiding must put exactly that back,
 * and void-as-waste must log the parts.
 */
jest.setTimeout(30_000);

describe('Combos — contents, ordering, stock and voids', () => {
  let orders: OrderService;
  let menu: MenuService;
  let prisma: PrismaService;
  let close: () => Promise<void>;

  const branchId = 'branch-main';
  const runId = Date.now().toString(36);
  let cashierId: string;
  let categoryId: string;
  const ing: Record<'dough' | 'coke' | 'sprite' | 'fanta', string> = { dough: '', coke: '', sprite: '', fanta: '' };
  const item: Record<'pizza' | 'coke' | 'sprite' | 'fanta' | 'combo' | 'shell', string> = { pizza: '', coke: '', sprite: '', fanta: '', combo: '', shell: '' };
  const orderIds: string[] = [];

  const stock = async (id: string) => (await prisma.ingredient.findUniqueOrThrow({ where: { id } })).currentStock.toNumber();
  const stockAll = async () => ({
    dough: await stock(ing.dough),
    coke: await stock(ing.coke),
    sprite: await stock(ing.sprite),
    fanta: await stock(ing.fanta),
  });
  /** Stock writes are fire-and-forget; poll until the expected deltas land. */
  const expectStock = async (start: Record<string, number>, delta: Record<string, number>) => {
    const deadline = Date.now() + 5000;
    let now = await stockAll();
    const matches = () => Object.entries(delta).every(([k, d]) => Math.abs(now[k as keyof typeof now] - (start[k] + d)) < 1e-6);
    while (!matches() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      now = await stockAll();
    }
    for (const [k, d] of Object.entries(delta)) expect(now[k as keyof typeof now]).toBeCloseTo(start[k] + d, 4);
  };

  const FIZZ_SLOT = 4;
  const comboContents = () => [
    { includedItemId: item.pizza, quantity: 1 },
    { includedItemId: item.coke, quantity: FIZZ_SLOT, choiceGroup: 'Fizz' },
    { includedItemId: item.sprite, quantity: FIZZ_SLOT, choiceGroup: 'Fizz' },
    { includedItemId: item.fanta, quantity: FIZZ_SLOT, choiceGroup: 'Fizz' },
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [OrderModule, MenuModule] })
      // No real Socket.IO server under Test.createTestingModule (see refund spec).
      .overrideProvider(RestoraPosGateway)
      .useValue({ emitToBranch: jest.fn(), emitToKds: jest.fn(), emitToOrder: jest.fn(), emitOrderUpdate: jest.fn() })
      .compile();
    orders = moduleRef.get(OrderService);
    menu = moduleRef.get(MenuService);
    prisma = moduleRef.get(PrismaService);
    close = () => moduleRef.close();

    cashierId = (await prisma.staff.findFirstOrThrow({ where: { branchId, role: 'OWNER', isActive: true } })).id;
    categoryId = (await prisma.menuCategory.create({ data: { branchId, name: `Test Combo Cat ${runId}` } })).id;

    const mkIng = async (name: string, unit: 'G' | 'PCS') =>
      (await prisma.ingredient.create({ data: { branchId, name: `Test ${name} ${runId}`, unit, currentStock: 10_000, costPerUnit: 10 } })).id;
    ing.dough = await mkIng('Dough', 'G');
    ing.coke = await mkIng('Coke Can', 'PCS');
    ing.sprite = await mkIng('Sprite Can', 'PCS');
    ing.fanta = await mkIng('Fanta Can', 'PCS');

    const mkItem = async (name: string, price: number, recipe?: { ingredientId: string; quantity: number; unit: 'G' | 'PCS' }) => {
      const m = await prisma.menuItem.create({ data: { branchId, categoryId, name: `Test ${name} ${runId}`, type: 'FOOD', price } });
      if (recipe) await prisma.recipe.create({ data: { menuItemId: m.id, items: { create: [recipe] } } });
      return m.id;
    };
    item.pizza = await mkItem('Pizza', 59_500, { ingredientId: ing.dough, quantity: 150, unit: 'G' });
    item.coke = await mkItem('Fizz', 9_000, { ingredientId: ing.coke, quantity: 1, unit: 'PCS' });
    item.sprite = await mkItem('Fizz White', 9_000, { ingredientId: ing.sprite, quantity: 1, unit: 'PCS' });
    item.fanta = await mkItem('Fizz Orange', 9_000, { ingredientId: ing.fanta, quantity: 1, unit: 'PCS' });
    item.combo = await mkItem('Buddy Combo', 199_900);
    item.shell = (await prisma.menuItem.create({ data: { branchId, categoryId, name: `Test Shell ${runId}`, type: 'FOOD', price: 0, isVariantParent: true } })).id;
  });

  afterAll(async () => {
    const itemIds = Object.values(item).filter(Boolean);
    const ingIds = Object.values(ing).filter(Boolean);
    await prisma.stockMovement.deleteMany({ where: { ingredientId: { in: ingIds } } });
    await prisma.wasteLog.deleteMany({ where: { ingredientId: { in: ingIds } } });
    await prisma.activityLog.deleteMany({ where: { entityId: { in: [...orderIds, ...itemIds] } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.comboItem.deleteMany({ where: { comboMenuId: { in: itemIds } } });
    await prisma.recipe.deleteMany({ where: { menuItemId: { in: itemIds } } });
    await prisma.menuItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.ingredient.deleteMany({ where: { id: { in: ingIds } } });
    await prisma.menuCategory.deleteMany({ where: { id: categoryId } });
    await close();
  });

  it('rejects bad combo contents', async () => {
    const set = (rows: unknown) => menu.setComboItems(item.combo, branchId, rows as never);
    await expect(set([{ includedItemId: item.pizza, quantity: 1 }, { includedItemId: item.pizza, quantity: 2 }])).rejects.toThrow(/only appear once/);
    await expect(set([{ includedItemId: item.combo, quantity: 1 }])).rejects.toThrow(/itself/);
    await expect(set([{ includedItemId: item.shell, quantity: 1 }])).rejects.toThrow(/option group/);
    await expect(set([{ includedItemId: item.pizza, quantity: 0 }])).rejects.toThrow(/1 to 99/);
    await expect(
      set([
        { includedItemId: item.coke, quantity: 2, choiceGroup: 'Fizz' },
        { includedItemId: item.sprite, quantity: 4, choiceGroup: 'Fizz' },
      ]),
    ).rejects.toThrow(/same quantity/);
    await expect(set([{ includedItemId: item.coke, quantity: 2, choiceGroup: 'Fizz' }])).rejects.toThrow(/at least two/);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: item.combo } })).isCombo).toBe(false);
  });

  it('saves fixed parts and a choice group in order', async () => {
    const saved = await menu.setComboItems(item.combo, branchId, comboContents());
    expect(saved.isCombo).toBe(true);
    expect(saved.comboItems.map((c) => [c.includedItemId, c.quantity, c.choiceGroup, c.sortOrder])).toEqual([
      [item.pizza, 1, null, 0],
      [item.coke, FIZZ_SLOT, 'Fizz', 1],
      [item.sprite, FIZZ_SLOT, 'Fizz', 2],
      [item.fanta, FIZZ_SLOT, 'Fizz', 3],
    ]);
  });

  it('orders a combo with a mixed drink pick and deducts every part', async () => {
    const start = await stockAll();
    const order = await orders.create(branchId, cashierId, {
      type: 'TAKEAWAY',
      items: [
        {
          menuItemId: item.combo,
          quantity: 2,
          comboChoices: [
            { includedItemId: item.coke, quantity: 2 },
            { includedItemId: item.sprite, quantity: 1 },
            { includedItemId: item.fanta, quantity: 1 },
          ],
        },
        { menuItemId: item.pizza, quantity: 1 },
      ],
    });
    orderIds.push(order.id);
    const line = order.items.find((i) => i.menuItemId === item.combo)!;
    expect(line.comboItems).toEqual([
      { menuItemId: item.pizza, name: `Test Pizza ${runId}`, quantity: 1, choiceGroup: null },
      { menuItemId: item.coke, name: `Test Fizz ${runId}`, quantity: 2, choiceGroup: 'Fizz' },
      { menuItemId: item.sprite, name: `Test Fizz White ${runId}`, quantity: 1, choiceGroup: 'Fizz' },
      { menuItemId: item.fanta, name: `Test Fizz Orange ${runId}`, quantity: 1, choiceGroup: 'Fizz' },
    ]);
    // 2 combos (2 pizzas, 4 coke, 2 sprite, 2 fanta) + 1 plain pizza.
    await expectStock(start, { dough: -450, coke: -4, sprite: -2, fanta: -2 });

    // Voiding the combo (not prepared) puts exactly its parts back.
    const before = await stockAll();
    await orders.voidItem(order.id, line.id, branchId, { reason: 'test', approverId: cashierId });
    await expectStock(before, { dough: 300, coke: 4, sprite: 2, fanta: 2 });
  });

  it('defaults an unpicked choice slot to its first option', async () => {
    const start = await stockAll();
    const order = await orders.create(branchId, cashierId, { type: 'TAKEAWAY', items: [{ menuItemId: item.combo, quantity: 1 }] });
    orderIds.push(order.id);
    expect(order.items[0].comboItems).toEqual(
      expect.arrayContaining([{ menuItemId: item.coke, name: `Test Fizz ${runId}`, quantity: FIZZ_SLOT, choiceGroup: 'Fizz' }]),
    );
    await expectStock(start, { dough: -150, coke: -4, sprite: 0, fanta: 0 });
  });

  it('rejects picks that do not add up or are not options', async () => {
    const order = (choices: { includedItemId: string; quantity: number }[]) =>
      orders.create(branchId, cashierId, { type: 'TAKEAWAY', items: [{ menuItemId: item.combo, quantity: 1, comboChoices: choices }] });
    await expect(order([{ includedItemId: item.coke, quantity: 3 }])).rejects.toThrow(/pick 4 in total/);
    await expect(order([{ includedItemId: item.pizza, quantity: 4 }])).rejects.toThrow(/not one of that combo/);
    await expect(
      orders.create(branchId, cashierId, { type: 'TAKEAWAY', items: [{ menuItemId: item.pizza, quantity: 1, comboChoices: [{ includedItemId: item.coke, quantity: 1 }] }] }),
    ).rejects.toThrow(/not a combo/);
  });

  it('logs a wasted combo as waste of its parts, with no net stock change', async () => {
    const preOrder = await stockAll();
    const order = await orders.create(branchId, cashierId, {
      type: 'TAKEAWAY',
      items: [
        { menuItemId: item.combo, quantity: 1, comboChoices: [{ includedItemId: item.sprite, quantity: 4 }] },
        { menuItemId: item.pizza, quantity: 1 },
      ],
    });
    orderIds.push(order.id);
    const line = order.items.find((i) => i.menuItemId === item.combo)!;
    await expectStock(preOrder, { dough: -300, coke: 0, sprite: -4, fanta: 0 }); // the sale has landed
    const start = await stockAll();
    await orders.voidItem(order.id, line.id, branchId, { reason: 'dropped', approverId: cashierId, logAsWaste: true, wasteReason: 'PREPARATION_ERROR' });
    const waste = await prisma.wasteLog.findMany({ where: { ingredientId: { in: Object.values(ing) }, notes: { contains: 'dropped' } } });
    const byIng = Object.fromEntries(waste.map((w) => [w.ingredientId, w.quantity.toNumber()]));
    expect(byIng).toEqual({ [ing.dough]: 150, [ing.sprite]: 4 });
    await expectStock(start, { dough: 0, coke: 0, sprite: 0, fanta: 0 });
  });

  it('un-marks a combo when its contents are cleared', async () => {
    const cleared = await menu.setComboItems(item.combo, branchId, []);
    expect(cleared.isCombo).toBe(false);
    expect(cleared.comboItems).toHaveLength(0);
  });
});
