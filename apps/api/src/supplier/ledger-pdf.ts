// pdfkit has no ESM build; load via require so it works without
// esModuleInterop on the api tsconfig. Mirrors the load pattern in
// purchasing/po-pdf.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');

/**
 * Supplier ledger PDF — server-side renderer for the same data the
 * admin Suppliers page already prints in-browser. Used by the
 * "Send Ledger via WhatsApp" action so the supplier gets the same
 * statement we'd print on letterhead. Layout is intentionally close
 * to the existing HTML print so admins reading both side-by-side
 * see matching numbers.
 */

export interface SupplierLedgerPdfInput {
  branch: { name: string; address?: string | null; phone?: string | null };
  supplier: { name: string; contactName?: string | null; phone?: string | null; address?: string | null };
  /** Aggregate balances. All amounts in paisa. */
  openingBalance: number;
  totalBilled: number;
  totalPaid: number;
  totalReturned: number;
  totalAdjustments: number;
  balance: number;
  /** Date range printed in the header. Optional — defaults to "All
   *  history" so admin can hand the supplier a full statement
   *  without filtering. */
  from?: Date | null;
  to?: Date | null;
  purchaseOrders: Array<{
    id: string;
    status: string;
    createdAt: Date | string;
    receivedAt?: Date | string | null;
    itemsTotal: number;
    discount?: number | null;
    discountReason?: string | null;
    fees?: Array<{ label: string; amount: number }>;
    poNumber: string;
  }>;
  returns: Array<{
    id: string;
    createdAt: Date | string;
    total: number;
    reason?: string | null;
  }>;
  payments: Array<{
    id: string;
    createdAt: Date | string;
    amount: number;
    method?: string | null;
    notes?: string | null;
  }>;
  adjustments: Array<{
    id: string;
    createdAt: Date | string;
    amount: number;
    reason?: string | null;
  }>;
}

const PAGE_MARGIN = 40;
const TABLE_WIDTH = 515; // A4 width 595 minus 2× margin

function fmtMoney(paisa: number): string {
  // Bangla taka glyph (৳) isn't in pdfkit's built-in Helvetica. Use
  // "Tk" so the PDF reads fine on any device without bundling a
  // Bangla TTF — same trade-off as the PO PDF.
  const v = paisa / 100;
  const sign = v < 0 ? '-' : '';
  return `${sign}Tk ${Math.abs(v).toFixed(2)}`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB');
}

export async function buildSupplierLedgerPdf(input: SupplierLedgerPdfInput): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Branch header ────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(16).text(input.branch.name, { align: 'left' });
    doc.font('Helvetica').fontSize(9).fillColor('#555');
    if (input.branch.address) doc.text(input.branch.address);
    if (input.branch.phone) doc.text(input.branch.phone);
    doc.moveDown(0.5);

    // ── Title strip ──────────────────────────────────────────────
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(20).text('SUPPLIER LEDGER', { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#555');
    if (input.from || input.to) {
      const fromLabel = input.from ? fmtDate(input.from) : '—';
      const toLabel = input.to ? fmtDate(input.to) : 'today';
      doc.text(`${fromLabel} to ${toLabel}`, { align: 'right' });
    } else {
      doc.text('All history', { align: 'right' });
    }
    doc.text(`Generated ${new Date().toLocaleDateString('en-GB')}`, { align: 'right' });
    doc.moveDown(1);

    // ── Supplier block ───────────────────────────────────────────
    const supplierTop = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('SUPPLIER', PAGE_MARGIN, supplierTop);
    doc.font('Helvetica').fontSize(11).text(input.supplier.name);
    doc.fontSize(9).fillColor('#555');
    if (input.supplier.contactName) doc.text(`Attn: ${input.supplier.contactName}`);
    if (input.supplier.phone) doc.text(input.supplier.phone);
    if (input.supplier.address) doc.text(input.supplier.address, { width: 280 });
    doc.moveDown(1);
    doc.fillColor('#000');

    // ── Summary card ─────────────────────────────────────────────
    const summaryTop = doc.y;
    const summaryRows: Array<[string, number, string?]> = [
      ['Opening balance', input.openingBalance],
      ['+ Total billed', input.totalBilled],
      ['− Total paid', -input.totalPaid],
      ['− Total returned', -input.totalReturned],
    ];
    if (input.totalAdjustments !== 0) {
      summaryRows.push([`${input.totalAdjustments >= 0 ? '+' : '−'} Adjustments`, Math.abs(input.totalAdjustments)]);
    }

    doc.font('Helvetica-Bold').fontSize(10).text('BALANCE SUMMARY', PAGE_MARGIN, summaryTop);
    let sy = summaryTop + 16;
    doc.font('Helvetica').fontSize(10);
    for (const [label, amount] of summaryRows) {
      doc.fillColor('#555').text(label, PAGE_MARGIN, sy, { width: 200 });
      doc.fillColor('#000').text(fmtMoney(amount), PAGE_MARGIN + 200, sy, { width: 100, align: 'right' });
      sy += 14;
    }
    sy += 4;
    doc.moveTo(PAGE_MARGIN, sy).lineTo(PAGE_MARGIN + 300, sy).strokeColor('#333').stroke();
    sy += 6;
    doc.font('Helvetica-Bold').fontSize(11);
    doc.fillColor('#000').text('OUTSTANDING', PAGE_MARGIN, sy, { width: 200 });
    // Positive balance = supplier is owed; negative = supplier
    // has a credit on file (they paid in advance / over-credited).
    const balColor = input.balance > 0 ? '#c62828' : '#2e7d32';
    doc.fillColor(balColor).text(fmtMoney(input.balance), PAGE_MARGIN + 200, sy, { width: 100, align: 'right' });
    doc.fillColor('#000');
    sy += 22;
    doc.y = sy;

    // ── Activity tables ──────────────────────────────────────────
    drawSection(doc, 'PURCHASE ORDERS', [
      { label: '#', width: 30 },
      { label: 'Date', width: 70 },
      { label: 'PO', width: 90 },
      { label: 'Status', width: 80 },
      { label: 'Total', width: 90, align: 'right' },
    ], input.purchaseOrders.map((po, i) => {
      const total = po.itemsTotal
        + (po.fees ?? []).reduce((s, f) => s + Number(f?.amount ?? 0), 0)
        - Number(po.discount ?? 0);
      return [
        String(i + 1),
        fmtDate(po.receivedAt ?? po.createdAt),
        po.poNumber,
        po.status,
        fmtMoney(total),
      ];
    }));

    if (input.payments.length > 0) {
      drawSection(doc, 'PAYMENTS', [
        { label: '#', width: 30 },
        { label: 'Date', width: 80 },
        { label: 'Method', width: 80 },
        { label: 'Notes', width: 170 },
        { label: 'Amount', width: 90, align: 'right' },
      ], input.payments.map((p, i) => [
        String(i + 1),
        fmtDate(p.createdAt),
        (p.method ?? '—').toString(),
        (p.notes ?? '').slice(0, 60),
        fmtMoney(p.amount),
      ]));
    }

    if (input.returns.length > 0) {
      drawSection(doc, 'RETURNS', [
        { label: '#', width: 30 },
        { label: 'Date', width: 80 },
        { label: 'Reason', width: 250 },
        { label: 'Amount', width: 90, align: 'right' },
      ], input.returns.map((r, i) => [
        String(i + 1),
        fmtDate(r.createdAt),
        (r.reason ?? '').slice(0, 90),
        fmtMoney(r.total),
      ]));
    }

    if (input.adjustments.length > 0) {
      drawSection(doc, 'ADJUSTMENTS', [
        { label: '#', width: 30 },
        { label: 'Date', width: 80 },
        { label: 'Reason', width: 250 },
        { label: 'Amount', width: 90, align: 'right' },
      ], input.adjustments.map((a, i) => [
        String(i + 1),
        fmtDate(a.createdAt),
        (a.reason ?? '').slice(0, 90),
        fmtMoney(a.amount),
      ]));
    }

    doc.font('Helvetica').fontSize(8).fillColor('#999')
      .text(`Generated by Restora POS · ${new Date().toLocaleString()}`, PAGE_MARGIN, 800, { width: TABLE_WIDTH, align: 'center' });

    doc.end();
  });
}

interface ColumnDef {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

/** Render a labelled section with a header row + tabular body. Auto-
 *  paginates when the section runs past the page bottom. Empty
 *  sections render a single "No entries" row so the supplier sees
 *  every header even when it's a fresh ledger. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawSection(doc: any, heading: string, columns: ColumnDef[], rows: string[][]) {
  if (doc.y > 700) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(heading, PAGE_MARGIN, doc.y);
  doc.moveDown(0.4);

  const top = doc.y;
  let x = PAGE_MARGIN;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333');
  for (const col of columns) {
    doc.text(col.label, x, top, { width: col.width, align: col.align ?? 'left' });
    x += col.width;
  }
  doc.moveTo(PAGE_MARGIN, top + 13).lineTo(PAGE_MARGIN + columns.reduce((s, c) => s + c.width, 0), top + 13).strokeColor('#333').stroke();
  doc.y = top + 18;

  if (rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#888').text('No entries.', PAGE_MARGIN, doc.y);
    doc.fillColor('#000');
    doc.moveDown(1);
    return;
  }

  doc.font('Helvetica').fontSize(9).fillColor('#000');
  for (const row of rows) {
    if (doc.y > 770) {
      doc.addPage();
      doc.y = PAGE_MARGIN;
    }
    let cx = PAGE_MARGIN;
    const rowTop = doc.y;
    let rowH = 12;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const cell = row[i] ?? '';
      doc.text(cell, cx, rowTop, { width: col.width, align: col.align ?? 'left' });
      const h = doc.heightOfString(cell, { width: col.width });
      if (h > rowH) rowH = h;
      cx += col.width;
    }
    doc.y = rowTop + Math.max(14, rowH + 2);
    doc.moveTo(PAGE_MARGIN, doc.y - 2).lineTo(PAGE_MARGIN + columns.reduce((s, c) => s + c.width, 0), doc.y - 2).strokeColor('#eee').stroke();
  }
  doc.moveDown(0.6);
}
