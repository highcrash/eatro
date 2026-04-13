import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicService } from './public.service';

@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('table/:tableId')
  getTableInfo(@Param('tableId') tableId: string) {
    return this.publicService.getTableInfo(tableId);
  }

  @Get('branches')
  getBranches() {
    return this.publicService.getBranches();
  }

  @Get('menu/:branchId/recommended')
  getRecommended(@Param('branchId') branchId: string, @Query('categoryId') categoryId?: string) {
    return this.publicService.getRecommended(branchId, categoryId);
  }

  @Get('menu/:branchId/item/:itemId')
  getMenuItem(@Param('branchId') branchId: string, @Param('itemId') itemId: string) {
    return this.publicService.getMenuItem(branchId, itemId);
  }

  @Get('menu/:branchId')
  getMenu(@Param('branchId') branchId: string) {
    return this.publicService.getMenu(branchId);
  }

  @Get('reviews/:branchId')
  getReviews(@Param('branchId') branchId: string) {
    return this.publicService.getReviews(branchId);
  }
}
