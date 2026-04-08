import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function clearTransactions() {
  console.log('Clearing all transaction data...\n');

  await prisma.orderPayment.deleteMany({});          console.log('  ✓ Order payments');
  await prisma.orderItem.deleteMany({});              console.log('  ✓ Order items');
  await prisma.order.deleteMany({});                  console.log('  ✓ Orders');
  await prisma.stockMovement.deleteMany({});          console.log('  ✓ Stock movements');
  await prisma.wasteLog.deleteMany({});               console.log('  ✓ Waste logs');
  await prisma.expense.deleteMany({});                console.log('  ✓ Expenses');
  await prisma.accountTransaction.deleteMany({});     console.log('  ✓ Account transactions');
  await prisma.account.updateMany({ data: { balance: 0 } }); console.log('  ✓ Account balances → 0');
  await prisma.purchaseReturnItem.deleteMany({});
  await prisma.purchaseReturn.deleteMany({});         console.log('  ✓ Purchase returns');
  await prisma.purchaseOrderItem.deleteMany({});
  await prisma.purchaseOrder.deleteMany({});          console.log('  ✓ Purchase orders');
  await prisma.supplierPayment.deleteMany({});
  await prisma.supplier.updateMany({ data: { totalDue: 0 } }); console.log('  ✓ Supplier payments + dues → 0');
  await prisma.payrollPayment.deleteMany({});
  await prisma.payroll.deleteMany({});                console.log('  ✓ Payroll + payments');
  await prisma.attendance.deleteMany({});             console.log('  ✓ Attendance');
  await prisma.leaveApplication.deleteMany({});       console.log('  ✓ Leave applications');
  await prisma.workPeriod.deleteMany({});             console.log('  ✓ Work periods');
  await prisma.preReadyBatch.deleteMany({});
  await prisma.productionOrder.deleteMany({});        console.log('  ✓ Pre-ready batches + productions');
  await prisma.preReadyItem.updateMany({ data: { currentStock: 0 } }); console.log('  ✓ Pre-ready stock → 0');
  await prisma.ingredient.updateMany({ data: { currentStock: 0 } });   console.log('  ✓ Ingredient stock → 0');
  await prisma.diningTable.updateMany({ data: { status: 'AVAILABLE' } }); console.log('  ✓ Tables → AVAILABLE');

  console.log('\n✅ All transaction data cleared! Fresh start.');
}

clearTransactions()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => void prisma.$disconnect());
