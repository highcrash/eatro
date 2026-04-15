import { getPrinters } from '../config/store';
import { sendThermalJob, ThermalError, type ThermalJob } from './escpos';
import { printHtmlToPdfThenShell } from './pdf-print';
import { probe } from './printer-health';
import log from 'electron-log';

// Keep the PDF fallback around for slots the user explicitly prefers that
// path on, even though it's been replaced as the default.
void printHtmlToPdfThenShell;

export interface ReceiptInput {
  brandName: string;
  branchName: string;
  branchAddress?: string;
  branchPhone?: string;
  bin?: string;                          // Business Identification Number (Bangladesh); prints below phone
  mushakVersion?: string;                // e.g. "Mushak-6.3"; optional audit line under BIN
  orderNumber: string;
  tableNumber?: string | null;
  type: string;
  createdAt: string | Date;
  cashierName?: string;
  waiterName?: string;
  guestCount?: number;
  wifiPass?: string;                     // printed as "WIFI PASS:xxx" line
  /** "Paid BILL" / "Customer Copy" / etc. Shown under the table + waiter block. */
  statusLabel?: string;
  items: Array<{
    quantity: number;
    menuItemName: string;
    unitPrice: number;
    lineTotal: number;
    notes?: string | null;
  }>;
  subtotal: number;
  discountAmount?: number;
  discountName?: string | null;
  taxAmount?: number;
  taxRatePct?: number;                   // e.g. 5 for 5%
  roundAdjustment?: number;              // +/- rounding applied to the total (paisa)
  totalAmount: number;
  /** Final paid bill — drives the Payments block. Empty/absent for a bill copy. */
  payments?: Array<{ method: string; amount: number; reference?: string | null }>;
  /** Tendered − total (cash change). Positive = change returned to customer. */
  changeReturned?: number;
  paymentMethod?: string;                // legacy single-method fallback when `payments` is missing
  currencySymbol?: string;               // defaults to "Tk" — Bengali Taka (৳) isn't in PC437 and prints as garbage on ESC/POS
  headerText?: string;                   // optional marketing line above the main separator
  footerText?: string;
  notes?: string;                        // free-form "Notes:" block at the very bottom
}

export interface PrintReceiptOptions {
  /** Set when the order was paid in cash so the drawer pops on a network-mode bill printer. */
  openCashDrawer?: boolean;
}

/**
 * Print the customer receipt / bill on the configured bill printer.
 * For cash payments on a networked thermal printer the drawer kick is
 * appended to the same job — no separate round-trip.
 */
export async function printReceipt(receipt: ReceiptInput, opts: PrintReceiptOptions = {}): Promise<void> {
  const printers = await getPrinters();
  const slot = printers.bill;
  if (slot.mode === 'disabled') {
    throw new Error('Bill printer is not configured. Set it in Printer Settings.');
  }

  const wantsDrawerKick = Boolean(opts.openCashDrawer && printers.openCashDrawerOnCashPayment);

  // Both network and os-printer modes go through sendThermalJob now —
  // os-printer is handled by compiling ESC/POS bytes in memory and
  // shipping them RAW through the Windows spooler (see escpos.ts).
  // Cash drawer kick works in both modes because it's an ESC/POS
  // command, not a driver feature.
  await sendThermalJob(slot, buildReceiptJob(receipt, wantsDrawerKick));
}

/**
 * Standalone cash-drawer kick. Tries the bill slot first; if that slot is
 * disabled or currently unreachable, falls back to the kitchen slot — which
 * is typically wired to the drawer in a single-printer shop. Either way
 * throws a ThermalError if nothing works, so the POS can surface an error.
 */
export async function openCashDrawer(): Promise<void> {
  const cfg = await getPrinters();
  const candidates: ReturnType<typeof pickNetwork>[] = [pickNetwork(cfg.bill), pickNetwork(cfg.kitchen)].filter(
    (s) => s != null,
  ) as ReturnType<typeof pickNetwork>[];
  if (candidates.length === 0) {
    throw new Error('Cash drawer kick requires a network-mode thermal printer on either the bill or kitchen slot.');
  }

  let lastError: unknown = null;
  for (const slot of candidates) {
    const health = await probe(slot);
    if (health.status === 'unreachable') {
      lastError = new Error(health.lastError ?? 'unreachable');
      log.warn(`[drawer] slot ${slot.host}:${slot.port} unreachable, trying next`);
      continue;
    }
    try {
      await sendThermalJob(slot, { lines: [{ kind: 'newline' }], openCashDrawer: true });
      return;
    } catch (err) {
      lastError = err;
      if (!(err instanceof ThermalError) || (err.kind !== 'timeout' && err.kind !== 'unreachable')) {
        throw err; // protocol / config errors won't succeed on another slot.
      }
      log.warn(`[drawer] slot ${slot.host}:${slot.port} threw ${err.kind}, trying next`);
    }
  }
  throw lastError ?? new Error('All configured drawer-capable printers failed');
}

function pickNetwork(slot: { mode: string; host?: string; port?: number }): { mode: 'network'; host: string; port: number } | null {
  if (slot.mode === 'network' && slot.host && slot.port) {
    return { mode: 'network', host: slot.host, port: slot.port };
  }
  return null;
}

/* ── Builders ─────────────────────────────────────────────────────────── */

// Rongta RP335A (and most 80 mm ESC/POS thermal printers) fit 48
// characters per line in the default Font A (12 × 24 at 12 cpi).
const LINE_WIDTH = 48;

function money(currency: string, paisa: number): string {
  return `${currency}${(paisa / 100).toFixed(2)}`;
}

/** Full-width key/value row with right-aligned value. */
function row(label: string, value: string): string {
  const maxLabel = LINE_WIDTH - value.length - 1;
  const trimmedLabel = label.length > maxLabel ? label.slice(0, maxLabel) : label;
  const spaces = LINE_WIDTH - trimmedLabel.length - value.length;
  return `${trimmedLabel}${' '.repeat(Math.max(1, spaces))}${value}`;
}

/** Left + right segments aligned at start and end. Used for header lines
 *  like "Date:16-Apr-26            Time:05:29 PM". */
function splitLine(left: string, right: string): string {
  const spaces = Math.max(1, LINE_WIDTH - left.length - right.length);
  return `${left}${' '.repeat(spaces)}${right}`;
}

/** Item row with 4 columns: qty, name, unit price, line total. Matches
 *  the reference bill layout:
 *    "  1 Nantan Chicken               390.00   390.00" */
function itemRow(qty: number, name: string, unit: string, total: string): string {
  const qtyCol = String(qty).padStart(3, ' ');
  const unitCol = unit.padStart(9, ' ');
  const totalCol = total.padStart(9, ' ');
  // Remaining width for the name: 48 − 3 − 1 − 9 − 1 − 9 = 25 chars.
  const nameWidth = LINE_WIDTH - qtyCol.length - 1 - unitCol.length - 1 - totalCol.length;
  const nameCol = (name.length > nameWidth ? name.slice(0, nameWidth - 1) + '.' : name)
    .padEnd(nameWidth, ' ');
  return `${qtyCol} ${nameCol}${unitCol} ${totalCol}`;
}

/** A wider "====" divider matching the reference design. */
function doubleDivider(): string {
  return '='.repeat(LINE_WIDTH);
}

function formatDate(d: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  const yr = String(d.getFullYear()).slice(-2);
  return `${day}-${mon}-${yr}`;
}

function formatTime(d: Date): string {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

function buildReceiptJob(receipt: ReceiptInput, openCashDrawer: boolean): ThermalJob {
  const job: ThermalJob = { lines: [], openCashDrawer };
  const currency = receipt.currencySymbol ?? 'Tk';
  const createdAt = new Date(receipt.createdAt);

  // ── Header (centered): brand, address, phone, BIN, Mushak ────────────
  job.lines.push({ kind: 'align-center' });
  job.lines.push({ kind: 'text', text: receipt.brandName, bold: true, size: 'large' });
  if (receipt.branchAddress) job.lines.push({ kind: 'text', text: receipt.branchAddress });
  if (receipt.branchPhone) job.lines.push({ kind: 'text', text: `Phone:${receipt.branchPhone}` });
  if (receipt.bin) job.lines.push({ kind: 'text', text: `BIN:${receipt.bin}` });
  if (receipt.mushakVersion) job.lines.push({ kind: 'text', text: receipt.mushakVersion });

  // Optional marketing header line between the brand block and the separator.
  if (receipt.headerText) {
    job.lines.push({ kind: 'text', text: receipt.headerText });
  }

  job.lines.push({ kind: 'text', text: doubleDivider() });

  // ── Table / Waiter / Status (left-aligned) ────────────────────────────
  job.lines.push({ kind: 'align-left' });
  if (receipt.tableNumber) job.lines.push({ kind: 'text', text: `Table: ${receipt.tableNumber}` });
  else job.lines.push({ kind: 'text', text: `Type : ${receipt.type}` });
  if (receipt.waiterName) job.lines.push({ kind: 'text', text: `Waiter:${receipt.waiterName}` });
  if (receipt.statusLabel) {
    job.lines.push({ kind: 'align-center' });
    job.lines.push({ kind: 'text', text: receipt.statusLabel, bold: true });
    job.lines.push({ kind: 'align-left' });
  }

  job.lines.push({ kind: 'text', text: doubleDivider() });

  // ── Date / Time / Invoice / Guests ────────────────────────────────────
  job.lines.push({
    kind: 'text',
    text: splitLine(`Date:${formatDate(createdAt)}`, `Time:${formatTime(createdAt)}`),
  });
  const invoiceLine = splitLine(
    `Invoice No:(${receipt.orderNumber})`,
    `Number Of Guests:${receipt.guestCount ?? 0}`,
  );
  job.lines.push({ kind: 'text', text: invoiceLine });
  if (receipt.cashierName) job.lines.push({ kind: 'text', text: `Cashier:${receipt.cashierName}` });

  if (receipt.wifiPass) {
    job.lines.push({ kind: 'text', text: doubleDivider() });
    job.lines.push({ kind: 'align-center' });
    job.lines.push({ kind: 'text', text: `WIFI PASS:${receipt.wifiPass}` });
    job.lines.push({ kind: 'align-left' });
  }

  job.lines.push({ kind: 'text', text: doubleDivider() });

  // ── Items table ───────────────────────────────────────────────────────
  // Header row: Qty [name 25w]     Price  T.Price — widths match itemRow().
  const nameHeader = 'Item Name'.padEnd(LINE_WIDTH - 3 - 1 - 9 - 1 - 9, ' ');
  job.lines.push({
    kind: 'text',
    text: `Qty ${nameHeader}${'Price'.padStart(9, ' ')} ${'T.Price'.padStart(9, ' ')}`,
    bold: true,
  });
  for (const it of receipt.items) {
    job.lines.push({
      kind: 'text',
      text: itemRow(
        it.quantity,
        it.menuItemName,
        money(currency, it.unitPrice).replace(currency, ''),
        money(currency, it.lineTotal).replace(currency, ''),
      ),
    });
    if (it.notes) job.lines.push({ kind: 'text', text: `    (${it.notes})` });
  }

  job.lines.push({ kind: 'text', text: doubleDivider() });

  // ── Totals block ──────────────────────────────────────────────────────
  job.lines.push({ kind: 'text', text: row('Ticket Total:', money(currency, receipt.subtotal)) });
  if (receipt.discountAmount && receipt.discountAmount > 0) {
    const label = receipt.discountName ? `${receipt.discountName}:` : 'Special Discount:';
    job.lines.push({ kind: 'text', text: row(label, `-${money(currency, receipt.discountAmount)}`) });
  }

  const netTotal = receipt.subtotal - (receipt.discountAmount ?? 0);
  job.lines.push({ kind: 'text', text: doubleDivider() });
  job.lines.push({ kind: 'text', text: row('Net Total:', money(currency, netTotal)) });

  if (receipt.taxAmount && receipt.taxAmount > 0) {
    const taxLabel = receipt.taxRatePct != null ? `Vat-${receipt.taxRatePct.toFixed(2)}%:` : 'Tax:';
    job.lines.push({ kind: 'text', text: row(taxLabel, money(currency, receipt.taxAmount)) });
  }
  if (receipt.roundAdjustment && Math.abs(receipt.roundAdjustment) > 0) {
    const sign = receipt.roundAdjustment >= 0 ? '+' : '-';
    const label = `Auto Round${sign}/-1.00:`;
    job.lines.push({ kind: 'text', text: row(label, money(currency, Math.abs(receipt.roundAdjustment))) });
  }

  job.lines.push({ kind: 'text', text: doubleDivider() });
  job.lines.push({ kind: 'text', text: row('Gross Total:', money(currency, receipt.totalAmount)), bold: true });

  // ── Payments block (only on paid copies) ──────────────────────────────
  const payments = receipt.payments ?? [];
  if (payments.length > 0) {
    job.lines.push({ kind: 'text', text: 'Payments:' });
    let totalPaid = 0;
    for (const p of payments) {
      totalPaid += p.amount;
      job.lines.push({ kind: 'text', text: row(` -${p.method}:`, money(currency, p.amount)) });
    }
    job.lines.push({ kind: 'text', text: row('-TOTAL PAYMENT:', money(currency, totalPaid)), bold: true });
    if (receipt.changeReturned != null) {
      job.lines.push({ kind: 'text', text: row('RETURNED AMOUNT:', money(currency, receipt.changeReturned)) });
    }
  } else {
    // Bill copy — show remaining amount instead of payments.
    job.lines.push({ kind: 'text', text: row('REMAINING AMOUNT:', money(currency, receipt.totalAmount)) });
  }

  if (receipt.notes && receipt.notes.trim()) {
    job.lines.push({ kind: 'text', text: `Notes: ${receipt.notes.trim()}` });
  } else {
    job.lines.push({ kind: 'text', text: 'Notes:' });
  }

  // ── Footer ────────────────────────────────────────────────────────────
  if (receipt.footerText) {
    job.lines.push({ kind: 'newline' });
    job.lines.push({ kind: 'align-center' });
    job.lines.push({ kind: 'text', text: receipt.footerText });
  }
  job.lines.push({ kind: 'newline' });
  job.lines.push({ kind: 'cut' });

  return job;
}

/** Minimal HTML receipt used only when the bill slot is in os-printer mode. */
function renderReceiptHtml(r: ReceiptInput): string {
  const currency = r.currencySymbol ?? '৳';
  const esc = (s: string) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const createdAt = new Date(r.createdAt);
  const itemsHtml = r.items.map((it) => `
    <tr><td>${it.quantity}× ${esc(it.menuItemName)}</td><td style="text-align:right">${currency}${it.lineTotal.toFixed(2)}</td></tr>
    ${it.notes ? `<tr><td colspan="2" style="font-size:10px;color:#666">  (${esc(it.notes)})</td></tr>` : ''}
  `).join('');

  return `<html><head><style>
    /* 80mm × 297mm fixed: "auto" height is unreliable across Windows thermal
       drivers (some render a zero-height page and the receipt prints blank).
       A tall fixed height works on every driver we've seen — the roll
       printer cuts at end-of-content anyway. */
    @page { size: 80mm 297mm; margin: 2mm; }
    html, body { margin: 0; padding: 0; color: #000; }
    body { font-family: monospace; width: 76mm; padding: 0; font-size: 11px; line-height: 1.3; }
    h1 { font-size: 15px; margin: 0; text-align: center; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    td { padding: 1px 0; vertical-align: top; }
    .center { text-align: center; }
    .right  { text-align: right; }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
    .total { font-weight: bold; font-size: 13px; }
  </style></head><body>
    <h1>${esc(r.brandName)}</h1>
    <p class="center">${esc(r.branchName)}</p>
    ${r.branchAddress ? `<p class="center">${esc(r.branchAddress)}</p>` : ''}
    ${r.branchPhone ? `<p class="center">${esc(r.branchPhone)}</p>` : ''}
    <div class="divider"></div>
    <p>Order #${esc(r.orderNumber)} — ${r.tableNumber ? 'Table ' + esc(String(r.tableNumber)) : esc(r.type)}</p>
    <p>${createdAt.toLocaleString()}</p>
    ${r.cashierName ? `<p>By: ${esc(r.cashierName)}</p>` : ''}
    <div class="divider"></div>
    <table>${itemsHtml}</table>
    <div class="divider"></div>
    <table>
      <tr><td>Subtotal</td><td class="right">${currency}${r.subtotal.toFixed(2)}</td></tr>
      ${r.discountAmount ? `<tr><td>Discount</td><td class="right">-${currency}${r.discountAmount.toFixed(2)}</td></tr>` : ''}
      ${r.taxAmount ? `<tr><td>Tax</td><td class="right">${currency}${r.taxAmount.toFixed(2)}</td></tr>` : ''}
      <tr class="total"><td>TOTAL</td><td class="right">${currency}${r.totalAmount.toFixed(2)}</td></tr>
    </table>
    ${r.paymentMethod ? `<p>Paid via: ${esc(r.paymentMethod)}</p>` : ''}
    <div class="divider"></div>
    <p class="center">${esc(r.footerText ?? 'Thank you!')}</p>
  </body></html>`;
}
