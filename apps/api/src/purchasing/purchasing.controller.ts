import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreatePurchaseOrderDto, UpdatePurchaseOrderDto, ReceiveGoodsDto, CreateReturnDto } from '@restora/types';

@Controller('purchasing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'ADVISOR')
export class PurchasingController {
  constructor(private readonly purchasingService: PurchasingService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.purchasingService.findAll(user.branchId, status);
  }

  @Get('shopping-list')
  generateShoppingList(@CurrentUser() user: JwtPayload) {
    return this.purchasingService.generateShoppingList(user.branchId);
  }

  @Post('shopping-list/submit')
  submitShoppingList(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { items: { ingredientId: string; supplierId: string; quantity: number; unitCost: number; unit?: string }[] },
  ) {
    return this.purchasingService.submitShoppingList(user.branchId, user.sub, dto.items);
  }

  @Get('returns')
  getReturns(@CurrentUser() user: JwtPayload, @Query('purchaseOrderId') poId?: string) {
    return this.purchasingService.getReturns(user.branchId, poId);
  }

  @Post('returns/create')
  createIndependentReturn(@CurrentUser() user: JwtPayload, @Body() dto: { supplierId: string; items: { ingredientId: string; quantity: number; unitPrice: number }[]; notes?: string }) {
    return this.purchasingService.createReturn(user.branchId, user.sub, dto);
  }

  @Post('returns/:id/complete')
  completeReturn(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasingService.completeReturn(id, user.branchId);
  }

  @Post('returns/:id/reject')
  rejectReturn(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasingService.rejectReturn(id, user.branchId);
  }

  @Post('returns/:id/cancel')
  cancelReturn(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasingService.cancelReturn(id, user.branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasingService.findOne(id, user.branchId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchasingService.create(user.branchId, user.sub, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdatePurchaseOrderDto) {
    return this.purchasingService.update(id, user.branchId, dto);
  }

  @Post(':id/send')
  send(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasingService.send(id, user.branchId);
  }

  @Post(':id/send-whatsapp')
  @Roles('OWNER', 'MANAGER')
  sendWhatsApp(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasingService.sendWhatsApp(user, id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasingService.cancel(id, user.branchId);
  }

  @Post(':id/close-partial')
  closePartial(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasingService.closePartial(id, user.branchId);
  }

  @Post(':id/receive')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  receiveGoods(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: ReceiveGoodsDto) {
    return this.purchasingService.receiveGoods(id, user.branchId, user.sub, dto);
  }

  @Post(':id/return')
  createReturn(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateReturnDto) {
    return this.purchasingService.createReturn(user.branchId, user.sub, { purchaseOrderId: id, ...dto });
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasingService.remove(id, user.branchId);
  }
}
