import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from '../license/license.service';

@Injectable()
export class PaymentMethodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
  ) {}

  findAll(branchId: string) {
    return this.prisma.paymentMethodConfig.findMany({
      where: { branchId },
      include: { options: { include: { account: { select: { id: true, name: true, type: true } } }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(branchId: string, dto: { code: string; name: string; sortOrder?: number }) {
    this.license.assertMutation('payment-method.create');
    const code = dto.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const existing = await this.prisma.paymentMethodConfig.findFirst({
      where: { branchId, code },
    });
    if (existing) throw new BadRequestException(`Payment method "${code}" already exists`);

    return this.prisma.paymentMethodConfig.create({
      data: { branchId, code, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  async update(id: string, _branchId: string, dto: { name?: string; isActive?: boolean; sortOrder?: number }) {
    return this.prisma.paymentMethodConfig.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async remove(id: string, branchId: string) {
    const pm = await this.prisma.paymentMethodConfig.findFirst({ where: { id, branchId } });
    if (!pm) throw new BadRequestException('Payment method not found');
    if (['CASH', 'CARD'].includes(pm.code)) throw new BadRequestException('Cannot delete system payment methods');
    return this.prisma.paymentMethodConfig.delete({ where: { id } });
  }

  // ── Payment Options ────────────────────────────────────────────────────

  findAllOptions(branchId: string) {
    return this.prisma.paymentOption.findMany({
      where: { branchId },
      include: { category: { select: { id: true, code: true, name: true } }, account: { select: { id: true, name: true, type: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });
  }

  async createOption(branchId: string, dto: { categoryId: string; code: string; name: string; accountId?: string; isDefault?: boolean }) {
    const code = dto.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const existing = await this.prisma.paymentOption.findFirst({ where: { branchId, code } });
    if (existing) throw new BadRequestException(`Payment option "${code}" already exists`);
    return this.prisma.paymentOption.create({
      data: { branchId, categoryId: dto.categoryId, code, name: dto.name, accountId: dto.accountId ?? null, isDefault: dto.isDefault ?? false },
      include: { category: { select: { id: true, code: true, name: true } }, account: { select: { id: true, name: true, type: true } } },
    });
  }

  async updateOption(id: string, _branchId: string, dto: { name?: string; accountId?: string | null; isActive?: boolean; isDefault?: boolean; sortOrder?: number }) {
    return this.prisma.paymentOption.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.accountId !== undefined ? { accountId: dto.accountId || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      include: { category: { select: { id: true, code: true, name: true } }, account: { select: { id: true, name: true, type: true } } },
    });
  }

  async removeOption(id: string, _branchId: string) {
    return this.prisma.paymentOption.delete({ where: { id } });
  }
}
