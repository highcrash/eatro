import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import type { JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CategoryService } from './category.service';

@ApiTags('Menu Categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('menu/categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.categoryService.findAll(user.branchId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  create(@Body() body: { name: string; sortOrder?: number; parentId?: string; icon?: string }, @CurrentUser() user: JwtPayload) {
    return this.categoryService.create(user.branchId, body.name, body.sortOrder, body.parentId, body.icon);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  update(@Param('id') id: string, @Body() body: { name?: string; sortOrder?: number; isActive?: boolean; parentId?: string | null; icon?: string | null }, @CurrentUser() user: JwtPayload) {
    return this.categoryService.update(id, user.branchId, body);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.categoryService.remove(id, user.branchId);
  }
}
