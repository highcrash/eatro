import type { PrismaClient } from '@prisma/client';

/**
 * "Demo full" — placeholder for the de-branded version of the legacy
 * 1500-line prisma/seed.ts. Generating that here would mean rewriting
 * every customer/order/inventory row to strip EATRO branding, which
 * is out of scope for the v1 CodeCanyon ship (the wizard + demo-light
 * cover the buyer's "I want to see what this looks like" use case).
 *
 * For now this throws so anyone running it sees the explicit reason.
 * Section 4 of the plan explicitly lists `demo-full` as a follow-up.
 *
 * If/when this ships:
 *   - Reuse the legacy seed.ts as a starting point.
 *   - Pipe every string through the strip-branding codemod (Section 5).
 *   - Replace every @restora.app email and 01XXXXXXXXX phone with
 *     example.com / +1000…
 *   - Generate fresh random passwords; log them once.
 */
export async function seedDemoFull(_prisma: PrismaClient): Promise<void> {
  throw new Error(
    'demo-full seed not yet implemented for the codecanyon edition. ' +
      'Use --variant=demo-light or --variant=empty for now.',
  );
}
