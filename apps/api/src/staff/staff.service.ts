import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import type { CreateStaffDto, UpdateStaffDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from '../license/license.service';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
  ) {}

  findAll(branchId: string) {
    return this.prisma.staff.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, name: true, email: true, role: true, phone: true, isActive: true, hireDate: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, branchId: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id, branchId, deletedAt: null },
      select: { id: true, name: true, email: true, role: true, phone: true, isActive: true, hireDate: true, createdAt: true },
    });
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return staff;
  }

  async create(branchId: string, dto: CreateStaffDto) {
    this.license.assertMutation('staff.create');
    const exists = await this.prisma.staff.findFirst({ where: { email: dto.email, deletedAt: null } });
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    return this.prisma.staff.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        role: dto.role,
        passwordHash,
        branchId,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : new Date(),
      },
      select: { id: true, name: true, email: true, role: true, phone: true, isActive: true, hireDate: true, createdAt: true },
    });
  }

  async update(id: string, branchId: string, dto: UpdateStaffDto) {
    await this.findOne(id, branchId);
    return this.prisma.staff.update({
      where: { id },
      data: dto,
      select: { id: true, name: true, email: true, role: true, phone: true, isActive: true, hireDate: true, updatedAt: true },
    });
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.staff.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
