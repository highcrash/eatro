import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { WasteService } from './waste.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateWasteLogDto } from '@restora/types';

@Controller('waste')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'KITCHEN', 'ADVISOR')
export class WasteController {
  constructor(private readonly wasteService: WasteService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('ingredientId') ingredientId?: string) {
    return this.wasteService.findAll(user.branchId, ingredientId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateWasteLogDto) {
    return this.wasteService.create(user.branchId, user.sub, dto);
  }

  @Post('menu')
  logMenuWaste(@CurrentUser() user: JwtPayload, @Body() dto: { menuItemId: string; quantity: number; reason: string; notes?: string }) {
    return this.wasteService.logMenuItemWaste(user.branchId, user.sub, dto.menuItemId, dto.quantity, dto.reason, dto.notes);
  }
}
