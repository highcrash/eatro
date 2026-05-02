import { Body, Controller, Get, Param, Post, Query, UseGuards, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { JwtPayload, CreatePurchaseOrderDto, ReceiveGoodsDto, CreateReturnDto, CreateExpenseDto, CreateCustomMenuDto } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PurchasingService } from '../purchasing/purchasing.service';
import { SupplierService } from '../supplier/supplier.service';
import { ExpenseService } from '../expense/expense.service';
import { PayrollService } from '../payroll/payroll.service';
import { PreReadyService } from '../pre-ready/pre-ready.service';
import { PermissionsService } from '../permissions/permissions.service';
import { SmsService } from '../sms/sms.service';
import { MenuService } from '../menu/menu.service';
import { RecipeService } from '../recipe/recipe.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

/**
 * Phase 7 — POS-side cashier purchasing operations.
 *
 * Each endpoint is gated by PermissionsService.requirePermission, which:
 *  - Always passes for OWNER/MANAGER (admin-equivalent)
 *  - For CASHIER, ADVISOR, and WAITER, enforces the per-action permission
 *    mode (NONE/AUTO/OTP) — advisors and waiters share the same POS policy
 *    as cashiers, configured once in admin → Cashier Permissions
 *  - For OTP mode, requires `actionOtp` in the body (verified once and consumed)
 *
 * The four actions delegate to the existing admin services so logic stays in
 * one place.
 */
@Controller('cashier-ops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
export class CashierOpsController {
  constructor(
    private readonly purchasing: PurchasingService,
    private readonly suppliers: SupplierService,
    private readonly expenses: ExpenseService,
    private readonly payroll: PayrollService,
    private readonly preReady: PreReadyService,
    private readonly permissions: PermissionsService,
    private readonly sms: SmsService,
    private readonly menu: MenuService,
    private readonly recipes: RecipeService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** List open POs (DRAFT/SENT/PARTIAL) — used by the Receive Goods tab. */
  @Get('purchase-orders/open')
  async listOpenPOs(@CurrentUser() user: JwtPayload) {
    const all = await this.purchasing.findAll(user.branchId);
    return all.filter((po) => po.status === 'SENT' || po.status === 'PARTIAL' || po.status === 'DRAFT');
  }

  /**
   * List every PO on the cashier's branch. Used by the Purchase History tab
   * so cashiers can look up what they created, received, paid, etc. Optional
   * `status` filter matches the admin findAll signature.
   */
  @Get('purchase-orders')
  async listAllPOs(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.purchasing.findAll(user.branchId, status);
  }

  /** Fetch a single PO for the details modal. */
  @Get('purchase-orders/:id')
  async getPO(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.purchasing.findOne(id, user.branchId);
  }

  /**
   * List ALL active suppliers — bypasses the visibleToCashier filter.
   * Used by Receive / Returns / Pay tabs where the cashier needs every supplier.
   * Create PO continues to use /suppliers which is filtered to visibleToCashier.
   */
  @Get('suppliers/all')
  listAllSuppliers(@CurrentUser() user: JwtPayload) {
    return this.suppliers.findAll(user.branchId);
  }

  @Post('purchase-order/create')
  async createPO(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseOrderDto & { actionOtp?: string },
  ) {
    if (!dto.supplierId || !dto.items?.length) throw new BadRequestException('Supplier and items required');
    await this.permissions.requirePermission(user.branchId, user.role, 'createPurchaseOrder', dto.actionOtp, user.customRoleId ?? null);
    const { actionOtp: _otp, ...createDto } = dto;
    const created = await this.purchasing.create(user.branchId, user.sub, createDto);
    // Auto-advance to SENT so the cashier doesn't have to do a separate "send" step.
    const sent = await this.purchasing.send(created.id, user.branchId);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'PURCHASING',
      action: 'CREATE',
      entityType: 'purchaseOrder',
      entityId: sent.id,
      entityName: (sent as any).poNumber ?? sent.id,
      after: sent as any,
      summary: `POS created PO with ${createDto.items.length} item(s)`,
    });
    return sent;
  }

  @Post('purchase-order/receive')
  async receivePO(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReceiveGoodsDto & { purchaseOrderId: string; actionOtp?: string },
  ) {
    if (!dto.purchaseOrderId) throw new BadRequestException('purchaseOrderId required');
    await this.permissions.requirePermission(user.branchId, user.role, 'receivePurchaseOrder', dto.actionOtp, user.customRoleId ?? null);
    const { actionOtp: _otp, purchaseOrderId, ...receiveDto } = dto;
    const result = await this.purchasing.receiveGoods(purchaseOrderId, user.branchId, user.sub, receiveDto);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'PURCHASING',
      action: 'UPDATE',
      entityType: 'purchaseOrder',
      entityId: purchaseOrderId,
      entityName: (result as any)?.poNumber ?? purchaseOrderId,
      after: { received: receiveDto } as any,
      summary: `POS received goods on PO`,
    });
    return result;
  }

  @Post('purchase-order/return')
  async returnPO(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { supplierId: string; purchaseOrderId?: string; items: { ingredientId: string; quantity: number; unitPrice: number }[]; notes?: string; actionOtp?: string },
  ) {
    if (!dto.supplierId || !dto.items?.length) throw new BadRequestException('Supplier and items required');
    await this.permissions.requirePermission(user.branchId, user.role, 'returnPurchaseOrder', dto.actionOtp, user.customRoleId ?? null);
    const { actionOtp: _otp, ...returnDto } = dto;
    const created = await this.purchasing.createReturn(user.branchId, user.sub, returnDto as CreateReturnDto & { supplierId: string });
    // Auto-complete the return so stock + supplier due are updated immediately
    // (cashier flow is single-step, mirroring auto-send for PO create).
    const completed = await this.purchasing.completeReturn(created.id, user.branchId);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'PURCHASING',
      action: 'CREATE',
      entityType: 'purchaseReturn',
      entityId: created.id,
      entityName: `Return ${created.id}`,
      after: completed as any,
      summary: `POS purchase return: ${returnDto.items.length} item(s)`,
    });
    return completed;
  }

  @Post('supplier/pay')
  async paySupplier(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { supplierId: string; purchaseOrderId?: string; amount: number; paymentMethod?: string; reference?: string; notes?: string; actionOtp?: string },
  ) {
    if (!dto.supplierId || !dto.amount) throw new BadRequestException('Supplier and amount required');
    await this.permissions.requirePermission(user.branchId, user.role, 'paySupplier', dto.actionOtp, user.customRoleId ?? null);
    const { actionOtp: _otp, ...payDto } = dto;
    const result = await this.suppliers.makePayment(user.branchId, user.sub, payDto);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'SUPPLIER',
      action: 'UPDATE',
      entityType: 'supplier',
      entityId: payDto.supplierId,
      entityName: (result as any)?.supplier?.name ?? `supplier ${payDto.supplierId}`,
      after: { payment: payDto } as any,
      summary: `POS supplier payment ${(Number(payDto.amount) / 100).toFixed(2)} via ${payDto.paymentMethod ?? 'CASH'}`,
    });
    return result;
  }

  // ─── Phase 8: Expenses ─────────────────────────────────────────────────────

  @Post('expense/create')
  async createExpense(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateExpenseDto & { actionOtp?: string },
  ) {
    if (!dto.category || !dto.amount) throw new BadRequestException('Category and amount required');

    // Per-category permission check (cashier only — owner/manager bypass below).
    if (user.role === 'CASHIER') {
      const { enabled, mode } = await this.permissions.resolveExpenseApproval(user.branchId, dto.category);
      if (!enabled || mode === 'NONE') {
        throw new ForbiddenException('Expense category is not allowed for cashier');
      }
      if (mode === 'OTP') {
        if (!dto.actionOtp) throw new UnauthorizedException('Manager OTP required');
        const result = this.sms.verifyActionOtp(user.branchId, 'createExpense', dto.actionOtp);
        if (!result.valid) throw new UnauthorizedException(result.error ?? 'Invalid OTP');
      }
    }

    const { actionOtp: _otp, ...createDto } = dto;
    const created = await this.expenses.create(user.branchId, user.sub, createDto);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'EXPENSE',
      action: 'CREATE',
      entityType: 'expense',
      entityId: created.id,
      entityName: createDto.description ?? createDto.category ?? 'expense',
      after: created as any,
      summary: `Cashier expense ${createDto.category} ${(Number(createDto.amount) / 100).toFixed(2)} via ${createDto.paymentMethod ?? 'CASH'}`,
    });
    return created;
  }

  // ─── Phase 8: Payroll ──────────────────────────────────────────────────────

  /** List approved payrolls + their existing payments so cashier sees what's outstanding. */
  @Get('payroll/list')
  async listPayroll(@CurrentUser() user: JwtPayload) {
    return this.payroll.findAll(user.branchId);
  }

  // ─── Phase 9: Pre-Ready Kitchen Tickets ────────────────────────────────────

  @Post('pre-ready/create')
  async createPreReadyKT(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { preReadyItemId: string; quantity: number; notes?: string; actionOtp?: string },
  ) {
    if (!dto.preReadyItemId || !dto.quantity) throw new BadRequestException('Item and quantity required');
    await this.permissions.requirePermission(user.branchId, user.role, 'createPreReadyKT', dto.actionOtp, user.customRoleId ?? null);
    const created = await this.preReady.createProduction(user.branchId, user.sub, {
      preReadyItemId: dto.preReadyItemId,
      quantity: dto.quantity,
      notes: dto.notes,
    });
    // Auto-advance from PENDING → APPROVED so the cashier can mark Complete in
    // a single flow (mirrors auto-send for cashier purchase orders).
    return this.preReady.approveProduction(created.id, user.branchId, user.sub);
  }

  // ─── POS Customised Menu ───────────────────────────────────────────────────

  /**
   * Recipe sources for the POS Customised Menu "Copy from recipe" picker.
   * Returns every menu item AND pre-ready item that has a recipe attached,
   * with the raw lines so the dialog can paste them into the working list.
   * Access is gated only by branch membership (the JwtAuthGuard at module
   * level), since cashiers can't see this data on the existing /menu or
   * /recipes endpoints.
   */
  @Get('custom-menu/sources')
  async listCustomMenuSources(@CurrentUser() user: JwtPayload) {
    return this.menu.listRecipeSourcesForBranch(user.branchId);
  }

  /**
   * Recent custom items the cashier (or any cashier on this branch)
   * built before, surfaced in the Custom Menu dialog so they can be
   * reused directly or used as a starting template for a new variant
   * — saves the cashier from rebuilding the same recipe twice.
   */
  @Get('custom-menu/recent')
  async listRecentCustomMenus(@CurrentUser() user: JwtPayload) {
    return this.menu.listRecentCustomItems(user.branchId);
  }

  /**
   * Cashier-readable recipe lookup powering the "Customise" dialog —
   * picks which ingredients the customer wants removed from a single
   * order line. The /recipes endpoint is admin-only, so this is the
   * dedicated read-only path for POS.
   */
  @Get('recipes/menu-item/:menuItemId')
  async getRecipeForCustomise(@Param('menuItemId') menuItemId: string, @CurrentUser() user: JwtPayload) {
    return this.recipes.findByMenuItem(menuItemId, user.branchId);
  }

  @Post('custom-menu')
  async createCustomMenu(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCustomMenuDto,
  ) {
    if (!dto?.name || !dto.items?.length || !dto.sellingPrice) {
      throw new BadRequestException('name, sellingPrice and at least one item are required');
    }
    await this.permissions.requirePermission(user.branchId, user.role, 'createCustomMenu', dto.actionOtp, user.customRoleId ?? null);
    const created = await this.menu.createCustomFromCashier(user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'MENU',
      action: 'CREATE',
      entityType: 'menuItem',
      entityId: created.id,
      entityName: created.name,
      after: created as any,
      summary: `POS custom menu "${created.name}" @ ${(Number(dto.sellingPrice) / 100).toFixed(2)} (${dto.items.length} ingredients)`,
    });
    return created;
  }

  @Post('payroll/pay')
  async payPayroll(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { payrollId: string; amount: number; paymentMethod?: string; reference?: string; notes?: string; actionOtp?: string },
  ) {
    if (!dto.payrollId || !dto.amount) throw new BadRequestException('Payroll and amount required');
    await this.permissions.requirePermission(user.branchId, user.role, 'payPayroll', dto.actionOtp, user.customRoleId ?? null);
    const { payrollId, actionOtp: _otp, ...payDto } = dto;
    const result = await this.payroll.makePayment(payrollId, user.branchId, user.sub, payDto);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'PAYROLL',
      action: 'UPDATE',
      entityType: 'payroll',
      entityId: payrollId,
      entityName: (result as any)?.staff?.name ?? `payroll ${payrollId}`,
      after: { paymentMade: payDto } as any,
      summary: `POS payroll payment ${(Number(payDto.amount) / 100).toFixed(2)} via ${payDto.paymentMethod ?? 'CASH'}`,
    });
    return result;
  }
}
