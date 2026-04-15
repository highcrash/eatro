import type { KitchenTicketInput } from '@restora/utils';
import type { PrinterSlot } from '../config/store';
import { getCached } from '../sync/cache-store';

/**
 * Resolves kitchen sections (cooking stations) from the response cache
 * and groups a ticket's items per section. Used by kitchen.ts to fan
 * KOTs out to each section's printer and also to drop copies on the
 * bill printer.
 */

export interface Station {
  id: string;
  name: string;
  printerName: string | null;
  printerIp: string | null;
  printerPort: number | null;
  sortOrder: number;
  isActive: boolean;
}

export interface SectionGroup {
  stationId: string | null;   // null = items without a configured station
  stationName: string | null;
  slot: PrinterSlot | null;   // printer derived from station config; null = fall back
  items: KitchenTicketInput['items'];
}

/**
 * Turn a station's printerName / printerIp / printerPort into a
 * PrinterSlot. Rule of thumb: IP wins if present (network printer);
 * otherwise a Windows OS-printer name; otherwise null (caller falls
 * back to the default kitchen slot).
 */
export function stationToSlot(station: Station): PrinterSlot | null {
  if (station.printerIp && station.printerIp.trim()) {
    return {
      mode: 'network',
      host: station.printerIp.trim(),
      port: station.printerPort && station.printerPort > 0 ? station.printerPort : 9100,
    };
  }
  if (station.printerName && station.printerName.trim()) {
    return { mode: 'os-printer', deviceName: station.printerName.trim() };
  }
  return null;
}

function getCachedStations(): Station[] {
  const entry = getCached('GET', '/cooking-stations');
  if (!entry || !Array.isArray(entry.body)) return [];
  return (entry.body as Station[]).filter((s) => s && s.isActive);
}

interface MenuItemLite {
  id: string;
  cookingStationId: string | null;
}

function getCachedMenu(): MenuItemLite[] {
  const entry = getCached('GET', '/menu');
  if (!entry || !Array.isArray(entry.body)) return [];
  return (entry.body as Array<{ id: string; cookingStationId?: string | null }>).map((m) => ({
    id: m.id,
    cookingStationId: m.cookingStationId ?? null,
  }));
}

/**
 * Group an incoming ticket's items into one bucket per cooking station.
 * Items without a station (or whose station isn't in the cache) go to
 * the null bucket, which the caller prints to the default kitchen slot.
 * Order: sorted sections first (by sortOrder then name), then the null
 * bucket last.
 *
 * We need the POS to be able to look items up by their menuItemId, so
 * each item must carry it — we extend KitchenTicketInput.items with an
 * optional menuItemId field in the types package separately.
 */
export function groupTicketBySection(ticket: KitchenTicketInput): SectionGroup[] {
  const stations = getCachedStations();
  const menu = getCachedMenu();
  const menuById = new Map<string, MenuItemLite>();
  for (const m of menu) menuById.set(m.id, m);

  const buckets = new Map<string | null, KitchenTicketInput['items']>();
  for (const item of ticket.items ?? []) {
    const menuId = (item as unknown as { menuItemId?: string }).menuItemId ?? null;
    const stationId = menuId ? menuById.get(menuId)?.cookingStationId ?? null : null;
    const list = buckets.get(stationId) ?? [];
    list.push(item);
    buckets.set(stationId, list);
  }

  const stationById = new Map<string, Station>();
  for (const s of stations) stationById.set(s.id, s);

  const groups: SectionGroup[] = [];
  // Sorted stations first.
  const sortedStations = stations.slice().sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
  for (const st of sortedStations) {
    const items = buckets.get(st.id);
    if (!items || items.length === 0) continue;
    groups.push({
      stationId: st.id,
      stationName: st.name,
      slot: stationToSlot(st),
      items,
    });
    buckets.delete(st.id);
  }
  // Leftover buckets = items whose station is inactive or missing. Roll them
  // into one unassigned group so they still hit the default kitchen printer.
  const leftover: KitchenTicketInput['items'] = [];
  for (const items of buckets.values()) leftover.push(...items);
  if (leftover.length > 0) {
    groups.push({ stationId: null, stationName: null, slot: null, items: leftover });
  }
  return groups;
}
