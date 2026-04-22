import { Body, Controller, Get, Param, Post, Query, UseGuards, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { JwtPayload, CreatePurchaseOrderDto, ReceiveGoodsDto, CreateReturnDto, CreateExpenseDto } from '@restora/types';
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
    await this.permissions.requirePermission(user.branchId, user.role, 'createPurchaseOrder', dto.actionOtp);
    const { actionOtp: _otp, ...createDto } = dto;
    const created = await this.purchasing.create(user.branchId, user.sub, createDto);
    // Auto-advance to SENT so the cashier doesn't have to do a separate "send" step.
    return this.purchasing.send(created.id, user.branchId);
  }

  @Post('purchase-order/receive')
  async receivePO(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReceiveGoodsDto & { purchaseOrderId: string; actionOtp?: string },
  ) {
    if (!dto.purchaseOrderId) throw new BadRequestException('purchaseOrderId required');
    await this.permissions.requirePermission(user.branchId, user.role, 'receivePurchaseOrder', dto.actionOtp);
    const { actionOtp: _otp, purchaseOrderId, ...receiveDto } = dto;
    return this.purchasing.receiveGoods(purchaseOrderId, user.branchId, user.sub, receiveDto);
  }

  @Post('purchase-order/return')
  async returnPO(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { supplierId: string; purchaseOrderId?: string; items: { ingredientId: string; quantity: number; unitPrice: number }[]; notes?: string; actionOtp?: string },
  ) {
    if (!dto.supplierId || !dto.items?.length) throw new BadRequestException('Supplier and items required');
    await this.permissions.requirePermission(user.branchId, user.role, 'returnPurchaseOrder', dto.actionOtp);
    const { actionOtp: _otp, ...returnDto } = dto;
    const created = await this.purchasing.createReturn(user.branchId, user.sub, returnDto as CreateReturnDto & { supplierId: string });
    // Auto-complete the return so stock + supplier due are updated immediately
    // (cashier flow is single-step, mirroring auto-send for PO create).
    return this.purchasing.completeReturn(created.id, user.branchId);
  }

  @Post('supplier/pay')
  async paySupplier(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { supplierId: string; purchaseOrderId?: string; amount: number; paymentMethod?: string; reference?: string; notes?: string; actionOtp?: string },
  ) {
    if (!dto.supplierId || !dto.amount) throw new BadRequestException('Supplier and amount required');
    await this.permissions.requirePermission(user.branchId, user.role, 'paySupplier', dto.actionOtp);
    const { actionOtp: _otp, ...payDto } = dto;
    return this.suppliers.makePayment(user.branchId, user.sub, payDto);
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
    return this.expenses.create(user.branchId, user.sub, createDto);
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
    await this.permissions.requirePermission(user.branchId, user.role, 'createPreReadyKT', dto.actionOtp);
    const created = await this.preReady.createProduction(user.branchId, user.sub, {
      preReadyItemId: dto.preReadyItemId,
      quantity: dto.quantity,
      notes: dto.notes,
    });
    // Auto-advance from PENDING → APPROVED so the cashier can mark Complete in
    // a single flow (mirrors auto-send for cashier purchase orders).
    return this.preReady.approveProduction(created.id, user.branchId, user.sub);
  }

  @Post('payroll/pay')
  async payPayroll(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { payrollId: string; amount: number; paymentMethod?: string; reference?: string; notes?: string; actionOtp?: string },
  ) {
    if (!dto.payrollId || !dto.amount) throw new BadRequestException('Payroll and amount required');
    await this.permissions.requirePermission(user.branchId, user.role, 'payPayroll', dto.actionOtp);
    const { payrollId, actionOtp: _otp, ...payDto } = dto;
    return this.payroll.makePayment(payrollId, user.branchId, user.sub, payDto);
  }
}
