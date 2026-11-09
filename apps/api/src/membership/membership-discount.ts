export interface MemberRule {
  menuItemId: string | null;
  categoryId: string | null;
  kind: 'EXCLUDE' | 'SPECIAL';
  type: 'FLAT' | 'PERCENTAGE' | 'FREE_ITEM' | null;
  value: number | null;
}

export interface MemberLine {
  menuItemId: string;
  quantity: number;
  totalPrice: number;
  variantParentId: string | null;
  categoryId: string | null;
  parentCategoryId: string | null;
}

/**
 * Member discount in paisa for these order lines. The most specific rule
 * wins: the item, its parent dish (options like a bottle of Water are
 * covered by a rule on Water), its category, the category's parent, then
 * the plan's default percent.
 */
export function memberDiscount(defaultPercent: number, rules: MemberRule[], lines: MemberLine[]): number {
  const byItem = new Map(rules.filter((r) => r.menuItemId).map((r) => [r.menuItemId as string, r]));
  const byCategory = new Map(rules.filter((r) => r.categoryId).map((r) => [r.categoryId as string, r]));

  const total = lines.reduce((sum, line) => {
    const rule =
      byItem.get(line.menuItemId) ??
      (line.variantParentId ? byItem.get(line.variantParentId) : undefined) ??
      (line.categoryId ? byCategory.get(line.categoryId) : undefined) ??
      (line.parentCategoryId ? byCategory.get(line.parentCategoryId) : undefined);

    if (!rule) return sum + (line.totalPrice * defaultPercent) / 100;
    if (rule.kind === 'EXCLUDE') return sum;
    const value = rule.value ?? 0;
    return sum + (rule.type === 'FLAT' ? Math.min(value * line.quantity, line.totalPrice) : (line.totalPrice * value) / 100);
  }, 0);

  return Math.round(total);
}
