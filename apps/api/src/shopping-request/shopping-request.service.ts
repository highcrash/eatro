import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import type {
  ApproveShoppingRequestResult,
  CreateShoppingRequestDto,
  JwtPayload,
  MismatchReason,
  ShoppingRequest,
  ShoppingRequestStatus,
  UpdateShoppingRequestDto,
} from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { IngredientService } from '../ingredient/ingredient.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

const STAFF_ROLES_THAT_CAN_CREATE = new Set(['OWNER', 'MANAGER', 'ADVISOR', 'KITCHEN']);
const ROLES_THAT_CAN_APPROVE = new Set(['OWNER', 'MANAGER']);

@Injectable()
export class ShoppingRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingredientService: IngredientService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ── Read ───────────────────────────────────────────────────────────

  async findAll(user: JwtPayload, filters: { status?: ShoppingRequestStatus | null; from?: string | null; to?: string | null; requestedById?: string | null; mineOnly?: boolean }) {
    const where: Record<string, unknown> = { branchId: user.branchId };
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      const createdAt: { gte?: Date; lte?: Date } = {};
      if (filters.from) { const d = new Date(filters.from); d.setHours(0, 0, 0, 0); createdAt.gte = d; }
      if (filters.to) { const d = new Date(filters.to); d.setHours(23, 59, 59, 999); createdAt.lte = d; }
      where.createdAt = createdAt;
    }
    // KITCHEN role only sees own requests regardless of filter — admin
    // roles can opt into the same view via mineOnly=true.
    const restrictToMine = filters.mineOnly || user.role === 'KITCHEN';
    if (restrictToMine) where.requestedById = user.sub;
    else if (filters.requestedById) where.requestedById = filters.requestedById;

    return this.prisma.shoppingRequest.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, name: true, role: true } },
        approvedBy: { select: { id: true, name: true } },
        lines: {
          include: {
            ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, costPerPurchaseUnit: true, currentStock: true } },
            supplier: { select: { id: true, name: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async findOne(user: JwtPayload, id: string) {
    const request = await this.prisma.shoppingRequest.findFirst({
      where: { id, branchId: user.branchId },
      include: {
        requestedBy: { select: { id: true, name: true, role: true } },
        approvedBy: { select: { id: true, name: true } },
        lines: {
          include: {
            ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, costPerPurchaseUnit: true, currentStock: true } },
            supplier: { select: { id: true, name: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!request) throw new NotFoundException('Shopping request not found');
    // KITCHEN can only see own.
    if (user.role === 'KITCHEN' && request.requestedById !== user.sub) {
      throw new ForbiddenException('You can only view your own requests');
    }
    return request;
  }

  // ── Write ──────────────────────────────────────────────────────────

  async create(user: JwtPayload, dto: CreateShoppingRequestDto) {
    if (!STAFF_ROLES_THAT_CAN_CREATE.has(user.role)) {
      throw new ForbiddenException('Your role cannot submit shopping requests');
    }
    if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('At least one line is required');
    }
    const ingredientIds = Array.from(new Set(dto.lines.map((l) => l.ingredientId).filter(Boolean)));
    if (ingredientIds.length === 0) {
      throw new BadRequestException('Lines must reference at least one ingredient');
    }
    // Snapshot the on-hand stock for each referenced ingredient — admin
    // review reflects what staff saw, not the moved-since current value.
    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: ingredientIds }, branchId: user.branchId, deletedAt: null },
      select: { id: true, currentStock: true },
    });
    const snapshot = new Map(ingredients.map((i) => [i.id, Number(i.currentStock)] as const));
    for (const id of ingredientIds) {
      if (!snapshot.has(id)) {
        throw new BadRequestException(`Ingredient ${id} not found in this branch`);
      }
    }

    const created = await this.prisma.shoppingRequest.create({
      data: {
        branchId: user.branchId,
        requestedById: user.sub,
        notes: dto.notes?.trim() || null,
        status: 'PENDING',
        lines: {
          create: dto.lines.map((l) => ({
            ingredientId: l.ingredientId,
            requestedQuantity: l.requestedQuantity != null ? l.requestedQuantity : null,
            physicalCount: l.physicalCount != null ? l.physicalCount : null,
            softwareCountAtTime: snapshot.get(l.ingredientId) ?? null,
            mismatchReason: l.mismatchReason ?? null,
            mismatchPhotoUrl: l.mismatchPhotoUrl?.trim() || null,
            mismatchNotes: l.mismatchNotes?.trim() || null,
          })),
        },
      },
      include: { lines: true },
    });

    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'PURCHASING',
      action: 'CREATE',
      entityType: 'shoppingRequest',
      entityId: created.id,
      entityName: `Shopping request · ${created.lines.length} line${created.lines.length === 1 ? '' : 's'}`,
      after: { id: created.id, status: created.status, lineCount: created.lines.length, mismatchCount: created.lines.filter((l) => l.mismatchReason).length },
      summary: `Submitted ${created.lines.length} line shopping request`,
    });

    return this.findOne(user, created.id);
  }

  /** Admin pre-approval edit. Replaces line-level supplier / qty /
   *  unit-cost so the approve handler has the final numbers. Only
   *  PENDING requests are editable. */
  async update(user: JwtPayload, id: string, dto: UpdateShoppingRequestDto) {
    if (!ROLES_THAT_CAN_APPROVE.has(user.role)) {
      throw new ForbiddenException('Only OWNER or MANAGER can edit a shopping request');
    }
    const request = await this.prisma.shoppingRequest.findFirst({
      where: { id, branchId: user.branchId },
      select: { id: true, status: true },
    });
    if (!request) throw new NotFoundException('Shopping request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Cannot edit a ${request.status} request`);
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.notes !== undefined) {
        await tx.shoppingRequest.update({ where: { id }, data: { notes: dto.notes?.trim() || null } });
      }
      for (const line of dto.lines ?? []) {
        await tx.shoppingRequestLine.update({
          where: { id: line.id },
          data: {
            ...(line.requestedQuantity !== undefined ? { requestedQuantity: line.requestedQuantity } : {}),
            ...(line.supplierId !== undefined ? { supplierId: line.supplierId || null } : {}),
            ...(line.unitCostPaisa !== undefined ? { unitCostPaisa: line.unitCostPaisa } : {}),
            ...(line.mismatchReason !== undefined ? { mismatchReason: line.mismatchReason } : {}),
            ...(line.mismatchNotes !== undefined ? { mismatchNotes: line.mismatchNotes?.trim() || null } : {}),
          },
        });
      }
    });

    return this.findOne(user, id);
  }

  async reject(user: JwtPayload, id: string, reason: string) {
    if (!ROLES_THAT_CAN_APPROVE.has(user.role)) {
      throw new ForbiddenException('Only OWNER or MANAGER can reject a shopping request');
    }
    const request = await this.prisma.shoppingRequest.findFirst({
      where: { id, branchId: user.branchId },
      select: { id: true, status: true },
    });
    if (!request) throw new NotFoundException('Shopping request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Cannot reject a ${request.status} request`);
    }
    if (!reason?.trim()) throw new BadRequestException('Rejection reason is required');

    await this.prisma.shoppingRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason.trim(),
        approvedById: user.sub,
        approvedAt: new Date(),
      },
    });

    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'PURCHASING',
      action: 'UPDATE',
      entityType: 'shoppingRequest',
      entityId: id,
      entityName: `Shopping request ${id.slice(-6)}`,
      after: { status: 'REJECTED', rejectionReason: reason },
      summary: `Rejected: ${reason}`,
    });

    return this.findOne(user, id);
  }

  /** Approval — atomic. Fires mismatch side-effects (WasteLog /
   *  ADJUSTMENT stockMovement) AND creates one DRAFT PurchaseOrder
   *  per supplier group. Records back-pointers on each line so the
   *  admin UI can deep-link the resolution artefacts. */
  async approve(user: JwtPayload, id: string): Promise<ApproveShoppingRequestResult> {
    if (!ROLES_THAT_CAN_APPROVE.has(user.role)) {
      throw new ForbiddenException('Only OWNER or MANAGER can approve a shopping request');
    }
    const request = await this.prisma.shoppingRequest.findFirst({
      where: { id, branchId: user.branchId },
      include: {
        lines: {
          include: {
            ingredient: {
              select: {
                id: true, name: true, unit: true, costPerUnit: true,
                costPerPurchaseUnit: true, purchaseUnit: true, purchaseUnitQty: true,
                parentId: true, hasVariants: true, currentStock: true,
                suppliers: { select: { supplierId: true }, take: 1 },
                supplierId: true,
              },
            },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('Shopping request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Cannot approve a ${request.status} request`);
    }

    const wasteLogIds: string[] = [];
    const adjustmentMovementIds: string[] = [];
    const createdPurchaseOrderIds: string[] = [];
    const parentSyncIds = new Set<string>();

    await this.prisma.$transaction(async (tx) => {
      // 1. Mismatch side-effects — per line.
      for (const line of request.lines) {
        if (!line.mismatchReason) continue;
        const physical = line.physicalCount == null ? null : Number(line.physicalCount);
        const software = line.softwareCountAtTime == null
          ? Number(line.ingredient.currentStock)
          : Number(line.softwareCountAtTime);
        if (physical == null) {
          // Shouldn't happen — UI guards against it — but skip safely.
          continue;
        }
        const delta = physical - software;
        if (Math.abs(delta) < 0.0001) continue;
        const reason = line.mismatchReason as MismatchReason;
        const unitCost = Number(line.ingredient.costPerUnit);

        if (reason === 'WASTE') {
          // Shortage → WasteLog + WASTE stockMovement + decrement.
          const wasteQty = software - physical; // positive
          if (wasteQty <= 0) continue;
          const wasteLog = await tx.wasteLog.create({
            data: {
              branchId: user.branchId,
              ingredientId: line.ingredientId,
              quantity: wasteQty,
              reason: 'SPOILAGE',
              notes: line.mismatchNotes || `Shopping request ${id.slice(-6)}`,
              photoUrl: line.mismatchPhotoUrl || null,
              recordedById: user.sub,
            },
          });
          wasteLogIds.push(wasteLog.id);
          await tx.ingredient.update({
            where: { id: line.ingredientId },
            data: { currentStock: { decrement: wasteQty } },
          });
          await tx.stockMovement.create({
            data: {
              branchId: user.branchId,
              ingredientId: line.ingredientId,
              type: 'WASTE',
              quantity: -wasteQty,
              staffId: user.sub,
              notes: `Waste: SPOILAGE${line.mismatchNotes ? ` — ${line.mismatchNotes}` : ''} (request ${id.slice(-6)})`,
              unitCostPaisa: unitCost,
            },
          });
          await tx.shoppingRequestLine.update({
            where: { id: line.id },
            data: { wasteLogId: wasteLog.id },
          });
          if (line.ingredient.parentId) parentSyncIds.add(line.ingredient.parentId);
        } else {
          // MISCALCULATION / MISSING_PURCHASE / ADJUSTMENT —
          // single ADJUSTMENT stockMovement with the signed delta and a
          // reason-tagged note (the Miscalculation Report filters on
          // the "Miscalculation:" prefix to surface chronic shrinkage).
          const reasonLabel =
            reason === 'MISCALCULATION' ? 'Miscalculation'
            : reason === 'MISSING_PURCHASE' ? 'Missing purchase'
            : 'Adjustment';
          await tx.ingredient.update({
            where: { id: line.ingredientId },
            data: { currentStock: { increment: delta } },
          });
          const movement = await tx.stockMovement.create({
            data: {
              branchId: user.branchId,
              ingredientId: line.ingredientId,
              type: 'ADJUSTMENT',
              quantity: delta,
              staffId: user.sub,
              notes: `${reasonLabel}: ${line.mismatchNotes ?? 'shopping request reconcile'} (request ${id.slice(-6)})`,
              unitCostPaisa: unitCost,
            },
          });
          adjustmentMovementIds.push(movement.id);
          await tx.shoppingRequestLine.update({
            where: { id: line.id },
            data: { adjustmentMovementId: movement.id },
          });
          if (line.ingredient.parentId) parentSyncIds.add(line.ingredient.parentId);
        }
      }

      // 2. Order lines — group by supplier and emit DRAFT POs.
      type Group = { supplierId: string; lines: typeof request.lines };
      const groups = new Map<string, Group>();
      for (const line of request.lines) {
        const qty = line.requestedQuantity == null ? 0 : Number(line.requestedQuantity);
        if (qty <= 0) continue;
        const supplierId =
          line.supplierId
          ?? line.ingredient.supplierId
          ?? line.ingredient.suppliers[0]?.supplierId
          ?? null;
        if (!supplierId) {
          throw new BadRequestException(
            `Line for "${line.ingredient.name}" has no supplier. Pick one in the review screen before approving.`,
          );
        }
        if (!groups.has(supplierId)) groups.set(supplierId, { supplierId, lines: [] });
        groups.get(supplierId)!.lines.push(line);
      }

      for (const group of groups.values()) {
        const po = await tx.purchaseOrder.create({
          data: {
            branchId: user.branchId,
            supplierId: group.supplierId,
            createdById: user.sub,
            status: 'DRAFT',
            notes: `From shopping request ${id.slice(-6)}`,
            items: {
              create: group.lines.map((line) => ({
                ingredientId: line.ingredientId,
                quantityOrdered: line.requestedQuantity as never,
                unitCost: line.unitCostPaisa ?? Number(line.ingredient.costPerPurchaseUnit) ?? 0,
                unit: line.ingredient.purchaseUnit ?? null,
              })),
            },
          },
        });
        createdPurchaseOrderIds.push(po.id);
        for (const line of group.lines) {
          await tx.shoppingRequestLine.update({
            where: { id: line.id },
            data: { purchaseOrderId: po.id, supplierId: group.supplierId },
          });
        }
        // Outside-the-tx ingredient↔supplier upsert is the
        // PurchasingService responsibility; mirror its behaviour here.
        for (const line of group.lines) {
          await tx.ingredientSupplier.upsert({
            where: { ingredientId_supplierId: { ingredientId: line.ingredientId, supplierId: group.supplierId } },
            create: { ingredientId: line.ingredientId, supplierId: group.supplierId },
            update: {},
          });
        }
      }

      // 3. Stamp approval.
      await tx.shoppingRequest.update({
        where: { id },
        data: { status: 'APPROVED', approvedById: user.sub, approvedAt: new Date() },
      });
    });

    // 4. Parent-stock sync for any variant whose stock changed.
    for (const parentId of parentSyncIds) {
      await this.ingredientService.syncParentStock(parentId);
    }

    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'PURCHASING',
      action: 'UPDATE',
      entityType: 'shoppingRequest',
      entityId: id,
      entityName: `Shopping request ${id.slice(-6)}`,
      after: {
        status: 'APPROVED',
        createdPurchaseOrderIds,
        wasteLogIds,
        adjustmentMovementIds,
      },
      summary: `Approved → ${createdPurchaseOrderIds.length} DRAFT PO(s), ${wasteLogIds.length} waste, ${adjustmentMovementIds.length} adjustment`,
    });

    const refreshed = await this.findOne(user, id);
    return {
      request: refreshed as unknown as ShoppingRequest,
      createdPurchaseOrderIds,
      wasteLogIds,
      adjustmentMovementIds,
    };
  }
}
