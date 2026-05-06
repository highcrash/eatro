/**
 * A4 print of the Pre-Ready stock sheet — the hardcopy a chef takes
 * to the kitchen at end-of-day to fill in the missing PG production
 * by hand. The on-screen Pre-Ready page only shows the current
 * computed stock; this print adds three empty Batch-1 / Batch-2 /
 * Batch-3 columns + a Current column so the head chef can write in
 * the day's actual production figures and reconcile against the
 * system later.
 *
 * Browser-only — opens a popup window, writes the HTML, fires the
 * auto-print on load. Same pattern as `kitchen-ticket.ts`.
 */

declare const window: {
  open(url: string, target: string, features: string): {
    document: { write(s: string): void; close(): void };
  } | null;
  desktop?: {
    print?: {
      reportA4?: (args: { html: string; landscape?: boolean }) => Promise<{ ok: true } | { ok: false; message: string }>;
    };
  };
};

export interface PreReadyStockSheetItem {
  /** Item name as shown on the Pre-Ready page (e.g. "PG Steam Rice"). */
  name: string;
  /** Current numeric stock — printed verbatim with up to 2 decimal
   *  places + a thousands separator. Negative values stay negative
   *  so the chef sees over-deduction immediately. */
  currentStock: number;
  /** Stock unit shown after the figure (G / KG / ML / PCS / PACKET …). */
  unit: string;
}

export interface PreReadyStockSheetInput {
  /** Optional brand label printed top-left. Defaults to
   *  "PRE-READY STOCK". The user's existing handwritten sheets use
   *  "PG STOCK" — pass that to match their workflow. */
  title?: string;
  /** Defaults to `new Date()`. Exposed so the caller can render
   *  for a stamped time (e.g. "as of 9:07 PM" snapshot). */
  printedAt?: Date;
  items: PreReadyStockSheetItem[];
}

export function renderPreReadyStockSheetHtml(input: PreReadyStockSheetInput): string {
  const title = (input.title ?? 'PRE-READY STOCK').toUpperCase();
  const printedAt = input.printedAt ?? new Date();
  const dateStr = printedAt.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const timeStr = printedAt.toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  // Sort alphabetically — chef wants to scan top-to-bottom by name,
  // not by sortOrder. Stable copy so the caller's array isn't mutated.
  const items = [...input.items].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

  const rowsHtml = items
    .map((it) => {
      const stockText = `${formatStock(it.currentStock)} ${escapeHtml(it.unit)}`;
      return `<tr>
        <td class="cell name">${escapeHtml(it.name)}</td>
        <td class="cell stock">${escapeHtml(stockText)}</td>
        <td class="cell batch"></td>
        <td class="cell batch"></td>
        <td class="cell batch"></td>
        <td class="cell current"></td>
      </tr>`;
    })
    .join('');

  // The header row spans the whole sheet so admin can confirm the
  // title + date at a glance even when the bottom of the page is
  // folded over a clipboard.
  return `<html><head><title>${escapeHtml(title)} — ${escapeHtml(dateStr)}</title><style>
    @page { size: A4; margin: 12mm 14mm; }
    html, body { margin: 0; padding: 0; color: #000; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; }
    .header { display: flex; align-items: stretch; border: 1.5px solid #000; }
    .header .title { flex: 0 0 36%; padding: 8px 10px; font-weight: 700; font-size: 14pt; letter-spacing: 1px; border-right: 1.5px solid #000; }
    .header .date-label { flex: 0 0 14%; padding: 8px 10px; font-weight: 700; font-size: 11pt; border-right: 1.5px solid #000; display: flex; align-items: center; }
    .header .date-value { flex: 1; padding: 8px 10px; font-weight: 600; font-size: 11pt; display: flex; align-items: center; }
    table { width: 100%; border-collapse: collapse; border: 1.5px solid #000; border-top: none; table-layout: fixed; }
    thead th { background: #f0f0f0; border: 1px solid #000; padding: 6px 8px; font-size: 10pt; font-weight: 700; text-align: left; }
    thead th.batch, thead th.current { text-align: center; }
    .cell { border: 1px solid #000; padding: 5px 8px; height: 22px; font-size: 9.5pt; }
    .cell.name { width: 36%; }
    .cell.stock { width: 14%; white-space: nowrap; }
    .cell.batch { width: 12%; }
    .cell.current { width: 14%; }
    /* Row striping prints faintly so the chef can track across
       the row when filling in batches by hand. */
    tbody tr:nth-child(even) .cell { background: #fafafa; }
    @media print {
      tbody tr { page-break-inside: avoid; }
    }
  </style></head><body>
    <div class="header">
      <div class="title">${escapeHtml(title)}</div>
      <div class="date-label">DATE</div>
      <div class="date-value">${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="name">Item</th>
          <th class="stock">Stock</th>
          <th class="batch">Batch-1</th>
          <th class="batch">Batch-2</th>
          <th class="batch">Batch-3</th>
          <th class="current">Current</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <script>window.onload=function(){window.print();}<\/script>
  </body></html>`;
}

/**
 * Print the A4 stock sheet. Two paths:
 *
 *   1. Electron desktop — routes through window.desktop.print.reportA4()
 *      which fires the configured Reports slot silently (the same
 *      Windows printer admin set up for daily reports / receipt
 *      backups). No popup, no print dialog. Fire-and-forget; any
 *      hardware error surfaces via the desktop's own toast.
 *
 *   2. Browser — opens an 820×1100 popup, writes the sheet HTML, and
 *      lets the auto-print <script> fire so the user's default
 *      browser print dialog handles it.
 *
 * Returns false when the browser path could not open a popup
 * (blocker triggered). The desktop path never returns false at the
 * caller site — IPC errors are surfaced by the desktop's own UI.
 */
export function printPreReadyStockSheet(input: PreReadyStockSheetInput): boolean {
  const html = renderPreReadyStockSheetHtml(input);
  if (typeof window !== 'undefined' && window.desktop?.print?.reportA4) {
    void window.desktop.print.reportA4({ html, landscape: false });
    return true;
  }
  // Slightly taller window than the kitchen ticket since A4 is
  // portrait — a 320×600 popup squashes the preview when the OS
  // print dialog opens.
  const win = window.open('', '_blank', 'width=820,height=1100');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

/** Two-decimal max, trim trailing zeros, thousands separator. Kept
 *  local so the print helper has no dependency on `formatCurrency`
 *  (which wraps with the currency symbol — wrong for stock units). */
function formatStock(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const fixed = Math.round(n * 100) / 100;
  const [whole, frac] = String(fixed).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
