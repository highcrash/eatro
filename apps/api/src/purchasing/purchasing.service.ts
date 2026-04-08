import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreatePurchaseOrderDto, UpdatePurchaseOrderDto, ReceiveGoodsDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitConversion: UnitConversionService,
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

    return this.prisma.$transaction(async (tx) => {
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
        const ingredient = await tx.ingredient.findUniqueOrThrow({ where: { id: poItem.ingredientId } });
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
          where: { id: poItem.ingredientId },
          data: ingredientUpdate,
        });

        stockMovements.push({
          branchId,
          ingredientId: poItem.ingredientId,
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

      if (receiptTotal > 0) {
        await tx.supplier.update({
          where: { id: po.supplierId },
          data: { totalDue: { increment: receiptTotal } },
        });
      }

      const newStatus = allReceived ? 'RECEIVED' : 'PARTIAL';
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          status: newStatus,
          receivedAt: allReceived ? new Date() : undefined,
        },
        include: {
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true, currentStock: true } } } },
        },
      });
    });
  }

  async generateShoppingList(branchId: string) {
    // Get all low-stock ingredients
    const ingredients = await this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null, isActive: true },
      include: { supplier: { select: { id: true, name: true } } },
    });

    const lowStock = ingredients.filter(
      (i) => i.currentStock.toNumber() <= i.minimumStock.toNumber() && !i.name.startsWith('[PR]'),
    );

    // Get last purchase price for each ingredient
    const lastPrices: Record<string, number> = {};
    for (const ing of lowStock) {
      const lastPOItem = await this.prisma.purchaseOrderItem.findFirst({
        where: { ingredientId: ing.id, purchaseOrder: { status: { in: ['RECEIVED', 'PARTIAL'] } } },
        orderBy: { createdAt: 'desc' },
      });
      if (lastPOItem) {
        lastPrices[ing.id] = lastPOItem.unitCost.toNumber();
      }
    }

    return lowStock.map((ing) => {
      const purchaseUnitQty = ing.purchaseUnitQty.toNumber();
      const deficit = Math.max(0, ing.minimumStock.toNumber() - ing.currentStock.toNumber());
      const suggestedStockQty = Math.max(0, ing.minimumStock.toNumber() * 2 - ing.currentStock.toNumber());
      // Convert suggested qty to purchase units if available
      const suggestedPurchaseQty = ing.purchaseUnit && purchaseUnitQty > 0
        ? Math.ceil(suggestedStockQty / purchaseUnitQty)
        : suggestedStockQty;

      return {
        ingredientId: ing.id,
        name: ing.name,
        unit: ing.unit,
        purchaseUnit: ing.purchaseUnit,
        purchaseUnitQty,
        costPerPurchaseUnit: ing.costPerPurchaseUnit.toNumber(),
        currentStock: ing.currentStock.toNumber(),
        minimumStock: ing.minimumStock.toNumber(),
        deficit,
        suggestedQty: suggestedPurchaseQty,
        supplierId: ing.supplierId,
        supplierName: ing.supplier?.name ?? null,
        lastPurchaseRate: ing.purchaseUnit && ing.costPerPurchaseUnit.toNumber() > 0
          ? ing.costPerPurchaseUnit.toNumber()
          : lastPrices[ing.id] ?? 0,
        category: ing.category,
      };
    });
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

  async createReturn(branchId: string, staffId: string, dto: { purchaseOrderId?: string; supplierId?: string; items: { ingredientId: string; quantity: number; unitPrice: number }[]; notes?: string }) {
    let supplierId = dto.supplierId;
    if (dto.purchaseOrderId) {
      const po = await this.findOne(dto.purchaseOrderId, branchId);
      supplierId = po.supplierId;
    }
    if (!supplierId) throw new BadRequestException('Supplier ID is required for independent returns');

    return this.prisma.purchaseReturn.create({
      data: {
        branchId,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        supplierId,
        requestedById: staffId,
        notes: dto.notes ?? null,
        items: {
          create: dto.items.map((i) => ({
            ingredientId: i.ingredientId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
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
