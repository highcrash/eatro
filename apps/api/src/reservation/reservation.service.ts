import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import type { CreateReservationDto, ConfirmReservationDto, UpdateReservationDto, ReservationSlot, ReservationSettings } from '@restora/types';
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

  /** The day's booking start times ("12:00", "13:30", …), from the opening hours and slot length. */
  slotTimes(settings: Pick<ReservationSettings, 'openingTime' | 'closingTime' | 'reservationSlotMinutes' | 'reservationBlockMinutes'>): string[] {
    const openMin = parseTime(settings.openingTime) + settings.reservationBlockMinutes;
    const closeMin = parseTime(settings.closingTime) - settings.reservationBlockMinutes;
    const slots: string[] = [];
    for (let t = openMin; t < closeMin; t += settings.reservationSlotMinutes) {
      slots.push(formatMinutes(t));
    }
    return slots;
  }

  async getAvailableSlots(branchId: string, date: string): Promise<ReservationSlot[]> {
    const settings = await this.getSettings(branchId);
    const { reservationMaxBookingsPerSlot, reservationMaxPersonsPerSlot } = settings;
    const slots = this.slotTimes(settings);

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

  /**
   * `confirmed` books it as CONFIRMED in the same transaction as the capacity
   * check (chat bookings from a verified number). Staff add the table later.
   */
  async create(branchId: string, dto: CreateReservationDto, opts: { confirmed?: boolean } = {}) {
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
          ...(opts.confirmed ? { status: 'CONFIRMED' as const, confirmedAt: new Date() } : {}),
        },
        include: RESERVATION_INCLUDE,
      });
    });

    this.ws.emitToBranch(branchId, 'reservation:created', reservation);

    // Send booking received SMS
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (settings.reservationSmsEnabled && opts.confirmed) {
      this.sendConfirmedSms(branchId, branch?.name ?? '', settings, reservation, '');
    } else if (settings.reservationSmsEnabled) {
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

  /**
   * Staff edit of an existing reservation's customer-facing fields:
   * customerName, customerPhone, date, timeSlot, partySize, notes.
   * Status + table assignment use their own dedicated endpoints
   * (/confirm, /cancel, etc.) — this method intentionally leaves
   * them alone.
   *
   * Only PENDING + CONFIRMED reservations are editable. Terminal
   * statuses (ARRIVED / COMPLETED / NO_SHOW / CANCELLED) are
   * read-only — admins should cancel + recreate if they truly need
   * to change a past booking.
   *
   * When date / timeSlot / partySize change, capacity is re-checked
   * against the destination slot (excluding THIS reservation's own
   * row so we don't double-count). When time-or-date changes on a
   * CONFIRMED reservation the booking is bumped back to PENDING so
   * the admin must re-confirm + verify the table is still suitable.
   */
  async update(id: string, branchId: string, dto: UpdateReservationDto) {
    const r = await this.findOne(id, branchId);
    if (r.status !== 'PENDING' && r.status !== 'CONFIRMED') {
      throw new BadRequestException(`Cannot edit a ${r.status} reservation. Cancel + recreate instead.`);
    }
    if (dto.partySize != null && dto.partySize < 1) {
      throw new BadRequestException('Party size must be at least 1');
    }

    // Resolve target slot for capacity validation. Compare to the
    // current row's values so we only validate when something
    // actually changes.
    const currentDateStr = r.date.toISOString().slice(0, 10);
    const newDateStr = dto.date ?? currentDateStr;
    const newTimeSlot = dto.timeSlot ?? r.timeSlot;
    const newPartySize = dto.partySize ?? r.partySize;
    const slotChanged = newDateStr !== currentDateStr || newTimeSlot !== r.timeSlot;
    const sizeChanged = newPartySize !== r.partySize;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (slotChanged || sizeChanged) {
        const settings = await this.getSettings(branchId);
        const bookDate = new Date(newDateStr + 'T00:00:00.000Z');
        const bookDateNext = new Date(bookDate);
        bookDateNext.setUTCDate(bookDateNext.getUTCDate() + 1);
        const existing = await tx.reservation.findMany({
          where: {
            branchId,
            date: { gte: bookDate, lt: bookDateNext },
            timeSlot: newTimeSlot,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            // Exclude this reservation's own row so an in-place
            // edit doesn't trip against itself.
            id: { not: id },
          },
        });
        if (existing.length >= settings.reservationMaxBookingsPerSlot) {
          throw new ConflictException('Destination time slot is fully booked');
        }
        const totalPersons = existing.reduce((s, x) => s + x.partySize, 0);
        if (totalPersons + newPartySize > settings.reservationMaxPersonsPerSlot) {
          throw new ConflictException('Not enough capacity for this party size in the destination slot');
        }
      }

      // When the slot moves on an already-CONFIRMED booking, bump
      // back to PENDING so the admin re-checks tables — the
      // previously assigned table may not be free at the new time.
      const resetToPending = r.status === 'CONFIRMED' && slotChanged;
      return tx.reservation.update({
        where: { id },
        data: {
          ...(dto.customerName !== undefined ? { customerName: dto.customerName } : {}),
          ...(dto.customerPhone !== undefined ? { customerPhone: dto.customerPhone } : {}),
          ...(dto.date !== undefined ? { date: new Date(dto.date + 'T00:00:00.000Z') } : {}),
          ...(dto.timeSlot !== undefined ? { timeSlot: dto.timeSlot } : {}),
          ...(dto.partySize !== undefined ? { partySize: dto.partySize } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(resetToPending ? {
            status: 'PENDING' as const,
            tableId: null,
            tableIds: null,
            confirmedById: null,
            confirmedAt: null,
          } : {}),
        },
        include: RESERVATION_INCLUDE,
      });
    });

    this.ws.emitToBranch(branchId, 'reservation:updated', updated);
    return updated;
  }

  async confirm(id: string, branchId: string, staffId: string, dto: ConfirmReservationDto) {
    const r = await this.findOne(id, branchId);
    if (r.status !== 'PENDING' && r.status !== 'CONFIRMED') throw new BadRequestException('Only PENDING reservations can be confirmed');

    // Support multiple tables
    const allTableIds = dto.tableIds && dto.tableIds.length > 0 ? dto.tableIds : (dto.tableId ? [dto.tableId] : []);
    const primaryTableId = allTableIds[0] ?? null;

    // Already confirmed (for example by the chat assistant): staff are only choosing tables.
    if (r.status === 'CONFIRMED') return this.assignTables(r, branchId, staffId, allTableIds, dto.notes);

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
      this.sendConfirmedSms(branchId, branch?.name ?? '', settings, updated, tableName);
    }

    return updated;
  }

  /** Tables for a booking that is already confirmed. No new SMS: the customer already has the confirmation. */
  private async assignTables(
    r: Awaited<ReturnType<ReservationService['findOne']>>,
    branchId: string,
    staffId: string,
    tableIds: string[],
    notes?: string,
  ) {
    const before: string[] = r.tableIds ? JSON.parse(r.tableIds as string) : (r.tableId ? [r.tableId] : []);
    const updated = await this.prisma.reservation.update({
      where: { id: r.id },
      data: {
        tableId: tableIds[0] ?? null,
        tableIds: tableIds.length > 0 ? JSON.stringify(tableIds) : null,
        notes: notes ?? r.notes,
        ...(r.confirmedById ? {} : { confirmedById: staffId }),
      },
      include: RESERVATION_INCLUDE,
    });
    // Tables taken off the booking are freed if they were already held for it.
    for (const tid of before.filter((t) => !tableIds.includes(t))) {
      const table = await this.prisma.diningTable.findUnique({ where: { id: tid } });
      if (table?.status === 'RESERVED') {
        await this.prisma.diningTable.update({ where: { id: tid }, data: { status: 'AVAILABLE' } });
        this.ws.emitToBranch(branchId, 'table:updated', { tableId: tid, status: 'AVAILABLE' });
      }
    }
    this.ws.emitToBranch(branchId, 'reservation:updated', updated);
    return updated;
  }

  private sendConfirmedSms(
    branchId: string,
    branchName: string,
    settings: ReservationSettings,
    r: { date: Date; timeSlot: string; partySize: number; customerName: string; customerPhone: string },
    tableName: string,
  ) {
    const template = settings.reservationSmsConfirmTemplate
      || 'Your reservation at {branch} on {date} at {time} for {partySize} guest(s) is confirmed. {table}';
    const msg = this.interpolate(template, { branch: branchName, date: r.date.toISOString().slice(0, 10), time: r.timeSlot, partySize: String(r.partySize), table: tableName, name: r.customerName });
    void Promise.resolve(this.sms.sendSms(branchId, r.customerPhone, msg.trim())).catch(() => undefined);
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
