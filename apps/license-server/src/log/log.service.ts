import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CheckAction } from '../../prisma/client';

/**
 * Append-only audit writer. Each public-endpoint hit writes one row;
 * admin UI surfaces them on the Logs page. Inserts are fire-and-forget
 * (no `await` from controllers) so a brief DB hiccup never blocks an
 * activate/verify call — the result column is what callers care about,
 * the log is opportunistic.
 */
@Injectable()
export class LogService {
  private readonly logger = new Logger(LogService.name);

  constructor(private readonly prisma: PrismaService) {}

  write(entry: {
    action: CheckAction;
    result: string;
    licenseId?: string | null;
    productId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    detail?: Record<string, unknown> | null;
  }): void {
    this.prisma.checkLog
      .create({
        data: {
          action: entry.action,
          result: entry.result,
          licenseId: entry.licenseId ?? null,
          productId: entry.productId ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          detail: (entry.detail ?? null) as never,
        },
      })
      .catch((err: Error) => {
        // Don't throw — logging failure must never break the request.
        this.logger.warn(`CheckLog insert failed: ${err.message}`);
      });
  }
}
