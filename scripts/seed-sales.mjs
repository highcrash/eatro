/**
 * Seed mock sales data for several months.
 * Run: node scripts/seed-sales.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
let orderSeq = 0;
function generateOrderNumber(date) {
  const d = date.toISOString().slice(0, 10).replace(/-/g, '');
  orderSeq++;
  return `ORD-${d}-${String(orderSeq).padStart(5, '0')}`;
}

async function main() {
  const branch = await prisma.branch.findFirst();
  if (!branch) throw new Error('No branch found');

  const items = await prisma.menuItem.findMany({
    where: { branchId: branch.id, deletedAt: null, isAvailable: true },
    select: { id: true, name: true, price: true },
  });
  const staff = await prisma.staff.findMany({
    where: { branchId: branch.id, isActive: true, role: { in: ['CASHIER', 'OWNER', 'MANAGER'] } },
    select: { id: true },
  });
  const tables = await prisma.diningTable.findMany({
    where: { branchId: branch.id, deletedAt: null },
    select: { id: true, tableNumber: true },
  });

  const taxRate = Number(branch.taxRate) / 100; // e.g. 5 -> 0.05
  const paymentMethods = ['CASH', 'CASH', 'CASH', 'CARD', 'CARD', 'MFS', 'DIGITAL']; // weighted toward cash
  const orderTypes = ['DINE_IN', 'DINE_IN', 'DINE_IN', 'DINE_IN', 'TAKEAWAY', 'TAKEAWAY'];

  // Generate orders from Jan 2026 to Mar 2026 (3 months)
  const startDate = new Date('2026-01-01');
  const endDate = new Date('2026-03-31');

  let totalOrders = 0;
  const batchSize = 50;
  let orderBatch = [];
  let itemBatch = [];
  let paymentBatch = [];

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    // 15-40 orders per day
    const ordersPerDay = randomInt(15, 40);

    for (let i = 0; i < ordersPerDay; i++) {
      const hour = randomInt(10, 22);
      const minute = randomInt(0, 59);
      const second = randomInt(0, 59);
      const orderDate = new Date(d);
      orderDate.setHours(hour, minute, second, randomInt(0, 999));

      const type = randomChoice(orderTypes);
      const table = type === 'DINE_IN' ? randomChoice(tables) : null;
      const cashier = randomChoice(staff);
      const paymentMethod = randomChoice(paymentMethods);

      // 1-6 items per order
      const numItems = randomInt(1, 6);
      const chosenItems = [];
      for (let j = 0; j < numItems; j++) {
        const item = randomChoice(items);
        const existing = chosenItems.find((c) => c.id === item.id);
        if (existing) {
          existing.qty += 1;
        } else {
          chosenItems.push({ id: item.id, name: item.name, price: Number(item.price), qty: randomInt(1, 3) });
        }
      }

      const subtotal = chosenItems.reduce((s, c) => s + c.price * c.qty, 0);
      const taxAmount = Math.round(subtotal * taxRate);
      const totalAmount = subtotal + taxAmount;

      const orderId = `mock-${d.toISOString().slice(0, 10)}-${String(i).padStart(3, '0')}-${Date.now()}-${randomInt(100000, 999999)}`;
      const orderNumber = generateOrderNumber(orderDate);

      orderBatch.push({
        id: orderId,
        orderNumber,
        branchId: branch.id,
        cashierId: cashier.id,
        tableId: table?.id ?? null,
        tableNumber: table?.tableNumber ?? null,
        type,
        status: 'PAID',
        subtotal,
        taxAmount,
        discountAmount: 0,
        totalAmount,
        paymentMethod,
        paidAt: orderDate,
        createdAt: orderDate,
        updatedAt: orderDate,
      });

      for (const ci of chosenItems) {
        itemBatch.push({
          orderId,
          menuItemId: ci.id,
          menuItemName: ci.name,
          quantity: ci.qty,
          unitPrice: ci.price,
          totalPrice: ci.price * ci.qty,
          kitchenStatus: 'DONE',
          createdAt: orderDate,
          updatedAt: orderDate,
        });
      }

      paymentBatch.push({
        orderId,
        method: paymentMethod,
        amount: totalAmount,
        createdAt: orderDate,
      });

      totalOrders++;

      // Flush in batches
      if (orderBatch.length >= batchSize) {
        await prisma.order.createMany({ data: orderBatch, skipDuplicates: true });
        await prisma.orderItem.createMany({ data: itemBatch, skipDuplicates: true });
        await prisma.orderPayment.createMany({ data: paymentBatch, skipDuplicates: true });
        console.log(`  Flushed ${orderBatch.length} orders... (total: ${totalOrders})`);
        orderBatch = [];
        itemBatch = [];
        paymentBatch = [];
      }
    }
  }

  // Flush remaining
  if (orderBatch.length > 0) {
    await prisma.order.createMany({ data: orderBatch, skipDuplicates: true });
    await prisma.orderItem.createMany({ data: itemBatch, skipDuplicates: true });
    await prisma.orderPayment.createMany({ data: paymentBatch, skipDuplicates: true });
  }

  console.log(`\n✅ Seeded ${totalOrders} mock orders from ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
