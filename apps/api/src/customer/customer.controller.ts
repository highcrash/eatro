import { Controller, Get, Post, Patch, Delete, Query, Body, Param, UseGuards, Headers, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CustomerService, normalizeBdPhone } from './customer.service';
import { customerSessionToken, requireCustomer, sessionCustomerId, signupPhone } from './customer-token';

// ─── Public endpoints (QR customer auth) ─────────────────────────────────────
//
// The customer is whoever the `x-customer-token` login token says, never a
// customer id from the request body. The token comes from verify-otp (or
// signup), so only someone who typed the SMS code gets one.

@Controller('customers')
export class CustomerPublicController {
  constructor(private readonly customerService: CustomerService) {}

  @Post('auth/request-otp')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  requestOtp(
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { phone: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.requestOtp(branchId, dto.phone);
  }

  @Post('auth/verify-otp')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  verifyOtp(
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { phone: string; otp: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.verifyOtp(branchId, dto.phone, dto.otp);
  }

  @Patch('auth/profile')
  updateProfile(
    @Headers('x-customer-token') token: string | undefined,
    @Body() dto: { customerId?: string; name?: string; email?: string },
  ) {
    const customerId = requireCustomer(token);
    if (dto.customerId && dto.customerId !== customerId) throw new ForbiddenException('Not your account');
    return this.customerService.updateProfile(customerId, { name: dto.name, email: dto.email });
  }

  /** Brand-new customer signup after verify-otp found no row for the phone.
   *  Needs the signupToken verify-otp returned, so the phone is proven. */
  @Post('auth/signup')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async signup(
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { phone: string; name: string; email?: string; signupToken?: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    const proven = signupPhone(dto.signupToken, branchId);
    if (!proven || proven !== normalizeBdPhone(dto.phone ?? '')) {
      throw new UnauthorizedException({ code: 'CUSTOMER_LOGIN_REQUIRED', message: 'Please verify your phone number with the SMS code first.' });
    }
    const customer = await this.customerService.createFromQr(branchId, { phone: proven, name: dto.name, email: dto.email });
    return { ...customer, token: customerSessionToken(customer.id, branchId) };
  }

  @Post('auth/active-order')
  getActiveOrder(
    @Headers('x-branch-id') branchId: string,
    @Headers('x-customer-token') token: string | undefined,
    @Body() dto: { customerId?: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.getActiveOrder(branchId, ownCustomer(token, branchId, dto.customerId));
  }

  /**
   * QR My Account — last N PAID/SERVED orders for a customer plus
   * the customer record itself in one round-trip. The customer
   * snapshot drives the lifetime-stats strip (totalSpent /
   * totalOrders / lastVisit) so the page doesn't need a separate
   * /me endpoint and stays in sync with whatever the order list
   * shows.
   */
  @Post('auth/order-history')
  getOrderHistory(
    @Headers('x-branch-id') branchId: string,
    @Headers('x-customer-token') token: string | undefined,
    @Body() dto: { customerId?: string; limit?: number },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.getOrderHistory(branchId, ownCustomer(token, branchId, dto.customerId), dto.limit);
  }

  /**
   * QR My Account — chronological list of reviews this customer
   * wrote, with the related order's number + paidAt for context.
   * Drives the "My reviews" section.
   */
  @Post('auth/customer-reviews')
  getCustomerReviewHistory(
    @Headers('x-branch-id') branchId: string,
    @Headers('x-customer-token') token: string | undefined,
    @Body() dto: { customerId?: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.getCustomerReviewHistory(branchId, ownCustomer(token, branchId, dto.customerId));
  }

  @Post('reviews')
  createReview(
    @Headers('x-branch-id') branchId: string,
    @Headers('x-customer-token') token: string | undefined,
    @Body() dto: { orderId: string; customerId?: string; foodScore: number; serviceScore: number; atmosphereScore: number; priceScore: number; notes?: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    // A review is only tied to the customer who is logged in.
    return this.customerService.createReview(branchId, { ...dto, customerId: sessionCustomerId(token, branchId) ?? undefined });
  }
}

/** The logged-in customer; a different customer id in the body is refused. */
function ownCustomer(token: string | undefined, branchId: string, claimed?: string): string {
  const customerId = requireCustomer(token, branchId);
  if (claimed && claimed !== customerId) throw new ForbiddenException('Not your account');
  return customerId;
}

// ─── Authenticated endpoints (POS/Admin) ─────────────────────────────────────

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.customerService.findAll(user.branchId);
  }

  @Get('search')
  search(@CurrentUser() user: JwtPayload, @Query('q') query: string) {
    return this.customerService.search(user.branchId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customerService.findOne(id, user.branchId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: { phone: string; name?: string; email?: string }) {
    return this.customerService.createFromPos(user.branchId, dto);
  }

  @Post('bulk')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  bulkImport(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { items: Array<{ phone: string; name?: string; email?: string }> },
  ) {
    if (!Array.isArray(dto.items)) throw new BadRequestException('items array required');
    return this.customerService.bulkImport(user.branchId, dto.items);
  }

  @Get(':id/detail')
  getDetail(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customerService.getDetail(id, user.branchId);
  }

  @Get('reviews/all')
  getReviews(@CurrentUser() user: JwtPayload) {
    return this.customerService.getReviews(user.branchId);
  }

  // Admin moderation: hide / show a single review on the public website.
  // The review stays in the admin Reviews list either way.
  @Patch('reviews/:id/visibility')
  setReviewVisibility(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { isHidden: boolean },
  ) {
    return this.customerService.setReviewVisibility(user.branchId, id, !!dto.isHidden);
  }

  @Post('assign-order')
  assignToOrder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { orderId: string; customerId: string | null },
  ) {
    return this.customerService.assignToOrder(dto.orderId, user.branchId, dto.customerId);
  }

  // Edit name / phone / email. POS + admin can both call. Backend
  // guards against phone collisions inside the branch.
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name?: string; phone?: string; email?: string | null },
  ) {
    return this.customerService.updateCustomer(id, user.branchId, dto);
  }

  // Soft delete. Admin only — historical orders + reviews keep their
  // customerId link; the row is just hidden from POS / admin lists.
  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customerService.deleteCustomer(id, user.branchId);
  }
}
