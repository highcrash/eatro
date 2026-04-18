import { Module } from '@nestjs/common';
import { ProductPublicController } from './product.public.controller';
import { ProductAdminController } from './product.admin.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SigningKeyModule } from '../signing-key/signing-key.module';

@Module({
  imports: [AdminAuthModule, SigningKeyModule],
  controllers: [ProductPublicController, ProductAdminController],
})
export class ProductModule {}
