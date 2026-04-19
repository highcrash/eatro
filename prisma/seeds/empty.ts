import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_PAYMENT_METHODS,
  announcePassword,
  generatePassword,
  hashPassword,
} from './common';

/**
 * Truly empty seed: just the bones the install wizard expects to NOT
 * exist on a fresh DB.
 *
 *   - SystemConfig with installedAt=null  ← so the wizard runs
 *   - No staff, no branches, no menu, no anything else
 *
 * This is the variant that ships in the CodeCanyon zip. The buyer's
 * first-boot experience is the wizard, not pre-seeded demo content.
 *
 * Returns nothing — the wizard creates everything else.
 */
export async function seedEmpty(prisma: PrismaClient): Promise<void> {
  // Idempotent: if SystemConfig already exists, leave it. Re-running
  // empty.ts on an installed DB shouldn't reset the install state.
  await prisma.systemConfig.upsert({
    where: { id: 'self' },
    create: { id: 'self' },
    update: {},
  });
  // eslint-disable-next-line no-console
  console.log('  ✓ empty seed — visit /admin to run the install wizard');
  // Suppress unused warnings for helpers that variants may pull in.
  void DEFAULT_PAYMENT_METHODS;
  void announcePassword;
  void generatePassword;
  void hashPassword;
}
