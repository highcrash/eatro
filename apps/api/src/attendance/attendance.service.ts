import { Injectable, NotFoundException } from '@nestjs/common';
import type { MarkAttendanceDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { TipsoiSyncService } from '../tipsoi/tipsoi.sync.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tipsoiSync: TipsoiSyncService,
  ) {}

  findAll(branchId: string, date?: string, staffId?: string) {
    return this.prisma.attendance.findMany({
      where: {
        branchId,
        ...(date ? { date: new Date(date) } : {}),
        ...(staffId ? { staffId } : {}),
      },
      include: { staff: { select: { id: true, name: true, role: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  /** Manual mark from the AttendancePage. Always stamps source=MANUAL
   *  + manualOverride=true so the next Tipsoi sync skips this row.
   *  Admin clears the override via clearOverride() to re-enable
   *  Tipsoi-driven updates for that day. */
  async mark(branchId: string, dto: MarkAttendanceDto) {
    return this.prisma.attendance.upsert({
      where: { staffId_date: { staffId: dto.staffId, date: new Date(dto.date) } },
      create: {
        branchId,
        staffId: dto.staffId,
        date: new Date(dto.date),
        status: dto.status,
        clockIn: dto.clockIn ? new Date(dto.clockIn) : null,
        clockOut: dto.clockOut ? new Date(dto.clockOut) : null,
        notes: dto.notes ?? null,
        source: 'MANUAL',
        manualOverride: true,
      },
      update: {
        status: dto.status,
        clockIn: dto.clockIn ? new Date(dto.clockIn) : null,
        clockOut: dto.clockOut ? new Date(dto.clockOut) : null,
        notes: dto.notes ?? null,
        source: 'MANUAL',
        manualOverride: true,
      },
      include: { staff: { select: { id: true, name: true, role: true } } },
    });
  }

  /** Drop the manual-override flag on a single (staff, date) row and
   *  immediately re-fetch from Tipsoi so the row repopulates with
   *  whatever the device says. Used by the "Restore from Tipsoi"
   *  button on the AttendancePage. */
  async clearOverride(branchId: string, staffId: string, date: string) {
    const target = new Date(date);
    const row = await this.prisma.attendance.findUnique({
      where: { staffId_date: { staffId, date: target } },
    });
    if (!row) throw new NotFoundException('Attendance row not found');
    await this.prisma.attendance.update({
      where: { id: row.id },
      data: { manualOverride: false },
    });
    // Resync this single (staff, date). Errors here are logged inside
    // the sync service and stamped onto BranchSetting; we surface the
    // post-sync row regardless so the UI re-renders.
    await this.tipsoiSync.syncOne(branchId, staffId, target).catch(() => { /* logged in sync service */ });
    return this.prisma.attendance.findUnique({
      where: { staffId_date: { staffId, date: target } },
      include: { staff: { select: { id: true, name: true, role: true } } },
    });
  }

  async getMonthSummary(branchId: string, year: number, month: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0); // last day of month

    const records = await this.prisma.attendance.findMany({
      where: { branchId, date: { gte: from, lte: to } },
      include: { staff: { select: { id: true, name: true, role: true } } },
    });

    // Group by staff
    const byStaff: Record<string, {
      staffId: string; name: string; role: string;
      present: number; absent: number; late: number; halfDay: number; paidLeave: number; sickLeave: number; festivalLeave: number;
    }> = {};

    for (const record of records) {
      const key = record.staffId;
      if (!byStaff[key]) {
        byStaff[key] = {
          staffId: record.staffId,
          name: record.staff.name,
          role: record.staff.role,
          present: 0, absent: 0, late: 0, halfDay: 0, paidLeave: 0, sickLeave: 0, festivalLeave: 0,
        };
      }
      if (record.status === 'PRESENT') byStaff[key].present++;
      else if (record.status === 'ABSENT') byStaff[key].absent++;
      else if (record.status === 'LATE') byStaff[key].late++;
      else if (record.status === 'HALF_DAY') byStaff[key].halfDay++;
      else if (record.status === 'PAID_LEAVE') byStaff[key].paidLeave++;
      else if (record.status === 'SICK_LEAVE') byStaff[key].sickLeave++;
      else if (record.status === 'FESTIVAL_LEAVE') byStaff[key].festivalLeave++;
    }

    return Object.values(byStaff);
  }
}
