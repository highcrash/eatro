import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UnitConversionService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(branchId: string) {
    return this.prisma.unitConversion.findMany({
      where: { branchId },
      orderBy: [{ fromUnit: 'asc' }, { toUnit: 'asc' }],
    });
  }

  async upsert(branchId: string, fromUnit: string, toUnit: string, factor: number) {
    if (fromUnit === toUnit) throw new BadRequestException('From and To units must be different');
    if (factor <= 0) throw new BadRequestException('Factor must be positive');

    // Create both directions
    await this.prisma.unitConversion.upsert({
      where: { branchId_fromUnit_toUnit: { branchId, fromUnit: fromUnit as any, toUnit: toUnit as any } },
      create: { branchId, fromUnit: fromUnit as any, toUnit: toUnit as any, factor },
      update: { factor },
    });
    // Reverse
    await this.prisma.unitConversion.upsert({
      where: { branchId_fromUnit_toUnit: { branchId, fromUnit: toUnit as any, toUnit: fromUnit as any } },
      create: { branchId, fromUnit: toUnit as any, toUnit: fromUnit as any, factor: 1 / factor },
      update: { factor: 1 / factor },
    });

    return this.findAll(branchId);
  }

  async remove(branchId: string, fromUnit: string, toUnit: string) {
    await this.prisma.unitConversion.deleteMany({
      where: {
        branchId,
        OR: [
          { fromUnit: fromUnit as any, toUnit: toUnit as any },
          { fromUnit: toUnit as any, toUnit: fromUnit as any },
        ],
      },
    });
    return this.findAll(branchId);
  }

  async convert(branchId: string, value: number, fromUnit: string, toUnit: string): Promise<number> {
    if (fromUnit === toUnit) return value;

    // Try direct conversion from DB
    const direct = await this.prisma.unitConversion.findUnique({
      where: { branchId_fromUnit_toUnit: { branchId, fromUnit: fromUnit as any, toUnit: toUnit as any } },
    });
    if (direct) return value * direct.factor.toNumber();

    // Fallback to hardcoded common conversions
    const hardcoded: Record<string, Record<string, number>> = {
      KG: { G: 1000 },
      G: { KG: 0.001 },
      L: { ML: 1000 },
      ML: { L: 0.001 },
      DOZEN: { PCS: 12 },
      PCS: { DOZEN: 1 / 12 },
    };
    const f = hardcoded[fromUnit]?.[toUnit];
    if (f) return value * f;

    // Incompatible units (e.g., G → PCS) — use value as-is with a warning log
    // This allows production to complete; admin should fix the recipe unit
    console.warn(`[UnitConversion] No conversion from ${fromUnit} to ${toUnit} — using value as-is (${value})`);
    return value;
  }

  // Get convertible units for a given unit
  async getConvertibleUnits(branchId: string, unit: string) {
    const conversions = await this.prisma.unitConversion.findMany({
      where: { branchId, fromUnit: unit as any },
    });
    // Also add hardcoded
    const hardcoded: Record<string, string[]> = {
      KG: ['G'],
      G: ['KG'],
      L: ['ML'],
      ML: ['L'],
      DOZEN: ['PCS'],
      PCS: ['DOZEN'],
    };
    const units = new Set<string>([unit]);
    for (const c of conversions) units.add(c.toUnit);
    for (const u of hardcoded[unit] ?? []) units.add(u);
    return [...units];
  }
}
