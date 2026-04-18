import { Module } from '@nestjs/common';
import { SigningKeyService } from './signing-key.service';

@Module({
  providers: [SigningKeyService],
  exports: [SigningKeyService],
})
export class SigningKeyModule {}
