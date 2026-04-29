import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import type { CreateStaffDto, UpdateStaffDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(branchId: string) {
    return this.prisma.staff.findMany({
      where: { branchId, deletedAt: null },
      select: {
        id: true, name: true, email: true, role: true, customRoleId: true, phone: true,
        isActive: true, canAccessPos: true, hireDate: true, createdAt: true,
        // Tipsoi + per-staff shift overrides surfaced for the admin
        // StaffPage / AttendancePage. Optional everywhere — frontend
        // shows them as "(branch default)" placeholders when null.
        tipsoiPersonId: true, shiftStart: true, shiftEnd: true,
        lateGraceMinutes: true, halfDayAfterMinutes: true,
      },
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
    const exists = await this.prisma.staff.findFirst({ where: { email: dto.email, deletedAt: null } });
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    return this.prisma.staff.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        role: dto.role,
        customRoleId: dto.customRoleId ?? null,
        passwordHash,
        branchId,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : new Date(),
        canAccessPos: dto.canAccessPos ?? true,
      },
      select: { id: true, name: true, email: true, role: true, customRoleId: true, phone: true, isActive: true, canAccessPos: true, hireDate: true, createdAt: true },
    });
  }

  async update(id: string, branchId: string, dto: UpdateStaffDto) {
    await this.findOne(id, branchId);
    // DTO accepts a plaintext `password` for convenience — the column
    // is `passwordHash`, so we bcrypt it and swap keys before forwarding
    // to Prisma. Missing / empty `password` means "don't change it".
    const { password, ...rest } = dto as { password?: string } & Record<string, unknown>;
    const data: Record<string, unknown> = { ...rest };
    if (typeof password === 'string' && password.length > 0) {
      data.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }
    return this.prisma.staff.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, customRoleId: true, phone: true, isActive: true, canAccessPos: true, hireDate: true, updatedAt: true },
    });
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.staff.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
