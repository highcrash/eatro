import { Controller, Get, Post, Patch, Param, Body, UseGuards, Query, Headers, BadRequestException, ForbiddenException, NotFoundException, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';

import type { CreateOrderDto, ProcessPaymentDto, VoidOrderDto, VoidOrderItemDto, RefundOrderDto, JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { QrGateService, extractClientIp } from '../qr-gate/qr-gate.service';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('tableId') tableId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.orderService.findAll(user.branchId, tableId, status, from, to);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.findOne(id, user.branchId);
  }

  @Get(':id/kitchen-ticket')
  getKitchenTicket(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.getKitchenTicket(id, user.branchId);
  }

  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: JwtPayload) {
    return this.orderService.create(user.branchId, user.sub, dto);
  }

  @Post(':id/payment')
  processPayment(@Param('id') id: string, @Body() dto: ProcessPaymentDto, @CurrentUser() user: JwtPayload) {
    return this.orderService.processPayment(id, user.branchId, dto);
  }

  @Post(':id/items')
  addItems(@Param('id') id: string, @Body() items: { menuItemId: string; quantity: number; notes?: string }[], @CurrentUser() user: JwtPayload) {
    return this.orderService.addItemsToOrder(id, user.branchId, items);
  }

  @Post(':id/items/:itemId/void')
  voidItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: VoidOrderItemDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orderService.voidItem(id, itemId, user.branchId, dto);
  }

  @Post(':id/items/:itemId/cancel')
  cancelItem(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.cancelItemByCustomer(id, itemId, user.branchId);
  }

  @Post(':id/accept')
  acceptOrder(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.acceptOrder(id, user.branchId);
  }

  @Patch(':id/waiter')
  setWaiter(@Param('id') id: string, @Body() dto: { waiterId: string }, @CurrentUser() user: JwtPayload) {
    return this.orderService.setWaiter(id, user.branchId, dto.waiterId);
  }

  @Patch(':id/guest-count')
  setGuestCount(@Param('id') id: string, @Body() dto: { guestCount: number }, @CurrentUser() user: JwtPayload) {
    return this.orderService.setGuestCount(id, user.branchId, dto.guestCount);
  }

  @Post(':id/move-table')
  moveTable(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { tableId: string }) {
    return this.orderService.moveTable(id, user.branchId, dto.tableId);
  }

  @Post(':id/items/:itemId/move-table')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  moveItemToTable(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { tableId: string },
  ) {
    return this.orderService.moveItemToTable(id, itemId, user.branchId, dto.tableId);
  }

  @Patch(':id/items/:itemId/notes')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  updateItemNotes(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentUser() user: JwtPayload, @Body() dto: { notes: string }) {
    return this.orderService.updateItemNotes(id, itemId, user.branchId, dto.notes);
  }

  @Post(':id/void')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  voidOrder(@Param('id') id: string, @Body() dto: VoidOrderDto, @CurrentUser() user: JwtPayload) {
    return this.orderService.voidOrder(id, user.branchId, dto);
  }

  @Post(':id/refund')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  refundOrder(@Param('id') id: string, @Body() dto: RefundOrderDto, @CurrentUser() user: JwtPayload) {
    return this.orderService.refundOrder(id, user.branchId, user.sub, dto);
  }

  @Post(':id/approve-items')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  approveNewItems(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.approveNewItems(id, user.branchId);
  }

  @Post(':id/reject-items')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  rejectNewItems(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.rejectNewItems(id, user.branchId);
  }

  @Post(':id/apply-discount')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  applyDiscount(@Param('id') id: string, @Body() dto: { discountId: string }, @CurrentUser() user: JwtPayload) {
    return this.orderService.applyDiscount(id, user.branchId, dto.discountId);
  }

  @Post(':id/remove-discount')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  removeDiscount(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.removeDiscount(id, user.branchId);
  }

  @Post(':id/apply-coupon')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  applyCouponFromPos(@Param('id') id: string, @Body() dto: { code: string }, @CurrentUser() user: JwtPayload) {
    return this.orderService.applyCoupon(id, user.branchId, dto.code);
  }

  @Post(':id/items/:itemId/approve')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  approveItem(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.approveItem(id, itemId, user.branchId);
  }

  @Post(':id/items/:itemId/reject')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  rejectItem(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentUser() user: JwtPayload) {
    return this.orderService.rejectItem(id, itemId, user.branchId);
  }
}

// ─── QR Order Controller (no JWT guard — public endpoint) ────────────────────

@ApiTags('Orders')
@Controller('orders')
export class QrOrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly prisma: PrismaService,
    private readonly qrGate: QrGateService,
  ) {}

  /**
   * Reject QR mutations when the client IP doesn't pass the branch's gate.
   * Frontend calls /public/qr-gate on boot and shows the Wi-Fi page, but
   * an off-network client that skips the SPA could still hit these
   * endpoints directly — this is the defense-in-depth check.
   */
  private async ensureGateOpen(branchId: string, req: Request) {
    // Use the same priority-aware extractor as /public/qr-gate so the
    // mutation check uses identical logic. Otherwise a CF hop could
    // cause the GET gate check to pass (using CF-Connecting-IP) while
    // the POST would see the edge IP and fail — or vice versa.
    const verdict = await this.qrGate.evaluate(branchId, extractClientIp(req));
    if (!verdict) throw new NotFoundException('Branch not found');
    if (!verdict.allowed) {
      throw new ForbiddenException('QR ordering is restricted to the restaurant Wi-Fi network.');
    }
  }

  @Post('qr')
  async createQr(@Headers('x-branch-id') branchId: string, @Body() dto: CreateOrderDto, @Req() req: Request) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    await this.ensureGateOpen(branchId, req);
    return this.orderService.createQrOrder(branchId, dto);
  }

  /**
   * Public feed for the customer-facing display pole. Takes a table id
   * and returns the current active order's items + totals (no
   * customer names, no staff ids). No auth — the display device
   * shouldn't need to know a password.
   */
  @Get('display/:tableId')
  async getCustomerDisplay(@Param('tableId') tableId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        tableId,
        deletedAt: null,
        status: { notIn: ['PAID', 'VOID'] },
      },
      orderBy: { createdAt: 'desc' },
      include: { items: { where: { voidedAt: null } } },
    });
    if (!order) return null;
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      tableNumber: order.tableNumber,
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount),
      discountName: order.discountName,
      taxAmount: Number(order.taxAmount),
      serviceChargeAmount: Number((order as unknown as { serviceChargeAmount?: number }).serviceChargeAmount ?? 0),
      totalAmount: Number(order.totalAmount),
      items: order.items.map((i) => ({
        id: i.id,
        menuItemName: i.menuItemName,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        totalPrice: Number(i.totalPrice),
      })),
    };
  }

  @Get('qr/:id/status')
  async getOrderStatus(@Param('id') id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      tableNumber: order.tableNumber,
      billRequested: order.billRequested,
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      discountName: order.discountName,
      couponCode: order.couponCode,
      couponId: order.couponId,
      discountId: order.discountId,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      // Expose customer presence so the QR app can decide whether to show
      // "Apply Coupon" directly or a phone-identify modal first.
      customerId: order.customerId,
      customerName: order.customerName,
      items: order.items.map((i) => ({
        id: i.id,
        name: i.menuItemName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: i.totalPrice,
        notes: i.notes,
        kitchenStatus: i.kitchenStatus,
        voidedAt: i.voidedAt,
      })),
    };
  }

  /**
   * Phone-based identification for the QR flow. Finds an existing customer
   * with this phone in the branch (creating one if new), then attaches it
   * to the order. Used as a prerequisite to applying coupons from the QR
   * app — the backend rejects coupon-apply without a customerId.
   */
  @Post('qr/:id/identify-customer')
  async identifyCustomer(
    @Param('id') id: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { phone: string; name?: string },
    @Req() req: Request,
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    await this.ensureGateOpen(branchId, req);

    const phone = (dto.phone ?? '').trim();
    if (!phone) throw new BadRequestException('Phone number required');
    const name = (dto.name ?? '').trim() || 'Guest';

    const order = await this.prisma.order.findFirst({ where: { id, branchId, deletedAt: null } });
    if (!order) throw new NotFoundException('Order not found');

    let customer = await this.prisma.customer.findFirst({
      where: { branchId, phone, isActive: true },
    });
    if (!customer) {
      customer = await this.prisma.customer.create({ data: { branchId, phone, name } });
    }

    await this.prisma.order.update({
      where: { id },
      data: { customerId: customer.id, customerName: customer.name, customerPhone: customer.phone },
    });

    return { customerId: customer.id, customerName: customer.name, customerPhone: customer.phone };
  }

  @Post('qr/:id/items')
  async addItems(
    @Param('id') id: string,
    @Headers('x-branch-id') branchId: string,
    @Body() body: { items: { menuItemId: string; quantity: number; notes?: string }[] },
    @Req() req: Request,
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    await this.ensureGateOpen(branchId, req);
    // If order is already accepted (not PENDING), new items need cashier approval
    const order = await this.prisma.order.findFirst({ where: { id, deletedAt: null } });
    if (!order) throw new NotFoundException('Order not found');
    const needsApproval = order.status !== 'PENDING';
    return this.orderService.addItemsToOrder(id, branchId, body.items, needsApproval);
  }

  @Post('qr/:id/items/:itemId/cancel')
  async cancelItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: Request,
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    await this.ensureGateOpen(branchId, req);
    return this.orderService.cancelItemByCustomer(id, itemId, branchId);
  }

  @Post('qr/:id/request-bill')
  async requestBill(@Param('id') id: string, @Headers('x-branch-id') branchId: string, @Req() req: Request) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    await this.ensureGateOpen(branchId, req);
    return this.orderService.requestBill(id, branchId);
  }

  @Post('qr/:id/apply-coupon')
  async applyCoupon(
    @Param('id') id: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { code: string },
    @Req() req: Request,
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    await this.ensureGateOpen(branchId, req);
    return this.orderService.applyCoupon(id, branchId, dto.code);
  }

  @Patch('qr/:id/items/:itemId/notes')
  async updateItemNotesQr(
    @Param('id') id: string, @Param('itemId') itemId: string,
    @Headers('x-branch-id') branchId: string, @Body() dto: { notes: string },
    @Req() req: Request,
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    await this.ensureGateOpen(branchId, req);
    return this.orderService.updateItemNotes(id, itemId, branchId, dto.notes);
  }

  @Post('qr/:id/remove-coupon')
  async removeCoupon(@Param('id') id: string, @Headers('x-branch-id') branchId: string, @Req() req: Request) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    await this.ensureGateOpen(branchId, req);
    return this.orderService.removeDiscount(id, branchId);
  }
}
