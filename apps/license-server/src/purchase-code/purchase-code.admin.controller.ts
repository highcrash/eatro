import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';
import { createHash } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { AdminJwtGuard } from '../admin-auth/admin-jwt.guard';

/**
 * Admin-only purchase code management.
 *
 * Three workflows:
 *   - List with pagination + filters (product, status, search-by-code-suffix)
 *   - Manual issue (GRANT for promos, MANUAL for direct sales)
 *   - Revoke (sets isRevoked=true; existing activations stay ACTIVE
 *     until the admin also revokes the License row — codes can be
 *     withdrawn without yanking current installs)
 *
 * Envato CSV import is scoped separately in Section I; this controller
 * only does manual issuance.
 */

class IssueDto {
  @IsString() productId!: string;

  @IsOptional() @IsString() @MinLength(8) @MaxLength(128)
  @Matches(/^[A-Za-z0-9-]+$/)
  code?: string;

  @IsEnum(['MANUAL', 'GRANT'])
  source!: 'MANUAL' | 'GRANT';

  @IsOptional() @IsInt() @Min(1) @Max(1000)
  maxActivations?: number;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

class RevokeDto {
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

class ListQuery {
  @IsOptional() @IsString() productId?: string;

  @IsOptional() @IsEnum(['ACTIVE', 'REVOKED', 'EXHAUSTED', 'UNUSED'])
  status?: 'ACTIVE' | 'REVOKED' | 'EXHAUSTED' | 'UNUSED';

  @IsOptional() @IsString() @MaxLength(64)
  search?: string; // matches the *last* 8+ chars of code, case-insensitive

  @IsOptional() @IsInt() @Min(1) @Max(500)
  pageSize?: number;

  @IsOptional() @IsInt() @Min(1)
  page?: number;
}

@ApiTags('Admin — purchase codes')
@ApiBearerAuth()
@Controller('admin/purchase-codes')
@UseGuards(AdminJwtGuard)
export class PurchaseCodeAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() q: ListQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;

    const where: Record<string, unknown> = {};
    if (q.productId) where.productId = q.productId;

    if (q.status === 'REVOKED') where.isRevoked = true;
    if (q.status === 'ACTIVE' || q.status === 'UNUSED') {
      where.isRevoked = false;
      if (q.status === 'UNUSED') where.usedActivations = 0;
    }
    // EXHAUSTED: usedActivations >= maxActivations (can't express as a
    // simple WHERE in Prisma — post-filter after fetch. Only relevant
    // when UI picks this filter, so the extra pass is fine.)

    if (q.search) {
      // Partial-suffix match. Purchase codes are unique so a suffix
      // search is unambiguous. Case-insensitive because CodeCanyon
      // codes are uppercase hex but admins type lazily.
      where.code = { contains: q.search, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.purchaseCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          product: { select: { sku: true, name: true } },
          _count: { select: { licenses: true } },
        },
      }),
      this.prisma.purchaseCode.count({ where }),
    ]);

    const filtered = q.status === 'EXHAUSTED'
      ? items.filter((r) => r.usedActivations >= r.maxActivations)
      : items;

    return {
      items: filtered.map((r) => ({
        id: r.id,
        code: r.code,
        source: r.source,
        maxActivations: r.maxActivations,
        usedActivations: r.usedActivations,
        isRevoked: r.isRevoked,
        revokedAt: r.revokedAt,
        revokedReason: r.revokedReason,
        envatoBuyer: r.envatoBuyer,
        envatoSoldAt: r.envatoSoldAt,
        notes: r.notes,
        createdAt: r.createdAt,
        product: r.product,
        licenseCount: r._count.licenses,
      })),
      page,
      pageSize,
      total,
    };
  }

  @Post()
  async issue(@Body() dto: IssueDto) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException({ result: 'PRODUCT_NOT_FOUND' });

    const code = (dto.code ?? generateCode()).toUpperCase();
    const codeHash = hashCode(code);

    const existing = await this.prisma.purchaseCode.findUnique({ where: { codeHash } });
    if (existing) throw new ConflictException({ result: 'CODE_TAKEN' });

    const row = await this.prisma.purchaseCode.create({
      data: {
        productId: dto.productId,
        code,
        codeHash,
        source: dto.source,
        maxActivations: dto.maxActivations ?? 1,
        notes: dto.notes,
      },
    });
    return { id: row.id, code: row.code };
  }

  @Post(':id/revoke')
  async revoke(@Param('id') id: string, @Body() dto: RevokeDto) {
    const existing = await this.prisma.purchaseCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ result: 'NOT_FOUND' });
    return this.prisma.purchaseCode.update({
      where: { id },
      data: { isRevoked: true, revokedAt: new Date(), revokedReason: dto.reason ?? null },
    });
  }

  /**
   * CSV import. Expected columns (header row, case-insensitive):
   *   code, maxActivations, buyer, soldAt, notes
   * Only `code` is required.
   *
   * Dry-run semantics: returns a per-row summary with `imported`/
   * `skipped`/`error` counts. The caller can POST with ?commit=false
   * (or omit) to preview, then ?commit=true to actually persist.
   */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async importCsv(
    @Query('productId') productId: string,
    @Query('commit') commit: string | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!productId) throw new BadRequestException({ result: 'NO_PRODUCT' });
    if (!file) throw new BadRequestException({ result: 'NO_FILE' });
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException({ result: 'PRODUCT_NOT_FOUND' });

    // Lazy import so csv-parse isn't pulled into bundles that don't
    // exercise this endpoint (minor bundle-size win on serverless).
    const { parse } = await import('csv-parse/sync');
    let rows: Array<Record<string, string>>;
    try {
      rows = parse(file.buffer, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, string>>;
    } catch (err) {
      throw new BadRequestException({ result: 'CSV_PARSE_FAILED', message: (err as Error).message });
    }

    const shouldCommit = commit === 'true' || commit === '1';
    let imported = 0;
    const errors: Array<{ row: number; message: string }> = [];

    // Preload all existing codeHashes for this product so we can
    // report duplicates without 1 round-trip per row.
    const existingHashes = new Set(
      (await this.prisma.purchaseCode.findMany({
        where: { productId },
        select: { codeHash: true },
      })).map((r) => r.codeHash),
    );

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const raw = row.code?.trim();
      if (!raw) { errors.push({ row: i + 2, message: 'empty code' }); continue; }
      const code = raw.toUpperCase();
      if (!/^[A-Za-z0-9-]{8,128}$/.test(code)) {
        errors.push({ row: i + 2, message: 'code fails validation' });
        continue;
      }
      const codeHash = hashCode(code);
      if (existingHashes.has(codeHash)) {
        errors.push({ row: i + 2, message: 'duplicate code (already imported)' });
        continue;
      }

      if (shouldCommit) {
        const maxActivations = Math.max(1, Math.min(1000, Number(row.maxactivations ?? row['max-activations'] ?? 1)));
        const soldAt = row.soldat ? new Date(row.soldat) : null;
        await this.prisma.purchaseCode.create({
          data: {
            productId,
            code,
            codeHash,
            source: 'IMPORTED',
            maxActivations,
            envatoBuyer: row.buyer ?? null,
            envatoSoldAt: soldAt && !isNaN(soldAt.getTime()) ? soldAt : null,
            notes: row.notes ?? null,
          },
        });
        existingHashes.add(codeHash);
      }
      imported++;
    }

    return {
      dryRun: !shouldCommit,
      imported,
      skipped: errors.length,
      total: rows.length,
      errors: errors.slice(0, 50), // cap at 50 to keep response small
    };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** CodeCanyon-ish random code for GRANT / MANUAL issuance: 4 groups of 8
 *  uppercase alphanumerics, e.g. `A1B2-C3D4-E5F6-G7H8`. */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit ambiguous I/O/0/1
  const group = (): string => Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${group()}-${group()}-${group()}-${group()}`;
}
