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
  const itemsHtml = activeItems
    .map(
      (i) =>
        `<tr><td style="padding:4px 0;font-size:16px;font-weight:bold">${i.quantity}\u00d7</td><td style="padding:4px 8px;font-size:16px">${escapeHtml(i.menuItemName)}</td></tr>${i.notes ? `<tr><td></td><td style="font-size:12px;color:#666;padding-bottom:4px">&nbsp;&rarr; ${escapeHtml(i.notes)}</td></tr>` : ''}`,
    )
    .join('');

  const createdAt = new Date(ticket.createdAt);
  const destination = ticket.tableNumber ? `Table ${escapeHtml(String(ticket.tableNumber))}` : escapeHtml(ticket.type);

  return `<html><head><style>
    @page { size: 80mm 297mm; margin: 2mm; }
    html, body { margin: 0; padding: 0; color: #000; }
    body { font-family: monospace; width: 76mm; padding: 0; }
    h1 { font-size: 22px; margin: 0; text-align: center; }
    .meta { font-size: 12px; text-align: center; color: #666; margin: 4px 0 12px; }
    table { width: 100%; border-collapse: collapse; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; }
    .notes { font-size: 12px; font-style: italic; margin-top: 8px; }
  </style></head><body>
    <h1>KITCHEN ORDER</h1>
    <div class="meta">#${escapeHtml(ticket.orderNumber)} &mdash; ${destination}</div>
    <div class="meta">${createdAt.toLocaleTimeString()}</div>
    <div class="divider"></div>
    <table>${itemsHtml}</table>
    <div class="divider"></div>
    ${ticket.notes ? `<div class="notes">Note: ${escapeHtml(ticket.notes)}</div>` : ''}
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
