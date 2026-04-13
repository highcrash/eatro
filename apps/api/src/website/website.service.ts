import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WebsiteService {
  constructor(private readonly prisma: PrismaService) {}

  async getContent(branchId: string) {
    let content = await this.prisma.websiteContent.findUnique({ where: { branchId } });
    if (!content) {
      content = await this.prisma.websiteContent.create({
        data: { branchId },
      });
    }
    return content;
  }

  async updateContent(branchId: string, dto: Record<string, unknown>) {
    // Ensure row exists
    await this.getContent(branchId);

    // Remove id, branchId, updatedAt from dto — these are not updatable
    const { id: _id, branchId: _bid, updatedAt: _upd, ...data } = dto;

    return this.prisma.websiteContent.update({
      where: { branchId },
      data,
    });
  }
}
