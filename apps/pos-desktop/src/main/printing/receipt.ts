import { getPrinters } from '../config/store';
import { sendThermalJob, type ThermalJob } from './escpos';
import { printHtmlToDevice } from './html-print';

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
  currencySymbol?: string; // defaults to BDT's Taka sign
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

  if (slot.mode === 'network') {
    await sendThermalJob(slot, buildReceiptJob(receipt, wantsDrawerKick));
    return;
  }

  // os-printer fallback: HTML rendering. Cash drawer kick cannot be sent
  // this way; we silently skip it.
  await printHtmlToDevice(renderReceiptHtml(receipt), slot.deviceName, {
    pageSize: { width: 80_000, height: 250_000 },
  });
}

/** Standalone cash-drawer kick (when no receipt print is happening). */
export async function openCashDrawer(): Promise<void> {
  const slot = (await getPrinters()).bill;
  if (slot.mode !== 'network') {
    throw new Error('Cash drawer kick requires a network-mode bill printer.');
  }
  await sendThermalJob(slot, { lines: [{ kind: 'newline' }], openCashDrawer: true });
}

/* ── Builders ─────────────────────────────────────────────────────────── */

function buildReceiptJob(receipt: ReceiptInput, openCashDrawer: boolean): ThermalJob {
  const job: ThermalJob = { lines: [], openCashDrawer };
  const currency = receipt.currencySymbol ?? '৳';
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
    body { font-family: monospace; width: 80mm; margin: 0; padding: 6px; font-size: 12px; }
    h1 { font-size: 16px; margin: 0; text-align: center; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    td { padding: 2px 0; vertical-align: top; }
    .center { text-align: center; }
    .right  { text-align: right; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .total { font-weight: bold; font-size: 14px; }
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
    <script>window.onload=function(){setTimeout(function(){window.close();},10);}<\/script>
  </body></html>`;
}
