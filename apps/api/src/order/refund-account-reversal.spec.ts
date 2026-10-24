import { Test } from '@nestjs/testing';
import { OrderModule } from './order.module';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../ws-gateway/realtime.gateway';
import { LicenseModule } from '../license/license.module';
import { LicenseService } from '../license/license.service';

/**
 * Regression test for the refund crash + account-corruption bug.
 *
 * Before the fix, refundOrder() reversed the account balance via
 * `updateAccountForPayment(..., 'REFUND' as never, ...)`. 'REFUND' is not a
 * member of the TransactionType enum, so accountTransaction.create() always
 * rejected — and because the call was `void`-fired with no `.catch`, that
 * unhandled rejection crashed the whole Node process. The balance update
 * (which ran first, and which added the refund instead of subtracting it,
 * since a negative amount was passed into a type whose delta is `-amount`
 * for non-SALE types) still committed, leaving the ledger permanently wrong
 * even though the API was now down.
 *
 * This test exercises the real refundOrder() against a real Postgres via a
 * dedicated, disposable test account — not the shared seed data — so
 * assertions on exact balance deltas can't be polluted by other activity on
 * the branch.
 */
describe('OrderService.refundOrder — account reversal', () => {
  let orderService: OrderService;
  let prisma: PrismaService;
  let moduleRefClose: () => Promise<void>;

  let branchId: string;
  const runId = Date.now().toString(36);

  let staffId: string;
  let menuItemId: string;
  let categoryId: string;
  let accountId: string;
  let paymentOptionCode: string;
  let orderId: string;
  let itemToRefundId: string;
  let priorBranchNbr: { nbrEnabled: boolean; bin: string | null; branchCode: string | null };

  const STARTING_BALANCE = 1_000_000; // paisa — arbitrary, just needs a known baseline
  const ITEM1_PRICE = 60_000; // the item we refund
  const ITEM2_PRICE = 40_000; // kept — proves this is a partial, not full, refund
  const TAX_RATE_PCT = 15;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // LicenseService is only resolvable via its own @Global() module —
      // Nest's module encapsulation means a provider declared directly on
      // this testing root isn't visible inside OrderModule's own injector
      // scope, so LicenseModule has to actually be imported, not stubbed
      // in via a bare `providers:` entry.
      imports: [OrderModule, LicenseModule],
    })
      // RealtimeGateway's @WebSocketServer() `server` is only wired up by a
      // real app.listen() — Test.createTestingModule() never starts one, so
      // emitToBranch()'s `this.server.to(...)` throws on `undefined`.
      // Unrelated to the bug under test; stub it out like a real Socket.IO
      // server would be, so refundOrder() can complete normally.
      .overrideProvider(RealtimeGateway)
      .useValue({
        emitToBranch: jest.fn(),
        emitToKds: jest.fn(),
        emitToOrder: jest.fn(),
        emitOrderUpdate: jest.fn(),
      })
      // Stub out the real license-check/scheduler logic (network calls,
      // license-file reads) — an unrelated concern to the bug under test.
      .overrideProvider(LicenseService)
      .useValue({ assertMutation: jest.fn() })
      .compile();
    orderService = moduleRef.get(OrderService);
    prisma = moduleRef.get(PrismaService);
    moduleRefClose = () => moduleRef.close();

    const branch = await prisma.branch.findFirstOrThrow();
    branchId = branch.id;
    priorBranchNbr = { nbrEnabled: branch.nbrEnabled, bin: branch.bin, branchCode: branch.branchCode };
    // refundOrder() requires NBR mode + a BIN/branchCode to issue the credit
    // note; the demo-light seed this branch ships without it. Restored in
    // afterAll.
    await prisma.branch.update({
      where: { id: branchId },
      data: { nbrEnabled: true, bin: '000123456-0101', branchCode: 'DHK' },
    });

    const owner = await prisma.staff.findFirstOrThrow({ where: { branchId, role: 'OWNER', isActive: true } });
    staffId = owner.id;

    const menuItem = await prisma.menuItem.findFirstOrThrow({ where: { branchId, deletedAt: null } });
    menuItemId = menuItem.id;

    // Dedicated account + payment option so the test's balance assertions
    // never touch the shared seed data's real CASH account.
    paymentOptionCode = `TEST_REFUND_${runId}`;
    const category = await prisma.paymentMethodConfig.create({
      data: { branchId, code: `TEST_CAT_${runId}`, name: 'Test Refund Category' },
    });
    categoryId = category.id;
    const account = await prisma.account.create({
      data: { branchId, type: 'CASH', name: `Test Refund Account ${runId}`, balance: STARTING_BALANCE },
    });
    accountId = account.id;
    await prisma.paymentOption.create({
      data: { branchId, categoryId, code: paymentOptionCode, name: 'Test Refund Option', accountId },
    });

    const subtotal = ITEM1_PRICE + ITEM2_PRICE;
    const taxAmount = Math.round(subtotal * (TAX_RATE_PCT / 100) * 100) / 100;
    const totalAmount = subtotal + taxAmount;

    const order = await prisma.order.create({
      data: {
        orderNumber: `TEST-REFUND-${runId}`,
        branchId,
        cashierId: staffId,
        type: 'DINE_IN',
        status: 'PAID',
        subtotal,
        taxAmount,
        totalAmount,
        paidAt: new Date(),
        paymentMethod: paymentOptionCode,
        items: {
          create: [
            { menuItemId, menuItemName: 'Test Item 1 (refunded)', quantity: 1, unitPrice: ITEM1_PRICE, totalPrice: ITEM1_PRICE },
            { menuItemId, menuItemName: 'Test Item 2 (kept)', quantity: 1, unitPrice: ITEM2_PRICE, totalPrice: ITEM2_PRICE },
          ],
        },
        payments: {
          create: [{ method: paymentOptionCode, amount: totalAmount }],
        },
      },
      include: { items: true },
    });
    orderId = order.id;
    itemToRefundId = order.items.find((i) => i.totalPrice.toNumber() === ITEM1_PRICE)!.id;

    await prisma.mushakInvoice.create({
      data: {
        branchId,
        orderId,
        serial: `TEST-INV-${runId}`,
        fiscalYear: `TEST-${runId}`,
        branchCode: 'DHK',
        seq: 1,
        subtotalExclVat: subtotal,
        vatAmount: taxAmount,
        totalInclVat: totalAmount,
        snapshot: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.mushakNote.deleteMany({ where: { orderId } });
    await prisma.mushakInvoice.deleteMany({ where: { orderId } });
    await prisma.accountTransaction.deleteMany({ where: { accountId } });
    await prisma.orderPayment.deleteMany({ where: { orderId } });
    await prisma.orderItem.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.paymentOption.deleteMany({ where: { branchId, code: paymentOptionCode } });
    await prisma.account.deleteMany({ where: { id: accountId } });
    await prisma.paymentMethodConfig.deleteMany({ where: { id: categoryId } });
    await prisma.branch.update({ where: { id: branchId }, data: priorBranchNbr });
    await moduleRefClose();
  });

  it('refunds one item without throwing, and settles the account balance correctly', async () => {
    const result = await orderService.refundOrder(orderId, branchId, staffId, {
      itemIds: [itemToRefundId],
      reason: 'CUSTOMER_RETURN',
    });

    // Order + credit note are unchanged by this bug — confirm they still work.
    expect(result.order.status).toBe('PARTIALLY_REFUNDED'); // one of two items refunded
    expect(result.note.noteType).toBe('CREDIT');

    const expectedRefundVat = Math.round((ITEM1_PRICE / (ITEM1_PRICE + ITEM2_PRICE)) * (ITEM1_PRICE + ITEM2_PRICE) * (TAX_RATE_PCT / 100) * 100) / 100;
    const expectedRefundTotal = ITEM1_PRICE + expectedRefundVat;

    // The account reversal is deliberately fire-and-forget (non-blocking)
    // inside refundOrder, so poll briefly for its effect instead of
    // asserting immediately. reverseSalePosting() updates the balance and
    // THEN creates the AccountTransaction row as two sequential awaits —
    // poll on the transaction row (its last step), not the balance (its
    // first), or this can race and observe the balance changed but the
    // transaction row not yet committed.
    const transactions = await waitFor(
      () => prisma.accountTransaction.findMany({ where: { accountId } }),
      (rows) => rows.length > 0,
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe('ADJUSTMENT');
    expect(transactions[0].amount.toNumber()).toBe(-expectedRefundTotal);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.balance.toNumber()).toBe(STARTING_BALANCE - expectedRefundTotal);
  });
});

async function waitFor<T>(fetch: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5000, intervalMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await fetch();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    value = await fetch();
  }
  return value;
}
