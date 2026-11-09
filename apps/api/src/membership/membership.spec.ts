import { ExecutionContext, INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { JwtPayload } from '@restora/types';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrderModule } from '../order/order.module';
import { OrderService } from '../order/order.service';
import { PrismaService } from '../prisma/prisma.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { buildCardNumber, formatCardNumber, isValidCardNumber, normalizeCardNumber } from './membership-number';
import { memberDiscount } from './membership-discount';
import { MembershipModule } from './membership.module';
import { MembershipService } from './membership.service';

/**
 * Pre-printed membership cards against the local dev Postgres with
 * disposable fixtures: 10% by default, a combo category excluded, Water
 * excluded through its parent dish, one item at a member-only 20%.
 */
jest.setTimeout(30_000);

describe('Membership card numbers', () => {
  it('builds 16 digits with the prefix, serial and a valid check digit', () => {
    const n = buildCardNumber(1, () => 4829173);
    expect(n).toMatch(/^328700014829173\d$/);
    expect(isValidCardNumber(n)).toBe(true);
    expect(formatCardNumber(n)).toBe(`3287 0001 4829 173${n[15]}`);
    expect(normalizeCardNumber(formatCardNumber(n))).toBe(n);
  });

  it('catches a single mistyped digit and a wrong prefix or length', () => {
    const n = buildCardNumber(12, () => 7654321);
    for (let i = 4; i < 16; i++) {
      const wrong = n.slice(0, i) + String((Number(n[i]) + 1) % 10) + n.slice(i + 1);
      expect(isValidCardNumber(wrong)).toBe(false);
    }
    expect(isValidCardNumber(`1234${n.slice(4)}`)).toBe(false);
    expect(isValidCardNumber(n.slice(0, 15))).toBe(false);
  });
});

describe('memberDiscount', () => {
  const line = (over: Partial<Parameters<typeof memberDiscount>[2][number]>) => ({
    menuItemId: 'x', quantity: 1, totalPrice: 10_000, variantParentId: null, categoryId: 'food', parentCategoryId: null, ...over,
  });
  const exclude = (t: { menuItemId?: string; categoryId?: string }) => ({ menuItemId: t.menuItemId ?? null, categoryId: t.categoryId ?? null, kind: 'EXCLUDE' as const, type: null, value: null });

  it('applies the default percent with no rule', () => {
    expect(memberDiscount(10, [], [line({})])).toBe(1_000);
  });

  it('excludes by item, parent dish, category and parent category', () => {
    expect(memberDiscount(10, [exclude({ menuItemId: 'x' })], [line({})])).toBe(0);
    expect(memberDiscount(10, [exclude({ menuItemId: 'water' })], [line({ variantParentId: 'water' })])).toBe(0);
    expect(memberDiscount(10, [exclude({ categoryId: 'food' })], [line({})])).toBe(0);
    expect(memberDiscount(10, [exclude({ categoryId: 'top' })], [line({ parentCategoryId: 'top' })])).toBe(0);
  });

  it('lets an item rule beat its category rule', () => {
    const rules = [exclude({ categoryId: 'food' }), { menuItemId: 'x', categoryId: null, kind: 'SPECIAL' as const, type: 'PERCENTAGE' as const, value: 20 }];
    expect(memberDiscount(10, rules, [line({})])).toBe(2_000);
  });

  it('takes a flat member rate per unit, never more than the line', () => {
    const rule = (value: number) => [{ menuItemId: 'x', categoryId: null, kind: 'SPECIAL' as const, type: 'FLAT' as const, value }];
    expect(memberDiscount(10, rule(500), [line({ quantity: 3, totalPrice: 30_000 })])).toBe(1_500);
    expect(memberDiscount(10, rule(50_000), [line({})])).toBe(10_000);
  });
});

describe('Membership cards — issue and use', () => {
  let orders: OrderService;
  let membership: MembershipService;
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let user: JwtPayload;
  let app: INestApplication;
  let origin: string;

  const branchId = 'branch-main';
  const runId = Date.now().toString(36);
  // Valid-format numbers unique to this run, so re-runs don't collide.
  const phoneTail = String(Date.now()).slice(-8);
  const phones = [`017${phoneTail}`, `018${phoneTail}`, `019${phoneTail}`, `016${phoneTail}`, `015${phoneTail}`];
  let planId: string;
  let foodCat: string;
  let comboCat: string;
  const item: Record<'food' | 'combo' | 'waterShell' | 'waterBottle' | 'special', string> = { food: '', combo: '', waterShell: '', waterBottle: '', special: '' };
  const orderIds: string[] = [];

  const newOrder = async (lines: { menuItemId: string; quantity: number }[]) => {
    const o = await orders.create(branchId, user.sub, { type: 'TAKEAWAY', items: lines });
    orderIds.push(o.id);
    return o;
  };
  const generate = async (quantity = 1) => membership.generateCards(branchId, { planId, quantity }, user);
  const issued = async (phoneIdx: number, name = 'Test Member') => {
    const [card] = await generate();
    await membership.activate(branchId, { number: card.number, phone: phones[phoneIdx], name }, user);
    return card;
  };
  const clearCustomer = async (phoneIdx: number) => {
    await prisma.membershipCard.updateMany({ where: { planId, customer: { phone: phones[phoneIdx] } }, data: { status: 'BLOCKED' } });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [OrderModule, MembershipModule] })
      .overrideProvider(RestoraPosGateway)
      .useValue({ emitToBranch: jest.fn(), emitToKds: jest.fn(), emitToOrder: jest.fn(), emitOrderUpdate: jest.fn() })
      // The real RolesGuard still runs; this only says who is calling.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { ...user, role: req.headers['x-test-role'] };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    orders = moduleRef.get(OrderService);
    membership = moduleRef.get(MembershipService);
    prisma = moduleRef.get(PrismaService);
    close = () => moduleRef.close();

    const owner = await prisma.staff.findFirstOrThrow({ where: { branchId, role: 'OWNER', isActive: true } });
    user = { sub: owner.id, role: 'OWNER', branchId } as JwtPayload;

    foodCat = (await prisma.menuCategory.create({ data: { branchId, name: `Test Member Food ${runId}` } })).id;
    comboCat = (await prisma.menuCategory.create({ data: { branchId, name: `Test Member Combos ${runId}` } })).id;
    const mk = async (name: string, price: number, categoryId: string, extra: object = {}) =>
      (await prisma.menuItem.create({ data: { branchId, categoryId, name: `Test ${name} ${runId}`, type: 'FOOD', price, ...extra } })).id;
    item.food = await mk('Pasta', 40_000, foodCat);
    item.combo = await mk('Combo', 100_000, comboCat);
    item.special = await mk('Iced Latte', 30_000, foodCat);
    item.waterShell = await mk('Water', 0, foodCat, { isVariantParent: true });
    item.waterBottle = await mk('Water 500ml', 3_000, foodCat, { variantParentId: item.waterShell });

    const plan = await membership.createPlan(branchId, { name: `Test Member ${runId}`, discountPercent: 10, validityMonths: 12 });
    planId = plan.id;
    await membership.setRules(planId, branchId, [
      { categoryId: comboCat, kind: 'EXCLUDE' },
      { menuItemId: item.waterShell, kind: 'EXCLUDE' },
      { menuItemId: item.special, kind: 'SPECIAL', type: 'PERCENTAGE', value: 20 },
    ]);
  });

  afterAll(async () => {
    const itemIds = Object.values(item).filter(Boolean);
    const cards = await prisma.membershipCard.findMany({ where: { planId }, select: { id: true } });
    const customers = await prisma.customer.findMany({ where: { branchId, phone: { in: phones } }, select: { id: true } });
    await prisma.activityLog.deleteMany({ where: { entityId: { in: [...cards.map((c) => c.id), planId, ...orderIds] } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.membershipCard.updateMany({ where: { planId }, data: { replacedById: null } });
    await prisma.membershipCard.deleteMany({ where: { planId } });
    await prisma.membershipPlan.deleteMany({ where: { id: planId } });
    await prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } });
    await prisma.menuItem.deleteMany({ where: { id: { in: [item.waterBottle] } } });
    await prisma.menuItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.menuCategory.deleteMany({ where: { id: { in: [foodCat, comboCat] } } });
    await app.close();
    await close();
  });

  it('lets cashiers give and use cards over HTTP, but only owner/manager run them', async () => {
    const call = async (method: string, path: string, role: string, body?: unknown) => {
      const res = await fetch(`${origin}/api/v1${path}`, {
        method,
        headers: { 'x-test-role': role, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { status: res.status, body: (await res.json().catch(() => null)) as any };
    };

    expect((await call('GET', '/membership/cards', 'CASHIER')).status).toBe(403);
    expect((await call('POST', '/membership/cards/generate', 'CASHIER', { planId, quantity: 1 })).status).toBe(403);
    expect((await call('PUT', `/membership/plans/${planId}/rules`, 'CASHIER', { rules: [] })).status).toBe(403);

    const made = await call('POST', '/membership/cards/generate', 'MANAGER', { planId, quantity: 1, batchLabel: 'http' });
    expect(made.status).toBe(201);
    const number: string = made.body[0].number;

    const given = await call('POST', '/membership/cards/activate', 'CASHIER', { number, phone: phones[4], name: 'Over Http' });
    expect(given.status).toBe(201);
    expect(given.body.member.name).toBe('Over Http');

    const order = await newOrder([{ menuItemId: item.food, quantity: 1 }]);
    expect((await call('POST', `/orders/${order.id}/apply-membership`, 'WAITER', { number })).status).toBe(403);
    const applied = await call('POST', `/orders/${order.id}/apply-membership`, 'CASHIER', { number: formatCardNumber(number) });
    expect(applied.status).toBe(201);
    expect(Number(applied.body.order.discountAmount)).toBe(4_000);

    const list = await call('GET', '/membership/cards', 'OWNER');
    expect(list.status).toBe(200);
    expect(list.body.find((c: { number: string }) => c.number === number)).toMatchObject({ state: 'ACTIVE', activatedByName: expect.any(String) });
    await clearCustomer(4);
  });

  it('generates unique in-stock cards with consecutive serials', async () => {
    const cards = await generate(5);
    expect(new Set(cards.map((c) => c.number)).size).toBe(5);
    expect(cards.every((c) => c.state === 'IN_STOCK' && isValidCardNumber(c.number))).toBe(true);
    cards.forEach((c, i) => expect(c.serial).toBe(cards[0].serial + i));
    await expect(membership.generateCards(branchId, { planId, quantity: 0 }, user)).rejects.toThrow(/Quantity/);
  });

  it('refuses a card that has not been given out, and a mistyped number', async () => {
    const [card] = await generate();
    const order = await newOrder([{ menuItemId: item.food, quantity: 1 }]);
    await expect(orders.applyMembership(order.id, branchId, card.number)).rejects.toThrow(/CARD_NOT_ACTIVE/);
    const wrong = card.number.slice(0, 15) + String((Number(card.number[15]) + 1) % 10);
    await expect(orders.applyMembership(order.id, branchId, wrong)).rejects.toThrow(/CARD_INVALID/);
  });

  it('hands a card to a new customer for 12 months, one active card each', async () => {
    const [card, spare] = await generate(2);
    const { card: active, member } = await membership.activate(branchId, { number: formatCardNumber(card.number), phone: phones[0], name: 'Rahim' }, user);
    expect(active.state).toBe('ACTIVE');
    expect(active.customer).toMatchObject({ name: 'Rahim', phone: phones[0] });
    expect(member.maskedPhone).toBe(`${phones[0].slice(0, 3)}••••${phones[0].slice(-4)}`);
    const months = (new Date(active.expiresAt!).getFullYear() - new Date().getFullYear()) * 12 + new Date(active.expiresAt!).getMonth() - new Date().getMonth();
    expect(months).toBe(12);
    await expect(membership.activate(branchId, { number: spare.number, phone: phones[0] }, user)).rejects.toThrow(/CUSTOMER_HAS_CARD/);
    await expect(membership.activate(branchId, { number: card.number, phone: phones[1] }, user)).rejects.toThrow(/CARD_ALREADY_USED/);
    await clearCustomer(0);
  });

  it('applies the rules, attaches the member and names the card on the bill', async () => {
    const card = await issued(1, 'Karim');
    const order = await newOrder([
      { menuItemId: item.food, quantity: 1 }, // 10% of 400
      { menuItemId: item.combo, quantity: 1 }, // excluded
      { menuItemId: item.waterBottle, quantity: 2 }, // excluded via Water
      { menuItemId: item.special, quantity: 1 }, // 20% of 300
    ]);
    const { order: updated, member } = await orders.applyMembership(order.id, branchId, card.number);
    expect(Number(updated.discountAmount)).toBe(4_000 + 6_000);
    expect(updated.customerName).toBe('Karim');
    expect(updated.discountName).toBe(`Test Member ${runId} (•••• ${card.number.slice(-4)})`);
    expect(updated.membershipCardCode).toBe(formatCardNumber(card.number));
    expect(member.name).toBe('Karim');
  });

  it('rescales when items are added or voided, and stays exclusive with a coupon', async () => {
    const card = await issued(2);
    const order = await newOrder([{ menuItemId: item.food, quantity: 1 }]);
    await orders.applyMembership(order.id, branchId, card.number);

    const added = await orders.addItemsToOrder(order.id, branchId, [{ menuItemId: item.food, quantity: 1 }, { menuItemId: item.combo, quantity: 1 }]);
    expect(Number(added.discountAmount)).toBe(8_000);

    await expect(orders.applyCoupon(order.id, branchId, 'ANY')).rejects.toThrow(/member card/);
    const combo = added.items.find((i) => i.menuItemId === item.combo)!;
    const voided = await orders.voidItem(order.id, combo.id, branchId, { reason: 'test', approverId: user.sub } as never);
    expect(Number(voided.discountAmount)).toBe(8_000);
    const line = added.items.find((i) => i.menuItemId === item.food && i.id !== combo.id)!;
    const after = await orders.voidItem(order.id, line.id, branchId, { reason: 'test', approverId: user.sub } as never);
    expect(Number(after.discountAmount)).toBe(4_000);

    const removed = await orders.removeDiscount(order.id, branchId);
    expect(Number(removed.discountAmount)).toBe(0);
    expect(removed.membershipCardId).toBeNull();
    await clearCustomer(2);
  });

  it('refuses blocked and expired cards; renew brings a card back', async () => {
    const card = await issued(3);
    const order = await newOrder([{ menuItemId: item.food, quantity: 1 }]);

    await prisma.membershipCard.update({ where: { number: card.number }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
    await expect(orders.applyMembership(order.id, branchId, card.number)).rejects.toThrow(/CARD_EXPIRED/);
    const list = await membership.listCards(branchId);
    expect(list.find((c) => c.id === card.id)?.state).toBe('EXPIRED');

    const renewed = await membership.renew(card.id, branchId, user);
    expect(new Date(renewed.expiresAt!).getTime()).toBeGreaterThan(Date.now());
    expect((await orders.applyMembership(order.id, branchId, card.number)).order.membershipCardId).toBe(card.id);
    await orders.removeDiscount(order.id, branchId);

    await membership.block(card.id, branchId, 'Lost', user);
    await expect(orders.applyMembership(order.id, branchId, card.number)).rejects.toThrow(/CARD_BLOCKED/);
    const back = await membership.unblock(card.id, branchId, user);
    expect(back.state).toBe('ACTIVE');
  });

  it('moves a member to a new card with the same expiry', async () => {
    const old = (await prisma.membershipCard.findFirstOrThrow({ where: { planId, customer: { phone: phones[3] }, status: 'ACTIVE' } }));
    const [fresh] = await generate();
    const moved = await membership.replace(old.id, branchId, fresh.number, user);
    expect(moved.state).toBe('ACTIVE');
    expect(moved.expiresAt).toBe(old.expiresAt!.toISOString());
    expect(moved.customer?.phone).toBe(phones[3]);
    const order = await newOrder([{ menuItemId: item.food, quantity: 1 }]);
    await expect(orders.applyMembership(order.id, branchId, old.number)).rejects.toThrow(/CARD_BLOCKED/);
    await expect(membership.unblock(old.id, branchId, user)).rejects.toThrow(/replaced/);
  });
});
