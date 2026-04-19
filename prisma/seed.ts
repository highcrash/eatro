/**
 * CLI dispatcher for the seed variants. Reads --variant or
 * SEED_VARIANT env, defaults to 'empty' on the codecanyon branch.
 *
 * Usage:
 *   pnpm tsx prisma/seed.ts                       # → empty
 *   pnpm tsx prisma/seed.ts --variant demo-light  # → demo-light
 *   SEED_VARIANT=demo-full pnpm tsx prisma/seed.ts
 *
 * Or via root package.json scripts:
 *   pnpm db:seed:empty
 *   pnpm db:seed:demo-light
 *
 * On the `main` branch, the rich legacy seed lives in
 * prisma/seeds/_internal/ and is wired into demo-full. On the
 * `codecanyon` branch that path is gitignored and demo-full throws —
 * buyers don't get our internal data.
 */
import { PrismaClient } from '@prisma/client';
import { runSeed, type SeedVariant } from './seeds';

const prisma = new PrismaClient();

function pickVariant(): SeedVariant {
  // CLI flag wins over env so a one-off override doesn't require
  // unsetting an env that's set in .env.
  const argFlag = process.argv.indexOf('--variant');
  if (argFlag >= 0 && process.argv[argFlag + 1]) {
    return process.argv[argFlag + 1] as SeedVariant;
  }
  const envVariant = process.env.SEED_VARIANT;
  if (envVariant) return envVariant as SeedVariant;
  // Codecanyon-branch default. Internal main builds set
  // SEED_VARIANT=demo-full in their own .env.
  return 'empty';
}

async function main(): Promise<void> {
  const variant = pickVariant();
  // eslint-disable-next-line no-console
  console.log(`\nseeding (variant: ${variant})…`);
  await runSeed(prisma, variant);
  // eslint-disable-next-line no-console
  console.log('\ndone.\n');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
