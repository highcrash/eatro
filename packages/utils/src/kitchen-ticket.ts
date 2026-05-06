/**
 * Shared kitchen-ticket HTML + print logic used by both the KDS app and the
 * POS app (the latter prints automatically when BranchSetting.useKds = false).
 *
 * The HTML is sized for a 80mm thermal printer and includes an auto-print
 * script that fires on window load — so calling `printKitchenTicket()`
 * silently triggers the OS print pipeline.
 *
 * This module is browser-only. The utils package's tsconfig doesn't include
 * the DOM lib (since the package is also consumed by the Nest backend), so
 * we declare the minimum `window.open` shape we need here.
 */

// Minimal ambient declaration so this file compiles without the DOM lib.
declare const window: {
  open(url: string, target: string, features: string): {
    document: { write(s: string): void; close(): void };
  } | null;
  desktop?: {
    print?: {
      kitchen?: (ticket: KitchenTicketInput) => Promise<{ ok: true } | { ok: false; message: string }>;
    };
  };
};
export interface KitchenTicketInput {
  orderNumber: string;
  tableNumber?: string | null;
  type: string;
  createdAt: string | Date;
  notes?: string | null;
  items: Array<{
    quantity: number;
    menuItemName: string;
    /** Menu item id — optional, used by the desktop to group items by
     *  their cooking station when fanning KOTs to multiple printers. */
    menuItemId?: string | null;
    notes?: string | null;
    voidedAt?: string | Date | null;
    /** Per-line ingredient removals ("no garlic", "no peanut").
     *  Rendered as bold "— NO <NAME>" rows under the item so the chef
     *  spots them at a glance. */
    removedIngredients?: string[] | null;
    /** Raw OrderItem.modifications shape — accepted as a fallback so
     *  callers can pass an Order straight through without remapping.
     *  `addedIngredients` carries the cashier's ad-hoc additions
     *  (qty + unit) attached via the Customise dialog so the kitchen
     *  knows to make them on top of the recipe. */
    modifications?: {
      removedNames?: string[] | null;
      addedIngredients?: Array<{ ingredientName: string; quantity: number; unit: string }> | null;
    } | null;
    /** Selected addon names ("Cheese Sauce", "Garlic Nun"). Rendered
     *  as "+ <NAME>" rows under the item so the chef plates them. */
    selectedAddons?: string[] | null;
    /** Raw OrderItem.addons shape — accepted as fallback. */
    addons?: { addonName: string }[] | null;
    /** Cashier-added ingredients (Customise → Add). Rendered as
     *  "+ <QTY><UNIT> <NAME>" rows so the kitchen prepares the
     *  add-ons. Same printed shape as the `selectedAddons` rows so
     *  the chef can scan top-to-bottom without context-switching. */
    addedIngredients?: Array<{ ingredientName: string; quantity: number; unit: string }> | null;
    /** Recipe attached for this item — printed below the item line in
     *  a small font so the cook can see exactly what to plate without
     *  flipping through a binder. Quantity is the per-1-serving figure;
     *  the renderer multiplies by `quantity` so the total matches what
     *  the recipe service deducts from stock. Optional — items with no
     *  recipe row print "(no recipe — sold as-is)" below the item line.
     *  Removed ingredients (`removedIngredients`) are filtered OUT of
     *  this list before render so the chef doesn't see what was
     *  already removed. */
    recipe?: Array<{ ingredientName: string; quantity: number; unit: string }> | null;
    /** Per-item override for the global `hideRecipe` flag. When TRUE,
     *  this item's recipe is suppressed even if the ticket-level
     *  `hideRecipe` is FALSE. Set on items where the recipe is too
     *  obvious to be worth printing (drinks, plain sides). */
    hideRecipe?: boolean;
  }>;
  /** Branch-level kill switch. When TRUE every item's recipe is
   *  suppressed regardless of the per-item flag — admin's master
   *  "Print recipe on Kitchen Tickets" toggle in Settings. Defaults
   *  to FALSE (= recipes print) when the caller doesn't pass it, so
   *  legacy callers that never knew about this surface get the new
   *  behaviour for free. */
  hideRecipe?: boolean;
  /** Kitchen section label printed as a sub-header on sectioned KOTs
   *  (e.g. "-- FOOD --", "-- BEVERAGE --"). Desktop-only; web POS
   *  popup flow ignores it. */
  sectionName?: string | null;
}

export function renderKitchenTicketHtml(ticket: KitchenTicketInput): string {
  const activeItems = (ticket.items ?? []).filter((i) => !i.voidedAt);
  // Each item gets a heavy double-line separator underneath — mirrors the
  // kitchen-POS reference layout where cooks scan the ticket from a
  // distance and need the item rows to stand out at a glance.
  const itemsHtml = activeItems
    .map((i) => {
      const removed = (i.removedIngredients ?? i.modifications?.removedNames ?? []).filter((n): n is string => !!n);
      const removedHtml = removed
        .map((n) => `<div class="item-removed">&minus; NO ${escapeHtml(n.toUpperCase())}</div>`)
        .join('');
      const addons = (i.selectedAddons ?? i.addons?.map((a) => a.addonName) ?? []).filter((n): n is string => !!n);
      const addonsHtml = addons
        .map((n) => `<div class="item-addon">+ ${escapeHtml(n)}</div>`)
        .join('');
      // Cashier-added ingredients via the Customise dialog. Falls
      // back to OrderItem.modifications.addedIngredients when the
      // caller hands us a server-side row directly.
      const added = (i.addedIngredients ?? i.modifications?.addedIngredients ?? []) || [];
      const addedHtml = added
        .map((a) => `<div class="item-addon">+ ${escapeHtml(`${a.quantity}${a.unit} ${a.ingredientName}`)}</div>`)
        .join('');
      // Recipe block — small font, indented under the item. Filter out
      // anything the customer asked to remove (case-insensitive name
      // match) so the chef doesn't see "Onion" listed when the line
      // already shouts "− NO ONION" above. Multiply per-serving qty by
      // line quantity so the figure on the ticket matches what stock
      // actually deducts.
      const recipeHtml = renderRecipeBlock(i, ticket);
      return `<div class="item"><div class="item-line">${i.quantity}-:${escapeHtml(i.menuItemName)}</div>${addonsHtml}${addedHtml}${removedHtml}${i.notes ? `<div class="item-note">&rarr; ${escapeHtml(i.notes)}</div>` : ''}${recipeHtml}<div class="item-sep"></div></div>`;
    })
    .join('');

  const createdAt = new Date(ticket.createdAt);
  const dateStr = createdAt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });
  const timeStr = createdAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  const destination = ticket.tableNumber ? `Table ${escapeHtml(String(ticket.tableNumber))}` : escapeHtml(ticket.type);
  const sectionHeader = ticket.sectionName ? escapeHtml(ticket.sectionName) : 'Kitchen Order';

  // Font sizes: item rows at 28px (was 16px) and the Table heading at 32px
  // (was 12px) — roughly 2-3x the original so the kitchen can read the
  // ticket from across the station.
  return `<html><head><style>
    @page { size: 80mm 297mm; margin: 2mm; }
    html, body { margin: 0; padding: 0; color: #000; }
    body { font-family: monospace; width: 76mm; padding: 0; }
    .section { font-size: 14px; text-align: center; letter-spacing: 2px; margin: 0 0 4px; }
    .new-order { font-size: 14px; text-align: center; margin: 2px 0 6px; }
    .datetime { display: flex; justify-content: space-between; font-size: 12px; color: #333; margin: 0 0 6px; }
    .destination { font-size: 32px; font-weight: 900; text-align: center; margin: 4px 0 0; line-height: 1.1; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; }
    .item { margin: 4px 0 0; }
    .item-line { font-size: 28px; font-weight: 900; line-height: 1.15; }
    .item-note { font-size: 16px; font-style: italic; margin-top: 2px; margin-left: 16px; }
    .item-removed { font-size: 18px; font-weight: 900; margin-top: 2px; margin-left: 16px; letter-spacing: 1px; }
    .item-addon { font-size: 18px; font-weight: 700; margin-top: 2px; margin-left: 16px; }
    .item-recipe-label { font-size: 10px; margin-top: 4px; margin-left: 16px; color: #333; letter-spacing: 1px; text-transform: lowercase; }
    .item-recipe-row { font-size: 10px; margin-left: 24px; line-height: 1.4; color: #000; font-family: monospace; }
    .item-recipe-empty { font-size: 10px; margin-top: 4px; margin-left: 16px; color: #555; font-style: italic; }
    .item-sep { border-top: 2px double #000; margin-top: 6px; }
    .notes { font-size: 14px; font-style: italic; margin-top: 10px; }
  </style></head><body>
    <div class="section">${sectionHeader}</div>
    <div class="new-order">New Order</div>
    <div class="datetime"><span>Date:${escapeHtml(dateStr)}</span><span>Time:${escapeHtml(timeStr)}</span></div>
    <div class="destination">${destination}</div>
    <div class="divider"></div>
    ${itemsHtml}
    <div class="notes">Notes: ${ticket.notes ? escapeHtml(ticket.notes) : ''}</div>
    <script>window.onload=function(){window.print();window.close();}<\/script>
  </body></html>`;
}

/**
 * Kitchen ticket print entry-point. Two paths:
 *
 *   1. Electron desktop — routes through window.desktop.print.kitchen(),
 *      which hits the Kitchen slot configured in Printer Settings (network
 *      ESC/POS or OS-installed printer). Silent, no browser dialog.
 *
 *   2. Browser — opens a 80 mm popup window, writes the ticket HTML, and
 *      lets the auto-print <script> fire so the user's default printer
 *      handles it.
 *
 * Returns false when the browser path could not open a popup (blocker
 * triggered). In Electron the function is fire-and-forget — we kick off the
 * IPC call and return true immediately; any hardware error surfaces via the
 * desktop's own toast/settings UI.
 */
export function printKitchenTicket(ticket: KitchenTicketInput): boolean {
  if (typeof window !== 'undefined' && window.desktop?.print?.kitchen) {
    void window.desktop.print.kitchen(ticket);
    return true;
  }
  const html = renderKitchenTicketHtml(ticket);
  const win = window.open('', '_blank', 'width=320,height=600');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Effective recipe rows for a ticket item, ready to render. Filters
 * out anything the customer asked to remove (case-insensitive on the
 * ingredient name) and multiplies per-serving qty by the line
 * quantity so the figure matches the actual stock deduction.
 *
 * Returns null when the recipe shouldn't print at all — branch toggle
 * off, per-item override on, or the item simply has no recipe row.
 * Callers distinguish "no recipe attached" (return value with
 * `kind: 'empty'`) from "explicitly suppressed" (`null`) so they can
 * draw the "(no recipe — sold as-is)" line vs. nothing.
 */
export function effectiveRecipeRows(
  item: KitchenTicketInput['items'][number],
  ticket: { hideRecipe?: boolean },
): { kind: 'empty' } | { kind: 'rows'; rows: Array<{ name: string; qty: number; unit: string }> } | null {
  // Branch-level kill switch beats everything.
  if (ticket.hideRecipe) return null;
  // Per-item override.
  if (item.hideRecipe) return null;
  const recipe = item.recipe ?? [];
  if (recipe.length === 0) return { kind: 'empty' };
  const removed = (item.removedIngredients ?? item.modifications?.removedNames ?? [])
    .filter((n): n is string => !!n)
    .map((n) => n.toLowerCase());
  const filtered = recipe
    .filter((r) => !removed.includes(r.ingredientName.toLowerCase()))
    .map((r) => ({
      name: r.ingredientName,
      qty: r.quantity * item.quantity,
      unit: r.unit,
    }));
  if (filtered.length === 0) return { kind: 'empty' };
  return { kind: 'rows', rows: filtered };
}

function renderRecipeBlock(
  item: KitchenTicketInput['items'][number],
  ticket: KitchenTicketInput,
): string {
  const eff = effectiveRecipeRows(item, ticket);
  if (eff === null) return '';
  if (eff.kind === 'empty') {
    return '<div class="item-recipe-empty">(no recipe &mdash; sold as-is)</div>';
  }
  const rows = eff.rows
    .map((r) => `<div class="item-recipe-row">&middot; ${escapeHtml(formatRecipeQty(r.qty))}${escapeHtml(r.unit)}  ${escapeHtml(r.name)}</div>`)
    .join('');
  return `<div class="item-recipe-label">recipe:</div>${rows}`;
}

/** Trim trailing zeros so `150.0000` prints as `150` and `0.5000` as
 *  `0.5`. Recipe quantities are stored at 4-decimal precision but
 *  rarely use that many in practice. */
function formatRecipeQty(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // Round to 2 decimals max to keep the line short; trim trailing zeros.
  const fixed = Math.round(n * 100) / 100;
  return String(fixed);
}
