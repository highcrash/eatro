import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreateSupplierDto, UpdateSupplierDto, JwtPayload } from '@restora/types';
import { ingredientDisplayName } from '@restora/utils';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../account/account.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { buildSupplierLedgerPdf } from './ledger-pdf';

@Injectable()
export class SupplierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
    private readonly whatsApp: WhatsAppService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async findAll(branchId: string, opts: { cashierVisibleOnly?: boolean } = {}) {
    // Use raw SQL so the visibleToCashier column is always included in the
    // response, even when the generated Prisma client is stale.
    if (opts.cashierVisibleOnly) {
      return this.prisma.$queryRaw`
        SELECT * FROM "suppliers"
        WHERE "branchId" = ${branchId}
          AND "deletedAt" IS NULL
          AND "isActive" = TRUE
          AND "visibleToCashier" = TRUE
        ORDER BY "name" ASC
      `;
    }
    return this.prisma.$queryRaw`
      SELECT * FROM "suppliers"
      WHERE "branchId" = ${branchId}
        AND "deletedAt" IS NULL
      ORDER BY "name" ASC
    `;
  }

  async findOne(id: string, branchId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, branchId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }

  create(branchId: string, dto: CreateSupplierDto) {
    const { openingBalance, whatsappNumber, ...rest } = dto;
    const ob = openingBalance ? Math.round(openingBalance) : 0;
    const normalisedWa = this.normaliseWhatsApp(whatsappNumber);
    return this.prisma.supplier.create({
      data: { branchId, ...rest, ...(normalisedWa !== undefined ? { whatsappNumber: normalisedWa } : {}), openingBalance: ob, totalDue: ob },
    });
  }

  async update(id: string, branchId: string, dto: UpdateSupplierDto) {
    await this.findOne(id, branchId);

    // Handle visibleToCashier via raw SQL so it works even when the generated
    // Prisma client is stale (column was added to the DB after the API started).
    const { visibleToCashier, whatsappNumber, ...rest } = dto as UpdateSupplierDto & { visibleToCashier?: boolean };
    if (typeof visibleToCashier === 'boolean') {
      await this.prisma.$executeRaw`
        UPDATE "suppliers"
        SET "visibleToCashier" = ${visibleToCashier}, "updatedAt" = NOW()
        WHERE id = ${id}
      `;
    }

    const data: Record<string, unknown> = { ...rest };
    if (whatsappNumber !== undefined) {
      data.whatsappNumber = this.normaliseWhatsApp(whatsappNumber);
    }

    if (Object.keys(data).length === 0) {
      return this.findOne(id, branchId);
    }

    return this.prisma.supplier.update({ where: { id }, data });
  }

  /**
   * Trim + light-validate an E.164 WhatsApp number. Accepts an optional
   * leading "+", then 10–15 digits. Empty/null clears the column.
   * Throws on a non-empty non-conforming string so admin sees the error
   * immediately instead of finding it later when "Send via WhatsApp"
   * fails on Meta.
   */
  private normaliseWhatsApp(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (!/^\+?\d{10,15}$/.test(trimmed.replace(/[\s-]/g, ''))) {
      throw new BadRequestException('WhatsApp number must be in international format (e.g. +8801712345678).');
    }
    return trimmed;
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async getSupplierLedger(id: string, branchId: string) {
    const supplier = await this.findOne(id, branchId);
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: { branchId, supplierId: id, deletedAt: null, status: { in: ['RECEIVED', 'PARTIAL'] } },
      include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, packSize: true } } } } },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch returns for this supplier
    const returns = await this.prisma.purchaseReturn.findMany({
      where: { branchId, supplierId: id, status: 'COMPLETED' },
      include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, packSize: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    const payments = await this.prisma.supplierPayment.findMany({
      where: { branchId, supplierId: id },
      include: { paidBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Manual ledger corrections (e.g. wrong opening balance) recorded
    // by Owner/Manager via POST /suppliers/:id/adjust. Strictly ledger-
    // only — never touched a cash account or expense.
    const adjustments = await this.prisma.supplierAdjustment.findMany({
      where: { branchId, supplierId: id },
      include: { recordedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate total billed. Items first, then add any receipt-level
    // extra fees (delivery, labour, etc.) and subtract receipt-level
    // discount the supplier offered at delivery — these are persisted
    // on the PurchaseOrder by purchasing.service.receiveGoods.
    let totalBilled = 0;
    for (const po of purchaseOrders) {
      for (const item of po.items) {
        totalBilled += item.unitCost.toNumber() * item.quantityReceived.toNumber();
      }
      const fees = ((po as unknown as { receiptExtraFees?: Array<{ amount: number }> | null }).receiptExtraFees ?? null);
      if (Array.isArray(fees)) {
        for (const f of fees) {
          if (Number(f?.amount) > 0) totalBilled += Number(f.amount);
        }
      }
      const rawDiscount = (po as unknown as { receiptDiscount?: { toNumber(): number } | number | null }).receiptDiscount;
      const discount = typeof rawDiscount === 'object' && rawDiscount && 'toNumber' in rawDiscount ? rawDiscount.toNumber() : Number(rawDiscount ?? 0);
      if (discount > 0) totalBilled -= Math.min(totalBilled, discount);
    }

    const totalPaid = payments.reduce((s, p) => s + p.amount.toNumber(), 0);
    const totalReturned = returns.reduce((s, r) => r.items.reduce((ss, i) => ss + i.unitPrice.toNumber() * i.quantity.toNumber(), s), 0);
    const openingBalance = supplier.openingBalance.toNumber();
    // Adjustments are signed: negative shrinks debt, positive grows it.
    // Sum directly into the running balance — same accounting as
    // payments (negative side) but kept as its own bucket so the
    // ledger view can distinguish "paid" from "manually corrected".
    const totalAdjustments = adjustments.reduce((s, a) => s + a.amount.toNumber(), 0);

    return {
      supplier,
      openingBalance,
      totalBilled,
      totalPaid,
      totalReturned,
      totalAdjustments,
      balance: openingBalance + totalBilled - totalPaid - totalReturned + totalAdjustments,
      purchaseOrders: purchaseOrders.map((po) => {
        const itemsTotal = po.items.reduce((s, i) => s + i.unitCost.toNumber() * i.quantityReceived.toNumber(), 0);
        const rawDiscount = (po as unknown as { receiptDiscount?: { toNumber(): number } | number | null }).receiptDiscount;
        const discount = typeof rawDiscount === 'object' && rawDiscount && 'toNumber' in rawDiscount ? rawDiscount.toNumber() : Number(rawDiscount ?? 0);
        const discountReason = (po as unknown as { receiptDiscountReason?: string | null }).receiptDiscountReason ?? null;
        const fees = ((po as unknown as { receiptExtraFees?: Array<{ label: string; amount: number }> | null }).receiptExtraFees ?? null);
        const feesArr = Array.isArray(fees) ? fees : [];
        const feesTotal = feesArr.reduce((s, f) => s + Number(f?.amount ?? 0), 0);
        const rawAttachments = (po as unknown as { receiptAttachments?: unknown }).receiptAttachments;
        const attachments: Array<{ url: string; type: 'image' | 'pdf'; uploadedAt?: string }> =
          Array.isArray(rawAttachments)
            ? (rawAttachments as Array<{ url: string; type: 'image' | 'pdf'; uploadedAt?: string }>)
            : [];
        return {
          id: po.id,
          status: po.status,
          createdAt: po.createdAt,
          receivedAt: po.receivedAt,
          items: po.items.map((item) => ({
            id: item.id,
            ingredientName: ingredientDisplayName(item.ingredient),
            unit: item.unit || item.ingredient?.purchaseUnit || item.ingredient?.unit || '',
            quantityOrdered: item.quantityOrdered.toNumber(),
            quantityReceived: item.quantityReceived.toNumber(),
            unitCost: item.unitCost.toNumber(),
            total: item.unitCost.toNumber() * item.quantityReceived.toNumber(),
          })),
          itemsTotal,
          receiptDiscount: discount,
          receiptDiscountReason: discountReason,
          receiptExtraFees: feesArr,
          receiptAttachments: attachments,
          // Net total — what actually moves the supplier ledger.
          total: Math.max(0, itemsTotal + feesTotal - discount),
        };
      }),
      returns: returns.map((r) => ({
        id: r.id,
        completedAt: r.completedAt,
        items: r.items.map((i) => ({
          ingredientName: ingredientDisplayName(i.ingredient),
          unit: i.ingredient?.purchaseUnit || i.ingredient?.unit || '',
          quantity: i.quantity.toNumber(),
          unitPrice: i.unitPrice.toNumber(),
          total: i.unitPrice.toNumber() * i.quantity.toNumber(),
        })),
        total: r.items.reduce((s, i) => s + i.unitPrice.toNumber() * i.quantity.toNumber(), 0),
      })),
      payments,
      adjustments: adjustments.map((a) => ({
        id: a.id,
        amount: a.amount.toNumber(),
        reason: a.reason,
        createdAt: a.createdAt,
        recordedBy: a.recordedBy,
      })),
    };
  }

  /**
   * Record a manual ledger correction. Pure ledger-only:
   *   - Decrements/increments Supplier.totalDue by `dto.amount` (signed).
   *   - Writes an audit row to SupplierAdjustment for the ledger view.
   *   - Does NOT touch any cash/bank Account.
   *   - Does NOT create an Expense mirror.
   *   - Does NOT post to Mushak / VAT.
   *
   * Use case: admin entered the wrong opening balance, supplier ledger
   * has a small off-by-X error from a deleted PO, etc. Owner/Manager
   * only — gated at the controller layer.
   */
  async recordAdjustment(
    branchId: string,
    supplierId: string,
    staffId: string,
    dto: { amount: number; reason: string },
  ) {
    if (!Number.isFinite(dto.amount) || dto.amount === 0) {
      throw new BadRequestException('Adjustment amount must be a non-zero number');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Adjustment reason is required');
    }
    await this.findOne(supplierId, branchId);

    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.supplierAdjustment.create({
        data: {
          branchId,
          supplierId,
          amount: dto.amount,
          reason: dto.reason.trim(),
          recordedById: staffId,
        },
        include: { recordedBy: { select: { id: true, name: true } } },
      });
      await tx.supplier.update({
        where: { id: supplierId },
        data: { totalDue: { increment: dto.amount } },
      });
      return adjustment;
    });
  }

  async makePayment(branchId: string, staffId: string, dto: { supplierId: string; purchaseOrderId?: string; amount: number; paymentMethod?: string; reference?: string; notes?: string }) {
    const payment = await this.prisma.supplierPayment.create({
      data: {
        branchId,
        supplierId: dto.supplierId,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        amount: dto.amount,
        paymentMethod: (dto.paymentMethod ?? 'CASH') as any,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        paidById: staffId,
      },
      include: { paidBy: { select: { id: true, name: true } } },
    });

    // Update supplier totalDue
    await this.prisma.supplier.update({
      where: { id: dto.supplierId },
      data: { totalDue: { decrement: dto.amount } },
    });

    // Get supplier name for expense description
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId }, select: { name: true } });

    // Auto-create expense entry. When the payment is linked to a PO
    // that carried receipt-level extra fees (delivery, freight, etc.),
    // those fees were already expensed at receive time as TRANSPORT /
    // MISCELLANEOUS rows with paymentMethod='CREDIT' (see
    // purchasing.service.receiveGoods). Net them out of THIS row so
    // the same delivery charge isn't counted twice across reports.
    let foodCostAmount = dto.amount;
    if (dto.purchaseOrderId) {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: dto.purchaseOrderId, branchId },
        select: { receiptExtraFees: true },
      });
      const fees = (po as unknown as { receiptExtraFees?: Array<{ amount: number }> | null } | null)?.receiptExtraFees;
      if (Array.isArray(fees)) {
        const accrued = fees.reduce((s, f) => s + (Number(f?.amount) > 0 ? Number(f.amount) : 0), 0);
        foodCostAmount = Math.max(0, dto.amount - accrued);
      }
    }
    const method = dto.paymentMethod ?? 'CASH';
    if (foodCostAmount > 0) {
      await this.prisma.expense.create({
        data: {
          branchId,
          category: 'FOOD_COST',
          description: `Supplier payment — ${supplier?.name ?? 'Unknown'}${dto.reference ? ` (Ref: ${dto.reference})` : ''}`,
          amount: foodCostAmount,
          paymentMethod: method,
          date: new Date(),
          recordedById: staffId,
          approvedById: staffId,
          approvedAt: new Date(),
        },
      });
    }

    // Update linked account balance
    void this.accountService.updateAccountForPayment(branchId, method, dto.amount, 'EXPENSE', `Supplier payment — ${supplier?.name ?? 'Unknown'}`);

    return payment;
  }

  async getPayments(branchId: string, supplierId?: string) {
    return this.prisma.supplierPayment.findMany({
      where: { branchId, ...(supplierId ? { supplierId } : {}) },
      include: {
        paidBy: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Build the supplier's ledger PDF and send it on WhatsApp using
   * the same Meta template + credentials as the PO send. Mirrors
   * `PurchasingService.sendWhatsApp` — same retry-on-language fall-
   * back, same metaCode-aware error rewrites — but builds a ledger
   * PDF instead of a PO PDF and uses a stable filename so suppliers
   * can save successive copies in WhatsApp without filename
   * collisions on the same day.
   */
  async sendLedgerWhatsApp(branchId: string, supplierId: string, user: JwtPayload) {
    const settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings?.whatsappEnabled) {
      throw new BadRequestException('WhatsApp integration is not enabled for this branch. Configure it in Settings → Notifications.');
    }
    const phoneNumberId = settings.whatsappPhoneNumberId?.trim();
    const accessToken = settings.whatsappAccessToken?.trim();
    const templateName = settings.whatsappPoTemplate?.trim();
    const languageCode = settings.whatsappPoTemplateLang?.trim() || 'en';
    const paramTokensRaw = (settings as any).whatsappPoTemplateParams?.trim() || 'supplierName,poNumber,date';
    if (!phoneNumberId || !accessToken || !templateName) {
      throw new BadRequestException('WhatsApp credentials incomplete. Set Phone Number ID, Access Token, and Template Name in Settings.');
    }

    const ledger = await this.getSupplierLedger(supplierId, branchId);
    const supplier = ledger.supplier as { name: string; contactName?: string | null; phone?: string | null; address?: string | null; whatsappNumber?: string | null };
    const waNumberRaw = supplier.whatsappNumber?.trim();
    if (!waNumberRaw) {
      throw new BadRequestException(`Supplier "${supplier.name}" has no WhatsApp number on file. Add one in the Supplier edit form.`);
    }
    const to = waNumberRaw.replace(/[^\d]/g, '');
    if (to.length < 10 || to.length > 15) {
      throw new BadRequestException(`Supplier WhatsApp number "${waNumberRaw}" is not a valid international number.`);
    }

    const branch = await this.prisma.branch.findFirstOrThrow({
      where: { id: branchId },
      select: { name: true, address: true, phone: true },
    });

    // Returns the ledger payload omits per-PO computed totals — the
    // PDF builder reconstructs from itemsTotal/discount/fees so the
    // same numbers admin sees in the on-screen ledger end up on
    // paper.
    const ledgerForPdf = {
      branch: { name: branch.name, address: branch.address ?? null, phone: branch.phone ?? null },
      supplier: {
        name: supplier.name,
        contactName: supplier.contactName ?? null,
        phone: supplier.phone ?? null,
        address: supplier.address ?? null,
      },
      openingBalance: ledger.openingBalance,
      totalBilled: ledger.totalBilled,
      totalPaid: ledger.totalPaid,
      totalReturned: ledger.totalReturned,
      totalAdjustments: ledger.totalAdjustments,
      balance: ledger.balance,
      purchaseOrders: ledger.purchaseOrders.map((po: any) => ({
        id: po.id,
        status: po.status,
        createdAt: po.createdAt,
        receivedAt: po.receivedAt,
        itemsTotal: po.itemsTotal ?? po.items?.reduce((s: number, i: any) => s + Number(i.unitPrice ?? 0) * Number(i.quantityReceived ?? 0), 0) ?? 0,
        discount: po.receiptDiscount ?? 0,
        discountReason: po.receiptDiscountReason ?? null,
        fees: po.receiptExtraFees ?? [],
        poNumber: po.id.slice(-8).toUpperCase(),
      })),
      returns: (ledger as any).returns?.map((r: any) => ({
        id: r.id,
        createdAt: r.createdAt,
        total: Number(r.total ?? r.items?.reduce((s: number, i: any) => s + Number(i.unitPrice ?? 0) * Number(i.quantity ?? 0), 0) ?? 0),
        reason: r.reason ?? null,
      })) ?? [],
      payments: (ledger as any).payments?.map((p: any) => ({
        id: p.id,
        createdAt: p.createdAt,
        amount: Number(p.amount ?? 0),
        method: p.method ?? null,
        notes: p.notes ?? null,
      })) ?? [],
      adjustments: (ledger as any).adjustments?.map((a: any) => ({
        id: a.id,
        createdAt: a.createdAt,
        amount: Number(a.amount ?? 0),
        reason: a.reason ?? null,
      })) ?? [],
    };

    const pdf = await buildSupplierLedgerPdf(ledgerForPdf);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `Ledger-${supplier.name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 24)}-${dateStamp}.pdf`;

    const { mediaId } = await this.whatsApp.uploadMedia({
      phoneNumberId, accessToken, buffer: pdf, filename, mimeType: 'application/pdf',
    });

    // Reuse the PO template since it's already approved and has the
    // generic "supplier + reference + date" body. The reference for
    // a ledger send is the formatted current balance (negotiated as
    // the `total` token's value below) when admin's template
    // includes it; otherwise just date + supplier.
    const formattedDate = new Date().toLocaleDateString('en-GB');
    const formattedBalance = `Tk ${(ledger.balance / 100).toFixed(2)}`;
    const paramValues: Record<string, string> = {
      supplierName: supplier.name,
      poNumber: `LEDGER-${dateStamp}`,
      date: formattedDate,
      total: formattedBalance,
      branchName: branch.name,
      itemCount: String(ledger.purchaseOrders.length),
      supplierContact: supplier.contactName ?? supplier.phone ?? '',
    };
    const bodyParams = paramTokensRaw
      .split(',')
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0)
      .map((t: string) => paramValues[t] ?? '');

    const sendOnce = (code: string) => this.whatsApp.sendDocumentTemplate({
      phoneNumberId, accessToken, to, templateName, languageCode: code, bodyParams, mediaId, documentFilename: filename,
    });
    const fallbackForLang = (lc: string): string | null => {
      const norm = lc.toLowerCase().replace('-', '_');
      if (norm.startsWith('en_')) return 'en';
      return null;
    };

    let messageId: string;
    try {
      ({ messageId } = await sendOnce(languageCode));
    } catch (err: any) {
      if (err?.metaCode === 132000) {
        const expected = /expected number of params \((\d+)\)/.exec(String(err?.message ?? ''))?.[1];
        throw new BadRequestException(
          `WhatsApp template "${templateName}" expects ${expected ?? '?'} body parameter(s), but Restora is sending ${bodyParams.length} (${paramTokensRaw}). ` +
          `Open Settings → Notifications and edit "Template Body Params" so its comma-separated list has exactly ${expected ?? 'the right'} entries.`,
        );
      }
      const fallback = err?.metaCode === 132001 ? fallbackForLang(languageCode) : null;
      if (!fallback || fallback === languageCode) {
        if (err?.metaCode === 132001) {
          throw new BadRequestException(
            `WhatsApp template "${templateName}" is not approved in language "${languageCode}". ` +
            `Open Settings → Notifications and set "Template Language" to the exact code shown in WhatsApp Manager (commonly "en", "en_US", or "bn").`,
          );
        }
        throw err;
      }
      ({ messageId } = await sendOnce(fallback));
    }

    void this.activityLog.log({
      branchId,
      actor: user,
      category: 'PURCHASING',
      action: 'UPDATE',
      entityType: 'suppliers',
      entityId: supplierId,
      entityName: `Supplier ${supplier.name}`,
      summary: `Sent ledger PDF to ${supplier.name} via WhatsApp (balance ${formattedBalance})`,
    });

    return { messageId, sentAt: new Date().toISOString() };
  }
}
