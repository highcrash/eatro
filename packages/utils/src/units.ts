/**
 * Unit conversion factors — all relative to base unit
 * Mass: base = G (grams)
 * Volume: base = ML (milliliters)
 */
const MASS_FACTORS: Record<string, number> = {
  G: 1,
  KG: 1000,
};

const VOLUME_FACTORS: Record<string, number> = {
  ML: 1,
  L: 1000,
};

export function convertUnit(value: number, fromUnit: string, toUnit: string): number {
  if (fromUnit === toUnit) return value;

  // Mass conversions
  if (MASS_FACTORS[fromUnit] && MASS_FACTORS[toUnit]) {
    return (value * MASS_FACTORS[fromUnit]) / MASS_FACTORS[toUnit];
  }

  // Volume conversions
  if (VOLUME_FACTORS[fromUnit] && VOLUME_FACTORS[toUnit]) {
    return (value * VOLUME_FACTORS[fromUnit]) / VOLUME_FACTORS[toUnit];
  }

  // No conversion available (PCS, DOZEN, BOX — incompatible)
  return value;
}

export function canConvert(fromUnit: string, toUnit: string): boolean {
  if (fromUnit === toUnit) return true;
  if (MASS_FACTORS[fromUnit] && MASS_FACTORS[toUnit]) return true;
  if (VOLUME_FACTORS[fromUnit] && VOLUME_FACTORS[toUnit]) return true;
  return false;
}

export function formatUnit(value: number, unit: string): string {
  // Auto-convert to more readable unit
  if (unit === 'G' && value >= 1000) return `${(value / 1000).toFixed(2)} KG`;
  if (unit === 'ML' && value >= 1000) return `${(value / 1000).toFixed(2)} L`;
  if (unit === 'KG' && value < 1 && value > 0) return `${(value * 1000).toFixed(0)} G`;
  if (unit === 'L' && value < 1 && value > 0) return `${(value * 1000).toFixed(0)} ML`;
  return `${value.toFixed(2)} ${unit}`;
}
