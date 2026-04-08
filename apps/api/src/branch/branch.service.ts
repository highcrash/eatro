import { Injectable, NotFoundException } from '@nestjs/common';

import type { CreateBranchDto, UpdateBranchDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.branch.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, deletedAt: null } });
    if (!branch) throw new NotFoundException(`Branch ${id} not found`);
    return branch;
  }

  create(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.branch.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
