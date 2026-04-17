import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Uppercase letters, digits, underscore only. Must start with a letter.
// This is interpolated into a PostgreSQL ALTER TYPE DDL statement so the
// regex is deliberately strict to close the SQL-injection window.
const CODE_RE = /^[A-Z][A-Z0-9_]{0,23}$/;

const BUILTIN_CODES = new Set([
  'KG', 'G', 'L', 'ML', 'PCS', 'DOZEN', 'BOX',
  'PACKET', 'PACK', 'BOTTLE', 'BAG', 'BUNDLE', 'CAN', 'JAR', 'TIN', 'CARTON',
]);

@Injectable()
export class CustomUnitService {
  constructor(private readonly prisma: PrismaService) {}

  list(branchId: string) {
    return (this.prisma as any).customUnit.findMany({
      where: { branchId, deletedAt: null },
      orderBy: { code: 'asc' },
    });
  }

  async create(branchId: string, dto: { code: string; label: string }) {
    const code = (dto.code ?? '').trim().toUpperCase();
    const label = (dto.label ?? '').trim();

    if (!CODE_RE.test(code)) {
      throw new BadRequestException(
        'Code must be 1–24 chars, uppercase letters/digits/underscore only, starting with a letter (e.g. JAR, POUCH, HALF_KG).',
      );
    }
    if (!label) throw new BadRequestException('Label is required');
    if (BUILTIN_CODES.has(code)) {
      throw new BadRequestException(`"${code}" is a built-in unit — no need to add it.`);
    }

    // If the unit already exists for this branch (even soft-deleted),
    // resurrect instead of inserting a duplicate. The enum value will
    // also already exist in Postgres, so the ALTER TYPE below is a no-op.
    const existing = await (this.prisma as any).customUnit.findUnique({
      where: { branchId_code: { branchId, code } },
    });
    if (existing && !existing.deletedAt) {
      throw new BadRequestException(`Unit "${code}" already exists for this branch.`);
    }

    // ALTER TYPE ... ADD VALUE cannot run inside a transaction, so it has
    // to be issued as its own statement before the row insert.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    await this.prisma.$executeRawUnsafe(
      `ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS '${code}'`,
    );

    if (existing) {
      return (this.prisma as any).customUnit.update({
        where: { id: existing.id },
        data: { label, deletedAt: null },
      });
    }
    return (this.prisma as any).customUnit.create({
      data: { branchId, code, label },
    });
  }

  async remove(id: string, branchId: string) {
    const unit = await (this.prisma as any).customUnit.findFirst({
      where: { id, branchId, deletedAt: null },
    });
    if (!unit) throw new NotFoundException('Custom unit not found');

    // Soft-delete only. The enum value stays in Postgres — removing enum
    // values safely requires rebuilding the type and is not worth the
    // risk to inventory data that may reference it. Hiding it from
    // dropdowns is enough.
    return (this.prisma as any).customUnit.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
