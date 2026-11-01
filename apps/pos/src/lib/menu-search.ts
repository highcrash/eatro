import type { MenuItem } from '@restora/types';

/** Items at or above this sort order are off the printed menu and have no number. */
const OFF_MENU = 1000;

/** The item's number on the printed menu (its sort order, 1–999), or null. */
export function menuNumber(item: Pick<MenuItem, 'sortOrder'>): number | null {
  const n = item.sortOrder ?? 0;
  return n > 0 && n < OFF_MENU ? n : null;
}

/**
 * What the search box finds. A number finds the dish with that printed
 * number; when no dish has it, the options that do (fried rice 1:1 and
 * 1:3 share one number but live as options). Text finds dishes by name.
 * `items` may include variant options; dishes are what it returns
 * otherwise.
 */
export function searchMenu(items: MenuItem[], query: string): MenuItem[] {
  const q = query.trim().toLowerCase();
  const dishes = items.filter((m) => !m.variantParentId);
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    const hit = dishes.filter((m) => menuNumber(m) === n);
    if (hit.length > 0) return hit;
    // Only options whose dish is itself on offer.
    const offered = new Map(dishes.map((m) => [m.id, m]));
    const options = items.filter(
      (m) => m.variantParentId && offered.get(m.variantParentId)?.isAvailable && menuNumber(m) === n,
    );
    if (options.length > 0) return options;
  }
  return dishes.filter((m) => m.name.toLowerCase().includes(q));
}

type CategoryRow = { id: string; parentId: string | null; sortOrder?: number };

/**
 * Menu order: top category, then subcategory, then the item's own sort
 * order, the same order the printed menu numbers follow.
 */
export function byMenuPosition(cats: CategoryRow[]) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const rank = (m: MenuItem): number[] => {
    const cat = byId.get(m.categoryId);
    const top = cat?.parentId ? byId.get(cat.parentId) : cat;
    return [top?.sortOrder ?? 0, cat?.parentId ? (cat.sortOrder ?? 0) : -1, m.sortOrder ?? 0];
  };
  return (a: MenuItem, b: MenuItem) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || a.name.localeCompare(b.name);
  };
}
