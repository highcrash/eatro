import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(branchId: string) {
    return this.prisma.menuCategory.findMany({
      where: { branchId, deletedAt: null },
      include: { children: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string, branchId: string) {
    const cat = await this.prisma.menuCategory.findFirst({ where: { id, branchId, deletedAt: null } });
    if (!cat) throw new NotFoundException(`Category ${id} not found`);
    return cat;
  }

  create(branchId: string, name: string, sortOrder = 0, parentId?: string, icon?: string) {
    return this.prisma.menuCategory.create({
      data: { branchId, name, sortOrder, parentId: parentId || null, icon: icon || null },
      include: { children: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
  }

  async update(id: string, branchId: string, data: { name?: string; sortOrder?: number; isActive?: boolean; parentId?: string | null; icon?: string | null }) {
    await this.findOne(id, branchId);
    return this.prisma.menuCategory.update({ where: { id }, data });
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.menuCategory.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
