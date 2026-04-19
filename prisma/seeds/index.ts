import type { PrismaClient } from '@prisma/client';
import { seedEmpty } from './empty';
import { seedDemoLight } from './demo-light';
import { seedDemoFull } from './demo-full';

export type SeedVariant = 'empty' | 'demo-light' | 'demo-full';

/**
 * Single dispatch point. The CLI wrapper (prisma/seed.ts) reads the
 * --variant flag (or SEED_VARIANT env) and calls into here. Adding a
 * new variant is two lines: one import, one case.
 *
 * Default is 'empty' on the codecanyon branch — the value buyers get.
 * On main, prisma/seed.ts overrides via SEED_VARIANT=demo-full so
 * internal dev keeps the rich seed data.
 */
export async function runSeed(prisma: PrismaClient, variant: SeedVariant): Promise<void> {
  switch (variant) {
    case 'empty':
      return seedEmpty(prisma);
    case 'demo-light':
      return seedDemoLight(prisma);
    case 'demo-full':
      return seedDemoFull(prisma);
    default: {
      const exhaustive: never = variant;
      throw new Error(`unknown seed variant: ${String(exhaustive)}`);
    }
  }
}
