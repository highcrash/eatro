import { Controller, Get, Post, Patch, Param, Body, Query, Headers, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateReservationDto, ConfirmReservationDto, ReservationSettings } from '@restora/types';
import { ReservationService } from './reservation.service';

// ─── Public (no auth — website booking) ──────────────────────────────────────

@Controller('reservations/public')
export class ReservationPublicController {
  constructor(private readonly svc: ReservationService) {}

  @Get('slots')
  getSlots(@Query('branchId') branchId: string, @Query('date') date: string) {
    return this.svc.getAvailableSlots(branchId, date);
  }

  @Get('settings')
  getPublicSettings(@Query('branchId') branchId: string) {
    return this.svc.getSettings(branchId);
  }

  @Post('book')
  book(@Headers('x-branch-id') branchId: string, @Body() dto: CreateReservationDto) {
    return this.svc.create(branchId, dto);
  }
}

// ─── Authenticated (admin + POS) ─────────────────────────────────────────────

@Controller('reservations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReservationController {
  constructor(private readonly svc: ReservationService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  findAll(@CurrentUser() user: JwtPayload, @Query('date') date?: string, @Query('status') status?: string) {
    return this.svc.findAll(user.branchId, date, status);
  }

  @Get('today')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  findToday(@CurrentUser() user: JwtPayload) {
    return this.svc.findToday(user.branchId);
  }

  @Get('settings')
  @Roles('OWNER', 'MANAGER')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.svc.getSettings(user.branchId);
  }

  @Patch('settings')
  @Roles('OWNER')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: Partial<ReservationSettings>) {
    return this.svc.updateSettings(user.branchId, dto);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.findOne(id, user.branchId);
  }

  @Patch(':id/confirm')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: ConfirmReservationDto) {
    return this.svc.confirm(id, user.branchId, user.sub, dto);
  }

  @Patch(':id/reject')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  reject(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { reason?: string }) {
    return this.svc.reject(id, user.branchId, dto.reason);
  }

  @Patch(':id/arrived')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  markArrived(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.markArrived(id, user.branchId);
  }

  @Patch(':id/completed')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  markCompleted(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.markCompleted(id, user.branchId);
  }

  @Patch(':id/no-show')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  markNoShow(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.markNoShow(id, user.branchId);
  }

  @Patch(':id/cancel')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { reason?: string }) {
    return this.svc.cancel(id, user.branchId, dto.reason);
  }
}
