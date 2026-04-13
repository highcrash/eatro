import { Controller, Get, Post, Patch, Put, Delete, Param, Body, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import type { CreateMenuItemDto, UpdateMenuItemDto, JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MenuService } from './menu.service';

@ApiTags('Menu')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.menuService.findAll(user.branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.findOne(id, user.branchId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false })) dto: CreateMenuItemDto, @CurrentUser() user: JwtPayload) {
    return this.menuService.create(user.branchId, dto as any);
  }

  @Post('bulk')
  @Roles('OWNER', 'MANAGER')
  bulkCreate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { rows: { categoryName: string; name: string; type: string; price: number; description?: string; tags?: string }[] },
  ) {
    return this.menuService.bulkCreate(user.branchId, dto.rows);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(@Param('id') id: string, @Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false })) dto: UpdateMenuItemDto, @CurrentUser() user: JwtPayload) {
    return this.menuService.update(id, user.branchId, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.remove(id, user.branchId);
  }

  @Put(':id/combo-items')
  @Roles('OWNER', 'MANAGER')
  setComboItems(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { items: { includedItemId: string; quantity: number }[] },
  ) {
    return this.menuService.setComboItems(id, user.branchId, dto.items);
  }

  @Put(':id/linked-items')
  @Roles('OWNER', 'MANAGER')
  setLinkedItems(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { items: { linkedMenuId: string; type: string; triggerQuantity: number; freeQuantity: number }[] },
  ) {
    return this.menuService.setLinkedItems(id, user.branchId, dto.items);
  }
}
