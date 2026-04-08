import { Controller, Get, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { RecipeService } from './recipe.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, UpsertRecipeDto } from '@restora/types';

@Controller('recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class RecipeController {
  constructor(private readonly recipeService: RecipeService) {}

  @Get('costs')
  getAllCosts(@CurrentUser() user: JwtPayload) {
    return this.recipeService.getAllCosts(user.branchId);
  }

  @Get('ingredient-map')
  getIngredientMap(@CurrentUser() user: JwtPayload) {
    return this.recipeService.getIngredientMap(user.branchId);
  }

  @Get('menu-item/:menuItemId')
  findByMenuItem(@Param('menuItemId') menuItemId: string, @CurrentUser() user: JwtPayload) {
    return this.recipeService.findByMenuItem(menuItemId, user.branchId);
  }

  @Get('menu-item/:menuItemId/cost')
  getCostPerServing(@Param('menuItemId') menuItemId: string, @CurrentUser() user: JwtPayload) {
    return this.recipeService.getCostPerServing(menuItemId, user.branchId);
  }

  @Put('menu-item/:menuItemId')
  upsert(@Param('menuItemId') menuItemId: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertRecipeDto) {
    return this.recipeService.upsert(menuItemId, user.branchId, dto);
  }

  @Delete('menu-item/:menuItemId')
  remove(@Param('menuItemId') menuItemId: string, @CurrentUser() user: JwtPayload) {
    return this.recipeService.remove(menuItemId, user.branchId);
  }
}
