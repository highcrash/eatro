import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import type { CreateReservationDto, ConfirmReservationDto, ReservationSlot, ReservationSettings } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';

const RESERVATION_INCLUDE = {
  table: { select: { id: true, tableNumber: true, capacity: true } },
  confirmedBy: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, phone: true } },
};

@Injectable()
export class ReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly ws: RestoraPosGateway,
  ) {}

  // ── Settings ──────────────────────────────────────────────────────────────

  async getSettings(branchId: string): Promise<ReservationSettings> {
    const s = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    return {
      openingTime: s?.openingTime ?? '09:00',
      closingTime: s?.closingTime ?? '23:00',
      reservationSlotMinutes: s?.reservationSlotMinutes ?? 90,
      reservationBlockMinutes: s?.reservationBlockMinutes ?? 60,
      reservationMaxBookingsPerSlot: s?.reservationMaxBookingsPerSlot ?? 12,
      reservationMaxPersonsPerSlot: s?.reservationMaxPersonsPerSlot ?? 40,
      reservationAutoReserveMinutes: s?.reservationAutoReserveMinutes ?? 30,
      reservationLateThresholdMinutes: s?.reservationLateThresholdMinutes ?? 30,
      reservationSmsEnabled: s?.reservationSmsEnabled ?? true,
      reservationReminderMinutes: s?.reservationReminderMinutes ?? 60,
      reservationSmsConfirmTemplate: s?.reservationSmsConfirmTemplate ?? null,
      reservationSmsRejectTemplate: s?.reservationSmsRejectTemplate ?? null,
      reservationSmsReminderTemplate: s?.reservationSmsReminderTemplate ?? null,
      reservationTermsOfService: s?.reservationTermsOfService ?? null,
    };
  }

  async updateSettings(branchId: string, data: Partial<ReservationSettings>) {
    return this.prisma.branchSetting.upsert({
      where: { branchId },
      create: { branchId, ...data } as any,
      update: data as any,
    });
  }

  // ── Slot Generation ───────────────────────────────────────────────────────

  async getAvailableSlots(branchId: string, date: string): Promise<ReservationSlot[]> {
    const settings = await this.getSettings(branchId);
    const { openingTime, closingTime, reservationSlotMinutes, reservationBlockMinutes, reservationMaxBookingsPerSlot, reservationMaxPersonsPerSlot } = settings;

    // Parse times to minutes from midnight
    const openMin = parseTime(openingTime) + reservationBlockMinutes;
    const closeMin = parseTime(closingTime) - reservationBlockMinutes;

    // Generate slot start times
    const slots: string[] = [];
    for (let t = openMin; t < closeMin; t += reservationSlotMinutes) {
      slots.push(formatMinutes(t));
    }

    // Get existing reservations for this date (non-cancelled)
    const d = new Date(date + 'T00:00:00.000Z');
    const dNext = new Date(d);
    dNext.setUTCDate(dNext.getUTCDate() + 1);
    const existing = await this.prisma.reservation.findMany({
      where: {
        branchId,
        date: { gte: d, lt: dNext },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      select: { timeSlot: true, partySize: true },
    });

    return slots.map((time) => {
      const slotReservations = existing.filter((r) => r.timeSlot === time);
      const bookingCount = slotReservations.length;
      const personCount = slotReservations.reduce((s, r) => s + r.partySize, 0);
      return {
        time,
        availableBookings: Math.max(0, reservationMaxBookingsPerSlot - bookingCount),
        availablePersons: Math.max(0, reservationMaxPersonsPerSlot - personCount),
        isFull: bookingCount >= reservationMaxBookingsPerSlot || personCount >= reservationMaxPersonsPerSlot,
      };
    });
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async create(branchId: string, dto: CreateReservationDto) {
    if (dto.partySize < 1) throw new BadRequestException('Party size must be at least 1');

    const settings = await this.getSettings(branchId);

    // Only require terms agreement if ToS is configured
    if (settings.reservationTermsOfService && !dto.agreedTerms) {
      throw new BadRequestException('You must agree to the terms of service');
    }

    // Validate slot capacity inside a transaction to prevent race conditions
    const bookDate = new Date(dto.date + 'T00:00:00.000Z');
    const bookDateNext = new Date(bookDate);
    bookDateNext.setUTCDate(bookDateNext.getUTCDate() + 1);

    const reservation = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.reservation.findMany({
        where: { branchId, date: { gte: bookDate, lt: bookDateNext }, timeSlot: dto.timeSlot, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
      });

      if (existing.length >= settings.reservationMaxBookingsPerSlot) {
        throw new ConflictException('This time slot is fully booked');
      }
      const totalPersons = existing.reduce((s, r) => s + r.partySize, 0);
      if (totalPersons + dto.partySize > settings.reservationMaxPersonsPerSlot) {
        throw new ConflictException('Not enough capacity for your party size in this time slot');
      }

      return tx.reservation.create({
        data: {
          branchId,
          customerId: dto.customerId ?? null,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          date: bookDate,
          timeSlot: dto.timeSlot,
          partySize: dto.partySize,
          notes: dto.notes ?? null,
          agreedTerms: dto.agreedTerms,
        },
        include: RESERVATION_INCLUDE,
      });
    });

    this.ws.emitToBranch(branchId, 'reservation:created', reservation);

    // Send booking received SMS
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (settings.reservationSmsEnabled) {
      void this.sms.sendSms(branchId, dto.customerPhone,
        `Your reservation at ${branch?.name ?? 'our restaurant'} on ${dto.date} at ${dto.timeSlot} for ${dto.partySize} guest(s) has been received. We will confirm shortly.`,
      );
    }

    return reservation;
  }

  async findAll(branchId: string, date?: string, status?: string) {
    const where: any = { branchId };
    if (date) {
      // For @db.Date: use raw date comparison to avoid timezone issues
      // Prisma @db.Date stores just the date portion — match exactly
      where.date = new Date(date + 'T00:00:00.000Z');
    }
    if (status) where.status = status;
    return this.prisma.reservation.findMany({
      where,
      include: RESERVATION_INCLUDE,
      orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
    });
  }

  async findToday(branchId: string) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const today = new Date(todayStr + 'T00:00:00.000Z');
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return this.prisma.reservation.findMany({
      where: { branchId, date: { gte: today, lt: tomorrow } },
      include: RESERVATION_INCLUDE,
      orderBy: { timeSlot: 'asc' },
    });
  }

  async findOne(id: string, branchId: string) {
    const r = await this.prisma.reservation.findFirst({ where: { id, branchId }, include: RESERVATION_INCLUDE });
    if (!r) throw new NotFoundException('Reservation not found');
    return r;
  }

  async confirm(id: string, branchId: string, staffId: string, dto: ConfirmReservationDto) {
    const r = await this.findOne(id, branchId);
    if (r.status !== 'PENDING') throw new BadRequestException('Only PENDING reservations can be confirmed');

    // Support multiple tables
    const allTableIds = dto.tableIds && dto.tableIds.length > 0 ? dto.tableIds : (dto.tableId ? [dto.tableId] : []);
    const primaryTableId = allTableIds[0] ?? null;

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        tableId: primaryTableId,
        tableIds: allTableIds.length > 0 ? JSON.stringify(allTableIds) : null,
        timeSlot: dto.timeSlot ?? r.timeSlot,
        notes: dto.notes ?? r.notes,
        confirmedById: staffId,
        confirmedAt: new Date(),
      },
      include: RESERVATION_INCLUDE,
    });

    this.ws.emitToBranch(branchId, 'reservation:updated', updated);

    // SMS
    const settings = await this.getSettings(branchId);
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (settings.reservationSmsEnabled) {
      // Show all table numbers in SMS
      let tableName = '';
      if (allTableIds.length > 0) {
        const tables = await this.prisma.diningTable.findMany({ where: { id: { in: allTableIds } }, select: { tableNumber: true } });
        tableName = 'Table ' + tables.map((t) => t.tableNumber).join(', ');
      }
      const template = settings.reservationSmsConfirmTemplate
        || 'Your reservation at {branch} on {date} at {time} for {partySize} guest(s) is confirmed. {table}';
      const msg = this.interpolate(template, { branch: branch?.name ?? '', date: r.date.toISOString().slice(0, 10), time: updated.timeSlot, partySize: String(r.partySize), table: tableName, name: r.customerName });
      void this.sms.sendSms(branchId, r.customerPhone, msg);
    }

    return updated;
  }

  async reject(id: string, branchId: string, reason?: string) {
    const r = await this.findOne(id, branchId);
    if (r.status !== 'PENDING') throw new BadRequestException('Only PENDING reservations can be rejected');

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? 'Rejected by staff' },
      include: RESERVATION_INCLUDE,
    });

    this.ws.emitToBranch(branchId, 'reservation:cancelled', updated);

    const settings = await this.getSettings(branchId);
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (settings.reservationSmsEnabled) {
      const template = settings.reservationSmsRejectTemplate
        || 'Sorry, your reservation at {branch} for {date} at {time} could not be confirmed.';
      const msg = this.interpolate(template, { branch: branch?.name ?? '', date: r.date.toISOString().slice(0, 10), time: r.timeSlot, name: r.customerName, partySize: String(r.partySize), table: '' });
      void this.sms.sendSms(branchId, r.customerPhone, msg);
    }

    return updated;
  }

  async markArrived(id: string, branchId: string) {
    const r = await this.findOne(id, branchId);
    if (r.status !== 'CONFIRMED') throw new BadRequestException('Only CONFIRMED reservations can be marked as arrived');

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'ARRIVED', arrivedAt: new Date() },
      include: RESERVATION_INCLUDE,
    });

    // Set all tables to OCCUPIED
    const tIds: string[] = r.tableIds ? JSON.parse(r.tableIds as string) : (r.tableId ? [r.tableId] : []);
    for (const tid of tIds) {
      await this.prisma.diningTable.update({ where: { id: tid }, data: { status: 'OCCUPIED' } });
      this.ws.emitToBranch(branchId, 'table:updated', { tableId: tid, status: 'OCCUPIED' });
    }

    this.ws.emitToBranch(branchId, 'reservation:updated', updated);
    return updated;
  }

  async markCompleted(id: string, branchId: string) {
    const r = await this.findOne(id, branchId);
    if (r.status !== 'ARRIVED') throw new BadRequestException('Only ARRIVED reservations can be completed');

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
      include: RESERVATION_INCLUDE,
    });

    this.ws.emitToBranch(branchId, 'reservation:updated', updated);
    return updated;
  }

  async markNoShow(id: string, branchId: string) {
    const r = await this.findOne(id, branchId);
    if (r.status !== 'CONFIRMED') throw new BadRequestException('Only CONFIRMED reservations can be marked as no-show');

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'NO_SHOW' },
      include: RESERVATION_INCLUDE,
    });

    // Release all tables
    const noShowTIds: string[] = r.tableIds ? JSON.parse(r.tableIds as string) : (r.tableId ? [r.tableId] : []);
    for (const tid of noShowTIds) {
      await this.prisma.diningTable.update({ where: { id: tid }, data: { status: 'AVAILABLE' } });
      this.ws.emitToBranch(branchId, 'table:updated', { tableId: tid, status: 'AVAILABLE' });
    }

    this.ws.emitToBranch(branchId, 'reservation:updated', updated);
    return updated;
  }

  async cancel(id: string, branchId: string, reason?: string) {
    const r = await this.findOne(id, branchId);
    if (['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(r.status)) {
      throw new BadRequestException('Cannot cancel a completed/no-show/already-cancelled reservation');
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null },
      include: RESERVATION_INCLUDE,
    });

    // Release reserved tables
    const cancelTIds: string[] = r.tableIds ? JSON.parse(r.tableIds as string) : (r.tableId ? [r.tableId] : []);
    for (const tid of cancelTIds) {
      const table = await this.prisma.diningTable.findUnique({ where: { id: tid } });
      if (table && table.status === 'RESERVED') {
        await this.prisma.diningTable.update({ where: { id: tid }, data: { status: 'AVAILABLE' } });
        this.ws.emitToBranch(branchId, 'table:updated', { tableId: tid, status: 'AVAILABLE' });
      }
    }

    this.ws.emitToBranch(branchId, 'reservation:cancelled', updated);
    return updated;
  }

  // ── Template interpolation ────────────────────────────────────────────────

  private interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
