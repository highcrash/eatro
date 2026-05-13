import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CurrentApiClient } from './decorators/current-api-client.decorator';
import { Scopes } from './decorators/scopes.decorator';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ScopesGuard } from './guards/scopes.guard';
import { ExternalService } from './external.service';
import type { ApiClient } from './types/api-client.type';

/// Public external surface. Versioned at /api/v1/external and
/// authenticated with API keys (NOT the staff JWT). Every route is
/// scope-gated; never trust client-supplied branchId — it comes from
/// the key.
@ApiTags('External API / v1')
@ApiBearerAuth()
@Controller({ path: 'external', version: '1' })
@UseGuards(ApiKeyGuard, ScopesGuard)
export class ExternalController {
  constructor(private readonly external: ExternalService) {}

  @Get('business/profile')
  @Scopes('business:read')
  @ApiOperation({
    summary: 'Get the connected business profile',
    description: 'Returns identity, contact, branding, social, and tax info for the branch this key is bound to.',
  })
  async getProfile(@CurrentApiClient() client: ApiClient) {
    const data = await this.external.getBusinessProfile(client.branchId);
    return this.envelope(client.branchId, data);
  }

  @Get('business/sales/daily')
  @Scopes('reports:read')
  @ApiOperation({
    summary: 'Daily sales time series for the last N days',
    description: 'Per-day revenue (paisa, minor units) and paid-order count. Missing days are zero-filled.',
  })
  @ApiQuery({ name: 'days', required: false, description: 'Window length in days. 1..365. Default 30.' })
  async getDailySales(
    @CurrentApiClient() client: ApiClient,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    const clamped = Math.max(1, Math.min(365, days));
    const series = await this.external.getDailySales(client.branchId, clamped);
    return this.envelope(client.branchId, { days: clamped, series });
  }

  @Get('business/sales')
  @Scopes('reports:read')
  @ApiOperation({ summary: 'Sales summary for a named period' })
  @ApiQuery({ name: 'period', required: false, description: 'today | week | month | year. Default today.' })
  async getSalesSummary(
    @CurrentApiClient() client: ApiClient,
    @Query('period', new DefaultValuePipe('today')) period: string,
  ) {
    const summary = await this.external.getSalesSummary(client.branchId, period);
    return this.envelope(client.branchId, summary);
  }

  @Get('business/sales/detail')
  @Scopes('reports:read')
  @ApiOperation({ summary: 'Per-order sales detail for an explicit window' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (YYYY-MM-DD). Default: today.' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (YYYY-MM-DD). Default: today.' })
  async getSalesDetail(
    @CurrentApiClient() client: ApiClient,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.external.getSalesDetail(client.branchId, from, to);
    return this.envelope(client.branchId, data);
  }

  @Get('business/sales/top-items')
  @Scopes('reports:read')
  @ApiOperation({ summary: 'Top menu items by revenue for a period' })
  @ApiQuery({ name: 'period', required: false, description: 'today | week | month | year. Default today.' })
  @ApiQuery({ name: 'limit', required: false, description: '1..100. Default 10.' })
  async getTopItems(
    @CurrentApiClient() client: ApiClient,
    @Query('period', new DefaultValuePipe('today')) period: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const clamped = Math.max(1, Math.min(100, limit));
    const items = await this.external.getTopItems(client.branchId, period, clamped);
    return this.envelope(client.branchId, { period, limit: clamped, items });
  }

  @Get('business/sales/by-category')
  @Scopes('reports:read')
  @ApiOperation({ summary: 'Revenue + units sold grouped by menu category' })
  @ApiQuery({ name: 'period', required: false, description: 'today | week | month | year. Default today.' })
  async getRevenueByCategory(
    @CurrentApiClient() client: ApiClient,
    @Query('period', new DefaultValuePipe('today')) period: string,
  ) {
    const categories = await this.external.getRevenueByCategory(client.branchId, period);
    return this.envelope(client.branchId, { period, categories });
  }

  @Get('business/performance')
  @Scopes('reports:read')
  @ApiOperation({
    summary: 'Gross, COGS, margin, food-cost%, txn count for a window',
    description: 'Aggregates the same numbers Restora exposes to OWNER/MANAGER under /reports/performance.',
  })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getPerformance(
    @CurrentApiClient() client: ApiClient,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.external.getPerformance(client.branchId, from, to);
    return this.envelope(client.branchId, data);
  }

  @Get('business/inventory')
  @Scopes('inventory:read')
  @ApiOperation({
    summary: 'Current inventory snapshot',
    description: 'Per-ingredient stock level, cost per unit, stock value, low-stock flag, and totals.',
  })
  async getInventory(@CurrentApiClient() client: ApiClient) {
    const data = await this.external.getStock(client.branchId);
    return this.envelope(client.branchId, data);
  }

  @Get('business/menu')
  @Scopes('menu:read')
  @ApiOperation({
    summary: 'Live menu with categories and prices',
    description: 'All non-deleted menu items grouped by category, with current prices in minor units.',
  })
  async getMenu(@CurrentApiClient() client: ApiClient) {
    const items = await this.external.getMenu(client.branchId);
    return this.envelope(client.branchId, { items });
  }

  @Get('business/customers')
  @Scopes('customers:read')
  @ApiOperation({
    summary: 'Customer base overview',
    description: 'Counts and lifetime spend aggregates across the customer base. No PII — only sums and averages.',
  })
  async getCustomersOverview(@CurrentApiClient() client: ApiClient) {
    const data = await this.external.getCustomersOverview(client.branchId);
    return this.envelope(client.branchId, data);
  }

  @Get('business/customers/segment')
  @Scopes('customers:read')
  @ApiOperation({
    summary: 'Segment customers by spend / visits / recency / loyalty',
    description:
      'Returns up to 1000 customers (PII included: name/phone) matching the filter. Empty filter returns top spenders.',
  })
  @ApiQuery({ name: 'minSpent', required: false, description: 'Minimum lifetime spend in TAKA (whole units, not paisa).' })
  @ApiQuery({ name: 'minVisits', required: false, description: 'Minimum total order count.' })
  @ApiQuery({ name: 'maxLastVisitDays', required: false, description: 'Visited within the last N days.' })
  @ApiQuery({ name: 'minLoyaltyPoints', required: false, description: 'Minimum loyalty balance.' })
  async segmentCustomers(
    @CurrentApiClient() client: ApiClient,
    @Query('minSpent') minSpent?: string,
    @Query('minVisits') minVisits?: string,
    @Query('maxLastVisitDays') maxLastVisitDays?: string,
    @Query('minLoyaltyPoints') minLoyaltyPoints?: string,
  ) {
    const filter = {
      minSpent: minSpent ? Number(minSpent) : undefined,
      minVisits: minVisits ? Number(minVisits) : undefined,
      maxLastVisitDays: maxLastVisitDays ? Number(maxLastVisitDays) : undefined,
      minLoyaltyPoints: minLoyaltyPoints ? Number(minLoyaltyPoints) : undefined,
    };
    const customers = await this.external.segmentCustomers(client.branchId, filter);
    return this.envelope(client.branchId, { filter, customers });
  }

  @Get('business/loyalty/summary')
  @Scopes('loyalty:read')
  @ApiOperation({
    summary: 'Loyalty program summary',
    description: 'Aggregate balance, holder count, expiring-soon count, and program settings.',
  })
  async getLoyaltySummary(@CurrentApiClient() client: ApiClient) {
    const data = await this.external.getLoyaltySummary(client.branchId);
    return this.envelope(client.branchId, data);
  }

  @Get('business/marketing/campaigns')
  @Scopes('marketing:read')
  @ApiOperation({ summary: 'List SMS coupon campaigns (DRAFT / SENDING / SENT)' })
  async listCampaigns(@CurrentApiClient() client: ApiClient) {
    const campaigns = await this.external.listCampaigns(client.branchId);
    return this.envelope(client.branchId, { campaigns });
  }

  @Get('business/finance/expenses')
  @Scopes('finance:read')
  @ApiOperation({ summary: 'Recorded business expenses (up to 200 rows, newest first)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'category', required: false })
  async listExpenses(
    @CurrentApiClient() client: ApiClient,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
  ) {
    const expenses = await this.external.listExpenses(client.branchId, from, to, category);
    return this.envelope(client.branchId, { from: from ?? null, to: to ?? null, category: category ?? null, expenses });
  }

  @Get('business/reviews')
  @Scopes('reviews:read')
  @ApiOperation({
    summary: 'Review aggregate scores',
    description:
      'Average of food / service / atmosphere / price scores on a 1–5 scale, plus an overall mean. Hidden reviews are excluded.',
  })
  async getReviewSummary(@CurrentApiClient() client: ApiClient) {
    const data = await this.external.getReviewSummary(client.branchId);
    return this.envelope(client.branchId, data);
  }

  @Post('business/sms/send')
  @Scopes('marketing:write')
  @ApiOperation({
    summary: 'Send a single SMS to one phone number',
    description:
      'Sends one SMS via the branch\'s configured SMS provider. Logs to sms_logs with kind=CAMPAIGN and the supplied campaignTag (if any). Use this for test sends and one-off targeted messages; bulk segment blasts will land at a separate endpoint.',
  })
  async sendSms(@CurrentApiClient() client: ApiClient, @Body() dto: SendSmsDto) {
    const phone = dto.phone.trim();
    const body = dto.body.trim();
    if (phone.length === 0 || body.length === 0) {
      throw new BadRequestException('phone and body are required');
    }
    const result = await this.external.sendSms(
      client.branchId,
      phone,
      body,
      dto.campaignTag?.trim() || null,
    );
    return this.envelope(client.branchId, {
      ok: result.ok,
      smsLogId: result.log.id,
      providerRequestId: result.log.requestId,
      status: result.log.status,
      error: result.log.errorText,
    });
  }

  private async envelope<T>(branchId: string, data: T) {
    const meta = await this.external.getBranchMetaContext(branchId);
    return {
      data,
      meta: {
        branchId,
        generatedAt: new Date().toISOString(),
        currency: meta.currency,
        timezone: meta.timezone,
      },
    };
  }
}

class SendSmsDto {
  @ApiProperty({
    description:
      'Destination phone number. Branch SMS service will normalise to its supported format (BD MSISDN, etc.).',
    example: '+8801710330040',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phone!: string;

  @ApiProperty({
    description:
      'SMS body. Branch may prefix a brand tag — total wire length is constrained by the provider (typically 160 chars Latin, 70 chars unicode per segment).',
    example: 'Hi Tahsin — we miss you at EATRO. 15% off this week. Show this SMS at the counter.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;

  @ApiProperty({
    required: false,
    description:
      "Free-form grouping tag persisted on the SmsLog row. Use the same tag across a batch so you can aggregate later (e.g. 'mai-2026-reactivation').",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  campaignTag?: string;
}
