import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

export type CleanupScope =
  | 'orders'
  | 'sales-summaries'
  | 'work-periods'
  | 'accounts-transactions'
  | 'accounts-all'
  | 'expenses'
  | 'discounts'
  | 'coupons'
  | 'coupon-campaigns'
  | 'loyalty'
  | 'stock-zero'
  | 'stock-movements'
  | 'inventory-all'
  | 'recipes'
  | 'menu-items'
  | 'menu-all'
  | 'pre-ready'
  | 'pre-ready-stock-zero'
  | 'production-orders'
  | 'pre-ready-batches'
  | 'suppliers'
  | 'creditors'
  | 'purchases'
  | 'returns'
  | 'customers'
  | 'attendance'
  | 'payroll'
  | 'sms-logs'
  | 'waste-logs'
  | 'fb-scheduled-posts'
  | 'activity-logs'
  | 'shopping-requests'
  | 'reset-all';

@Injectable()
export class CleanupService {
  constructor(private readonly prisma: PrismaService) {}

  async run(branchId: string, ownerId: string, scope: CleanupScope, password: string, confirmName: string) {
    // Verify owner password
    const owner = await this.prisma.staff.findFirst({
      where: { id: ownerId, branchId, role: 'OWNER', deletedAt: null, isActive: true },
    });
    if (!owner) throw new UnauthorizedException('Owner account not found');
    const ok = await bcrypt.compare(password, owner.passwordHash);
    if (!ok) throw new UnauthorizedException('Incorrect password');

    // Verify branch name typed correctly
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new BadRequestException('Branch not found');
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm(branch.name) !== norm(confirmName)) {
      throw new BadRequestException(
        `Branch name confirmation does not match. Expected: "${branch.name}" (len ${branch.name.length}), got: "${confirmName}" (len ${confirmName.length})`,
      );
    }

    const result = await this.execute(branchId, scope);
    return { scope, ...result };
  }

  private async execute(branchId: string, scope: CleanupScope): Promise<{ deleted: Record<string, number> }> {
    const p = this.prisma;
    const where = { branchId };
    const deleted: Record<string, number> = {};

    switch (scope) {
      case 'orders': {
        deleted.reviews = (await p.review.deleteMany({ where })).count;
        // Mushak notes/invoices reference Order via restrict FKs — drop
        // them before the orders they point at. Sequence counter is
        // branch-scoped, not order-scoped, so it stays put.
        deleted.mushakNotes = (await p.mushakNote.deleteMany({ where })).count;
        deleted.mushakInvoices = (await p.mushakInvoice.deleteMany({ where })).count;
        // OrderItem & OrderPayment cascade on Order delete
        deleted.orders = (await p.order.deleteMany({ where })).count;
        break;
      }

      case 'sales-summaries': {
        deleted.note = 0;
        break;
      }

      case 'work-periods': {
        deleted.workPeriods = (await p.workPeriod.deleteMany({ where })).count;
        break;
      }

      case 'discounts': {
        // ScheduledFbPost has FK menuDiscountId (SetNull on delete),
        // so we explicitly wipe it here to keep the queue clean —
        // otherwise admin would see a pile of orphaned PENDING posts
        // that no longer reference any discount.
        deleted.scheduledFbPosts = (await p.scheduledFbPost.deleteMany({ where })).count;
        deleted.menuItemDiscounts = (await p.menuItemDiscount.deleteMany({ where: { menuItem: { branchId } } })).count;
        deleted.discounts = (await p.discount.deleteMany({ where })).count;
        break;
      }

      case 'fb-scheduled-posts': {
        // Targeted clean of just the FB queue — useful when admin
        // swaps Facebook pages and wants to flush old posts without
        // touching menu discounts.
        deleted.scheduledFbPosts = (await p.scheduledFbPost.deleteMany({ where })).count;
        break;
      }

      case 'activity-logs': {
        // Manual purge of the audit trail. The 90-day cron handles
        // automatic retention; this scope is for blow-it-all-away
        // scenarios (rebrand, install hand-off, debugging).
        deleted.activityLogs = (await p.activityLog.deleteMany({ where })).count;
        break;
      }

      case 'coupons': {
        deleted.coupons = (await p.coupon.deleteMany({ where })).count;
        break;
      }

      case 'coupon-campaigns': {
        // Wipe campaign metadata + every coupon issued by a campaign.
        // Manually-typed shared coupons (no campaignTag) survive.
        deleted.campaignCoupons = (await p.coupon.deleteMany({
          where: { branchId, campaignTag: { not: null } },
        })).count;
        deleted.couponCampaigns = (await p.couponCampaign.deleteMany({ where })).count;
        break;
      }

      case 'loyalty': {
        // Wipe the loyalty ledger AND zero every customer balance in
        // this branch. The expiry sweep zeros balances individually
        // when the rolling clock runs out; this is the
        // blow-it-all-away version for "we're rebooting the loyalty
        // programme" admin moments.
        deleted.loyaltyTransactions = (await p.loyaltyTransaction.deleteMany({ where })).count;
        await p.customer.updateMany({
          where: { branchId, loyaltyPoints: { gt: 0 } },
          data: { loyaltyPoints: 0, loyaltyExpiresAt: null },
        });
        break;
      }

      case 'accounts-transactions': {
        deleted.accountTransactions = (await p.accountTransaction.deleteMany({ where })).count;
        await p.account.updateMany({ where, data: { balance: 0 } });
        break;
      }

      case 'accounts-all': {
        deleted.accountTransactions = (await p.accountTransaction.deleteMany({ where })).count;
        deleted.accounts = (await p.account.deleteMany({ where })).count;
        break;
      }

      case 'expenses': {
        deleted.expenses = (await p.expense.deleteMany({ where })).count;
        break;
      }

      case 'stock-zero': {
        deleted.stockMovements = (await p.stockMovement.deleteMany({ where })).count;
        await p.ingredient.updateMany({ where, data: { currentStock: 0 } });
        break;
      }

      case 'stock-movements': {
        deleted.stockMovements = (await p.stockMovement.deleteMany({ where })).count;
        break;
      }

      case 'inventory-all': {
        deleted.wasteLogs = (await p.wasteLog.deleteMany({ where })).count;
        deleted.stockMovements = (await p.stockMovement.deleteMany({ where })).count;
        deleted.recipes = (await p.recipe.deleteMany({ where: { menuItem: { branchId } } })).count;
        deleted.preReadyRecipes = (await p.preReadyRecipe.deleteMany({ where: { preReadyItem: { branchId } } })).count;
        // Delete all FK references to ingredients before deleting them
        deleted.purchaseOrderItems = (await p.purchaseOrderItem.deleteMany({ where: { ingredient: { branchId } } })).count;
        deleted.purchaseReturnItems = (await p.purchaseReturnItem.deleteMany({ where: { ingredient: { branchId } } })).count;
        deleted.ingredientSuppliers = (await p.ingredientSupplier.deleteMany({ where: { ingredient: { branchId } } })).count;
        // Delete variants (children) before parents to satisfy self-referential FK
        deleted.ingredientVariants = (await p.ingredient.deleteMany({ where: { branchId, parentId: { not: null } } })).count;
        deleted.ingredients = (await p.ingredient.deleteMany({ where })).count;
        break;
      }

      case 'recipes': {
        // RecipeItem cascades on Recipe delete
        deleted.recipes = (await p.recipe.deleteMany({ where: { menuItem: { branchId } } })).count;
        break;
      }

      case 'menu-items': {
        deleted.recipes = (await p.recipe.deleteMany({ where: { menuItem: { branchId } } })).count;
        deleted.comboItems = (await p.comboItem.deleteMany({ where: { comboMenu: { branchId } } })).count;
        deleted.linkedItems = (await p.linkedItem.deleteMany({ where: { parentMenu: { branchId } } })).count;
        deleted.menuItemDiscounts = (await p.menuItemDiscount.deleteMany({ where: { menuItem: { branchId } } })).count;
        // OrderItem references menuItem without cascade — unlink by deleting orphaned refs
        deleted.orderItems = (await p.orderItem.deleteMany({ where: { menuItem: { branchId } } })).count;
        deleted.menuItems = (await p.menuItem.deleteMany({ where })).count;
        break;
      }

      case 'menu-all': {
        deleted.recipes = (await p.recipe.deleteMany({ where: { menuItem: { branchId } } })).count;
        deleted.comboItems = (await p.comboItem.deleteMany({ where: { comboMenu: { branchId } } })).count;
        deleted.linkedItems = (await p.linkedItem.deleteMany({ where: { parentMenu: { branchId } } })).count;
        deleted.menuItemDiscounts = (await p.menuItemDiscount.deleteMany({ where: { menuItem: { branchId } } })).count;
        deleted.orderItems = (await p.orderItem.deleteMany({ where: { menuItem: { branchId } } })).count;
        deleted.menuItems = (await p.menuItem.deleteMany({ where })).count;
        deleted.menuCategories = (await p.menuCategory.deleteMany({ where })).count;
        break;
      }

      case 'pre-ready': {
        deleted.preReadyBatches = (await p.preReadyBatch.deleteMany({ where })).count;
        deleted.productionOrders = (await p.productionOrder.deleteMany({ where })).count;
        deleted.preReadyRecipes = (await p.preReadyRecipe.deleteMany({ where: { preReadyItem: { branchId } } })).count;
        deleted.preReadyItems = (await p.preReadyItem.deleteMany({ where })).count;
        break;
      }

      case 'production-orders': {
        // Production order log only — pre-ready items, recipes, and
        // batches stay. Stock figures are not rewound (matches the
        // shape of waste-logs / stock-movements scopes).
        deleted.productionOrders = (await p.productionOrder.deleteMany({ where })).count;
        break;
      }

      case 'pre-ready-batches': {
        // Made-batch ledger only. Pre-ready items + recipes survive.
        deleted.preReadyBatches = (await p.preReadyBatch.deleteMany({ where })).count;
        break;
      }

      case 'pre-ready-stock-zero': {
        // Mirror of the ingredient 'stock-zero' scope: zero the
        // currentStock column on every PreReadyItem AND clear the
        // batch ledger so the two on-hand sources stay consistent.
        // Items + recipes + production-order log survive.
        deleted.preReadyBatches = (await p.preReadyBatch.deleteMany({ where })).count;
        await p.preReadyItem.updateMany({ where, data: { currentStock: 0 } });
        break;
      }

      case 'suppliers': {
        deleted.supplierAdjustments = (await p.supplierAdjustment.deleteMany({ where: { supplier: { branchId } } })).count;
        deleted.supplierPayments = (await p.supplierPayment.deleteMany({ where: { supplier: { branchId } } })).count;
        deleted.ingredientSuppliers = (await p.ingredientSupplier.deleteMany({ where: { supplier: { branchId } } })).count;
        deleted.suppliers = (await p.supplier.deleteMany({ where })).count;
        break;
      }

      case 'creditors': {
        deleted.creditorAdjustments = (await p.creditorAdjustment.deleteMany({ where: { creditor: { branchId } } })).count;
        deleted.creditorPayments = (await p.creditorPayment.deleteMany({ where: { creditor: { branchId } } })).count;
        deleted.creditorBills = (await p.creditorBill.deleteMany({ where: { creditor: { branchId } } })).count;
        deleted.creditors = (await p.creditor.deleteMany({ where })).count;
        break;
      }

      case 'purchases': {
        deleted.purchaseOrderItems = (await p.purchaseOrderItem.deleteMany({
          where: { purchaseOrder: { branchId } },
        })).count;
        deleted.purchaseOrders = (await p.purchaseOrder.deleteMany({ where })).count;
        break;
      }

      case 'returns': {
        deleted.purchaseReturnItems = (await p.purchaseReturnItem.deleteMany({
          where: { purchaseReturn: { branchId } },
        })).count;
        deleted.purchaseReturns = (await p.purchaseReturn.deleteMany({ where })).count;
        break;
      }

      case 'customers': {
        // Per-customer coupons go SetNull on FK delete by default,
        // which would leave them as orphaned "shared" codes any
        // customer could redeem — wrong. Drop them explicitly first
        // so the post-cleanup state has zero rogue coupons.
        deleted.customerCoupons = (await p.coupon.deleteMany({
          where: { branchId, customerId: { not: null } },
        })).count;
        // LoyaltyTransaction has onDelete: Cascade on the customerId
        // FK, so customer.deleteMany takes the ledger with it.
        deleted.customers = (await p.customer.deleteMany({ where })).count;
        break;
      }

      case 'attendance': {
        deleted.attendance = (await p.attendance.deleteMany({ where })).count;
        break;
      }

      case 'payroll': {
        deleted.payrollPayments = (await p.payrollPayment.deleteMany({ where: { payroll: { branchId } } })).count;
        deleted.payrolls = (await p.payroll.deleteMany({ where })).count;
        break;
      }

      case 'sms-logs': {
        // Templates stay — they're the admin's saved message bodies, not history.
        deleted.smsLogs = (await p.smsLog.deleteMany({ where })).count;
        break;
      }

      case 'waste-logs': {
        // WasteLog rows only — ingredient stock figures are not rewound,
        // matching how stock-movements cleanup leaves currentStock alone.
        // Use 'inventory-all' or 'reset-all' if a deeper wipe is needed.
        deleted.wasteLogs = (await p.wasteLog.deleteMany({ where })).count;
        break;
      }

      case 'shopping-requests': {
        // ShoppingRequestLine is cascade-deleted via FK; delete the
        // header rows and Prisma takes care of the children. Mismatch
        // side-effects (WasteLog, ADJUSTMENT stockMovement) stay where
        // they are — they're part of the inventory audit trail and
        // are handled separately by waste-logs / stock-movements
        // cleanups.
        deleted.shoppingRequests = (await p.shoppingRequest.deleteMany({ where })).count;
        break;
      }

      case 'reset-all': {
        // Wipe all transactional data, keep: branch, settings, staff, payment methods, branding
        // FB queue first — its FK to menuItemDiscount uses SetNull,
        // but it's cleaner to drop the queue rows explicitly so a
        // post-reset state doesn't show orphaned PENDING posts.
        deleted.scheduledFbPosts = (await p.scheduledFbPost.deleteMany({ where })).count;
        deleted.reviews = (await p.review.deleteMany({ where })).count;
        // Mushak rows depend on Order — drop them first so order.deleteMany
        // doesn't fail on a restrict FK.
        deleted.mushakNotes = (await p.mushakNote.deleteMany({ where })).count;
        deleted.mushakInvoices = (await p.mushakInvoice.deleteMany({ where })).count;
        deleted.mushakSequences = (await p.mushakSequence.deleteMany({ where })).count;
        deleted.orders = (await p.order.deleteMany({ where })).count;

        deleted.purchaseReturnItems = (await p.purchaseReturnItem.deleteMany({ where: { purchaseReturn: { branchId } } })).count;
        deleted.purchaseReturns = (await p.purchaseReturn.deleteMany({ where })).count;
        // ShoppingRequest before PurchaseOrder + WasteLog + StockMovement so
        // its line-level FKs don't restrict the parent deletes below.
        deleted.shoppingRequests = (await p.shoppingRequest.deleteMany({ where })).count;
        deleted.purchaseOrderItems = (await p.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { branchId } } })).count;
        deleted.purchaseOrders = (await p.purchaseOrder.deleteMany({ where })).count;
        deleted.supplierAdjustments = (await p.supplierAdjustment.deleteMany({ where: { supplier: { branchId } } })).count;
        deleted.supplierPayments = (await p.supplierPayment.deleteMany({ where: { supplier: { branchId } } })).count;
        // Liabilities (creditors): same chain — adjustments, payments,
        // bills, then the creditor row itself stays so the directory
        // survives a reset (mirrors how suppliers stay).
        deleted.creditorAdjustments = (await p.creditorAdjustment.deleteMany({ where: { creditor: { branchId } } })).count;
        deleted.creditorPayments = (await p.creditorPayment.deleteMany({ where: { creditor: { branchId } } })).count;
        deleted.creditorBills = (await p.creditorBill.deleteMany({ where: { creditor: { branchId } } })).count;
        await p.creditor.updateMany({ where, data: { totalDue: 0 } });
        deleted.expenses = (await p.expense.deleteMany({ where })).count;
        deleted.accountTransactions = (await p.accountTransaction.deleteMany({ where })).count;
        await p.account.updateMany({ where, data: { balance: 0 } });
        deleted.stockMovements = (await p.stockMovement.deleteMany({ where })).count;
        deleted.preReadyBatches = (await p.preReadyBatch.deleteMany({ where })).count;
        deleted.productionOrders = (await p.productionOrder.deleteMany({ where })).count;
        deleted.attendance = (await p.attendance.deleteMany({ where })).count;
        deleted.payrollPayments = (await p.payrollPayment.deleteMany({ where: { payroll: { branchId } } })).count;
        deleted.payrolls = (await p.payroll.deleteMany({ where })).count;
        deleted.wasteLogs = (await p.wasteLog.deleteMany({ where })).count;
        deleted.smsLogs = (await p.smsLog.deleteMany({ where })).count;
        // Activity log audit trail — wiped as part of reset-all so a
        // post-reset install starts with a clean audit slate.
        deleted.activityLogs = (await p.activityLog.deleteMany({ where })).count;
        // Marketing + loyalty — campaign metadata, generated coupons,
        // points ledger, customer balances. Manual coupons (no
        // campaignTag) get nuked by the explicit coupon.deleteMany
        // below. Reset zeroes balances on customers we keep.
        deleted.loyaltyTransactions = (await p.loyaltyTransaction.deleteMany({ where })).count;
        await p.customer.updateMany({
          where: { branchId, loyaltyPoints: { gt: 0 } },
          data: { loyaltyPoints: 0, loyaltyExpiresAt: null },
        });
        deleted.coupons = (await p.coupon.deleteMany({ where })).count;
        deleted.couponCampaigns = (await p.couponCampaign.deleteMany({ where })).count;
        await p.ingredient.updateMany({ where, data: { currentStock: 0 } });
        break;
      }

      default:
        throw new BadRequestException(`Unknown cleanup scope: ${scope}`);
    }

    return { deleted };
  }
}
