/**
 * Standalone preview render for the discount-card composer.
 *
 * Run: cd apps/api && npx tsx src/social/__test__/preview.ts
 *
 * Writes two JPEGs into apps/api/tmp/ — open them and compare to
 * mockups/createimage/Selected day Discount.jpg and
 * mockups/createimage/Every day with validity.jpg.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { composeDiscountImage } from '../image-composer';

async function main() {
  const outDir = join(process.cwd(), 'tmp', 'social-preview');
  await mkdir(outDir, { recursive: true });

  const sharedFood = 'https://picsum.photos/seed/eatro-wonton/800/800';
  const sharedLogo: string | null = null; // logo path to be wired at call site once API is integrated

  // PRICE_DROP layout — discount runs every day, validity = May 30.
  const priceDrop = await composeDiscountImage({
    productName: 'Crispy Eatro Special Chicken Wontons (Fried)',
    foodImageUrl: sharedFood,
    discount: { type: 'FLAT', value: 3000 },
    validity: { endDate: new Date('2026-05-30T23:59:59'), days: null },
    branding: {
      logoUrl: sharedLogo,
      address:
        'Kha-225 Level-4, Brac University Main Campus, Century Centre, Dhaka 1212',
    },
  });
  await writeFile(join(outDir, 'price-drop.jpg'), priceDrop.buffer);

  // SELECTED_DAYS layout — discount on Sun/Mon/Fri, validity = May 30.
  const selectedDays = await composeDiscountImage({
    productName: 'Crispy Eatro Special Chicken Wontons (Fried)',
    foodImageUrl: sharedFood,
    discount: { type: 'PERCENTAGE', value: 30 },
    validity: {
      endDate: new Date('2026-05-30T23:59:59'),
      days: ['SUNDAY', 'MONDAY', 'FRIDAY'],
    },
    branding: {
      logoUrl: sharedLogo,
      address:
        'Kha-225 Level-4, Brac University Main Campus, Century Centre, Dhaka 1212',
    },
  });
  await writeFile(join(outDir, 'selected-days.jpg'), selectedDays.buffer);

  // eslint-disable-next-line no-console
  console.log(`Wrote previews to ${outDir}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
