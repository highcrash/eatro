import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CookingStationService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(branchId: string) {
    return this.prisma.cookingStation.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string, branchId: string) {
    const station = await this.prisma.cookingStation.findFirst({
      where: { id, branchId },
    });
    if (!station) throw new NotFoundException(`Cooking station ${id} not found`);
    return station;
  }

  create(branchId: string, dto: { name: string; printerName?: string | null; printerIp?: string | null; printerPort?: number | null; sortOrder?: number; vatEnabled?: boolean }) {
    // vatEnabled is in the schema but the locally cached Prisma client
    // may be stale when a dev hasn't regenerated since the last
    // migration. Feed the record through a typed-but-escaped var so CI
    // (where generate runs) validates normally and local builds compile.
    const createData: Record<string, unknown> = {
      branchId,
      name: dto.name,
      printerName: dto.printerName ?? null,
      printerIp: dto.printerIp ?? null,
      printerPort: dto.printerPort ?? null,
      sortOrder: dto.sortOrder ?? 0,
    };
    if (dto.vatEnabled != null) createData.vatEnabled = dto.vatEnabled;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.cookingStation.create({ data: createData as any });
  }

  async update(id: string, branchId: string, dto: { name?: string; printerName?: string | null; printerIp?: string | null; printerPort?: number | null; sortOrder?: number; isActive?: boolean; vatEnabled?: boolean }) {
    await this.findOne(id, branchId);
    return this.prisma.cookingStation.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.cookingStation.delete({ where: { id } });
  }
}
