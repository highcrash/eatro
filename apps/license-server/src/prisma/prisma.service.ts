import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma-license';

/**
 * Prisma wrapper for the license-server's dedicated DB.
 *
 * Important: this imports from `../generated/prisma-license`, NOT the
 * @prisma/client module that `apps/api` uses. The generator in
 * `prisma/schema.prisma` writes to this path so two Prisma clients can
 * coexist in one monorepo without type collisions.
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
