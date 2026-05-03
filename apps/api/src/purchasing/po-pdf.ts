// pdfkit has no ESM build; load via require so it works without
// esModuleInterop on the api tsconfig.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');

export interface POPdfInput {
  id: string;
  poNumber: string;
  status: string;
  createdAt: Date;
  expectedAt?: Date | null;
  notes: string | null;
  branch: { name: string; address?: string | null; phone?: string | null };
  supplier: { name: string; contactName?: string | null; phone?: string | null; address?: string | null };
  items: Array<{
    name: string;
    quantityOrdered: number;
    unit: string;
    unitCostPaisa: number;
  }>;
}

const PAGE_MARGIN = 40;

// pdfkit's built-in fonts cover Latin-1 only. The Bangla taka glyph
// (৳) renders as a missing-glyph box. We substitute "Tk" so the PDF
// is readable on any device without bundling a Bangla TTF.
function fmtMoney(paisa: number): string {
  return `Tk ${(paisa / 100).toFixed(2)}`;
}

function fmtQty(qty: number): string {
  return Number(qty).toFixed(3).replace(/\.?0+$/, '');
}

export async function buildPurchaseOrderPdf(po: POPdfInput): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Branch header ────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(16).text(po.branch.name, { align: 'left' });
    doc.font('Helvetica').fontSize(9).fillColor('#555');
    if (po.branch.address) doc.text(po.branch.address);
    if (po.branch.phone) doc.text(po.branch.phone);
    doc.moveDown(0.5);

    // ── Title strip ──────────────────────────────────────────────
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(20).text('PURCHASE ORDER', { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#555')
      .text(`PO #${po.poNumber}`, { align: 'right' })
      .text(po.createdAt.toLocaleDateString(), { align: 'right' })
      .text(`Status: ${po.status}`, { align: 'right' });
    if (po.expectedAt) {
      doc.text(`Expected: ${po.expectedAt.toLocaleDateString()}`, { align: 'right' });
    }
    doc.moveDown(1);

    // ── Supplier block ───────────────────────────────────────────
    const supplierTop = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('SUPPLIER', PAGE_MARGIN, supplierTop);
    doc.font('Helvetica').fontSize(11).text(po.supplier.name);
    doc.fontSize(9).fillColor('#555');
    if (po.supplier.contactName) doc.text(`Attn: ${po.supplier.contactName}`);
    if (po.supplier.phone) doc.text(po.supplier.phone);
    if (po.supplier.address) doc.text(po.supplier.address, { width: 280 });
    doc.moveDown(1);
    doc.fillColor('#000');

    // ── Items table ──────────────────────────────────────────────
    const tableTop = doc.y + 6;
    const cols = {
      idx: { x: PAGE_MARGIN, w: 22 },
      name: { x: PAGE_MARGIN + 22, w: 230 },
      qty: { x: PAGE_MARGIN + 252, w: 70, align: 'right' as const },
      unit: { x: PAGE_MARGIN + 322, w: 50, align: 'left' as const },
      price: { x: PAGE_MARGIN + 372, w: 70, align: 'right' as const },
      total: { x: PAGE_MARGIN + 442, w: 70, align: 'right' as const },
    };

    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('#', cols.idx.x, tableTop);
    doc.text('ITEM', cols.name.x, tableTop);
    doc.text('QTY', cols.qty.x, tableTop, { width: cols.qty.w, align: cols.qty.align });
    doc.text('UNIT', cols.unit.x, tableTop, { width: cols.unit.w });
    doc.text('UNIT PRICE', cols.price.x, tableTop, { width: cols.price.w, align: cols.price.align });
    doc.text('TOTAL', cols.total.x, tableTop, { width: cols.total.w, align: cols.total.align });

    doc.moveTo(PAGE_MARGIN, tableTop + 14).lineTo(PAGE_MARGIN + 472, tableTop + 14).strokeColor('#333').stroke();

    let y = tableTop + 20;
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    let grandTotal = 0;

    po.items.forEach((item, idx) => {
      if (y > 760) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      const lineTotal = item.quantityOrdered * item.unitCostPaisa;
      grandTotal += lineTotal;

      doc.text(String(idx + 1), cols.idx.x, y);
      doc.text(item.name, cols.name.x, y, { width: cols.name.w });
      const rowH = doc.heightOfString(item.name, { width: cols.name.w });
      doc.text(fmtQty(item.quantityOrdered), cols.qty.x, y, { width: cols.qty.w, align: cols.qty.align });
      doc.text(item.unit, cols.unit.x, y, { width: cols.unit.w });
      doc.text(fmtMoney(item.unitCostPaisa), cols.price.x, y, { width: cols.price.w, align: cols.price.align });
      doc.text(fmtMoney(lineTotal), cols.total.x, y, { width: cols.total.w, align: cols.total.align });

      y += Math.max(14, rowH + 4);
      doc.moveTo(PAGE_MARGIN, y - 2).lineTo(PAGE_MARGIN + 472, y - 2).strokeColor('#eee').stroke();
    });

    // ── Grand total ──────────────────────────────────────────────
    y += 8;
    doc.moveTo(PAGE_MARGIN + 320, y).lineTo(PAGE_MARGIN + 472, y).strokeColor('#333').stroke();
    y += 6;
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('GRAND TOTAL', PAGE_MARGIN + 320, y, { width: 122, align: 'right' });
    doc.text(fmtMoney(grandTotal), cols.total.x, y, { width: cols.total.w, align: cols.total.align });
    y += 24;

    if (po.notes) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Notes:', PAGE_MARGIN, y);
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(po.notes, PAGE_MARGIN, y + 12, { width: 472 });
    }

    doc.font('Helvetica').fontSize(8).fillColor('#999')
      .text(`Generated by Restora POS · ${new Date().toLocaleString()}`, PAGE_MARGIN, 800, { width: 472, align: 'center' });

    doc.end();
  });
}
