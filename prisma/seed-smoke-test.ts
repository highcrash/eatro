/**
 * Smoke Test Seed — Realistic fine-dining restaurant data
 *
 * Run after base seed: pnpm tsx prisma/seed-smoke-test.ts
 *
 * Creates:
 * - Ingredient variants (brand-specific bread, oil, dairy, etc.)
 * - Pre-ready items with recipes (sauces, keema, dough, stocks)
 * - Full recipes for 15+ menu items
 * - 30 days of orders (20-50K BDT daily)
 * - Customers with order history
 * - Purchase orders with receiving
 * - Account transactions
 * - Expenses, attendance, waste logs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BRANCH = 'branch-main';
const OWNER = 'staff-owner';
const MANAGER = 'staff-manager';
const CASHIER = 'staff-cashier';

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[rand(0, arr.length - 1)]; }
function paisa(taka: number) { return Math.round(taka * 100); }

async function main() {
  console.warn('🔧 Smoke Test Seed — Fine Dining Restaurant Data\n');

  // ── 1. Convert key ingredients to parent + create variants ────────────

  const variantParents = [
    { name: 'Sandwich Bread', purchaseUnit: 'PACK', variants: [
      { brandName: 'Milk Butter', packSize: '250G', piecesPerPack: 10, cost: 85 },
      { brandName: 'Bread Pit White', packSize: '260G', piecesPerPack: 12, cost: 95 },
      { brandName: 'Cooper\'s Whole Wheat', packSize: '400G', piecesPerPack: 16, cost: 130 },
    ]},
    { name: 'Milk Bread', purchaseUnit: 'PACK', variants: [
      { brandName: 'Farm Fresh', packSize: '300G', piecesPerPack: 8, cost: 70 },
      { brandName: 'Pran', packSize: '350G', piecesPerPack: 10, cost: 80 },
    ]},
    { name: 'Soybean Oil', purchaseUnit: 'BOTTLE', variants: [
      { brandName: 'Teer', packSize: '1L', piecesPerPack: 1000, cost: 180 },
      { brandName: 'Fresh', packSize: '5L', piecesPerPack: 5000, cost: 850 },
      { brandName: 'Rupchanda', packSize: '2L', piecesPerPack: 2000, cost: 340 },
    ]},
    { name: 'Butter', purchaseUnit: 'PACK', variants: [
      { brandName: 'Aarong', packSize: '200G', piecesPerPack: 200, cost: 280 },
      { brandName: 'Danish', packSize: '500G', piecesPerPack: 500, cost: 620 },
    ]},
    { name: 'Cheddar Cheese', purchaseUnit: 'PACK', variants: [
      { brandName: 'PUCK', packSize: '200G', piecesPerPack: 200, cost: 350 },
      { brandName: 'Kiri', packSize: '400G', piecesPerPack: 400, cost: 580 },
    ]},
    { name: 'Fresh Milk', purchaseUnit: 'PACK', variants: [
      { brandName: 'Aarong', packSize: '1L', piecesPerPack: 1000, cost: 90 },
      { brandName: 'Farm Fresh', packSize: '500ML', piecesPerPack: 500, cost: 50 },
    ]},
    { name: 'Chicken Breast', purchaseUnit: 'KG', variants: [
      { brandName: 'Kazi Farms', packSize: '1KG', piecesPerPack: 1000, cost: 380 },
      { brandName: 'CP', packSize: '2KG', piecesPerPack: 2000, cost: 720 },
    ]},
  ];

  let variantsCreated = 0;
  for (const vp of variantParents) {
    const parent = await prisma.ingredient.findFirst({
      where: { branchId: BRANCH, name: vp.name, deletedAt: null },
    });
    if (!parent) { console.warn(`  ⚠ "${vp.name}" not found — skipping`); continue; }

    // Convert to parent
    if (!parent.hasVariants) {
      await prisma.ingredient.update({ where: { id: parent.id }, data: { hasVariants: true, purchaseUnit: vp.purchaseUnit } });

      // Move existing stock to a "Default" variant
      if (parent.currentStock.toNumber() > 0) {
        await prisma.ingredient.create({
          data: {
            branchId: BRANCH, parentId: parent.id, name: `${parent.name} — Default`, brandName: 'Default',
            unit: parent.unit, category: parent.category, purchaseUnit: vp.purchaseUnit,
            purchaseUnitQty: parent.purchaseUnitQty, currentStock: parent.currentStock,
            costPerUnit: parent.costPerUnit, costPerPurchaseUnit: parent.costPerPurchaseUnit,
            supplierId: parent.supplierId,
          },
        });
      }
    }

    // Create brand variants
    for (const v of vp.variants) {
      const exists = await prisma.ingredient.findFirst({
        where: { parentId: parent.id, brandName: v.brandName, deletedAt: null },
      });
      if (exists) continue;

      const costPerUnit = Math.round(paisa(v.cost) / v.piecesPerPack);
      await prisma.ingredient.create({
        data: {
          branchId: BRANCH, parentId: parent.id,
          name: `${parent.name} — ${v.brandName}`,
          brandName: v.brandName, packSize: v.packSize, piecesPerPack: v.piecesPerPack,
          unit: parent.unit, category: parent.category, purchaseUnit: vp.purchaseUnit,
          purchaseUnitQty: v.piecesPerPack, costPerUnit, costPerPurchaseUnit: paisa(v.cost),
          currentStock: rand(10, 200),
        },
      });
      variantsCreated++;
    }

    // Sync parent aggregate
    const variants = await prisma.ingredient.findMany({ where: { parentId: parent.id, deletedAt: null } });
    let totalStock = 0, totalValue = 0;
    for (const vr of variants) { const s = vr.currentStock.toNumber(); totalStock += s; totalValue += s * vr.costPerUnit.toNumber(); }
    const avgCost = totalStock > 0 ? totalValue / totalStock : 0;
    await prisma.ingredient.update({ where: { id: parent.id }, data: { currentStock: totalStock, costPerUnit: avgCost, minimumStock: 20 } });
  }
  console.warn(`✅ ${variantsCreated} ingredient variants created`);

  // ── 2. Pre-Ready Items (Sauces, Keema, Stocks, Dough) ────────────────

  const preReadyDefs = [
    { name: 'Tomato Basil Sauce', unit: 'ML', minStock: 500, ingredients: ['Tomato', 'Basil Leaf', 'Garlic', 'Olive Oil', 'Salt', 'Black Pepper'] },
    { name: 'Béchamel Sauce', unit: 'ML', minStock: 300, ingredients: ['Butter', 'All Purpose Flour', 'Fresh Milk', 'Salt', 'Nutmeg Powder'] },
    { name: 'BBQ Sauce', unit: 'ML', minStock: 400, ingredients: ['Tomato Ketchup', 'Brown Sugar', 'Vinegar', 'Garlic', 'Onion'] },
    { name: 'Chicken Keema', unit: 'G', minStock: 500, ingredients: ['Chicken Breast', 'Onion', 'Garlic', 'Ginger', 'Green Chilli', 'Salt', 'Turmeric Powder'] },
    { name: 'Beef Keema', unit: 'G', minStock: 300, ingredients: ['Beef Mince', 'Onion', 'Garlic', 'Ginger', 'Cumin Powder', 'Salt'] },
    { name: 'Pizza Dough', unit: 'G', minStock: 1000, ingredients: ['All Purpose Flour', 'Yeast', 'Salt', 'Sugar', 'Olive Oil'] },
    { name: 'Chicken Stock', unit: 'ML', minStock: 1000, ingredients: ['Chicken Breast', 'Onion', 'Carrot', 'Celery', 'Salt', 'Bay Leaf'] },
    { name: 'Garlic Butter', unit: 'G', minStock: 200, ingredients: ['Butter', 'Garlic', 'Parsley'] },
  ];

  let preReadyCount = 0;
  for (const pr of preReadyDefs) {
    const exists = await prisma.preReadyItem.findFirst({ where: { branchId: BRANCH, name: pr.name } });
    if (exists) continue;

    const item = await prisma.preReadyItem.create({
      data: { branchId: BRANCH, name: pr.name, unit: pr.unit as any, minimumStock: pr.minStock, currentStock: rand(200, 2000) },
    });

    // Create recipe
    const recipeIngredients: { ingredientId: string; quantity: number; unit: string }[] = [];
    for (const ingName of pr.ingredients) {
      const ing = await prisma.ingredient.findFirst({
        where: { branchId: BRANCH, name: { contains: ingName }, deletedAt: null, parentId: null },
      });
      if (ing) recipeIngredients.push({ ingredientId: ing.id, quantity: rand(10, 100), unit: ing.unit });
    }

    if (recipeIngredients.length > 0) {
      const recipe = await prisma.preReadyRecipe.create({
        data: { preReadyItemId: item.id, yieldQuantity: rand(500, 2000), yieldUnit: pr.unit as any },
      });
      for (const ri of recipeIngredients) {
        await prisma.preReadyRecipeItem.create({
          data: { recipeId: recipe.id, ingredientId: ri.ingredientId, quantity: ri.quantity, unit: ri.unit as any },
        });
      }
    }
    preReadyCount++;
  }
  console.warn(`✅ ${preReadyCount} pre-ready items with recipes`);

  // ── 3. Menu Item Recipes (link more items to ingredients) ─────────────

  const recipeDefs: Record<string, { name: string; qty: number }[]> = {
    'Butter Chicken': [
      { name: 'Chicken Breast', qty: 250 }, { name: 'Butter', qty: 50 }, { name: 'Tomato', qty: 100 },
      { name: 'Cream', qty: 30 }, { name: 'Garlic', qty: 10 }, { name: 'Ginger', qty: 10 },
      { name: 'Cumin Powder', qty: 5 }, { name: 'Turmeric Powder', qty: 3 }, { name: 'Salt', qty: 5 },
    ],
    'Grilled Salmon': [
      { name: 'Salmon Fillet', qty: 200 }, { name: 'Lemon', qty: 20 }, { name: 'Olive Oil', qty: 15 },
      { name: 'Garlic', qty: 5 }, { name: 'Salt', qty: 3 }, { name: 'Black Pepper', qty: 2 },
    ],
    'Caesar Salad': [
      { name: 'Lettuce', qty: 100 }, { name: 'Cheddar Cheese', qty: 30 },
      { name: 'Bread Crumbs White', qty: 20 }, { name: 'Lemon', qty: 10 }, { name: 'Olive Oil', qty: 10 },
    ],
    'Chicken Fried Rice': [
      { name: 'Chicken Breast', qty: 150 }, { name: 'Rice', qty: 200 },
      { name: 'Soybean Oil', qty: 20 }, { name: 'Onion', qty: 30 }, { name: 'Garlic', qty: 5 },
      { name: 'Soy Sauce', qty: 15 }, { name: 'Salt', qty: 3 },
    ],
    'Beef Burger': [
      { name: 'Beef Mince', qty: 200 }, { name: 'Burger Bun', qty: 1 },
      { name: 'Lettuce', qty: 20 }, { name: 'Tomato', qty: 30 }, { name: 'Cheddar Cheese', qty: 25 },
      { name: 'Onion', qty: 15 },
    ],
    'Pasta Carbonara': [
      { name: 'Pasta', qty: 200 }, { name: 'Cream', qty: 50 }, { name: 'Cheddar Cheese', qty: 30 },
      { name: 'Garlic', qty: 5 }, { name: 'Black Pepper', qty: 3 }, { name: 'Salt', qty: 3 },
    ],
    'Tom Yum Soup': [
      { name: 'Prawn', qty: 100 }, { name: 'Mushroom', qty: 50 }, { name: 'Lemon', qty: 15 },
      { name: 'Green Chilli', qty: 5 }, { name: 'Garlic', qty: 5 }, { name: 'Salt', qty: 3 },
    ],
    'Cappuccino': [
      { name: 'Coffee Bean', qty: 18 }, { name: 'Fresh Milk', qty: 200 },
    ],
    'Chocolate Brownie': [
      { name: 'Cocoa Powder', qty: 30 }, { name: 'Butter', qty: 50 },
      { name: 'Sugar', qty: 60 }, { name: 'All Purpose Flour', qty: 40 },
    ],
    'Naan Bread': [
      { name: 'All Purpose Flour', qty: 100 }, { name: 'Yeast', qty: 3 },
      { name: 'Sugar', qty: 5 }, { name: 'Salt', qty: 3 }, { name: 'Butter', qty: 15 },
    ],
    'Mango Lassi': [
      { name: 'Mango', qty: 100 }, { name: 'Fresh Milk', qty: 150 }, { name: 'Sugar', qty: 20 },
    ],
  };

  let recipeCount = 0;
  for (const [menuName, items] of Object.entries(recipeDefs)) {
    const menuItem = await prisma.menuItem.findFirst({
      where: { branchId: BRANCH, name: { contains: menuName }, deletedAt: null },
    });
    if (!menuItem) continue;

    const existing = await prisma.recipe.findUnique({ where: { menuItemId: menuItem.id } });
    if (existing) continue;

    const recipeItems: { ingredientId: string; quantity: number; unit: string }[] = [];
    for (const ri of items) {
      const ing = await prisma.ingredient.findFirst({
        where: { branchId: BRANCH, name: { contains: ri.name }, deletedAt: null, parentId: null },
      });
      if (ing) recipeItems.push({ ingredientId: ing.id, quantity: ri.qty, unit: ing.unit });
    }

    if (recipeItems.length > 0) {
      await prisma.recipe.create({
        data: {
          menuItemId: menuItem.id,
          items: { create: recipeItems.map((ri) => ({ ingredientId: ri.ingredientId, quantity: ri.quantity, unit: ri.unit as any })) },
        },
      });
      recipeCount++;
    }
  }
  console.warn(`✅ ${recipeCount} new menu recipes created`);

  // ── 4. Customers ──────────────────────────────────────────────────────

  const customerNames = [
    'Rafiq Ahmed', 'Fatima Begum', 'Hasan Ali', 'Nusrat Jahan', 'Karim Sheikh',
    'Aisha Rahman', 'Tanvir Hossain', 'Priya Das', 'Sohel Rana', 'Nadia Islam',
    'Imran Khan', 'Sabrina Chowdhury', 'Arif Mahmud', 'Rumi Akter', 'Zahid Hasan',
    'Tania Sultana', 'Masud Parvez', 'Shirin Akhter', 'Nazmul Haque', 'Farhana Yasmin',
  ];
  let custCount = 0;
  for (let i = 0; i < customerNames.length; i++) {
    const phone = `0171${String(1000000 + i).slice(1)}`;
    const exists = await prisma.customer.findFirst({ where: { branchId: BRANCH, phone } });
    if (exists) continue;
    await prisma.customer.create({
      data: { branchId: BRANCH, name: customerNames[i], phone, email: `${customerNames[i].toLowerCase().replace(/\s/g, '.')}@email.com` },
    });
    custCount++;
  }
  console.warn(`✅ ${custCount} customers created`);

  // ── 5. 30 Days of Orders (20-50K BDT/day) ────────────────────────────

  const menuItems = await prisma.menuItem.findMany({
    where: { branchId: BRANCH, deletedAt: null, isAvailable: true },
    select: { id: true, name: true, price: true },
  });
  const customers = await prisma.customer.findMany({ where: { branchId: BRANCH }, select: { id: true, name: true, phone: true } });
  const tables = await prisma.diningTable.findMany({ where: { branchId: BRANCH }, select: { id: true, tableNumber: true } });
  const paymentMethods = ['CASH', 'CARD', 'MFS'];

  let totalOrders = 0;
  const today = new Date();

  for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
    const date = new Date(today);
    date.setDate(date.getDate() - dayOffset);
    date.setHours(10, 0, 0, 0);

    const targetRevenue = rand(20000, 50000); // BDT daily target
    let dayRevenue = 0;
    let orderNum = 1;

    while (dayRevenue < targetRevenue * 100) { // compare in paisa
      const numItems = rand(1, 5);
      const orderItems: { menuItemId: string; name: string; price: number; qty: number }[] = [];
      let subtotal = 0;

      for (let j = 0; j < numItems; j++) {
        const mi = pick(menuItems);
        const qty = rand(1, 3);
        const price = mi.price.toNumber();
        subtotal += price * qty;
        orderItems.push({ menuItemId: mi.id, name: mi.name, price, qty });
      }

      const taxRate = 5;
      const taxAmount = Math.round(subtotal * taxRate / 100);
      const totalAmount = subtotal + taxAmount;
      dayRevenue += totalAmount;

      const orderType = pick(['DINE_IN', 'DINE_IN', 'DINE_IN', 'TAKEAWAY', 'DELIVERY']) as any;
      const table = orderType === 'DINE_IN' ? pick(tables) : null;
      const customer = Math.random() > 0.4 ? pick(customers) : null;
      const method = pick(paymentMethods);

      const orderDate = new Date(date);
      orderDate.setHours(rand(10, 22), rand(0, 59), rand(0, 59));

      const dd = String(orderDate.getDate()).padStart(2, '0');
      const mm = String(orderDate.getMonth() + 1).padStart(2, '0');
      const yyyy = orderDate.getFullYear();
      const seq = String(orderNum).padStart(3, '0');
      const orderNumber = `ORD-${yyyy}${mm}${dd}-${seq}`;

      // Skip if order number exists
      const exists = await prisma.order.findUnique({ where: { orderNumber } });
      if (exists) { orderNum++; continue; }

      const order = await prisma.order.create({
        data: {
          orderNumber,
          branchId: BRANCH,
          cashierId: pick([CASHIER, MANAGER, OWNER]),
          tableId: table?.id ?? null,
          tableNumber: table?.tableNumber ?? null,
          type: orderType,
          status: 'PAID',
          subtotal,
          taxAmount,
          totalAmount,
          paymentMethod: method,
          paidAt: orderDate,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? 'Walk-in',
          customerPhone: customer?.phone ?? null,
          createdAt: orderDate,
          updatedAt: orderDate,
        },
      });

      for (const oi of orderItems) {
        await prisma.orderItem.create({
          data: {
            orderId: order.id, menuItemId: oi.menuItemId, menuItemName: oi.name,
            quantity: oi.qty, unitPrice: oi.price, totalPrice: oi.price * oi.qty,
            kitchenStatus: 'DONE', createdAt: orderDate,
          },
        });
      }

      await prisma.orderPayment.create({
        data: { orderId: order.id, method, amount: totalAmount, createdAt: orderDate },
      });

      // Account transaction for this sale
      const accountId = method === 'CASH' ? 'acc-cash' : method === 'CARD' ? 'acc-pos' : 'acc-bkash';
      await prisma.accountTransaction.create({
        data: { branchId: BRANCH, accountId, type: 'SALE', amount: totalAmount, description: `Sale ${orderNumber}`, referenceId: order.id, createdAt: orderDate },
      });

      totalOrders++;
      orderNum++;
    }
  }
  console.warn(`✅ ${totalOrders} orders over 30 days`);

  // ── 6. Purchase Orders (received) ────────────────────────────────────

  const allSuppliers = await prisma.supplier.findMany({ where: { branchId: BRANCH, deletedAt: null } });
  if (allSuppliers.length === 0) { console.warn('  ⚠ No suppliers — skipping POs'); } else {
  const allIngredients = await prisma.ingredient.findMany({
    where: { branchId: BRANCH, deletedAt: null, isActive: true },
    select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, costPerPurchaseUnit: true, costPerUnit: true, parentId: true, hasVariants: true, supplierId: true },
  });
  // Only purchasable: standalone ingredients or variants (not parents with hasVariants)
  const purchasable = allIngredients.filter((i) => !i.hasVariants && allIngredients.length > 0);

  let poCount = 0;
  for (let i = 0; i < 8; i++) {
    const supplier = pick(allSuppliers);
    const poDate = new Date(today);
    poDate.setDate(poDate.getDate() - rand(1, 25));

    const po = await prisma.purchaseOrder.create({
      data: {
        branchId: BRANCH, supplierId: supplier.id, status: 'RECEIVED',
        createdById: MANAGER, orderedAt: poDate, receivedAt: poDate, createdAt: poDate,
      },
    });

    const lineCount = rand(3, 8);
    let poTotal = 0;
    for (let j = 0; j < lineCount; j++) {
      const ing = pick(purchasable.filter((x) => !x.parentId || x.parentId !== null));
      const qty = rand(2, 20);
      const unitCost = ing.costPerPurchaseUnit.toNumber() > 0
        ? ing.costPerPurchaseUnit.toNumber()
        : (ing.costPerUnit.toNumber() * rand(5, 20));

      await prisma.purchaseOrderItem.create({
        data: {
          purchaseOrderId: po.id, ingredientId: ing.id,
          quantityOrdered: qty, quantityReceived: qty, unitCost,
        },
      });

      // Stock movement
      const stockQty = ing.purchaseUnitQty.toNumber() > 1 ? qty * ing.purchaseUnitQty.toNumber() : qty;
      await prisma.stockMovement.create({
        data: { branchId: BRANCH, ingredientId: ing.id, type: 'PURCHASE', quantity: stockQty, notes: `PO received`, createdAt: poDate },
      });

      poTotal += unitCost * qty;
    }

    // Supplier due
    await prisma.supplier.update({ where: { id: supplier.id }, data: { totalDue: { increment: poTotal } } });

    // Account transaction for purchase
    await prisma.accountTransaction.create({
      data: { branchId: BRANCH, accountId: 'acc-cash', type: 'PURCHASE_PAYMENT', amount: -poTotal, description: `Purchase PO`, referenceId: po.id, createdAt: poDate },
    });

    poCount++;
  }
  console.warn(`✅ ${poCount} purchase orders (received)`);

  // ── 7. Supplier Payments ──────────────────────────────────────────────

  for (const sup of allSuppliers) {
    if (sup.totalDue.toNumber() > 0) {
      const payAmount = Math.round(sup.totalDue.toNumber() * 0.6); // pay 60%
      if (payAmount > 0) {
        await prisma.supplierPayment.create({
          data: { branchId: BRANCH, supplierId: sup.id, amount: payAmount, paymentMethod: 'CASH', paidById: OWNER },
        });
        await prisma.supplier.update({ where: { id: sup.id }, data: { totalDue: { decrement: payAmount } } });
      }
    }
  }
  console.warn('✅ Supplier payments recorded');
  } // end supplier/PO block

  // ── 8. Daily Expenses ─────────────────────────────────────────────────

  const expenseTypes: { category: string; desc: string; min: number; max: number }[] = [
    { category: 'UTILITIES', desc: 'Electricity bill', min: 3000, max: 8000 },
    { category: 'UTILITIES', desc: 'Water bill', min: 500, max: 1500 },
    { category: 'TRANSPORT', desc: 'Delivery transport', min: 200, max: 800 },
    { category: 'SUPPLIES', desc: 'Kitchen supplies', min: 500, max: 2000 },
    { category: 'MAINTENANCE', desc: 'Equipment maintenance', min: 1000, max: 5000 },
    { category: 'MARKETING', desc: 'Social media ads', min: 500, max: 3000 },
    { category: 'STAFF_FOOD', desc: 'Staff meals', min: 300, max: 800 },
  ];

  let expenseCount = 0;
  for (let dayOffset = 25; dayOffset >= 0; dayOffset -= rand(2, 5)) {
    const date = new Date(today);
    date.setDate(date.getDate() - dayOffset);
    const exp = pick(expenseTypes);
    const amount = paisa(rand(exp.min, exp.max));
    await prisma.expense.create({
      data: {
        branchId: BRANCH, category: exp.category as any, description: exp.desc,
        amount, approvedById: OWNER, recordedById: MANAGER, date, createdAt: date,
      },
    });
    await prisma.accountTransaction.create({
      data: { branchId: BRANCH, accountId: 'acc-cash', type: 'EXPENSE', amount: -amount, description: exp.desc, createdAt: date },
    });
    expenseCount++;
  }
  console.warn(`✅ ${expenseCount} expenses recorded`);

  // ── 9. Waste Logs ─────────────────────────────────────────────────────

  const wasteReasons = ['SPOILAGE', 'PREPARATION_ERROR', 'EXPIRED', 'OVERCOOKED'] as const;
  const wasteIngList = await prisma.ingredient.findMany({
    where: { branchId: BRANCH, deletedAt: null, isActive: true, parentId: null, hasVariants: false },
    select: { id: true },
    take: 15,
  });
  const wasteIngredients = wasteIngList;
  let wasteCount = 0;
  for (let i = 0; i < 12; i++) {
    const ing = pick(wasteIngredients);
    const date = new Date(today);
    date.setDate(date.getDate() - rand(0, 20));
    const qty = rand(1, 10);
    await prisma.wasteLog.create({
      data: { branchId: BRANCH, ingredientId: ing.id, quantity: qty, reason: pick(wasteReasons), notes: 'Smoke test waste', recordedById: pick([MANAGER, CASHIER]), createdAt: date },
    });
    await prisma.stockMovement.create({
      data: { branchId: BRANCH, ingredientId: ing.id, type: 'WASTE', quantity: -qty, staffId: MANAGER, notes: 'Waste recorded', createdAt: date },
    });
    wasteCount++;
  }
  console.warn(`✅ ${wasteCount} waste logs`);

  // ── 10. Attendance (30 days) ──────────────────────────────────────────

  const staffIds = [OWNER, MANAGER, CASHIER, 'staff-kitchen', 'staff-kitchen2', 'staff-waiter'];
  const attendStatuses = ['PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'] as const;
  let attendCount = 0;
  for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
    const date = new Date(today);
    date.setDate(date.getDate() - dayOffset);
    if (date.getDay() === 5) continue; // Skip Friday

    for (const sid of staffIds) {
      const status = pick(attendStatuses);
      const clockIn = new Date(date); clockIn.setHours(9, rand(0, 30));
      const clockOut = status !== 'ABSENT' ? new Date(date) : undefined;
      if (clockOut) clockOut.setHours(status === 'HALF_DAY' ? 14 : rand(20, 23), rand(0, 59));

      const exists = await prisma.attendance.findFirst({ where: { branchId: BRANCH, staffId: sid, date: { gte: new Date(date.toDateString()), lt: new Date(new Date(date).setDate(date.getDate() + 1)) } } });
      if (exists) continue;

      await prisma.attendance.create({
        data: { branchId: BRANCH, staffId: sid, date, status: status as any, clockIn: status !== 'ABSENT' ? clockIn : undefined, clockOut },
      });
      attendCount++;
    }
  }
  console.warn(`✅ ${attendCount} attendance records`);

  // ── 11. Update account balances ───────────────────────────────────────

  for (const accId of ['acc-cash', 'acc-pos', 'acc-bkash']) {
    const txns = await prisma.accountTransaction.findMany({ where: { accountId: accId } });
    const balance = txns.reduce((s, t) => s + t.amount.toNumber(), 0);
    await prisma.account.update({ where: { id: accId }, data: { balance: Math.max(0, balance) } });
  }
  console.warn('✅ Account balances synced');

  console.warn('\n🎉 Smoke test seed complete!');
  console.warn('  - Ingredient variants with brands');
  console.warn('  - Pre-ready items (sauces, keema, dough, stocks)');
  console.warn('  - 11+ menu recipes');
  console.warn('  - 30 days of orders (20-50K BDT/day)');
  console.warn('  - Purchase orders received with stock movements');
  console.warn('  - Customer directory');
  console.warn('  - Expenses, waste logs, attendance\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { void prisma.$disconnect(); });
