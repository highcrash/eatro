import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// Client output is `prisma/client/` (sibling of src/ and dist/) so this
// relative path resolves the same way at dev (src/) and prod (dist/)
// runtime. See the commentary in prisma/schema.prisma for why it's NOT
// inside src/.
import { PrismaClient } from '../../prisma/client';

/**
 * Prisma wrapper for the license-server's dedicated DB.
 *
 * Imports the dedicated client at `apps/license-server/prisma/client`,
 * NOT the @prisma/client module that `apps/api` uses. Two Prisma clients
 * coexist in one monorepo without type collisions because each app's
 * schema specifies its own generator output path.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
