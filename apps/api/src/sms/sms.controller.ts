import { Controller, Get, Patch, Post, Delete, Param, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
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
  updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      smsEnabled?: boolean;
      smsApiKey?: string;
      smsApiUrl?: string;
      notifyVoidOtp?: boolean;
      smsPaymentNotifyEnabled?: boolean;
      smsPaymentTemplate?: string | null;
    },
  ) {
    return this.smsService.updateSettings(user.branchId, dto);
  }

  @Get('balance')
  @Roles('OWNER', 'MANAGER')
  getBalance(@CurrentUser() user: JwtPayload) {
    return this.smsService.getBalance(user.branchId);
  }

  @Post('test')
  @Roles('OWNER', 'MANAGER')
  async testSms(@CurrentUser() user: JwtPayload, @Body() dto: { phoneNumber: string }) {
    const sent = await this.smsService.sendSms(user.branchId, dto.phoneNumber, 'Test SMS — your gateway is working!');
    return { sent };
  }
}

// ─── SMS campaign + logs + templates (admin) ────────────────────────────────

@Controller('sms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SmsAdminController {
  constructor(private readonly smsService: SmsService) {}

  // Logs
  @Get('logs')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  listLogs(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('campaignId') campaignId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.smsService.listLogs(user.branchId, {
      status,
      kind,
      from,
      to,
      campaignId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('logs/:id/refresh')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  refreshStatus(@CurrentUser() _user: JwtPayload, @Param('id') id: string) {
    return this.smsService.refreshLogStatus(id);
  }

  @Post('logs/:id/retry')
  @Roles('OWNER', 'MANAGER')
  retry(@CurrentUser() _user: JwtPayload, @Param('id') id: string) {
    return this.smsService.retryLog(id);
  }

  // Campaigns
  @Post('campaigns')
  @Roles('OWNER', 'MANAGER')
  send(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { customerIds: string[]; body: string; templateId?: string },
  ) {
    if (!Array.isArray(dto.customerIds) || dto.customerIds.length === 0) {
      throw new BadRequestException('customerIds required');
    }
    if (!dto.body || dto.body.trim().length < 2) {
      throw new BadRequestException('body required');
    }
    return this.smsService.sendCampaign(user.branchId, dto);
  }

  // Templates
  @Get('templates')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  listTemplates(@CurrentUser() user: JwtPayload) {
    return this.smsService.listTemplates(user.branchId);
  }

  @Post('templates')
  @Roles('OWNER', 'MANAGER')
  createTemplate(@CurrentUser() user: JwtPayload, @Body() dto: { name: string; body: string }) {
    if (!dto.name?.trim() || !dto.body?.trim()) throw new BadRequestException('name + body required');
    return this.smsService.createTemplate(user.branchId, { name: dto.name.trim(), body: dto.body });
  }

  @Patch('templates/:id')
  @Roles('OWNER', 'MANAGER')
  updateTemplate(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: { name?: string; body?: string }) {
    return this.smsService.updateTemplate(id, user.branchId, dto);
  }

  @Delete('templates/:id')
  @Roles('OWNER', 'MANAGER')
  deleteTemplate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.smsService.deleteTemplate(id, user.branchId);
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
