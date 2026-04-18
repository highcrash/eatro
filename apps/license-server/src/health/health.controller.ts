import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Liveness + DB probe. Public, unauthenticated. DO App Platform polls
 * this every 30s; a 500ms timeout on the SELECT 1 means a sick DB
 * doesn't hang the health probe (App Platform considers >30s = down).
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{
    ok: boolean;
    uptime: number;
    db: 'up' | 'down';
    at: string;
  }> {
    let db: 'up' | 'down' = 'down';
    try {
      // 500ms guard so a stuck query can't black-hole the probe.
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('db_timeout')), 500)),
      ]);
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      ok: db === 'up',
      uptime: process.uptime(),
      db,
      at: new Date().toISOString(),
    };
  }
}
