import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchSettingsService {
  // 30s in-memory cache so OrderService's useKds check doesn't hit the DB on every order.
  private cache = new Map<string, { value: boolean; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(branchId: string) {
    let s = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!s) {
      s = await this.prisma.branchSetting.create({ data: { branchId } });
    }
    return s;
  }

  async update(
    branchId: string,
    dto: {
      useKds?: boolean;
      customMenuCostMargin?: number | null;
      customMenuNegotiateMargin?: number | null;
      customMenuMaxMargin?: number | null;
    },
  ) {
    await this.getOrCreate(branchId);
    const updated = await this.prisma.branchSetting.update({
      where: { branchId },
      data: {
        ...(dto.useKds != null ? { useKds: dto.useKds } : {}),
        ...(dto.customMenuCostMargin !== undefined ? { customMenuCostMargin: dto.customMenuCostMargin } : {}),
        ...(dto.customMenuNegotiateMargin !== undefined ? { customMenuNegotiateMargin: dto.customMenuNegotiateMargin } : {}),
        ...(dto.customMenuMaxMargin !== undefined ? { customMenuMaxMargin: dto.customMenuMaxMargin } : {}),
      },
    });
    this.cache.delete(branchId);
    return updated;
  }

  async isKdsEnabled(branchId: string): Promise<boolean> {
    const cached = this.cache.get(branchId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;
    const setting = await this.getOrCreate(branchId);
    this.cache.set(branchId, { value: setting.useKds, expiresAt: now + this.CACHE_TTL_MS });
    return setting.useKds;
  }
}
