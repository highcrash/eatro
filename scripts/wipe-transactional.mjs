/**
 * Wipe transactional data for ALL branches.
 *
 * KEEPS:
 *   - Branch, BranchSetting, PaymentMethodConfig/Option, CookingStation
 *   - Staff (Users)
 *   - MenuCategory, MenuItem, ComboItem, LinkedItem
 *   - Recipe, RecipeItem, PreReadyItem, PreReadyRecipe(Item)
 *   - Ingredient, IngredientSupplier, UnitConversion
 *   - DiningTable (status reset)
 *   - Supplier (balances zeroed)
 *   - Account (balance zeroed)
 *   - Discount, Coupon, MenuItemDiscount
 *
 * DELETES (transactional):
 *   - Order, OrderItem, OrderPayment
 *   - Customer, Review
 *   - Expense
 *   - AccountTransaction
 *   - StockMovement
 *   - ProductionOrder, PreReadyBatch
 *   - PurchaseOrder(Item), PurchaseReturn(Item)
 *   - SupplierPayment
 *   - Attendance, Payroll, PayrollPayment, LeaveApplication
 *   - WasteLog
 *   - WorkPeriod
 *
 * RESETS:
 *   - Account.balance         → 0
 *   - Ingredient.stock        → 0
 *   - Supplier.openingBalance → 0
 *   - Supplier.totalDue       → 0
 *   - DiningTable.status      → AVAILABLE
 *
 * Run:  node scripts/wipe-transactional.mjs --yes
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  if (!process.argv.includes('--yes')) {
    console.log('Refusing to run without --yes flag.');
    console.log('Usage:  node scripts/wipe-transactional.mjs --yes');
    process.exit(1);
  }

  console.log('\n=== WIPING TRANSACTIONAL DATA (all branches) ===\n');

  // 1. Reviews (FK to both Order and Customer) — must go before Order/Customer
  await prisma.review.deleteMany({});                 console.log('  ✓ Review');

  // 2. Order graph (children → parents)
  await prisma.orderPayment.deleteMany({});           console.log('  ✓ OrderPayment');
  await prisma.orderItem.deleteMany({});              console.log('  ✓ OrderItem');
  await prisma.order.deleteMany({});                  console.log('  ✓ Order');

  // 3. Customers
  await prisma.customer.deleteMany({});               console.log('  ✓ Customer');

  // 3. Stock & inventory history
  await prisma.stockMovement.deleteMany({});          console.log('  ✓ StockMovement');
  await prisma.wasteLog.deleteMany({});               console.log('  ✓ WasteLog');

  // 4. Pre-ready batches & production
  await prisma.preReadyBatch.deleteMany({});          console.log('  ✓ PreReadyBatch');
  await prisma.productionOrder.deleteMany({});        console.log('  ✓ ProductionOrder');

  // 5. Purchasing
  await prisma.purchaseReturnItem.deleteMany({});     console.log('  ✓ PurchaseReturnItem');
  await prisma.purchaseReturn.deleteMany({});         console.log('  ✓ PurchaseReturn');
  await prisma.purchaseOrderItem.deleteMany({});      console.log('  ✓ PurchaseOrderItem');
  await prisma.purchaseOrder.deleteMany({});          console.log('  ✓ PurchaseOrder');
  await prisma.supplierPayment.deleteMany({});        console.log('  ✓ SupplierPayment');

  // 6. Finance
  await prisma.expense.deleteMany({});                console.log('  ✓ Expense');
  await prisma.accountTransaction.deleteMany({});     console.log('  ✓ AccountTransaction');

  // 7. HR / payroll / attendance
  await prisma.payrollPayment.deleteMany({});         console.log('  ✓ PayrollPayment');
  await prisma.payroll.deleteMany({});                console.log('  ✓ Payroll');
  await prisma.attendance.deleteMany({});             console.log('  ✓ Attendance');
  await prisma.leaveApplication.deleteMany({});       console.log('  ✓ LeaveApplication');

  // 8. Work periods
  await prisma.workPeriod.deleteMany({});             console.log('  ✓ WorkPeriod');

  console.log('\n=== RESETTING BALANCES ===\n');

  // 9. Reset balances / stock / table status
  const acc = await prisma.account.updateMany({ data: { balance: 0 } });
  console.log(`  ✓ Account.balance        = 0  (${acc.count} rows)`);

  const ing = await prisma.ingredient.updateMany({ data: { currentStock: 0 } });
  console.log(`  ✓ Ingredient.currentStock = 0  (${ing.count} rows)`);

  const sup = await prisma.supplier.updateMany({ data: { openingBalance: 0, totalDue: 0 } });
  console.log(`  ✓ Supplier balances       = 0  (${sup.count} rows)`);

  const tbl = await prisma.diningTable.updateMany({ data: { status: 'AVAILABLE' } });
  console.log(`  ✓ DiningTable.status      = AVAILABLE  (${tbl.count} rows)`);

  console.log('\n=== DONE ===\n');
}

main()
  .catch((e) => {
    console.error('\nFAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
