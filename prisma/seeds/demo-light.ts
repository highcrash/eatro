import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_PAYMENT_METHODS,
  announcePassword,
  generatePassword,
  hashPassword,
} from './common';

/**
 * "Demo light" — what the operator sees when they tick the demo box
 * in the install wizard. Just enough data to show the UI isn't empty:
 *
 *   - 1 branch
 *   - 1 owner staff (random password, logged once)
 *   - 4 default payment methods
 *   - 3 menu categories with 6-7 items each
 *
 * No customer data, no orders, no inventory beyond what each menu item
 * implicitly needs. Brand-neutral throughout — restaurant called
 * "Demo Restaurant", item names like "Classic Burger" / "Garden
 * Salad" / "House Tea".
 *
 * Marks the install as completed at the end so the buyer doesn't see
 * the wizard on top of the demo data.
 */
export async function seedDemoLight(prisma: PrismaClient): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { id: 'self' },
    create: { id: 'self', installedAt: new Date(), brandName: 'Demo Restaurant', siteName: 'Demo Restaurant' },
    update: { installedAt: new Date(), brandName: 'Demo Restaurant', siteName: 'Demo Restaurant' },
  });

  const branch = await prisma.branch.upsert({
    where: { id: 'demo-branch' },
    create: {
      id: 'demo-branch',
      name: 'Demo Restaurant',
      address: '1 Demo Street',
      phone: '+10000000000',
      currency: 'USD',
      timezone: 'UTC',
    },
    update: {},
  });

  const ownerPlain = generatePassword();
  await prisma.staff.upsert({
    where: { email: 'owner@example.com' },
    create: {
      branchId: branch.id,
      name: 'Demo Owner',
      email: 'owner@example.com',
      passwordHash: await hashPassword(ownerPlain),
      role: 'OWNER',
      phone: '+10000000000',
    },
    update: {},
  });
  announcePassword('owner@example.com', ownerPlain);

  for (const pm of DEFAULT_PAYMENT_METHODS) {
    await prisma.paymentMethodConfig.upsert({
      where: { branchId_code: { branchId: branch.id, code: pm.code } },
      create: { branchId: branch.id, code: pm.code, name: pm.name, sortOrder: pm.sortOrder },
      update: {},
    });
  }

  // Three categories with six items each. Names + prices chosen to
  // look like a small American/European bistro — generic enough that
  // a Bangladeshi or Brazilian buyer can edit names without confusion.
  const categories = [
    {
      name: 'Burgers',
      items: [
        ['Classic Burger', 8.5],
        ['Cheese Burger', 9.5],
        ['Bacon Burger', 11],
        ['Veggie Burger', 8],
        ['Double Stack', 13.5],
        ['BBQ Burger', 10.5],
      ] as [string, number][],
    },
    {
      name: 'Sides',
      items: [
        ['Fries', 3.5],
        ['Onion Rings', 4],
        ['Mozzarella Sticks', 5.5],
        ['Coleslaw', 3],
        ['Garden Salad', 6],
        ['Sweet Potato Fries', 4.5],
      ] as [string, number][],
    },
    {
      name: 'Drinks',
      items: [
        ['Soft Drink', 2.5],
        ['House Tea', 2],
        ['Lemonade', 3.5],
        ['Coffee', 2.5],
        ['Bottled Water', 1.5],
        ['Milkshake', 5.5],
      ] as [string, number][],
    },
  ];

  for (const [i, cat] of categories.entries()) {
    const c = await prisma.menuCategory.upsert({
      where: { id: `demo-cat-${i}` },
      create: { id: `demo-cat-${i}`, branchId: branch.id, name: cat.name, sortOrder: i },
      update: {},
    });
    for (const [j, [itemName, price]] of cat.items.entries()) {
      await prisma.menuItem.upsert({
        where: { id: `demo-item-${i}-${j}` },
        create: {
          id: `demo-item-${i}-${j}`,
          branchId: branch.id,
          categoryId: c.id,
          name: itemName,
          price,
          sortOrder: j,
        },
        update: {},
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log('  ✓ demo-light seed: 1 branch, 1 owner, 4 payment methods, 3 categories x 6 items');
}
