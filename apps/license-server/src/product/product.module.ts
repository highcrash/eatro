import { Module } from '@nestjs/common';
import { ProductPublicController } from './product.public.controller';

/**
 * Public product endpoints. Admin endpoints land in a sibling
 * controller (product.admin.controller.ts) when the admin module ships.
 */
@Module({
  controllers: [ProductPublicController],
})
export class ProductModule {}
