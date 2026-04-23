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
  }>;
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
    .map(
      (i) =>
        `<div class="item"><div class="item-line">${i.quantity}-:${escapeHtml(i.menuItemName)}</div>${i.notes ? `<div class="item-note">&rarr; ${escapeHtml(i.notes)}</div>` : ''}<div class="item-sep"></div></div>`,
    )
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
