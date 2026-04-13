import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';

@Injectable()
export class ReservationScheduler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly ws: RestoraPosGateway,
  ) {}

  @Interval(60_000) // every 60 seconds
  async handleReservationTasks() {
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true, deletedAt: null },
      include: { settings: true },
    });

    const now = new Date();

    for (const branch of branches) {
      const s = branch.settings;
      if (!s) continue;

      const autoReserveMinutes = s.reservationAutoReserveMinutes;
      const reminderMinutes = s.reservationReminderMinutes;
      const smsEnabled = s.smsEnabled && s.reservationSmsEnabled;

      // Get today's CONFIRMED reservations with assigned tables
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const confirmed = await this.prisma.reservation.findMany({
        where: { branchId: branch.id, date: { gte: today, lt: tomorrow }, status: 'CONFIRMED' },
        include: { table: true },
      });

      for (const r of confirmed) {
        const slotTime = this.parseSlotToDate(r.date, r.timeSlot);

        // 1. Auto-reserve tables (supports multiple)
        const reserveAt = new Date(slotTime.getTime() - autoReserveMinutes * 60_000);
        if (now >= reserveAt) {
          const tIds: string[] = r.tableIds ? JSON.parse(r.tableIds as string) : (r.tableId ? [r.tableId] : []);
          for (const tid of tIds) {
            const t = await this.prisma.diningTable.findUnique({ where: { id: tid } });
            if (t && t.status === 'AVAILABLE') {
              await this.prisma.diningTable.update({ where: { id: tid }, data: { status: 'RESERVED' } });
              this.ws.emitToBranch(branch.id, 'table:updated', { tableId: tid, status: 'RESERVED' });
            }
          }
        }

        // 2. Send reminder SMS
        if (smsEnabled && !r.reminderSentAt) {
          const remindAt = new Date(slotTime.getTime() - reminderMinutes * 60_000);
          if (now >= remindAt && now < slotTime) {
            const template = s.reservationSmsReminderTemplate
              || 'Reminder: Your reservation at {branch} is in {minutes} minutes. See you soon!';
            const minsUntil = Math.max(1, Math.round((slotTime.getTime() - now.getTime()) / 60_000));
            const msg = template
              .replace('{branch}', branch.name)
              .replace('{minutes}', String(minsUntil))
              .replace('{time}', r.timeSlot)
              .replace('{name}', r.customerName)
              .replace('{date}', r.date.toISOString().slice(0, 10));
            void this.sms.sendSms(branch.id, r.customerPhone, msg);
            await this.prisma.reservation.update({ where: { id: r.id }, data: { reminderSentAt: now } });
          }
        }
      }
    }
  }

  private parseSlotToDate(date: Date, timeSlot: string): Date {
    const [h, m] = timeSlot.split(':').map(Number);
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d;
  }
}
