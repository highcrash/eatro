import { Controller, Get, Patch, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { SmsService } from './sms.service';

@Controller('settings/sms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Get()
  @Roles('OWNER', 'MANAGER')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.smsService.getSettings(user.branchId);
  }

  @Patch()
  @Roles('OWNER')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: { smsEnabled?: boolean; smsApiKey?: string; smsApiUrl?: string; notifyVoidOtp?: boolean }) {
    return this.smsService.updateSettings(user.branchId, dto);
  }

  @Post('test')
  @Roles('OWNER', 'MANAGER')
  async testSms(@CurrentUser() user: JwtPayload, @Body() dto: { phoneNumber: string }) {
    const sent = await this.smsService.sendSms(user.branchId, dto.phoneNumber, 'Test SMS — your gateway is working!');
    return { sent };
  }
}

// ─── Void OTP endpoints (accessible by cashier) ─────────────────────────────

@Controller('void-otp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class VoidOtpController {
  constructor(private readonly smsService: SmsService) {}

  @Post('request')
  async requestOtp(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { orderId: string; itemName: string; itemQty: number; reason: string },
  ) {
    if (!dto.orderId || !dto.itemName || !dto.reason) throw new BadRequestException('Missing required fields');
    return this.smsService.sendVoidOtp(user.branchId, dto.orderId, dto.itemName, dto.itemQty, dto.reason);
  }

  @Post('verify')
  verifyOtp(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { orderId: string; otp: string },
  ) {
    if (!dto.orderId || !dto.otp) throw new BadRequestException('Missing required fields');
    return this.smsService.verifyVoidOtp(user.branchId, dto.orderId, dto.otp);
  }
}

// ─── Generic Action Approval OTP (Phase 6) ──────────────────────────────────

@Controller('approval-otp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class ApprovalOtpController {
  constructor(private readonly smsService: SmsService) {}

  @Post('request')
  requestOtp(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { action: string; summary: string },
  ) {
    if (!dto.action) throw new BadRequestException('action required');
    return this.smsService.sendActionOtp(user.branchId, dto.action, dto.summary || dto.action);
  }

  @Post('verify')
  verifyOtp(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { action: string; otp: string },
  ) {
    if (!dto.action || !dto.otp) throw new BadRequestException('Missing required fields');
    return this.smsService.verifyActionOtp(user.branchId, dto.action, dto.otp);
  }
}
