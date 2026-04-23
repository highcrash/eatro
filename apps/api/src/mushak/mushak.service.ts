/**
 * Bangladesh NBR (National Board of Revenue) Mushak VAT compliance.
 *
 * Issues Mushak-6.3 (tax invoice) on payment and Mushak-6.8 (credit/debit
 * note) on refund. Sequencing is atomic per (branch, fiscal year, docKind)
 * via a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING, so concurrent
 * terminals can't reuse or skip a serial even under load.
 *
 * A frozen JSON snapshot of each document is stored alongside the row so
 * reprints stay legally stable even after menu prices / VAT rates change.
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  computeFiscalYear,
  formatInvoiceSerial,
  formatNoteSerial,
  type MushakSnapshot,
  type MushakLineItem,
  type MushakSellerBlock,
  type MushakBuyerBlock,
} from '@restora/utils';
import type { MushakRegisterRow, RefundReason } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

interface IssueInvoiceInput {
  order: {
    id: string;
    branchId: string;
    subtotal: { toNumber(): number };
    taxAmount: { toNumber(): number };
    discountAmount: { toNumber(): number };
    totalAmount: { toNumber(): number };
    roundAdjustment?: { toNumber(): number };
    customerName: string | null;
    customerPhone: string | null;
    paymentMethod: string | null;
    paidAt: Date | null;
    items: Array<{
      id: string;
      menuItemName: string;
      // OrderItem.quantity is Prisma Int, not Decimal — comes through as a
      // plain number. The other money fields ARE Decimal.
      quantity: number;
      unitPrice: { toNumber(): number };
      totalPrice: { toNumber(): number };
      voidedAt: Date | null;
    }>;
    payments?: Array<{ method: string; amount: { toNumber(): number } }>;
  };
  branch: {
    id: string;
    name: string;
    address: string;
    phone: string;
    currency: string;
    taxRate: { toNumber(): number };
    bin: string | null;
    branchCode: string | null;
    sellerLegalName: string | null;
    sellerTradingName: string | null;
  };
}

@Injectable()
export class MushakService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserve the next sequence for (branchId, fiscalYear, docKind) atomically.
   * Single SQL statement — PostgreSQL serialises conflicts on the unique
   * index so every concurrent caller gets a distinct lastSeq. The caller
   * MUST be inside the same transaction that writes the invoice/note row so
   * a rollback unwinds the seq increment too.
   */
  private async nextSeq(tx: Tx, branchId: string, fiscalYear: string, docKind: 'INVOICE' | 'NOTE'): Promise<number> {
    const rows = await tx.$queryRaw<{ lastSeq: number }[]>`
      INSERT INTO "mushak_sequences" ("id", "branchId", "fiscalYear", "docKind", "lastSeq", "updatedAt")
      VALUES (gen_random_uuid()::text, ${branchId}, ${fiscalYear}, ${docKind}, 1, NOW())
      ON CONFLICT ("branchId", "fiscalYear", "docKind")
      DO UPDATE SET "lastSeq" = "mushak_sequences"."lastSeq" + 1, "updatedAt" = NOW()
      RETURNING "lastSeq"
    `;
    const seq = rows[0]?.lastSeq;
    if (!seq) throw new Error('Mushak sequence allocation failed');
    return Number(seq);
  }

  private sellerBlock(branch: IssueInvoiceInput['branch']): MushakSellerBlock {
    return {
      legalName: branch.sellerLegalName ?? branch.name,
      tradingName: branch.sellerTradingName ?? branch.name,
      address: branch.address,
      bin: branch.bin ?? '',
      phone: branch.phone,
    };
  }

  private buyerBlock(order: IssueInvoiceInput['order']): MushakBuyerBlock | null {
    if (!order.customerName && !order.customerPhone) return null;
    return { name: order.customerName ?? 'Walk-in', phone: order.customerPhone };
  }

  /**
   * Called inside the same $transaction as Order.status → PAID. Builds the
   * frozen snapshot from the order + branch + payments payload and writes
   * the MushakInvoice row. No-op when branch has no BIN / branchCode — the
   * controller enforces the precondition, but we fail-closed here too.
   */
  async issueInvoiceForOrder(tx: Tx, input: IssueInvoiceInput) {
    const { order, branch } = input;
    if (!branch.bin || !branch.branchCode) {
      throw new BadRequestException('Branch BIN + branchCode must be set before NBR mode can issue Mushak invoices');
    }
    const fiscalYear = computeFiscalYear(order.paidAt ?? new Date());
    const seq = await this.nextSeq(tx, branch.id, fiscalYear, 'INVOICE');
    const serial = formatInvoiceSerial(fiscalYear, branch.branchCode, seq);
    const issuedAt = order.paidAt ?? new Date();

    const activeItems = order.items.filter((i) => !i.voidedAt);
    const subtotal = order.subtotal.toNumber() - order.discountAmount.toNumber();
    const vatAmount = order.taxAmount.toNumber();
    const totalInclVat = order.totalAmount.toNumber();
    const vatRate = branch.taxRate.toNumber();
    // Distribute VAT across lines proportional to line total. Rounding
    // residue lands on the last line so per-line VAT sums exactly to the
    // order-level vatAmount (matches what the receipt already prints).
    const lineItems: MushakLineItem[] = [];
    const taxableBase = Math.max(1, activeItems.reduce((s, i) => s + i.totalPrice.toNumber(), 0));
    let vatAccum = 0;
    activeItems.forEach((i, idx) => {
      const lineTotal = i.totalPrice.toNumber();
      const shareVat = idx === activeItems.length - 1
        ? Math.max(0, vatAmount - vatAccum)
        : Math.round((lineTotal / taxableBase) * vatAmount * 100) / 100;
      vatAccum += shareVat;
      lineItems.push({
        id: i.id,
        name: i.menuItemName,
        quantity: Number(i.quantity),
        unitPrice: i.unitPrice.toNumber(),
        subtotalExclVat: lineTotal,
        sdAmount: 0,
        vatAmount: shareVat,
        totalInclVat: lineTotal + shareVat,
        vatRate,
      });
    });

    const snapshot: MushakSnapshot = {
      serial,
      formVersion: '6.3',
      issuedAt: issuedAt.toISOString(),
      fiscalYear,
      branchCode: branch.branchCode,
      seq,
      seller: this.sellerBlock(branch),
      buyer: this.buyerBlock(order),
      items: lineItems,
      subtotalExclVat: subtotal,
      sdAmount: 0,
      vatAmount,
      roundAdjustment: order.roundAdjustment ? order.roundAdjustment.toNumber() : 0,
      totalInclVat,
      paymentSummary: order.payments?.map((p) => ({ method: p.method, amount: p.amount.toNumber() }))
        ?? (order.paymentMethod ? [{ method: order.paymentMethod, amount: totalInclVat }] : []),
      currency: branch.currency,
    };

    return tx.mushakInvoice.create({
      data: {
        branchId: branch.id,
        orderId: order.id,
        serial,
        fiscalYear,
        branchCode: branch.branchCode,
        seq,
        formVersion: '6.3',
        issuedAt,
        buyerName: order.customerName ?? null,
        buyerPhone: order.customerPhone ?? null,
        subtotalExclVat: subtotal,
        sdAmount: 0,
        vatAmount,
        totalInclVat,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Issue a Mushak-6.8 credit note tied to the original 6.3. Called inside
   * the refundOrder transaction. `refundTotals` already holds the negative
   * (for CREDIT) subtotals — we just write them verbatim into the snapshot.
   */
  async issueNoteForRefund(
    tx: Tx,
    input: {
      invoice: { id: string; serial: string; branchId: string; branchCode: string };
      order: { id: string };
      branch: IssueInvoiceInput['branch'];
      issuedByStaff: { id: string; name: string };
      reasonCode: RefundReason;
      reasonText: string | null;
      noteType: 'CREDIT' | 'DEBIT';
      refundedItems: MushakLineItem[];
      refundedItemIds: string[];
      totals: { subtotalExclVat: number; sdAmount: number; vatAmount: number; totalInclVat: number };
      buyer: MushakBuyerBlock | null;
    },
  ) {
    const { invoice, order, branch, issuedByStaff, reasonCode, reasonText, noteType, refundedItems, refundedItemIds, totals, buyer } = input;
    if (!branch.bin || !branch.branchCode) {
      throw new BadRequestException('Branch BIN + branchCode must be set before NBR mode can issue a credit note');
    }
    const issuedAt = new Date();
    const fiscalYear = computeFiscalYear(issuedAt);
    const seq = await this.nextSeq(tx, branch.id, fiscalYear, 'NOTE');
    const serial = formatNoteSerial(fiscalYear, branch.branchCode, seq);

    const snapshot: MushakSnapshot = {
      serial,
      formVersion: '6.8',
      issuedAt: issuedAt.toISOString(),
      fiscalYear,
      branchCode: branch.branchCode,
      seq,
      seller: this.sellerBlock(branch),
      buyer,
      items: refundedItems,
      subtotalExclVat: totals.subtotalExclVat,
      sdAmount: totals.sdAmount,
      vatAmount: totals.vatAmount,
      totalInclVat: totals.totalInclVat,
      refund: {
        invoiceSerial: invoice.serial,
        reasonCode,
        reasonText: reasonText ?? null,
        issuedByName: issuedByStaff.name,
      },
      currency: branch.currency,
    };

    return tx.mushakNote.create({
      data: {
        branchId: branch.id,
        invoiceId: invoice.id,
        orderId: order.id,
        serial,
        fiscalYear,
        branchCode: branch.branchCode,
        seq,
        formVersion: '6.8',
        noteType,
        reasonCode,
        reasonText,
        issuedAt,
        issuedById: issuedByStaff.id,
        subtotalExclVat: totals.subtotalExclVat,
        sdAmount: totals.sdAmount,
        vatAmount: totals.vatAmount,
        totalInclVat: totals.totalInclVat,
        refundedItemIds: refundedItemIds as unknown as Prisma.InputJsonValue,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async getInvoiceById(id: string, branchId: string) {
    const inv = await this.prisma.mushakInvoice.findFirst({ where: { id, branchId } });
    if (!inv) throw new NotFoundException(`Mushak invoice ${id} not found`);
    return inv;
  }

  async getInvoiceByOrder(orderId: string, branchId: string) {
    return this.prisma.mushakInvoice.findFirst({ where: { orderId, branchId } });
  }

  async getNoteById(id: string, branchId: string) {
    const note = await this.prisma.mushakNote.findFirst({ where: { id, branchId } });
    if (!note) throw new NotFoundException(`Mushak note ${id} not found`);
    return note;
  }

  async listNotesByInvoice(invoiceId: string, branchId: string) {
    return this.prisma.mushakNote.findMany({
      where: { invoiceId, branchId },
      orderBy: { issuedAt: 'asc' },
    });
  }

  /**
   * Sales register — interleaved 6.3 + 6.8 for the period, sorted by issue
   * date. Used by the admin Mushak Register page and the CSV export.
   */
  async listRegister(branchId: string, from: Date, to: Date, filter: 'all' | 'invoice' | 'note' = 'all'): Promise<MushakRegisterRow[]> {
    const [invoices, notes] = await Promise.all([
      filter === 'note'
        ? Promise.resolve([])
        : this.prisma.mushakInvoice.findMany({
            where: { branchId, issuedAt: { gte: from, lte: to } },
            orderBy: { issuedAt: 'asc' },
          }),
      filter === 'invoice'
        ? Promise.resolve([])
        : this.prisma.mushakNote.findMany({
            where: { branchId, issuedAt: { gte: from, lte: to } },
            orderBy: { issuedAt: 'asc' },
            include: { invoice: { select: { serial: true } } },
          }),
    ]);

    const invoiceRows: MushakRegisterRow[] = invoices.map((i) => ({
      kind: 'INVOICE',
      id: i.id,
      serial: i.serial,
      issuedAt: i.issuedAt,
      buyerName: i.buyerName,
      subtotalExclVat: i.subtotalExclVat.toNumber(),
      sdAmount: i.sdAmount.toNumber(),
      vatAmount: i.vatAmount.toNumber(),
      totalInclVat: i.totalInclVat.toNumber(),
    }));
    const noteRows: MushakRegisterRow[] = notes.map((n) => ({
      kind: 'NOTE',
      id: n.id,
      serial: n.serial,
      issuedAt: n.issuedAt,
      buyerName: null,
      subtotalExclVat: n.subtotalExclVat.toNumber(),
      sdAmount: n.sdAmount.toNumber(),
      vatAmount: n.vatAmount.toNumber(),
      totalInclVat: n.totalInclVat.toNumber(),
      reasonCode: n.reasonCode as RefundReason,
      linkedInvoiceSerial: (n as typeof n & { invoice?: { serial: string } }).invoice?.serial ?? null,
    }));
    return [...invoiceRows, ...noteRows].sort(
      (a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime(),
    );
  }

  async exportRegisterCsv(branchId: string, from: Date, to: Date): Promise<string> {
    const rows = await this.listRegister(branchId, from, to, 'all');
    const header = 'Kind,Serial,IssuedAt,Buyer,LinkedInvoice,Reason,Subtotal,SD,VAT,Total';
    const escape = (v: string | number | null | undefined) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // Money columns are stored in paisa (smallest unit); export in taka so
    // the accountant's spreadsheet can sum directly without dividing.
    const toTaka = (n: number) => (n / 100).toFixed(2);
    const lines = rows.map((r) =>
      [
        r.kind,
        r.serial,
        new Date(r.issuedAt).toISOString(),
        r.buyerName ?? '',
        r.linkedInvoiceSerial ?? '',
        r.reasonCode ?? '',
        toTaka(r.subtotalExclVat),
        toTaka(r.sdAmount),
        toTaka(r.vatAmount),
        toTaka(r.totalInclVat),
      ].map(escape).join(','),
    );
    return [header, ...lines].join('\n');
  }
}
