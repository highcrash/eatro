import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import type {
  CreateShoppingRequestDto,
  JwtPayload,
  RejectShoppingRequestDto,
  ShoppingRequestStatus,
  UpdateShoppingRequestDto,
} from '@restora/types';
import { ShoppingRequestService } from './shopping-request.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('shopping-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShoppingRequestController {
  constructor(private readonly service: ShoppingRequestService) {}

  // Create: kitchen + admin tier (advisor / manager / owner).
  @Post()
  @Roles('OWNER', 'MANAGER', 'ADVISOR', 'KITCHEN')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateShoppingRequestDto) {
    return this.service.create(user, dto);
  }

  // List: same role set; service tightens KITCHEN to own-only.
  @Get()
  @Roles('OWNER', 'MANAGER', 'ADVISOR', 'KITCHEN')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: ShoppingRequestStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('requestedById') requestedById?: string,
    @Query('mineOnly') mineOnly?: string,
  ) {
    return this.service.findAll(user, {
      status: status ?? null,
      from: from ?? null,
      to: to ?? null,
      requestedById: requestedById ?? null,
      mineOnly: mineOnly === '1' || mineOnly === 'true',
    });
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR', 'KITCHEN')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.findOne(user, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateShoppingRequestDto) {
    return this.service.update(user, id, dto);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'MANAGER')
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.approve(user, id);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'MANAGER')
  reject(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RejectShoppingRequestDto) {
    return this.service.reject(user, id, dto.reason);
  }
}
