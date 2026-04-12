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
  | 'stock-zero'
  | 'stock-movements'
  | 'inventory-all'
  | 'recipes'
  | 'menu-items'
  | 'menu-all'
  | 'pre-ready'
  | 'suppliers'
  | 'purchases'
  | 'returns'
  | 'customers'
  | 'attendance'
  | 'payroll'
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
        deleted.menuItemDiscounts = (await p.menuItemDiscount.deleteMany({ where: { menuItem: { branchId } } })).count;
        deleted.discounts = (await p.discount.deleteMany({ where })).count;
        break;
      }

      case 'coupons': {
        deleted.coupons = (await p.coupon.deleteMany({ where })).count;
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

      case 'suppliers': {
        deleted.supplierPayments = (await p.supplierPayment.deleteMany({ where: { supplier: { branchId } } })).count;
        deleted.ingredientSuppliers = (await p.ingredientSupplier.deleteMany({ where: { supplier: { branchId } } })).count;
        deleted.suppliers = (await p.supplier.deleteMany({ where })).count;
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

      case 'reset-all': {
        // Wipe all transactional data, keep: branch, settings, staff, payment methods, branding
        deleted.reviews = (await p.review.deleteMany({ where })).count;
        deleted.orders = (await p.order.deleteMany({ where })).count;

        deleted.purchaseReturnItems = (await p.purchaseReturnItem.deleteMany({ where: { purchaseReturn: { branchId } } })).count;
        deleted.purchaseReturns = (await p.purchaseReturn.deleteMany({ where })).count;
        deleted.purchaseOrderItems = (await p.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { branchId } } })).count;
        deleted.purchaseOrders = (await p.purchaseOrder.deleteMany({ where })).count;
        deleted.supplierPayments = (await p.supplierPayment.deleteMany({ where: { supplier: { branchId } } })).count;
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
        await p.ingredient.updateMany({ where, data: { currentStock: 0 } });
        break;
      }

      default:
        throw new BadRequestException(`Unknown cleanup scope: ${scope}`);
    }

    return { deleted };
  }
}
