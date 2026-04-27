import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { CreditorService } from './creditor.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type {
  JwtPayload,
  CreateCreditorDto,
  UpdateCreditorDto,
  RecordCreditorBillDto,
  MakeCreditorPaymentDto,
  RecordCreditorAdjustmentDto,
} from '@restora/types';

@Controller('creditors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class CreditorController {
  constructor(private readonly creditorService: CreditorService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.creditorService.findAll(user.branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.creditorService.findOne(id, user.branchId);
  }

  @Get(':id/ledger')
  getLedger(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.creditorService.getCreditorLedger(id, user.branchId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCreditorDto) {
    return this.creditorService.create(user.branchId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateCreditorDto) {
    return this.creditorService.update(id, user.branchId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.creditorService.remove(id, user.branchId);
  }

  @Post(':id/bills')
  recordBill(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordCreditorBillDto,
  ) {
    return this.creditorService.recordBill(user.branchId, id, user.sub, dto);
  }

  @Post(':id/payments')
  makePayment(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: MakeCreditorPaymentDto,
  ) {
    return this.creditorService.makePayment(user.branchId, id, user.sub, dto);
  }

  // Manual ledger correction. Pure ledger-only — no cash account is
  // touched (see CreditorService.recordAdjustment).
  @Post(':id/adjust')
  recordAdjustment(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordCreditorAdjustmentDto,
  ) {
    return this.creditorService.recordAdjustment(user.branchId, id, user.sub, dto);
  }
}
