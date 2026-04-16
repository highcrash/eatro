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
    return this.prisma.cookingStation.create({
      data: {
        branchId,
        name: dto.name,
        printerName: dto.printerName ?? null,
        printerIp: dto.printerIp ?? null,
        printerPort: dto.printerPort ?? null,
        sortOrder: dto.sortOrder ?? 0,
        vatEnabled: dto.vatEnabled ?? true,
      },
    });
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
