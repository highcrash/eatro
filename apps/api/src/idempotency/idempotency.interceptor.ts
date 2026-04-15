import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, tap } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// How long the server remembers a key. 24h is plenty for a POS offline burst.
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Global interceptor that caches mutation responses keyed by the
 * `Idempotency-Key` request header. A second request with the same key
 * returns the original response byte-for-byte without touching the
 * handler — making desktop outbox retries safe even if the original
 * response was lost in transit.
 *
 * Opt-in by contract: callers without an `Idempotency-Key` header bypass
 * the cache entirely, so existing clients (admin panel, web POS) are
 * unaffected.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const key = req.header(IDEMPOTENCY_HEADER);
    const method = req.method.toUpperCase();

    if (!key || !MUTATION_METHODS.has(method)) {
      return next.handle();
    }

    const path = req.originalUrl.split('?')[0];

    return from(this.lookupCached(key)).pipe(
      switchMap((cached) => {
        if (cached) {
          res.status(cached.responseCode);
          this.logger.verbose(`idempotency HIT ${key} → ${cached.responseCode}`);
          try {
            return of(JSON.parse(cached.responseBody));
          } catch {
            // Very old record or an odd non-JSON body — surface the raw string.
            return of(cached.responseBody);
          }
        }

        return next.handle().pipe(
          tap({
            next: (body) => {
              const statusCode = res.statusCode || 200;
              // Persist AFTER the handler succeeds. A Prisma error here is
              // swallowed — the client already got their real response.
              void this.persist(key, method, path, statusCode, body);
            },
          }),
        );
      }),
    );
  }

  private async lookupCached(key: string) {
    try {
      const row = await this.prisma.idempotencyRecord.findUnique({ where: { key } });
      if (!row) return null;
      // Best-effort TTL cleanup: ignore records older than TTL_MS.
      if (Date.now() - row.createdAt.getTime() > TTL_MS) {
        void this.prisma.idempotencyRecord
          .delete({ where: { key } })
          .catch(() => void 0);
        return null;
      }
      return row;
    } catch (err) {
      this.logger.warn(`idempotency lookup failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async persist(
    key: string,
    method: string,
    path: string,
    responseCode: number,
    body: unknown,
  ): Promise<void> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key,
          method,
          path,
          responseCode,
          responseBody: JSON.stringify(body ?? null),
        },
      });
    } catch (err) {
      // Unique-constraint collisions are expected (the client hit twice
      // before the first persist finished). Ignore them.
      const msg = (err as Error).message;
      if (!/unique/i.test(msg)) {
        this.logger.warn(`idempotency persist failed for ${key}: ${msg}`);
      }
    }
  }
}
