import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreatePurchaseOrderDto, UpdatePurchaseOrderDto, ReceiveGoodsDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { IngredientService } from '../ingredient/ingredient.service';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitConversion: UnitConversionService,
    private readonly ingredientService: IngredientService,
  ) {}

  findAll(branchId: string, status?: string) {
    return this.prisma.purchaseOrder.findMany({
      where: {
        branchId,
        deletedAt: null,
        ...(status ? { status: status as never } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string, branchId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, branchId, deletedAt: null },
      include: {
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
      },
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return po;
  }

  create(branchId: string, createdById: string, dto: CreatePurchaseOrderDto) {
    return this.prisma.purchaseOrder.create({
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
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
      },
    });
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
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
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
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
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
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
      },
    });
  }

  async receiveGoods(id: string, branchId: string, staffId: string, dto: ReceiveGoodsDto) {
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

        if (effectivePrice !== undefined) {
          const branch = await tx.branch.findFirstOrThrow({ where: { id: branchId } });
          const method = (branch as any).stockPricingMethod ?? 'LAST_PURCHASE';

          // Calculate cost per STOCK unit from purchase unit price
          const conversionFactor = stockQtyReceived / receipt.quantityReceived; // e.g. 1000 for KG→G
          const costPerStockUnit = Math.round(effectivePrice / conversionFactor);

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
          if (extra.unitPrice && extra.unitPrice > 0) {
            const conversionFactor = stockQtyReceived / extra.quantityReceived;
            ingredientUpdate.costPerUnit = Math.round(extra.unitPrice / conversionFactor);
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

      if (receiptTotal > 0) {
        await tx.supplier.update({
          where: { id: po.supplierId },
          data: { totalDue: { increment: receiptTotal } },
        });
      }

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
        },
        include: {
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
        },
      });
    });

    // Sync parent aggregates for any variants that received stock
    for (const parentId of parentSyncIds) {
      await this.ingredientService.syncParentStock(parentId);
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
          name: `${ing.name} → ${bestVariant.brandName ?? ''} ${bestVariant.packSize ?? ''}`.trim(),
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
          items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
        },
      });
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
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
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
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
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
          items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
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
      include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } }, supplier: { select: { id: true, name: true } }, requestedBy: { select: { id: true, name: true } } },
    });
  }

  async cancelReturn(id: string, branchId: string) {
    const ret = await this.prisma.purchaseReturn.findFirst({ where: { id, branchId } });
    if (!ret) throw new NotFoundException('Return not found');
    if (ret.status === 'COMPLETED') throw new BadRequestException('Cannot cancel a completed return');
    return this.prisma.purchaseReturn.update({
      where: { id },
      data: { status: 'REJECTED' },
      include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } }, supplier: { select: { id: true, name: true } }, requestedBy: { select: { id: true, name: true } } },
    });
  }

  async getReturns(branchId: string, purchaseOrderId?: string) {
    return this.prisma.purchaseReturn.findMany({
      where: { branchId, ...(purchaseOrderId ? { purchaseOrderId } : {}) },
      include: {
        items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
        supplier: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
