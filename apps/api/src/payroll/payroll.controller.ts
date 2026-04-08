import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, GeneratePayrollDto, ApprovePayrollDto } from '@restora/types';

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.payrollService.findAll(user.branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.payrollService.findOne(id, user.branchId);
  }

  @Post()
  generate(@CurrentUser() user: JwtPayload, @Body() dto: GeneratePayrollDto) {
    return this.payrollService.generate(user.branchId, dto);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: ApprovePayrollDto) {
    return this.payrollService.approve(id, user.branchId, user.sub, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.payrollService.remove(id, user.branchId);
  }

  @Post(':id/pay')
  makePayment(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { amount: number; paymentMethod?: string; reference?: string; notes?: string }) {
    return this.payrollService.makePayment(id, user.branchId, user.sub, dto);
  }

  @Get(':id/payments')
  getPayments(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.payrollService.getPayments(id, user.branchId);
  }
}
