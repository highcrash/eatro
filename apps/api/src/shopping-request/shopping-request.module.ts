import { Module } from '@nestjs/common';
import { ShoppingRequestService } from './shopping-request.service';
import { ShoppingRequestController } from './shopping-request.controller';
import { IngredientModule } from '../ingredient/ingredient.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

/**
 * Mobile staff-side shopping list + admin review flow. Approval is
 * the surgery moment — one transaction fires WasteLog / ADJUSTMENT
 * writes for mismatch lines AND spawns DRAFT PurchaseOrders grouped
 * by supplier. Nothing in inventory moves until admin approves.
 *
 * Approve path writes PurchaseOrder + items directly via the tx
 * client (inline) rather than calling PurchasingService.create — it
 * needs the transaction scope so the PO + the ShoppingRequestLine
 * back-pointer + the WasteLog / ADJUSTMENT writes are all-or-nothing.
 */
@Module({
  imports: [IngredientModule, ActivityLogModule],
  controllers: [ShoppingRequestController],
  providers: [ShoppingRequestService],
  exports: [ShoppingRequestService],
})
export class ShoppingRequestModule {}
