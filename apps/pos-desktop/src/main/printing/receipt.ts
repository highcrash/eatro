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
  orderNumber: string;
  tableNumber?: string | null;
  type: string;
  createdAt: string | Date;
  cashierName?: string;
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
  totalAmount: number;
  paymentMethod?: string;
  currencySymbol?: string; // defaults to "Tk" — Bengali Taka (৳) isn't in PC437 and prints as garbage on ESC/POS
  footerText?: string;
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

/** Money values arrive in paisa / minor units. Thermal receipts show
 *  "Tk 380.00" style, so divide by 100 and format to 2 decimals. */
function money(currency: string, paisa: number): string {
  return `${currency}${(paisa / 100).toFixed(2)}`;
}

/** Left label + right-aligned value across the full line width, with at
 *  least one space between. Truncates label if needed. */
function row(label: string, value: string): string {
  const maxLabel = LINE_WIDTH - value.length - 1;
  const trimmedLabel = label.length > maxLabel ? label.slice(0, maxLabel) : label;
  const spaces = LINE_WIDTH - trimmedLabel.length - value.length;
  return `${trimmedLabel}${' '.repeat(Math.max(1, spaces))}${value}`;
}

function buildReceiptJob(receipt: ReceiptInput, openCashDrawer: boolean): ThermalJob {
  const job: ThermalJob = { lines: [], openCashDrawer };
  // ESC/POS printers use PC437 by default; no Bengali Taka glyph there, so
  // default to "Tk" which renders reliably.
  const currency = receipt.currencySymbol ?? 'Tk';
  const createdAt = new Date(receipt.createdAt);

  job.lines.push({ kind: 'align-center' });
  job.lines.push({ kind: 'text', text: receipt.brandName, bold: true, size: 'large' });
  job.lines.push({ kind: 'text', text: receipt.branchName });
  if (receipt.branchAddress) job.lines.push({ kind: 'text', text: receipt.branchAddress });
  if (receipt.branchPhone) job.lines.push({ kind: 'text', text: receipt.branchPhone });

  job.lines.push({ kind: 'divider' });
  job.lines.push({ kind: 'align-left' });
  job.lines.push({ kind: 'text', text: `Order #${receipt.orderNumber}` });
  job.lines.push({
    kind: 'text',
    text: receipt.tableNumber ? `Table: ${receipt.tableNumber}` : `Type : ${receipt.type}`,
  });
  job.lines.push({ kind: 'text', text: createdAt.toLocaleString() });
  if (receipt.cashierName) job.lines.push({ kind: 'text', text: `Cashier: ${receipt.cashierName}` });

  job.lines.push({ kind: 'divider' });
  for (const it of receipt.items) {
    const lineTotal = money(currency, it.lineTotal);
    const name = `${it.quantity}x ${it.menuItemName}`;
    job.lines.push({ kind: 'text', text: row(name, lineTotal) });
    if (it.quantity > 1) {
      // Secondary "@ Tk unit" line, indented so it reads as a sub-item.
      job.lines.push({ kind: 'text', text: `   @ ${money(currency, it.unitPrice)}` });
    }
    if (it.notes) job.lines.push({ kind: 'text', text: `   (${it.notes})` });
  }

  job.lines.push({ kind: 'divider' });
  job.lines.push({ kind: 'text', text: row('Subtotal', money(currency, receipt.subtotal)) });
  if (receipt.discountAmount && receipt.discountAmount > 0) {
    const label = receipt.discountName ? `Discount (${receipt.discountName})` : 'Discount';
    job.lines.push({ kind: 'text', text: row(label, `-${money(currency, receipt.discountAmount)}`) });
  }
  if (receipt.taxAmount && receipt.taxAmount > 0) {
    job.lines.push({ kind: 'text', text: row('Tax', money(currency, receipt.taxAmount)) });
  }
  job.lines.push({ kind: 'text', text: row('TOTAL', money(currency, receipt.totalAmount)), bold: true });
  if (receipt.paymentMethod) {
    job.lines.push({ kind: 'text', text: `Paid via: ${receipt.paymentMethod}` });
  }

  job.lines.push({ kind: 'divider' });
  job.lines.push({ kind: 'align-center' });
  job.lines.push({ kind: 'text', text: receipt.footerText ?? 'Thank you!' });
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
