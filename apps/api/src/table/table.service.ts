import { Injectable, NotFoundException } from '@nestjs/common';

import type { TableStatus } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TableService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(branchId: string) {
    return this.prisma.diningTable.findMany({
      where: { branchId, deletedAt: null },
      orderBy: { tableNumber: 'asc' },
    });
  }

  async findOne(id: string, branchId: string) {
    const table = await this.prisma.diningTable.findFirst({ where: { id, branchId, deletedAt: null } });
    if (!table) throw new NotFoundException(`Table ${id} not found`);
    return table;
  }

  create(branchId: string, data: { tableNumber: string; capacity: number; floorPlanX?: number; floorPlanY?: number }) {
    return this.prisma.diningTable.create({ data: { ...data, branchId } });
  }

  async updateStatus(id: string, branchId: string, status: TableStatus) {
    await this.findOne(id, branchId);
    return this.prisma.diningTable.update({ where: { id }, data: { status } });
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.diningTable.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
