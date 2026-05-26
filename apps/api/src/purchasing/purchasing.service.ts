import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreatePurchaseOrderDto, UpdatePurchaseOrderDto, ReceiveGoodsDto, JwtPayload } from '@restora/types';
import { formatVariantLabel } from '@restora/utils';
import { PrismaService } from '../prisma/prisma.service';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { IngredientService } from '../ingredient/ingredient.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { buildPurchaseOrderPdf } from './po-pdf';

@Injectable()
export class PurchasingService {
  private readonly logger = new Logger(PurchasingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly unitConversion: UnitConversionService,
    private readonly ingredientService: IngredientService,
    private readonly whatsApp: WhatsAppService,
    private readonly activityLog: ActivityLogService,
  ) {}

  findAll(branchId: string, status?: string) {
    return this.prisma.purchaseOrder.findMany({
      where: {
        branchId,
        deletedAt: null,
        ...(status ? { status: status as never } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true, whatsappNumber: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string, branchId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, branchId, deletedAt: null },
      include: {
        supplier: { select: { id: true, name: true, whatsappNumber: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
      },
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return po;
  }

  async create(branchId: string, createdById: string, dto: CreatePurchaseOrderDto) {
    const po = await this.prisma.purchaseOrder.create({
      data: {
        branchId,
        supplierId: dto.supplierId,
        createdById,
        notes: dto.notes ?? null,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
        items: {
          create: dto.items.map((i) => ({
            ingredientId: i.ingredientId,
            quantityOrdered: i.quantityOrdered,
            unitCost: i.unitCost,
            unit: i.unit ?? null,
          })),
        },
      },
      include: {
        supplier: { select: { id: true, name: true, whatsappNumber: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
      },
    });
    await this.linkSupplierToIngredients(dto.items.map((i) => i.ingredientId), dto.supplierId);
    return po;
  }

  /**
   * Upsert IngredientSupplier for each (ingredient, supplier) pair and,
   * when the ingredient has no primary supplier yet, promote this one to
   * primary. Called whenever the admin explicitly pairs an ingredient
   * with a supplier on a PO — so next time that ingredient appears on
   * the shopping list / PO form, the supplier dropdown is pre-filled.
   * Idempotent: the unique (ingredientId, supplierId) constraint short-
   * circuits repeat calls.
   */
  private async linkSupplierToIngredients(ingredientIds: string[], supplierId: string) {
    const uniqueIds = Array.from(new Set(ingredientIds.filter(Boolean)));
    if (uniqueIds.length === 0 || !supplierId) return;
    for (const ingredientId of uniqueIds) {
      await this.prisma.ingredientSupplier.upsert({
        where: { ingredientId_supplierId: { ingredientId, supplierId } },
        create: { ingredientId, supplierId },
        update: {},
      });
      await this.prisma.ingredient.updateMany({
        where: { id: ingredientId, supplierId: null },
        data: { supplierId },
      });
    }
  }

  async update(id: string, branchId: string, dto: UpdatePurchaseOrderDto) {
    const po = await this.findOne(id, branchId);
    if (po.status !== 'DRAFT') throw new BadRequestException('Only DRAFT orders can be edited');

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: dto.supplierId,
        notes: dto.notes,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
      },
      include: {
        supplier: { select: { id: true, name: true, whatsappNumber: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
      },
    });
  }

  async send(id: string, branchId: string) {
    const po = await this.findOne(id, branchId);
    if (po.status !== 'DRAFT') throw new BadRequestException('Only DRAFT orders can be sent');
    if (po.items.length === 0) throw new BadRequestException('Purchase order has no items');

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'SENT', orderedAt: new Date() },
      include: {
        supplier: { select: { id: true, name: true, whatsappNumber: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
      },
    });
  }

  async cancel(id: string, branchId: string) {
    const po = await this.findOne(id, branchId);
    if (po.status === 'RECEIVED') throw new BadRequestException('Cannot cancel a received order');
    if (po.status === 'CANCELLED') throw new BadRequestException('Order already cancelled');

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        supplier: { select: { id: true, name: true, whatsappNumber: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
      },
    });
  }

  async receiveGoods(id: string, branchId: string, staffId: string, dto: ReceiveGoodsDto, user?: JwtPayload) {
    const po = await this.findOne(id, branchId);
    if (po.status === 'RECEIVED') throw new BadRequestException('Order already fully received');
    if (po.status === 'CANCELLED') throw new BadRequestException('Cannot receive a cancelled order');
    if (po.status === 'DRAFT') throw new BadRequestException('Order must be SENT before receiving');

    const parentSyncIds = new Set<string>();

    const result = await this.prisma.$transaction(async (tx) => {
      let allReceived = true;
      const stockMovements: {
        branchId: string;
        ingredientId: string;
        type: 'PURCHASE';
        quantity: number;
        orderId: null;
        staffId: string;
        notes: string;
        unitCostPaisa: number;
        purchaseOrderId: string;
      }[] = [];

      for (const receipt of dto.items) {
        const poItem = po.items.find((i) => i.id === receipt.purchaseOrderItemId);
        if (!poItem) continue;
        if (receipt.quantityReceived <= 0) continue;

        const newReceived = poItem.quantityReceived.toNumber() + receipt.quantityReceived;
        // Update PO item — save received price if different from original
        const receivedPrice = (receipt.unitPrice !== undefined && receipt.unitPrice > 0) ? receipt.unitPrice : undefined;
        await tx.purchaseOrderItem.update({
          where: { id: receipt.purchaseOrderItemId },
          data: {
            quantityReceived: newReceived,
            ...(receivedPrice !== undefined ? { unitCost: receivedPrice } : {}),
            ...(receipt.makingDate ? { makingDate: new Date(receipt.makingDate) } : {}),
            ...(receipt.expiryDate ? { expiryDate: new Date(receipt.expiryDate) } : {}),
          },
        });

        // Update ingredient stock + cost per unit
        // Allow receiving as a different variant (supplier sent a different brand)
        const targetIngredientId = receipt.ingredientIdOverride ?? poItem.ingredientId;
        const ingredient = await tx.ingredient.findUniqueOrThrow({ where: { id: targetIngredientId } });
        const hasPurchaseUnit = ingredient.purchaseUnit && ingredient.purchaseUnitQty.toNumber() > 0;
        const purchaseUnitQty = hasPurchaseUnit ? ingredient.purchaseUnitQty.toNumber() : 1;

        // Convert received qty to stock units
        // Priority: 1) ingredient's purchaseUnit conversion, 2) PO item's ordering unit conversion, 3) as-is
        const orderingUnit = poItem.unit || ingredient.purchaseUnit || ingredient.unit;
        const stockUnit = ingredient.unit;
        let stockQtyReceived: number;
        if (hasPurchaseUnit) {
          stockQtyReceived = receipt.quantityReceived * purchaseUnitQty;
        } else if (orderingUnit !== stockUnit) {
          // Use unit conversion (e.g. KG → G = ×1000)
          stockQtyReceived = await this.unitConversion.convert(branchId, receipt.quantityReceived, orderingUnit, stockUnit);
        } else {
          stockQtyReceived = receipt.quantityReceived;
        }

        // Price per PURCHASE unit (paisa) — use receipt price if provided, else PO item's unitCost
        const effectivePrice = (receipt.unitPrice !== undefined && receipt.unitPrice > 0)
          ? receipt.unitPrice
          : poItem.unitCost.toNumber() > 0
            ? poItem.unitCost.toNumber()
            : undefined;

        const ingredientUpdate: Record<string, unknown> = { currentStock: { increment: stockQtyReceived } };

        // Hoisted so the StockMovement push below can reference it
        // unconditionally. Falls back to the existing ingredient cost
        // when the cashier didn't enter a price for this receipt
        // (e.g. a comp/sample drop) — keeps the movement value sane.
        let costPerStockUnit = ingredient.costPerUnit.toNumber();

        if (effectivePrice !== undefined) {
          const branch = await tx.branch.findFirstOrThrow({ where: { id: branchId } });
          const method = (branch as any).stockPricingMethod ?? 'LAST_PURCHASE';

          // Calculate cost per STOCK unit from purchase unit price
          const conversionFactor = stockQtyReceived / receipt.quantityReceived; // e.g. 1000 for KG→G
          costPerStockUnit = Math.round(effectivePrice / conversionFactor);

          if (method === 'WEIGHTED_AVERAGE') {
            const existingStock = ingredient.currentStock.toNumber();
            const existingCost = ingredient.costPerUnit.toNumber();
            const totalStock = existingStock + stockQtyReceived;
            const avgCost = totalStock > 0
              ? Math.round((existingStock * existingCost + stockQtyReceived * costPerStockUnit) / totalStock)
              : costPerStockUnit;
            ingredientUpdate.costPerUnit = avgCost;
          } else {
            // LAST_PURCHASE (default)
            ingredientUpdate.costPerUnit = costPerStockUnit;
          }

          // Also update costPerPurchaseUnit
          if (hasPurchaseUnit) {
            ingredientUpdate.costPerPurchaseUnit = effectivePrice;
          }
        }

        await tx.ingredient.update({
          where: { id: targetIngredientId },
          data: ingredientUpdate,
        });

        // Track parent for sync if this is a variant
        if (ingredient.parentId) {
          parentSyncIds.add(ingredient.parentId);
        }

        stockMovements.push({
          branchId,
          ingredientId: targetIngredientId,
          type: 'PURCHASE',
          quantity: stockQtyReceived, // in stock units (not purchase units)
          orderId: null,
          staffId,
          notes: dto.notes ?? `Received ${receipt.quantityReceived} ${hasPurchaseUnit ? ingredient.purchaseUnit : ingredient.unit} from PO ${po.id.slice(-8)}`,
          // Per-stock-unit cost AT TIME OF RECEIPT — same figure used
          // to compute costPerUnit on the Ingredient row, but
          // preserved on the movement so the Stock Watcher report
          // can value this PURCHASE row historically even after
          // costPerUnit shifts on later receipts.
          unitCostPaisa: costPerStockUnit,
          // Direct FK to the PO so the report can join supplier +
          // PO# without parsing notes.
          purchaseOrderId: po.id,
        });

        // Check if this item is fully received
        if (newReceived < poItem.quantityOrdered.toNumber()) allReceived = false;
      }

      // Check if any other items are not fully received
      for (const poItem of po.items) {
        const receipt = dto.items.find((r) => r.purchaseOrderItemId === poItem.id);
        if (!receipt) {
          const existing = poItem.quantityReceived.toNumber();
          const ordered = poItem.quantityOrdered.toNumber();
          if (existing < ordered) allReceived = false;
        }
      }

      // Process additional items (not in original PO — supplier sent extras)
      if (dto.additionalItems && dto.additionalItems.length > 0) {
        for (const extra of dto.additionalItems) {
          if (!extra.ingredientId || extra.quantityReceived <= 0) continue;
          const ingredient = await tx.ingredient.findUnique({ where: { id: extra.ingredientId } });
          if (!ingredient) continue;
          const hasPurchaseUnit = ingredient.purchaseUnit && ingredient.purchaseUnitQty.toNumber() > 0;
          const purchaseUnitQty = hasPurchaseUnit ? ingredient.purchaseUnitQty.toNumber() : 1;

          // Convert received qty to stock units, same priority as PO items:
          //   1) hasPurchaseUnit → qty is in purchase-units, scale by purchaseUnitQty
          //   2) explicit `unit` override that differs from stock unit → unit-conversion table
          //   3) as-is (qty is already in stock units)
          const incomingUnit = extra.unit || ingredient.purchaseUnit || ingredient.unit;
          const stockUnit = ingredient.unit;
          let stockQtyReceived: number;
          if (hasPurchaseUnit) {
            stockQtyReceived = extra.quantityReceived * purchaseUnitQty;
          } else if (incomingUnit !== stockUnit) {
            stockQtyReceived = await this.unitConversion.convert(
              branchId,
              extra.quantityReceived,
              incomingUnit,
              stockUnit,
            );
          } else {
            stockQtyReceived = extra.quantityReceived;
          }

          const ingredientUpdate: Record<string, unknown> = { currentStock: { increment: stockQtyReceived } };
          // Compute the per-stock-unit cost for this extra so we can
          // both update the Ingredient row AND stamp the StockMovement.
          // Falls back to 0 when the cashier didn't enter a unit price.
          let extraCostPerStockUnit = 0;
          if (extra.unitPrice && extra.unitPrice > 0) {
            const conversionFactor = stockQtyReceived / extra.quantityReceived;
            extraCostPerStockUnit = Math.round(extra.unitPrice / conversionFactor);
            ingredientUpdate.costPerUnit = extraCostPerStockUnit;
            if (hasPurchaseUnit) ingredientUpdate.costPerPurchaseUnit = extra.unitPrice;
          }

          await tx.ingredient.update({ where: { id: extra.ingredientId }, data: ingredientUpdate });
          if (ingredient.parentId) parentSyncIds.add(ingredient.parentId);

          // Add PO item record so it appears in the PO
          await tx.purchaseOrderItem.create({
            data: {
              purchaseOrderId: id,
              ingredientId: extra.ingredientId,
              quantityOrdered: extra.quantityReceived,
              quantityReceived: extra.quantityReceived,
              unitCost: extra.unitPrice ?? 0,
            },
          });

          stockMovements.push({
            branchId,
            ingredientId: extra.ingredientId,
            type: 'PURCHASE',
            quantity: stockQtyReceived,
            orderId: null,
            staffId,
            notes: dto.notes ?? `Extra item received with PO ${po.id.slice(-8)}`,
            unitCostPaisa: extraCostPerStockUnit,
            purchaseOrderId: po.id,
          });
        }
      }

      if (stockMovements.length > 0) {
        await tx.stockMovement.createMany({ data: stockMovements });
      }

      // Calculate total cost of this receipt and update supplier totalDue
      let receiptTotal = 0;
      for (const receipt of dto.items) {
        const poItem = po.items.find((i) => i.id === receipt.purchaseOrderItemId);
        if (poItem && receipt.quantityReceived > 0) {
          const price = (receipt.unitPrice !== undefined && receipt.unitPrice > 0) ? receipt.unitPrice : poItem.unitCost.toNumber();
          receiptTotal += price * receipt.quantityReceived;
        }
      }
      // Add additional items cost
      for (const extra of (dto.additionalItems ?? [])) {
        if (extra.quantityReceived > 0 && extra.unitPrice && extra.unitPrice > 0) {
          receiptTotal += extra.unitPrice * extra.quantityReceived;
        }
      }

      // Receipt-level adjustments. Discount is subtracted, extra fees are
      // added. Net is what the supplier ledger should change by — never
      // less than zero (a discount bigger than the bill becomes a no-op
      // ledger move; the over-discount is purely a display artefact).
      const discountPaisa = Math.max(0, dto.receiptDiscount ?? 0);
      const cleanedFees: { label: string; amount: number }[] = (dto.receiptExtraFees ?? [])
        .filter((f) => f && typeof f.label === 'string' && f.label.trim().length > 0 && Number(f.amount) > 0)
        .map((f) => ({ label: f.label.trim(), amount: Math.round(Number(f.amount)) }));

      // Receipt attachments — sanitise + stamp uploadedAt server-side
      // so the client can't backdate. Appends to the existing array on
      // the PO; passing zero attachments leaves the prior list intact.
      const incomingAttachments = Array.isArray(dto.receiptAttachments)
        ? dto.receiptAttachments
            .filter((a) => a && typeof a.url === 'string' && a.url.trim().length > 0)
            .map((a) => ({
              url: a.url.trim(),
              type: a.type === 'pdf' ? 'pdf' as const : 'image' as const,
              uploadedAt: new Date().toISOString(),
            }))
        : [];
      const rawExistingAttachments = (po as unknown as { receiptAttachments?: unknown }).receiptAttachments;
      const existingAttachments: Array<{ url: string; type: 'image' | 'pdf'; uploadedAt: string }> =
        Array.isArray(rawExistingAttachments)
          ? (rawExistingAttachments as Array<{ url: string; type: 'image' | 'pdf'; uploadedAt: string }>)
          : [];
      const mergedAttachments = [...existingAttachments, ...incomingAttachments];
      const extraFeesTotal = cleanedFees.reduce((s, f) => s + f.amount, 0);
      const netDelta = Math.max(0, receiptTotal + extraFeesTotal - discountPaisa);

      if (netDelta > 0) {
        await tx.supplier.update({
          where: { id: po.supplierId },
          data: { totalDue: { increment: netDelta } },
        });
      }

      // Surface receipt-level extra fees (delivery, freight, labour…) as
      // their own Expense rows so they show up in expense reports the
      // moment goods are received — not buried inside a future
      // "Supplier payment" FOOD_COST row. paymentMethod='CREDIT' flags
      // them as accrued obligations rather than cash outflows; when
      // the supplier is paid, makePayment() nets these out of its
      // FOOD_COST entry so we don't double-count.
      //
      // Category heuristic: delivery/transport keywords → TRANSPORT,
      // anything else → MISCELLANEOUS. The label is preserved in the
      // description so reports group sensibly even at coarser granularity.
      if (cleanedFees.length > 0) {
        const supplierName = po.supplier?.name ?? 'Supplier';
        const poTag = id.slice(-8).toUpperCase();
        for (const fee of cleanedFees) {
          const lower = fee.label.toLowerCase();
          const category: 'TRANSPORT' | 'MISCELLANEOUS' =
            /(deliver|freight|transport|shipping|courier|carriage)/.test(lower)
              ? 'TRANSPORT'
              : 'MISCELLANEOUS';
          await tx.expense.create({
            data: {
              branchId,
              category,
              description: `${fee.label} — ${supplierName} (PO ${poTag})`,
              amount: fee.amount,
              paymentMethod: 'CREDIT',
              reference: `PO-${id}`,
              date: new Date(),
              recordedById: staffId,
              approvedById: staffId,
              approvedAt: new Date(),
              notes: 'Accrued at goods receipt — settles via supplier ledger payment.',
            },
          });
        }
      }

      // Persist the adjustment block on the PO so the supplier ledger,
      // PO detail page, and printed receipt can show what was billed.
      // Stored as paisa to stay consistent with item.unitCost.
      const persistAdjustments = discountPaisa > 0 || cleanedFees.length > 0;

      // `closePartial` lets the cashier mark the PO complete even when some
      // items weren't fully received (supplier finalised the delivery at a
      // short count, no more coming). Remaining un-received qty stays on the
      // PO items for auditability; status flips to RECEIVED.
      const forceClose = dto.closePartial === true;
      const finalReceived = allReceived || forceClose;
      const newStatus = finalReceived ? 'RECEIVED' : 'PARTIAL';
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          status: newStatus,
          receivedAt: finalReceived ? new Date() : undefined,
          ...(persistAdjustments
            ? {
                receiptDiscount: discountPaisa,
                receiptDiscountReason: (dto.receiptDiscountReason ?? '').trim() || null,
                receiptExtraFees: cleanedFees as unknown as object,
              }
            : {}),
          // Only re-write the column when this receive added attachments,
          // so a no-attachment receive doesn't wipe earlier uploads.
          ...(incomingAttachments.length > 0
            ? { receiptAttachments: mergedAttachments as unknown as object }
            : {}),
        },
        include: {
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
        },
      });
    });

    // Sync parent aggregates for any variants that received stock
    for (const parentId of parentSyncIds) {
      await this.ingredientService.syncParentStock(parentId);
    }

    // Record the supplier against every ingredient that actually showed
    // up in this receipt (PO items + additional items tacked on at
    // delivery time). Covers the case where an admin creates a PO
    // manually without a supplier column but then receives it — the
    // supplier link should still stick to the ingredient afterward.
    const receivedIngredientIds = [
      ...po.items.map((i) => i.ingredientId),
      ...(dto.additionalItems ?? []).map((x) => x.ingredientId).filter((x): x is string => !!x),
    ];
    await this.linkSupplierToIngredients(receivedIngredientIds, po.supplierId);

    // Fire-and-forget WhatsApp confirmation to the supplier with the
    // PRICED PDF + the new receipt status (PARTIAL / RECEIVED). The
    // draft send earlier hid prices so the supplier could quote on
    // delivery; now that the cashier has captured the agreed numbers
    // (and any receipt-time discount / extra fees), the supplier
    // gets an updated copy with the figures locked in. Wrapped in a
    // try/catch — a missing WhatsApp config or a Meta API blip must
    // never roll back the goods-received transaction itself.
    if (user) {
      void this.notifyReceiptViaWhatsApp(id, branchId, user, result).catch((err) => {
        this.logger.warn(`PO receive WhatsApp confirmation failed (PO ${id}): ${(err as Error).message}`);
      });
    }

    return result;
  }

  async generateShoppingList(branchId: string) {
    // Get all top-level ingredients (not variants — low stock is checked on parent aggregate)
    const ingredients = await this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null, isActive: true, parentId: null },
      include: {
        supplier: { select: { id: true, name: true } },
        variants: {
          where: { deletedAt: null, isActive: true },
          include: { supplier: { select: { id: true, name: true } } },
          orderBy: [{ currentStock: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    const lowStock = ingredients.filter(
      (i) => i.minimumStock.toNumber() > 0 && i.currentStock.toNumber() <= i.minimumStock.toNumber() && !i.name.startsWith('[PR]'),
    );

    const results = [];
    for (const ing of lowStock) {
      const purchaseUnit = ing.purchaseUnit;
      const deficit = Math.max(0, ing.minimumStock.toNumber() - ing.currentStock.toNumber());
      const suggestedStockQty = Math.max(0, ing.minimumStock.toNumber() * 2 - ing.currentStock.toNumber());

      if (ing.hasVariants && ing.variants.length > 0) {
        // Pick the best variant: most stock first, then most recent
        const bestVariant = ing.variants[0];
        const puQty = bestVariant.purchaseUnitQty.toNumber();
        const suggestedPurchaseQty = purchaseUnit && puQty > 0
          ? Math.ceil(suggestedStockQty / puQty)
          : suggestedStockQty;

        // Get last purchase price for this variant
        const lastPOItem = await this.prisma.purchaseOrderItem.findFirst({
          where: { ingredientId: bestVariant.id, purchaseOrder: { status: { in: ['RECEIVED', 'PARTIAL'] } } },
          orderBy: { createdAt: 'desc' },
        });

        results.push({
          ingredientId: bestVariant.id,
          parentId: ing.id,
          parentName: ing.name,
          name: formatVariantLabel({
            parentName: ing.name,
            brandName: bestVariant.brandName,
            packSize: bestVariant.packSize,
            piecesPerPack: bestVariant.piecesPerPack,
            purchaseUnit,
            purchaseUnitQty: puQty || null,
            unit: ing.unit,
            id: bestVariant.id,
          }),
          unit: ing.unit,
          purchaseUnit,
          purchaseUnitQty: puQty,
          costPerPurchaseUnit: bestVariant.costPerPurchaseUnit.toNumber(),
          currentStock: ing.currentStock.toNumber(), // parent aggregate
          minimumStock: ing.minimumStock.toNumber(),
          deficit,
          suggestedQty: suggestedPurchaseQty,
          supplierId: bestVariant.supplierId ?? ing.supplierId,
          supplierName: bestVariant.supplier?.name ?? ing.supplier?.name ?? null,
          lastPurchaseRate: bestVariant.costPerPurchaseUnit.toNumber() > 0
            ? bestVariant.costPerPurchaseUnit.toNumber()
            : lastPOItem?.unitCost.toNumber() ?? 0,
          category: ing.category,
          hasVariants: true,
          variants: ing.variants.map((v) => ({
            id: v.id,
            brandName: v.brandName,
            packSize: v.packSize,
            piecesPerPack: v.piecesPerPack,
            currentStock: v.currentStock.toNumber(),
            costPerPurchaseUnit: v.costPerPurchaseUnit.toNumber(),
            supplierId: v.supplierId,
            supplierName: v.supplier?.name ?? null,
          })),
        });
      } else {
        // Standard ingredient (no variants)
        const purchaseUnitQty = ing.purchaseUnitQty.toNumber();
        const suggestedPurchaseQty = purchaseUnit && purchaseUnitQty > 0
          ? Math.ceil(suggestedStockQty / purchaseUnitQty)
          : suggestedStockQty;

        const lastPOItem = await this.prisma.purchaseOrderItem.findFirst({
          where: { ingredientId: ing.id, purchaseOrder: { status: { in: ['RECEIVED', 'PARTIAL'] } } },
          orderBy: { createdAt: 'desc' },
        });

        results.push({
          ingredientId: ing.id,
          parentId: null,
          parentName: null,
          name: ing.name,
          unit: ing.unit,
          purchaseUnit,
          purchaseUnitQty,
          costPerPurchaseUnit: ing.costPerPurchaseUnit.toNumber(),
          currentStock: ing.currentStock.toNumber(),
          minimumStock: ing.minimumStock.toNumber(),
          deficit,
          suggestedQty: suggestedPurchaseQty,
          supplierId: ing.supplierId,
          supplierName: ing.supplier?.name ?? null,
          lastPurchaseRate: purchaseUnit && ing.costPerPurchaseUnit.toNumber() > 0
            ? ing.costPerPurchaseUnit.toNumber()
            : lastPOItem?.unitCost.toNumber() ?? 0,
          category: ing.category,
          hasVariants: false,
          variants: [],
        });
      }
    }

    return results;
  }

  async submitShoppingList(
    branchId: string,
    createdById: string,
    items: { ingredientId: string; supplierId: string; quantity: number; unitCost: number; unit?: string }[],
  ) {
    // Group items by supplier
    const bySupplier: Record<string, typeof items> = {};
    for (const item of items) {
      if (!bySupplier[item.supplierId]) bySupplier[item.supplierId] = [];
      bySupplier[item.supplierId].push(item);
    }

    // Create a draft PO for each supplier
    const purchaseOrders = [];
    for (const [supplierId, supplierItems] of Object.entries(bySupplier)) {
      const po = await this.prisma.purchaseOrder.create({
        data: {
          branchId,
          supplierId,
          createdById,
          notes: 'Auto-generated from shopping list',
          items: {
            create: supplierItems.map((si) => ({
              ingredientId: si.ingredientId,
              quantityOrdered: si.quantity,
              unitCost: si.unitCost,
              unit: si.unit ?? null,
            })),
          },
        },
        include: {
          supplier: { select: { id: true, name: true } },
          items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
        },
      });
      await this.linkSupplierToIngredients(supplierItems.map((si) => si.ingredientId), supplierId);
      purchaseOrders.push(po);
    }

    return purchaseOrders;
  }

  async closePartial(id: string, branchId: string) {
    const po = await this.findOne(id, branchId);
    if (po.status !== 'PARTIAL') throw new BadRequestException('Only PARTIAL orders can be closed');
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'RECEIVED', receivedAt: new Date() },
      include: {
        supplier: { select: { id: true, name: true, whatsappNumber: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
      },
    });
  }

  async remove(id: string, branchId: string) {
    const po = await this.findOne(id, branchId);
    if (po.status !== 'DRAFT') throw new BadRequestException('Only DRAFT orders can be deleted');

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Purchase Returns ──────────────────────────────────────────────────────

  async createReturn(
    branchId: string,
    staffId: string,
    dto: {
      purchaseOrderId?: string;
      supplierId?: string;
      items: { ingredientId: string; quantity: number; unitPrice: number; unit?: string | null }[];
      notes?: string;
    },
  ) {
    let supplierId = dto.supplierId;
    if (dto.purchaseOrderId) {
      const po = await this.findOne(dto.purchaseOrderId, branchId);
      supplierId = po.supplierId;
    }
    if (!supplierId) throw new BadRequestException('Supplier ID is required for independent returns');

    // Convert each line's quantity to the ingredient's STOCK unit and
    // its unitPrice from per-purchase-unit to per-stock-unit. The POS
    // form lets a cashier enter "1 BOX @ ৳300" (purchase unit + price
    // per box); we need to record 30 pcs @ ৳10/pcs so the supplier
    // ledger and return list show the correct ৳300 total instead of
    // 30 × ৳300 = ৳9000.
    const itemsInStockUnit: Array<{ ingredientId: string; quantity: number; unitPrice: number }> = [];
    for (const line of dto.items) {
      const ingredient = await this.prisma.ingredient.findFirst({
        where: { id: line.ingredientId, branchId, deletedAt: null },
      });
      if (!ingredient) throw new BadRequestException(`Ingredient ${line.ingredientId} not found`);
      const hasPurchaseUnit = !!ingredient.purchaseUnit && ingredient.purchaseUnitQty.toNumber() > 0;
      const inputUnit = (line.unit ?? '').trim() || null;

      let stockQty = line.quantity;
      let stockUnitPrice = line.unitPrice;
      // Conversion factor = stockQty / inputQty. unitPrice is divided by
      // the same factor so quantity × unitPrice stays equal to the
      // amount the customer agreed.
      let factor = 1;

      if (hasPurchaseUnit && inputUnit && inputUnit === ingredient.purchaseUnit) {
        factor = ingredient.purchaseUnitQty.toNumber();
        stockQty = line.quantity * factor;
      } else if (inputUnit && inputUnit !== ingredient.unit) {
        try {
          stockQty = await this.unitConversion.convert(branchId, line.quantity, inputUnit, ingredient.unit);
          factor = line.quantity > 0 ? stockQty / line.quantity : 1;
        } catch {
          stockQty = line.quantity; // no conversion → leave raw + price
        }
      }

      if (factor > 0 && factor !== 1) {
        stockUnitPrice = Math.round(line.unitPrice / factor);
      }

      itemsInStockUnit.push({
        ingredientId: line.ingredientId,
        quantity: stockQty,
        unitPrice: stockUnitPrice,
      });
    }

    return this.prisma.purchaseReturn.create({
      data: {
        branchId,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        supplierId,
        requestedById: staffId,
        notes: dto.notes ?? null,
        items: {
          create: itemsInStockUnit,
        },
      },
      include: {
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
        supplier: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    });
  }

  async completeReturn(id: string, branchId: string) {
    const ret = await this.prisma.purchaseReturn.findFirst({
      where: { id, branchId },
      include: { items: true },
    });
    if (!ret) throw new NotFoundException('Return not found');
    if (ret.status !== 'REQUESTED' && ret.status !== 'APPROVED') {
      throw new BadRequestException('Return cannot be completed');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of ret.items) {
        await tx.ingredient.update({
          where: { id: item.ingredientId },
          data: { currentStock: { decrement: item.quantity.toNumber() } },
        });
        await tx.stockMovement.create({
          data: {
            branchId,
            ingredientId: item.ingredientId,
            type: 'ADJUSTMENT',
            quantity: -item.quantity.toNumber(),
            notes: `Return to supplier${ret.purchaseOrderId ? ` - PO ${ret.purchaseOrderId.slice(-8)}` : ''}`,
            // Per-stock-unit price the items were returned AT — used by
            // the Stock Watcher report to value the supplier-return row.
            unitCostPaisa: item.unitPrice.toNumber(),
            ...(ret.purchaseOrderId ? { purchaseOrderId: ret.purchaseOrderId } : {}),
          },
        });
      }

      const returnTotal = ret.items.reduce((s, i) => s + i.unitPrice.toNumber() * i.quantity.toNumber(), 0);
      await tx.supplier.update({
        where: { id: ret.supplierId },
        data: { totalDue: { decrement: returnTotal } },
      });

      return tx.purchaseReturn.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
        include: {
          items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
          supplier: { select: { id: true, name: true } },
          requestedBy: { select: { id: true, name: true } },
        },
      });
    });
  }

  async rejectReturn(id: string, branchId: string) {
    const ret = await this.prisma.purchaseReturn.findFirst({ where: { id, branchId } });
    if (!ret) throw new NotFoundException('Return not found');
    if (ret.status !== 'REQUESTED') throw new BadRequestException('Only REQUESTED returns can be rejected');
    return this.prisma.purchaseReturn.update({
      where: { id },
      data: { status: 'REJECTED' },
      include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } }, supplier: { select: { id: true, name: true } }, requestedBy: { select: { id: true, name: true } } },
    });
  }

  async cancelReturn(id: string, branchId: string) {
    const ret = await this.prisma.purchaseReturn.findFirst({ where: { id, branchId } });
    if (!ret) throw new NotFoundException('Return not found');
    if (ret.status === 'COMPLETED') throw new BadRequestException('Cannot cancel a completed return');
    return this.prisma.purchaseReturn.update({
      where: { id },
      data: { status: 'REJECTED' },
      include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } }, supplier: { select: { id: true, name: true } }, requestedBy: { select: { id: true, name: true } } },
    });
  }

  async getReturns(branchId: string, purchaseOrderId?: string) {
    return this.prisma.purchaseReturn.findMany({
      where: { branchId, ...(purchaseOrderId ? { purchaseOrderId } : {}) },
      include: {
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true, packSize: true, brandName: true } } } },
        supplier: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Render the PO as a PDF, upload it to Meta, and send a pre-approved
   * utility template message to the supplier's WhatsApp number with the
   * PDF attached as the document header. Records the returned Meta
   * message id on the PO row for traceability + future webhook hookup.
   */
  async sendWhatsApp(user: JwtPayload, poId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: poId, branchId: user.branchId, deletedAt: null },
      include: {
        supplier: true,
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, packSize: true, brandName: true } } } },
        branch: { select: { id: true, name: true, address: true, phone: true } },
      },
    });
    if (!po) throw new NotFoundException(`Purchase order ${poId} not found`);

    const settings = await this.prisma.branchSetting.findUnique({ where: { branchId: user.branchId } });
    if (!settings?.whatsappEnabled) {
      throw new BadRequestException('WhatsApp integration is not enabled for this branch. Configure it in Settings → Notifications.');
    }
    const phoneNumberId = settings.whatsappPhoneNumberId?.trim();
    const accessToken = settings.whatsappAccessToken?.trim();
    const templateName = settings.whatsappPoTemplate?.trim();
    const languageCode = settings.whatsappPoTemplateLang?.trim() || 'en_US';
    const paramTokensRaw = (settings as any).whatsappPoTemplateParams?.trim() || 'supplierName,poNumber,date';
    if (!phoneNumberId || !accessToken || !templateName) {
      throw new BadRequestException('WhatsApp credentials incomplete. Set Phone Number ID, Access Token, and Template Name in Settings.');
    }

    const waNumberRaw = po.supplier?.whatsappNumber?.trim();
    if (!waNumberRaw) {
      throw new BadRequestException(`Supplier "${po.supplier?.name ?? ''}" has no WhatsApp number on file. Add one in Suppliers first.`);
    }
    // Meta wants bare digits — strip +, spaces, dashes, parens.
    const to = waNumberRaw.replace(/[^\d]/g, '');
    if (to.length < 10 || to.length > 15) {
      throw new BadRequestException(`Supplier WhatsApp number "${waNumberRaw}" is not a valid international number.`);
    }

    const poNumber = po.id.slice(-8).toUpperCase();
    const poDate = (po.createdAt instanceof Date ? po.createdAt : new Date(po.createdAt));
    const formattedDate = poDate.toLocaleDateString('en-GB');
    const itemsSubtotalPaisa = po.items.reduce(
      (sum, item) => sum + Number(item.quantityOrdered) * Number(item.unitCost),
      0,
    );
    const discountPaisa = Number((po as any).receiptDiscount ?? 0);
    const feesPaisa = Array.isArray((po as any).receiptExtraFees)
      ? ((po as any).receiptExtraFees as Array<{ amount: number }>)
          .reduce((s, f) => s + (Number(f?.amount) > 0 ? Number(f.amount) : 0), 0)
      : 0;
    const grandTotalPaisa = itemsSubtotalPaisa + feesPaisa - discountPaisa;
    const formattedTotal = `Tk ${(grandTotalPaisa / 100).toFixed(2)}`;

    // Outgoing draft / sent PO to a supplier hides unit price + line
    // total + grand total. Suppliers quote their own prices on
    // delivery, so the draft copy is a request-for-quote / shopping
    // list — internal margin negotiations stay internal until goods
    // arrive and the cashier confirms the agreed numbers (at which
    // point receiveGoods fires a separate priced confirmation copy).
    const pdf = await buildPurchaseOrderPdf({
      id: po.id,
      poNumber,
      status: String(po.status),
      createdAt: poDate,
      expectedAt: po.expectedAt,
      notes: po.notes,
      branch: {
        name: po.branch?.name ?? '',
        address: po.branch?.address ?? null,
        phone: po.branch?.phone ?? null,
      },
      supplier: {
        name: po.supplier?.name ?? '',
        contactName: po.supplier?.contactName ?? null,
        phone: po.supplier?.phone ?? null,
        address: po.supplier?.address ?? null,
      },
      items: po.items.map((item) => ({
        name: item.ingredient?.name ?? '',
        quantityOrdered: Number(item.quantityOrdered),
        unit: item.unit ?? item.ingredient?.purchaseUnit ?? item.ingredient?.unit ?? '',
        unitCostPaisa: Number(item.unitCost),
      })),
      receiptDiscountPaisa: Number((po as any).receiptDiscount ?? 0),
      receiptDiscountReason: (po as any).receiptDiscountReason ?? null,
      receiptExtraFees: Array.isArray((po as any).receiptExtraFees)
        ? ((po as any).receiptExtraFees as Array<{ label: string; amount: number }>)
        : [],
      hidePrices: true,
    });

    const filename = `PO-${poNumber}.pdf`;
    const { mediaId } = await this.whatsApp.uploadMedia({
      phoneNumberId,
      accessToken,
      buffer: pdf,
      filename,
      mimeType: 'application/pdf',
    });

    // Body params are built from the admin-configured ordered token
    // list so a template with a different placeholder count (Meta
    // returns #132000 when count mismatches) can be supported without
    // a code change. Unknown tokens are skipped silently — the admin
    // sees the param count + names in Settings, so a typo there will
    // surface as a 132000 with a clearer follow-up message below.
    const paramValues: Record<string, string> = {
      supplierName: po.supplier?.name ?? '',
      poNumber,
      date: formattedDate,
      total: formattedTotal,
      branchName: po.branch?.name ?? '',
      itemCount: String(po.items.length),
      supplierContact: po.supplier?.contactName ?? po.supplier?.phone ?? '',
    };
    const bodyParams = paramTokensRaw
      .split(',')
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0)
      .map((t: string) => paramValues[t] ?? '');

    // Meta's language code matching is exact-match — `en_US` and `en`
    // are NOT interchangeable. Templates created in WhatsApp Manager
    // without a region tag are usually approved as plain `en`, so when
    // the configured code returns 132001 ("template name does not exist
    // in the translation"), retry once with the most likely fallback
    // before giving up. Saves the admin a Settings round-trip the first
    // time they hit this.
    const sendOnce = (code: string) => this.whatsApp.sendDocumentTemplate({
      phoneNumberId,
      accessToken,
      to,
      templateName,
      languageCode: code,
      bodyParams,
      mediaId,
      documentFilename: filename,
    });

    const fallbackForLang = (lc: string): string | null => {
      const norm = lc.toLowerCase().replace('-', '_');
      // en_US / en_GB / en_IN → en (the most common WhatsApp default).
      if (norm.startsWith('en_')) return 'en';
      // Plain "en" → no further fallback worth trying automatically.
      return null;
    };

    let messageId: string;
    try {
      ({ messageId } = await sendOnce(languageCode));
    } catch (err: any) {
      // 132000 → param count mismatch. Meta tells us in the message how
      // many it expected; rewrite the error so the admin knows exactly
      // which Settings field to trim. Don't auto-retry — guessing which
      // params to drop would silently send a misleading message.
      if (err?.metaCode === 132000) {
        const expected = /expected number of params \((\d+)\)/.exec(String(err?.message ?? ''))?.[1];
        throw new BadRequestException(
          `WhatsApp template "${templateName}" expects ${expected ?? '?'} body parameter(s), but Restora is sending ${bodyParams.length} (${paramTokensRaw}). ` +
          `Open Settings → Notifications and edit "Template Body Params" so its comma-separated list has exactly ${expected ?? 'the right'} entries — pick from: supplierName, poNumber, date, total, branchName, itemCount, supplierContact.`,
        );
      }
      const fallback = err?.metaCode === 132001 ? fallbackForLang(languageCode) : null;
      if (!fallback || fallback === languageCode) {
        // Re-throw with a friendlier hint when the failure is the
        // language-mismatch that the admin can fix in Settings. The
        // raw Meta message ("(#132001) Template name does not exist
        // in the translation") doesn't tell them WHERE to fix it.
        if (err?.metaCode === 132001) {
          throw new BadRequestException(
            `WhatsApp template "${templateName}" is not approved in language "${languageCode}". ` +
            `Open Settings → Notifications and set "Template Language" to the exact code shown in WhatsApp Manager (commonly "en", "en_US", or "bn").`,
          );
        }
        throw err;
      }
      this.logger.warn(`WhatsApp PO send: template not in ${languageCode}; retrying with ${fallback}`);
      ({ messageId } = await sendOnce(fallback));
    }

    const sentAt = new Date();
    await this.prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { whatsappMessageId: messageId, whatsappSentAt: sentAt },
    });

    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'PURCHASING',
      action: 'UPDATE',
      entityType: 'purchase_orders',
      entityId: po.id,
      entityName: `PO #${poNumber}`,
      summary: `Sent PO PDF to ${po.supplier?.name ?? 'supplier'} via WhatsApp`,
    });

    return { messageId, sentAt: sentAt.toISOString() };
  }

  /**
   * Goods-received confirmation to the supplier via WhatsApp. Sent
   * automatically by `receiveGoods` once a receipt commits — full
   * priced PDF (so the supplier can reconcile their delivery against
   * what the cashier captured) plus a header line keyed by the new
   * status (PARTIAL vs RECEIVED). Mirrors `sendWhatsApp`'s template
   * + media flow but skips the rich error-rewrite path: any Meta
   * failure here is caught by the caller and logged as a warning,
   * never thrown — the underlying receipt has already committed.
   *
   * Skips silently when:
   *   - WhatsApp integration is disabled for this branch.
   *   - The WhatsApp template / credentials aren't configured.
   *   - The supplier has no whatsappNumber on file.
   * Each is a normal "admin hasn't set this up" state, not an error.
   */
  private async notifyReceiptViaWhatsApp(
    poId: string,
    branchId: string,
    user: JwtPayload,
    receivedPo: { status?: string } | null,
  ): Promise<void> {
    const settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings?.whatsappEnabled) return;
    const phoneNumberId = settings.whatsappPhoneNumberId?.trim();
    const accessToken = settings.whatsappAccessToken?.trim();
    const templateName = settings.whatsappPoTemplate?.trim();
    const languageCode = settings.whatsappPoTemplateLang?.trim() || 'en';
    const paramTokensRaw = (settings as any).whatsappPoTemplateParams?.trim() || 'supplierName,poNumber,date';
    if (!phoneNumberId || !accessToken || !templateName) return;

    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: poId, branchId, deletedAt: null },
      include: {
        supplier: true,
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, packSize: true, brandName: true } } } },
        branch: { select: { id: true, name: true, address: true, phone: true } },
      },
    });
    if (!po) return;

    const waNumberRaw = po.supplier?.whatsappNumber?.trim();
    if (!waNumberRaw) return; // Supplier has no WA number configured — silent skip.
    const to = waNumberRaw.replace(/[^\d]/g, '');
    if (to.length < 10 || to.length > 15) return;

    const poNumber = po.id.slice(-8).toUpperCase();
    const poDate = po.createdAt instanceof Date ? po.createdAt : new Date(po.createdAt);
    const formattedDate = poDate.toLocaleDateString('en-GB');
    const itemsSubtotalPaisa = po.items.reduce(
      (sum, item) => sum + Number(item.quantityOrdered) * Number(item.unitCost),
      0,
    );
    const discountPaisa = Number((po as any).receiptDiscount ?? 0);
    const feesPaisa = Array.isArray((po as any).receiptExtraFees)
      ? ((po as any).receiptExtraFees as Array<{ amount: number }>)
          .reduce((s, f) => s + (Number(f?.amount) > 0 ? Number(f.amount) : 0), 0)
      : 0;
    const grandTotalPaisa = itemsSubtotalPaisa + feesPaisa - discountPaisa;
    const formattedTotal = `Tk ${(grandTotalPaisa / 100).toFixed(2)}`;
    const status = receivedPo?.status ?? po.status ?? 'RECEIVED';
    const statusLabel = status === 'PARTIAL' ? 'Partially Received' : 'Received';

    const pdf = await buildPurchaseOrderPdf({
      id: po.id,
      poNumber,
      // Reflect the post-receipt status on the PDF header so the
      // supplier sees "Status: PARTIAL" / "Status: RECEIVED" instead
      // of the stale DRAFT/SENT they saw on the first copy.
      status: statusLabel,
      createdAt: poDate,
      expectedAt: po.expectedAt,
      notes: po.notes,
      branch: {
        name: po.branch?.name ?? '',
        address: po.branch?.address ?? null,
        phone: po.branch?.phone ?? null,
      },
      supplier: {
        name: po.supplier?.name ?? '',
        contactName: po.supplier?.contactName ?? null,
        phone: po.supplier?.phone ?? null,
        address: po.supplier?.address ?? null,
      },
      items: po.items.map((item) => ({
        name: item.ingredient?.name ?? '',
        quantityOrdered: Number(item.quantityOrdered),
        unit: item.unit ?? item.ingredient?.purchaseUnit ?? item.ingredient?.unit ?? '',
        unitCostPaisa: Number(item.unitCost),
      })),
      receiptDiscountPaisa: discountPaisa,
      receiptDiscountReason: (po as any).receiptDiscountReason ?? null,
      receiptExtraFees: Array.isArray((po as any).receiptExtraFees)
        ? ((po as any).receiptExtraFees as Array<{ label: string; amount: number }>)
        : [],
      // Receipt copy SHOWS prices — supplier needs to reconcile
      // their delivery slip against the captured numbers.
      hidePrices: false,
    });

    const filename = `PO-${poNumber}-receipt.pdf`;
    const { mediaId } = await this.whatsApp.uploadMedia({
      phoneNumberId, accessToken, buffer: pdf, filename, mimeType: 'application/pdf',
    });

    const paramValues: Record<string, string> = {
      supplierName: po.supplier?.name ?? '',
      poNumber,
      date: formattedDate,
      total: formattedTotal,
      branchName: po.branch?.name ?? '',
      itemCount: String(po.items.length),
      supplierContact: po.supplier?.contactName ?? po.supplier?.phone ?? '',
    };
    const bodyParams = paramTokensRaw
      .split(',')
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0)
      .map((t: string) => paramValues[t] ?? '');

    await this.whatsApp.sendDocumentTemplate({
      phoneNumberId,
      accessToken,
      to,
      templateName,
      languageCode,
      bodyParams,
      mediaId,
      documentFilename: filename,
    });

    void this.activityLog.log({
      branchId,
      actor: user,
      category: 'PURCHASING',
      action: 'UPDATE',
      entityType: 'purchase_orders',
      entityId: po.id,
      entityName: `PO #${poNumber}`,
      summary: `Sent ${statusLabel.toLowerCase()} confirmation (with prices) to ${po.supplier?.name ?? 'supplier'} via WhatsApp`,
    });
  }
}
