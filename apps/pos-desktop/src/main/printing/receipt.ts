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

function buildReceiptJob(receipt: ReceiptInput, openCashDrawer: boolean): ThermalJob {
  const job: ThermalJob = { lines: [], openCashDrawer };
  // ESC/POS printers use PC437 by default, which has no Bengali Taka
  // glyph — so "৳" either prints as "?" or gets swallowed. Default to
  // "Tk" which is what handwritten Bengali receipts traditionally use.
  const currency = receipt.currencySymbol ?? 'Tk';
  const createdAt = new Date(receipt.createdAt);

  job.lines.push({ kind: 'align-center' });
  job.lines.push({ kind: 'text', text: receipt.brandName, bold: true, size: 'large' });
  job.lines.push({ kind: 'text', text: receipt.branchName });
  if (receipt.branchAddress) job.lines.push({ kind: 'text', text: receipt.branchAddress });
  if (receipt.branchPhone) job.lines.push({ kind: 'text', text: receipt.branchPhone });

  job.lines.push({ kind: 'divider' });
  job.lines.push({ kind: 'align-left' });
  job.lines.push({ kind: 'text', text: `Order: #${receipt.orderNumber}` });
  job.lines.push({
    kind: 'text',
    text: receipt.tableNumber ? `Table: ${receipt.tableNumber}` : `Type : ${receipt.type}`,
  });
  job.lines.push({ kind: 'text', text: `Time : ${createdAt.toLocaleString()}` });
  if (receipt.cashierName) job.lines.push({ kind: 'text', text: `By   : ${receipt.cashierName}` });

  job.lines.push({ kind: 'divider' });
  for (const it of receipt.items) {
    job.lines.push({
      kind: 'text',
      text: `${it.quantity}x ${it.menuItemName}`.slice(0, 30),
    });
    const priceLine = padRight(`  @ ${currency}${it.unitPrice.toFixed(2)}`, 20) +
      `${currency}${it.lineTotal.toFixed(2)}`;
    job.lines.push({ kind: 'text', text: priceLine });
    if (it.notes) job.lines.push({ kind: 'text', text: `  (${it.notes})` });
  }

  job.lines.push({ kind: 'divider' });
  job.lines.push({ kind: 'text', text: padLabel('Subtotal', `${currency}${receipt.subtotal.toFixed(2)}`) });
  if (receipt.discountAmount && receipt.discountAmount > 0) {
    job.lines.push({
      kind: 'text',
      text: padLabel(`Discount${receipt.discountName ? ' (' + receipt.discountName + ')' : ''}`,
        `-${currency}${receipt.discountAmount.toFixed(2)}`),
    });
  }
  if (receipt.taxAmount && receipt.taxAmount > 0) {
    job.lines.push({ kind: 'text', text: padLabel('Tax', `${currency}${receipt.taxAmount.toFixed(2)}`) });
  }
  job.lines.push({ kind: 'text', text: padLabel('TOTAL', `${currency}${receipt.totalAmount.toFixed(2)}`), bold: true });
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

function padLabel(label: string, amount: string): string {
  const totalWidth = 32;
  const amountLen = amount.length;
  const labelLen = label.length;
  const spaces = Math.max(1, totalWidth - amountLen - labelLen);
  return `${label}${' '.repeat(spaces)}${amount}`;
}
function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
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
