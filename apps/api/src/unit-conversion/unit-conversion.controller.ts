import { Controller, Get, Post, Delete, Body, Query, UseGuards } from '@nestjs/common';
import { UnitConversionService } from './unit-conversion.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('unit-conversions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UnitConversionController {
  constructor(private readonly service: UnitConversionService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.branchId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  upsert(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { fromUnit: string; toUnit: string; factor: number },
  ) {
    return this.service.upsert(user.branchId, dto.fromUnit, dto.toUnit, dto.factor);
  }

  @Delete()
  @Roles('OWNER', 'MANAGER')
  remove(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.remove(user.branchId, from, to);
  }

  @Get('convertible')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN')
  getConvertible(
    @CurrentUser() user: JwtPayload,
    @Query('unit') unit: string,
  ) {
    return this.service.getConvertibleUnits(user.branchId, unit);
  }
}
