import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales-detail')
  getSalesDetail(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getSalesDetail(user.branchId, from, to);
  }

  @Get('sales-summary')
  getSalesSummary(@CurrentUser() user: JwtPayload, @Query('period') period = 'today') {
    return this.reportsService.getSalesSummary(user.branchId, period);
  }

  @Get('top-items')
  getTopItems(
    @CurrentUser() user: JwtPayload,
    @Query('period') period = 'today',
    @Query('limit') limit = '10',
  ) {
    return this.reportsService.getTopItems(user.branchId, period, parseInt(limit));
  }

  @Get('revenue-by-category')
  getRevenueByCategory(@CurrentUser() user: JwtPayload, @Query('period') period = 'today') {
    return this.reportsService.getRevenueByCategory(user.branchId, period);
  }

  @Get('daily-sales')
  getDailySales(@CurrentUser() user: JwtPayload, @Query('days') days = '30') {
    return this.reportsService.getDailySales(user.branchId, parseInt(days));
  }

  @Get('purchasing-summary')
  getPurchasingSummary(@CurrentUser() user: JwtPayload, @Query('period') period = 'today') {
    return this.reportsService.getPurchasingSummary(user.branchId, period);
  }

  @Get('stock/daily')
  getDailyConsumption(@CurrentUser() user: JwtPayload, @Query('date') date?: string) {
    return this.reportsService.getDailyConsumption(user.branchId, date ?? new Date().toISOString().split('T')[0]);
  }

  @Get('stock')
  getStockReport(@CurrentUser() user: JwtPayload) {
    return this.reportsService.getStockReport(user.branchId);
  }

  @Get('stock/monthly')
  getMonthlyStockReport(
    @CurrentUser() user: JwtPayload,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    return this.reportsService.getMonthlyStockReport(
      user.branchId,
      parseInt(year ?? String(now.getFullYear())),
      parseInt(month ?? String(now.getMonth() + 1)),
    );
  }

  @Get('waiter-sales')
  getWaiterReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    return this.reportsService.getWaiterReport(user.branchId, from ?? defaultFrom, to ?? now.toISOString().split('T')[0]);
  }

  @Get('voids')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  getVoidReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getVoidReport(user.branchId, from, to);
  }

  @Get('sales-vs-food-cost')
  getSalesVsFoodCost(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const defaultTo = now.toISOString().split('T')[0];
    return this.reportsService.getSalesVsFoodCost(user.branchId, from ?? defaultFrom, to ?? defaultTo);
  }
}
