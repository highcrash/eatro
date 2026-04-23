/**
 * Bangladesh NBR (National Board of Revenue) Mushak helpers.
 *
 * Used by both the API (when issuing an invoice at payment / a credit note
 * on refund) and the POS/Admin (when rendering the printable slip). Keeping
 * everything here avoids a sync drift between how the server assigns the
 * serial and how the client displays it.
 */

const SERIAL_SEQ_WIDTH = 6;

/**
 * Bangladesh fiscal year starts July 1 (Asia/Dhaka) and ends June 30 of the
 * next calendar year. The accountant-friendly label is the last two digits
 * of each year concatenated — e.g. FY 2025-07 through 2026-06 is "2526".
 *
 * We reason in Asia/Dhaka because BD accountants always do. Intl with
 * timeZone: 'Asia/Dhaka' is supported by every modern JS runtime (Node 18+,
 * Chromium, Electron) so this doesn't need a dayjs/luxon dependency.
 */
export function computeFiscalYear(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? NaN);
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? NaN);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '0000';
  // Jul-Dec → FY starts this year. Jan-Jun → FY started previous year.
  const startYear = month >= 7 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}${String(endYear).slice(-2)}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Format: {FY}/{BRANCH}/{SEQ} — e.g. "2526/DHK/000147".
 */
export function formatInvoiceSerial(fiscalYear: string, branchCode: string, seq: number): string {
  return `${fiscalYear}/${branchCode}/${pad(seq, SERIAL_SEQ_WIDTH)}`;
}

/**
 * Format: {FY}/{BRANCH}/NOTE/{SEQ} — e.g. "2526/DHK/NOTE/000023". The extra
 * "NOTE" segment is what distinguishes 6.8 credit/debit notes from 6.3
 * invoices in the register + on printed slips, even though their sequence
 * counters are independent.
 */
export function formatNoteSerial(fiscalYear: string, branchCode: string, seq: number): string {
  return `${fiscalYear}/${branchCode}/NOTE/${pad(seq, SERIAL_SEQ_WIDTH)}`;
}

// ─── Snapshot shape (shared between API + reprint UI) ────────────────────────

export interface MushakSellerBlock {
  legalName: string;
  tradingName: string;
  address: string;
  bin: string;
  phone?: string | null;
}

export interface MushakBuyerBlock {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  bin?: string | null;
}

export interface MushakLineItem {
  /** OrderItem id — empty for aggregated rows or when the underlying item was deleted. */
  id?: string | null;
  name: string;
  /** Optional HS code for items that have one (most restaurant items don't). */
  hsCode?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number; // in currency minor unit (paisa) or major — keep consistent with Order totals
  /** Per-line VAT rate %; if omitted the snapshot reader uses the invoice's branch-level rate. */
  vatRate?: number | null;
  sdRate?: number | null;
  subtotalExclVat: number;
  sdAmount: number;
  vatAmount: number;
  totalInclVat: number;
}

export interface MushakSnapshot {
  serial: string;
  formVersion: '6.3' | '6.8';
  issuedAt: string; // ISO
  fiscalYear: string;
  branchCode: string;
  seq: number;
  seller: MushakSellerBlock;
  buyer?: MushakBuyerBlock | null;
  items: MushakLineItem[];
  // Totals — mirror the top-level Invoice / Note columns so reprints don't
  // need a database round-trip.
  subtotalExclVat: number;
  sdAmount: number;
  vatAmount: number;
  /** Signed paisa rounding delta applied to the total. Zero when no rounding. */
  roundAdjustment?: number;
  totalInclVat: number;
  // Payment method(s) for 6.3; refund method for 6.8.
  paymentSummary?: Array<{ method: string; amount: number }>;
  // Reason block for 6.8 only.
  refund?: {
    invoiceSerial: string;
    reasonCode: string;
    reasonText?: string | null;
    issuedByName?: string | null;
  } | null;
  currency: string;
}

/**
 * Render the 80mm thermal slip for a 6.3 or 6.8 as printable HTML. Used from
 * both the web POS popup path and the reprint UI. The desktop Electron path
 * has its own ESC/POS renderer (receipt.ts) so we don't need to cover that
 * here — but keeping the HTML aligned with the ESC/POS layout means the
 * "Print" fallback looks substantially the same.
 */
export function renderMushakSlipHtml(snapshot: MushakSnapshot): string {
  const esc = (s: string | number | null | undefined) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const isNote = snapshot.formVersion === '6.8';
  const title = isNote ? 'CREDIT NOTE (Mushak-6.8)' : 'TAX INVOICE (Mushak-6.3)';
  const headerColor = isNote ? '#B71C1C' : '#000';
  const dateStr = new Date(snapshot.issuedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });
  const currency = snapshot.currency || 'BDT';
  // All money fields on the snapshot come from Order columns which store
  // paisa (smallest unit). Divide by 100 for display so ৳6184.50 doesn't
  // print as "BDT 618450.00".
  const money = (n: number) => `${currency} ${(n / 100).toFixed(2)}`;

  const itemRows = snapshot.items
    .map(
      (i) => `
      <tr>
        <td style="padding:3px 2px;font-size:12px">${esc(i.name)}</td>
        <td style="padding:3px 2px;font-size:12px;text-align:right">${i.quantity.toFixed(i.quantity % 1 ? 2 : 0)}${i.unit ? '&nbsp;' + esc(i.unit) : ''}</td>
        <td style="padding:3px 2px;font-size:12px;text-align:right">${money(i.unitPrice)}</td>
        <td style="padding:3px 2px;font-size:12px;text-align:right">${money(i.vatAmount)}</td>
        <td style="padding:3px 2px;font-size:12px;text-align:right;font-weight:bold">${money(i.totalInclVat)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(snapshot.serial)}</title><style>
    @page { size: 80mm 297mm; margin: 2mm; }
    html, body { margin: 0; padding: 0; color: #000; font-family: monospace; }
    body { width: 76mm; }
    h1 { font-size: 14px; margin: 4px 0 2px; text-align: center; color: ${headerColor}; letter-spacing: 1px; }
    .seller { text-align: center; font-size: 11px; line-height: 1.3; }
    .seller b { font-size: 13px; }
    .meta { display: flex; justify-content: space-between; font-size: 11px; margin: 6px 0 4px; }
    .buyer { font-size: 11px; margin: 4px 0 6px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #000; padding: 3px 2px; }
    th.r { text-align: right; }
    .totals { margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; font-size: 12px; }
    .totals .row { display: flex; justify-content: space-between; padding: 2px 0; }
    .totals .grand { font-size: 15px; font-weight: 900; border-top: 2px solid #000; margin-top: 3px; padding-top: 3px; }
    .footer { margin-top: 8px; text-align: center; font-size: 10px; color: #333; }
    .reason { font-size: 11px; margin-top: 6px; border: 1px solid #000; padding: 4px; }
  </style></head><body>
    <div class="seller">
      <b>${esc(snapshot.seller.tradingName || snapshot.seller.legalName)}</b><br/>
      ${snapshot.seller.legalName && snapshot.seller.tradingName !== snapshot.seller.legalName ? esc(snapshot.seller.legalName) + '<br/>' : ''}
      ${esc(snapshot.seller.address)}<br/>
      BIN: ${esc(snapshot.seller.bin)}${snapshot.seller.phone ? ' · ' + esc(snapshot.seller.phone) : ''}
    </div>
    <h1>${esc(title)}</h1>
    <div class="meta">
      <span>No: <b>${esc(snapshot.serial)}</b></span>
      <span>${esc(dateStr)}</span>
    </div>
    ${snapshot.buyer && (snapshot.buyer.name || snapshot.buyer.phone || snapshot.buyer.bin)
      ? `<div class="buyer">
          Buyer: ${esc(snapshot.buyer.name ?? 'Walk-in')}
          ${snapshot.buyer.phone ? '<br/>Phone: ' + esc(snapshot.buyer.phone) : ''}
          ${snapshot.buyer.bin ? '<br/>BIN: ' + esc(snapshot.buyer.bin) : ''}
          ${snapshot.buyer.address ? '<br/>' + esc(snapshot.buyer.address) : ''}
        </div>`
      : ''}
    <table>
      <thead><tr>
        <th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">VAT</th><th class="r">Total</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Subtotal (excl VAT)</span><span>${money(snapshot.subtotalExclVat)}</span></div>
      ${snapshot.sdAmount ? `<div class="row"><span>Supplementary Duty</span><span>${money(snapshot.sdAmount)}</span></div>` : ''}
      <div class="row"><span>VAT</span><span>${money(snapshot.vatAmount)}</span></div>
      ${snapshot.roundAdjustment && Math.abs(snapshot.roundAdjustment) > 0 ? `<div class="row"><span>Auto Roundup</span><span>${snapshot.roundAdjustment >= 0 ? '+' : '-'}${money(Math.abs(snapshot.roundAdjustment))}</span></div>` : ''}
      <div class="row grand"><span>${isNote ? 'Refund' : 'Total'}</span><span>${money(snapshot.totalInclVat)}</span></div>
    </div>
    ${isNote && snapshot.refund
      ? `<div class="reason">
          Re: invoice <b>${esc(snapshot.refund.invoiceSerial)}</b><br/>
          Reason: ${esc(snapshot.refund.reasonCode)}${snapshot.refund.reasonText ? ' — ' + esc(snapshot.refund.reasonText) : ''}<br/>
          ${snapshot.refund.issuedByName ? 'Approved by: ' + esc(snapshot.refund.issuedByName) : ''}
        </div>`
      : ''}
    <div class="footer">Mushak-${snapshot.formVersion} · NBR Bangladesh</div>
    <script>window.onload=function(){window.print();window.close();}<\/script>
  </body></html>`;
}

/**
 * Browser helper — opens the slip in a popup window and lets the auto-print
 * script fire. Mirrors printKitchenTicket()'s behaviour but specific to
 * Mushak so callers don't depend on its KDS-oriented signature.
 */
export function printMushakSlip(snapshot: MushakSnapshot): boolean {
  const g = globalThis as unknown as {
    window?: {
      open(url: string, target: string, features: string): {
        document: { write(s: string): void; close(): void };
      } | null;
    };
  };
  if (!g.window) return false;
  const html = renderMushakSlipHtml(snapshot);
  const w = g.window.open('', '_blank', 'width=360,height=700');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
