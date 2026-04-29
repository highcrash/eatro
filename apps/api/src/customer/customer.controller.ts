import { Controller, Get, Post, Patch, Delete, Query, Body, Param, UseGuards, Headers, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { CustomerService } from './customer.service';

// ─── Public endpoints (QR customer auth) ─────────────────────────────────────

@Controller('customers')
export class CustomerPublicController {
  constructor(private readonly customerService: CustomerService) {}

  @Post('auth/request-otp')
  requestOtp(
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { phone: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.requestOtp(branchId, dto.phone);
  }

  @Post('auth/verify-otp')
  verifyOtp(
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { phone: string; otp: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.verifyOtp(branchId, dto.phone, dto.otp);
  }

  @Patch('auth/profile')
  updateProfile(
    @Body() dto: { customerId: string; name?: string; email?: string },
  ) {
    if (!dto.customerId) throw new BadRequestException('Customer ID required');
    return this.customerService.updateProfile(dto.customerId, { name: dto.name, email: dto.email });
  }

  /** Brand-new customer signup after OTP verify when no row matched
   *  the phone. Name required, email optional. Public endpoint —
   *  branch comes from the x-branch-id header same as the rest of
   *  the QR auth flow. */
  @Post('auth/signup')
  signup(
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { phone: string; name: string; email?: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.createFromQr(branchId, dto);
  }

  @Post('auth/active-order')
  getActiveOrder(
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { customerId: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.getActiveOrder(branchId, dto.customerId);
  }

  @Post('reviews')
  createReview(
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { orderId: string; customerId?: string; foodScore: number; serviceScore: number; atmosphereScore: number; priceScore: number; notes?: string },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    return this.customerService.createReview(branchId, dto);
  }
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
