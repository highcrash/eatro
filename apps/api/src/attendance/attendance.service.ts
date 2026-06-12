import { Injectable, NotFoundException } from '@nestjs/common';
import type { MarkAttendanceDto, JwtPayload } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { TipsoiSyncService } from '../tipsoi/tipsoi.sync.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tipsoiSync: TipsoiSyncService,
    private readonly activityLog: ActivityLogService,
  ) {}

  findAll(branchId: string, date?: string, staffId?: string, from?: string, to?: string) {
    // `date` is a single-day exact match (legacy daily-tab query).
    // `from`/`to` open the door to a date range — used by the
    // admin's "Print Staff Attendance" tab to fetch a whole month
    // for one staff member at once. Ranges win when supplied.
    const dateFilter: { gte?: Date; lte?: Date } | undefined =
      from || to
        ? {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          }
        : undefined;
    return this.prisma.attendance.findMany({
      where: {
        branchId,
        ...(dateFilter ? { date: dateFilter } : (date ? { date: new Date(date) } : {})),
        ...(staffId ? { staffId } : {}),
      },
      include: { staff: { select: { id: true, name: true, role: true } } },
      // Range queries want chronological (oldest → newest) so the
      // print table reads top-to-bottom. Single-day / no-filter
      // queries keep the existing newest-first ordering.
      orderBy: [{ date: dateFilter ? 'asc' : 'desc' }, { createdAt: 'desc' }],
      // Bumped from 200 to cover a full month per staff member (≤31
      // rows when filtered to one staffId; bigger when admin queries
      // the whole branch over a month).
      take: dateFilter ? 1000 : 200,
    });
  }

  /** Manual mark from the AttendancePage. Always stamps source=MANUAL
   *  + manualOverride=true so the next Tipsoi sync skips this row.
   *  Admin clears the override via clearOverride() to re-enable
   *  Tipsoi-driven updates for that day. */
  async mark(user: JwtPayload, dto: MarkAttendanceDto) {
    const branchId = user.branchId;
    // Capture the pre-state so the activity log diff shows what the
    // admin changed (status flip, clock-in adjustment, etc.).
    const before = await this.prisma.attendance.findUnique({
      where: { staffId_date: { staffId: dto.staffId, date: new Date(dto.date) } },
      include: { staff: { select: { name: true } } },
    });

    const row = await this.prisma.attendance.upsert({
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

    const action = before ? 'UPDATE' : 'CREATE';
    const dateLabel = new Date(dto.date).toISOString().slice(0, 10);
    void this.activityLog.log({
      branchId,
      actor: user,
      category: 'ATTENDANCE',
      action,
      entityType: 'attendance',
      entityId: row.id,
      entityName: `${row.staff.name} — ${dateLabel}`,
      before: before ? {
        status: before.status,
        clockIn: before.clockIn,
        clockOut: before.clockOut,
        notes: before.notes,
        source: before.source,
        manualOverride: before.manualOverride,
      } : null,
      after: {
        status: row.status,
        clockIn: row.clockIn,
        clockOut: row.clockOut,
        notes: row.notes,
        source: row.source,
        manualOverride: row.manualOverride,
      },
      summary: before
        ? `Manual edit: ${before.status} → ${row.status}`
        : `Manual mark: ${row.status}`,
    });

    return row;
  }

  /** Drop the manual-override flag on a single (staff, date) row and
   *  immediately re-fetch from Tipsoi so the row repopulates with
   *  whatever the device says. Used by the "Restore from Tipsoi"
   *  button on the AttendancePage. */
  async clearOverride(user: JwtPayload, staffId: string, date: string) {
    const branchId = user.branchId;
    const target = new Date(date);
    const row = await this.prisma.attendance.findUnique({
      where: { staffId_date: { staffId, date: target } },
      include: { staff: { select: { name: true } } },
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
    const refreshed = await this.prisma.attendance.findUnique({
      where: { staffId_date: { staffId, date: target } },
      include: { staff: { select: { id: true, name: true, role: true } } },
    });

    const dateLabel = target.toISOString().slice(0, 10);
    void this.activityLog.log({
      branchId,
      actor: user,
      category: 'ATTENDANCE',
      action: 'UPDATE',
      entityType: 'attendance',
      entityId: row.id,
      entityName: `${row.staff.name} — ${dateLabel}`,
      before: {
        status: row.status,
        clockIn: row.clockIn,
        clockOut: row.clockOut,
        manualOverride: row.manualOverride,
        source: row.source,
      },
      after: refreshed ? {
        status: refreshed.status,
        clockIn: refreshed.clockIn,
        clockOut: refreshed.clockOut,
        manualOverride: refreshed.manualOverride,
        source: refreshed.source,
      } : null,
      summary: 'Cleared manual override — re-pulled from Tipsoi',
    });

    return refreshed;
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
