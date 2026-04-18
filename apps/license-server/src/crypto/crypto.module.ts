import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/**
 * Global so any feature module (license, signing-key, admin) can
 * inject CryptoService without importing this module explicitly.
 * Mirrors the PrismaModule pattern at apps/api/src/prisma/prisma.module.ts.
 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
