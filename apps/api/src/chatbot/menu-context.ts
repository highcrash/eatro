import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { PublicService } from '../public/public.service';

/** One thing a customer can order, as the bot refers to it. */
export interface MenuUnit {
  /** Short handle the AI uses, e.g. "#12". Valid for this snapshot only. */
  ref: string;
  itemId: string;
  /** The dish: the parent for a size or flavour option, else the item itself. */
  dishId: string;
  dishName: string;
  name: string;
  category: string;
  /** Taka. The price a customer pays today (offer price when on offer). */
  price: number;
  /** Regular price in taka when the item is on offer. */
  wasPrice: number | null;
  /** Printed menu number (1-999), when the item has one. */
  menuNumber: number | null;
  description: string | null;
  includes: string | null;
  imageUrl: string | null;
  url: string;
}

export interface MenuSnapshot {
  units: MenuUnit[];
  byRef: Map<string, MenuUnit>;
  /** Every price a reply may legitimately quote, in taka. */
  prices: Set<number>;
  /** The menu as the AI reads it. */
  text: string;
}

export interface MenuCard {
  name: string;
  price: number;
  wasPrice: number | null;
  imageUrl: string | null;
  url: string;
}

interface RawItem {
  id: string;
  categoryId: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  price: unknown;
  discountedPrice?: number | null;
  imageUrl?: string | null;
  sortOrder: number;
  isVariantParent?: boolean;
  variants?: RawItem[];
}
interface RawCategory { id: string; name: string; parentId: string | null; sortOrder: number }

const taka = (paisa: unknown) => Math.round(Number(paisa)) / 100;
const short = (s: string | null | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** Pure: turns the public menu payload into the bot's snapshot. */
export function buildMenuSnapshot(
  menu: { categories: RawCategory[]; items: RawItem[] },
  siteUrl: string,
  comboContents: Map<string, string> = new Map(),
): MenuSnapshot {
  const categoryName = new Map(menu.categories.map((c) => [c.id, c.name]));
  const categoryOrder = new Map(menu.categories.map((c, i) => [c.id, i]));
  const units: MenuUnit[] = [];

  const add = (item: RawItem, parent: RawItem | null) => {
    const price = taka(item.price);
    if (!(price > 0)) return;
    const offer = item.discountedPrice != null && taka(item.discountedPrice) < price ? taka(item.discountedPrice) : null;
    const base = parent ?? item;
    const name = parent && !item.name.toLowerCase().startsWith(parent.name.toLowerCase()) ? `${parent.name} - ${item.name}` : item.name;
    const number = base.sortOrder >= 1 && base.sortOrder <= 999 ? base.sortOrder : item.sortOrder >= 1 && item.sortOrder <= 999 ? item.sortOrder : null;
    units.push({
      ref: `#${units.length + 1}`,
      itemId: item.id,
      dishId: base.id,
      dishName: base.name,
      name,
      category: categoryName.get(base.categoryId) ?? 'Menu',
      price: offer ?? price,
      wasPrice: offer != null ? price : null,
      menuNumber: number,
      description: short(item.description ?? parent?.description, 110) || null,
      includes: comboContents.get(item.id) ?? null,
      imageUrl: item.imageUrl ?? parent?.imageUrl ?? null,
      url: `${siteUrl}/menu/${base.slug || base.id}`,
    });
  };

  const ordered = [...menu.items].sort(
    (a, b) => (categoryOrder.get(a.categoryId) ?? 999) - (categoryOrder.get(b.categoryId) ?? 999) || a.sortOrder - b.sortOrder,
  );
  for (const item of ordered) {
    if (item.variants && item.variants.length > 0) for (const v of item.variants) add({ ...v, categoryId: item.categoryId }, item);
    else add(item, null);
  }

  const lines: string[] = [];
  let current = '';
  for (const u of units) {
    if (u.category !== current) {
      current = u.category;
      lines.push(`\n## ${current}`);
    }
    const parts = [`${u.ref} ${u.name} = ৳${u.price}`];
    if (u.wasPrice != null) parts.push(`(on offer now, regular ৳${u.wasPrice})`);
    if (u.menuNumber != null) parts.push(`[menu no. ${u.menuNumber}]`);
    if (u.includes) parts.push(`| includes: ${u.includes}`);
    if (u.description) parts.push(`| ${u.description}`);
    lines.push(parts.join(' '));
  }

  const prices = new Set<number>();
  for (const u of units) {
    prices.add(u.price);
    if (u.wasPrice != null) prices.add(u.wasPrice);
  }
  return { units, byRef: new Map(units.map((u) => [u.ref, u])), prices, text: lines.join('\n').trim() };
}

export const toCard = (u: MenuUnit): MenuCard => ({ name: u.name, price: u.price, wasPrice: u.wasPrice, imageUrl: u.imageUrl, url: u.url });

const CACHE_MS = 5 * 60_000;

@Injectable()
export class MenuContextService {
  private cache = new Map<string, { at: number; snapshot: MenuSnapshot }>();

  constructor(
    private readonly publicService: PublicService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  siteUrl(): string {
    return (this.config.get<string>('PUBLIC_SITE_URL') ?? 'https://eatrobd.com').replace(/\/+$/, '');
  }

  /** The live public menu (same visibility rules as the website), cached a few minutes. */
  async get(branchId: string): Promise<MenuSnapshot> {
    const hit = this.cache.get(branchId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.snapshot;

    const menu = (await this.publicService.getMenu(branchId)) as unknown as { categories: RawCategory[]; items: RawItem[] };
    const combos = await this.prisma.menuItem.findMany({
      where: { branchId, isCombo: true, deletedAt: null, id: { in: menu.items.map((i) => i.id) } },
      select: {
        id: true,
        comboItems: { orderBy: { sortOrder: 'asc' }, select: { quantity: true, choiceGroup: true, includedItem: { select: { name: true } } } },
      },
    });
    const contents = new Map<string, string>();
    for (const combo of combos) {
      const fixed = combo.comboItems.filter((c) => !c.choiceGroup).map((c) => `${c.quantity}x ${c.includedItem.name}`);
      const groups = new Map<string, { quantity: number; names: string[] }>();
      for (const c of combo.comboItems.filter((x) => x.choiceGroup)) {
        const g = groups.get(c.choiceGroup!) ?? { quantity: c.quantity, names: [] };
        g.names.push(c.includedItem.name);
        groups.set(c.choiceGroup!, g);
      }
      const choices = [...groups.values()].map((g) => `${g.quantity}x choice of ${g.names.join(' / ')}`);
      const all = [...fixed, ...choices];
      if (all.length > 0) contents.set(combo.id, short(all.join(', '), 220));
    }

    const snapshot = buildMenuSnapshot(menu, this.siteUrl(), contents);
    this.cache.set(branchId, { at: Date.now(), snapshot });
    return snapshot;
  }

  clear(branchId?: string) {
    if (branchId) this.cache.delete(branchId);
    else this.cache.clear();
  }
}

/**
 * Dishes a post caption or title names, longest name first, so
 * "Chicken Cheese Burger" wins over "Cheese Burger". At most three dishes.
 */
export function matchDishes(text: string | null | undefined, menu: MenuSnapshot, max = 3): string[] {
  if (!text) return [];
  const hay = ` ${normalize(text)} `;
  const dishes = new Map<string, string>();
  for (const u of menu.units) if (!dishes.has(u.dishId)) dishes.set(u.dishId, normalize(u.dishName));
  const hits = [...dishes.entries()].filter(([, n]) => n.length >= 4 && hay.includes(` ${n} `)).sort((a, b) => b[1].length - a[1].length);
  const picked: [string, string][] = [];
  for (const h of hits) if (!picked.some(([, n]) => n.includes(h[1]))) picked.push(h);
  return picked.slice(0, max).map(([id]) => id);
}

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
