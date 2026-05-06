import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

/** Bangladesh phone normaliser. Accepts:
 *    01910202020   (11-digit local with leading 0)
 *    +8801910202020 (E.164)
 *    8801910202020 (without +)
 *    1910202020   (10-digit no leading 0)
 *  Always returns the canonical local 11-digit form (`01XXXXXXXXX`).
 *  Returns null if the input can't be coerced to a valid BD mobile. */
export function normalizeBdPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip everything except digits and a leading +.
  let cleaned = String(raw).trim().replace(/[\s-()]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  cleaned = cleaned.replace(/[^\d]/g, '');
  if (!cleaned) return null;

  // Drop the country code if present (880).
  if (cleaned.startsWith('880') && cleaned.length >= 12) {
    cleaned = cleaned.slice(3);
  }
  // 10-digit form (without leading 0) → prepend 0.
  if (cleaned.length === 10 && cleaned.startsWith('1')) {
    cleaned = '0' + cleaned;
  }
  // BD mobile MUST be 11 digits, start with 01, and the third digit
  // must be 3-9 (operator prefix). Reject otherwise.
  if (!/^01[3-9]\d{8}$/.test(cleaned)) return null;
  return cleaned;
}

/** Permissive phone normaliser used at every customer create/update
 *  path. Prefers the BD canonical form (`01XXXXXXXXX`) when the input
 *  is recognisably a BD mobile — that's how `01620307630` and
 *  `+8801620307630` collapse to the SAME customer row. For non-BD
 *  numbers (a foreign supplier contact, an unusual landline) we keep
 *  the digits-only form so admin can still save it. Returns null only
 *  on empty / non-numeric input. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const bd = normalizeBdPhone(raw);
  if (bd) return bd;
  const digits = String(raw).replace(/[^\d]/g, '');
  return digits.length >= 8 ? digits : null;
}

@Injectable()
export class CustomerService {
  // In-memory OTP store for customer auth
  private otpStore = new Map<string, { otp: string; expiresAt: Date; branchId: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
  ) {}

  /** Find a customer by any phone format. Falls back to a digit-suffix
   *  match so legacy rows stored as +8801XXXXX or 01XXXXX both resolve
   *  to the same person. Returns the first match (DB has a unique on
   *  branchId+phone, but format drift across imports means there can
   *  be aliases). */
  private async findCustomerByPhone(branchId: string, normalized: string) {
    // Fast path — exact match on normalized form.
    const exact = await this.prisma.customer.findUnique({
      where: { branchId_phone: { branchId, phone: normalized } },
    });
    if (exact) return exact;
    // Suffix match — legacy rows might be stored as +8801XXXXX or
    // 8801XXXXX. The last 10 digits (without leading 0) are the
    // distinguishing tail; match on that.
    const tail = normalized.slice(1); // drop leading 0 → 1XXXXXXXXX
    return this.prisma.customer.findFirst({
      where: { branchId, phone: { endsWith: tail } },
    });
  }

  // ─── Auth (public endpoints for QR) ────────────────────────────────────────

  async requestOtp(branchId: string, phone: string) {
    const normalized = normalizeBdPhone(phone);
    if (!normalized) {
      throw new BadRequestException('Enter a valid Bangladesh mobile number (e.g. 01XXXXXXXXX).');
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const key = `${branchId}:${normalized}`;
    this.otpStore.set(key, { otp, expiresAt: new Date(Date.now() + 5 * 60 * 1000), branchId });

    const sent = await this.smsService.sendSms(branchId, normalized, `Your login OTP: ${otp}. Valid for 5 minutes.`);

    // In dev mode, return OTP if SMS not sent
    return { sent, phone: normalized, ...(sent ? {} : { otp }) };
  }

  async verifyOtp(branchId: string, phone: string, inputOtp: string) {
    const normalized = normalizeBdPhone(phone);
    if (!normalized) throw new BadRequestException('Enter a valid Bangladesh mobile number.');

    const key = `${branchId}:${normalized}`;
    const stored = this.otpStore.get(key);

    if (!stored) throw new BadRequestException('No OTP found. Please request a new one.');
    if (new Date() > stored.expiresAt) { this.otpStore.delete(key); throw new BadRequestException('OTP expired'); }
    if (stored.otp !== inputOtp) throw new BadRequestException('Invalid OTP');

    this.otpStore.delete(key);

    // Match the customer across phone-format variants. If the row is
    // there but stored in a non-normalized form, return it without
    // overwriting the existing phone — the front-end displays the name
    // we have on file.
    const existing = await this.findCustomerByPhone(branchId, normalized);
    if (existing) {
      return {
        customer: existing,
        // Surface the convention so the UI can decide whether to show
        // an empty name field (Walk-in default) vs greet by name.
        isWalkIn: existing.name === 'Walk-in',
        isNew: false,
      };
    }

    // Brand-new customer. Defer creation until the front-end posts a
    // name (required) so we don't pollute the directory with rows that
    // never finished signup. Return a sentinel so the UI knows to ask
    // for name + email.
    return {
      customer: null,
      isNew: true,
      phone: normalized,
    };
  }

  /** Brand-new customer signup, called after OTP verification when
   *  no row was found for the phone. Name is required; email is
   *  optional. Phone must be normalized server-side. */
  async createFromQr(branchId: string, dto: { phone: string; name: string; email?: string }) {
    const normalized = normalizeBdPhone(dto.phone);
    if (!normalized) throw new BadRequestException('Enter a valid Bangladesh mobile number.');
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Name is required');

    // Race-guard: another request may have created the row between
    // verifyOtp and now. Return the existing match instead of failing
    // on the unique constraint.
    const existing = await this.findCustomerByPhone(branchId, normalized);
    if (existing) {
      // Fill in missing fields if previously a Walk-in placeholder.
      const patches: { name?: string; email?: string } = {};
      if (!existing.name || existing.name === 'Walk-in') patches.name = name;
      if (dto.email && !existing.email) patches.email = dto.email.trim();
      if (Object.keys(patches).length === 0) return existing;
      return this.prisma.customer.update({ where: { id: existing.id }, data: patches });
    }

    return this.prisma.customer.create({
      data: {
        branchId,
        phone: normalized,
        name,
        email: dto.email?.trim() || null,
      },
    });
  }

  async updateProfile(customerId: string, data: { name?: string; email?: string }) {
    return this.prisma.customer.update({
      where: { id: customerId },
      data,
    });
  }

  async getActiveOrder(branchId: string, customerId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        branchId,
        customerId,
        deletedAt: null,
        status: { notIn: ['PAID', 'VOID'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, orderNumber: true, tableId: true, tableNumber: true, status: true },
    });
    return { order };
  }

  /**
   * QR My Account — last N PAID/SERVED orders + the customer
   * record (totalSpent / totalOrders / lastVisit). Single round-
   * trip drives both the lifetime stats strip + the order list,
   * keeps them in sync, no separate /me endpoint needed.
   *
   * Items include only NON-voided lines + the linked review (or
   * null) so the UI can render a "Leave a review" or "★ Reviewed"
   * affordance per row without a follow-up request per order.
   */
  async getOrderHistory(branchId: string, customerId: string, limit?: number) {
    const take = Math.min(Math.max(1, limit ?? 30), 100);
    const [customer, orders] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: customerId, branchId },
        select: {
          id: true, name: true, phone: true, email: true,
          totalSpent: true, totalOrders: true, lastVisit: true,
        },
      }),
      this.prisma.order.findMany({
        where: {
          branchId, customerId, deletedAt: null,
          status: { in: ['PAID', 'SERVED'] },
        },
        include: {
          items: {
            where: { voidedAt: null },
            select: {
              id: true,
              menuItemId: true,
              menuItemName: true,
              quantity: true,
              unitPrice: true,
              totalPrice: true,
              notes: true,
            },
          },
          review: {
            select: {
              id: true,
              foodScore: true, serviceScore: true,
              atmosphereScore: true, priceScore: true,
              notes: true, createdAt: true,
            },
          },
        },
        orderBy: { paidAt: 'desc' },
        take,
      }),
    ]);
    return { customer, orders };
  }

  /**
   * QR My Account — chronological list of reviews this customer
   * wrote, joined to the order's number + paidAt for "from your
   * visit on …" context.
   */
  async getCustomerReviewHistory(branchId: string, customerId: string) {
    return this.prisma.review.findMany({
      where: { branchId, customerId },
      include: {
        order: { select: { id: true, orderNumber: true, paidAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Admin/POS endpoints ───────────────────────────────────────────────────

  findAll(branchId: string) {
    return this.prisma.customer.findMany({
      where: { branchId, isActive: true },
      orderBy: { lastVisit: 'desc' },
    });
  }

  async findOne(id: string, branchId: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, branchId } });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  async search(branchId: string, query: string) {
    if (!query || query.length < 2) return [];
    return this.prisma.customer.findMany({
      where: {
        branchId,
        isActive: true,
        OR: [
          { phone: { contains: query } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: { lastVisit: 'desc' },
    });
  }

  async createFromPos(branchId: string, data: { phone: string; name?: string; email?: string }) {
    // Normalise FIRST so `01620307630` and `+8801620307630` resolve to
    // the same canonical key. Without this, the same diner saving
    // their number two different ways spawned two customer rows.
    const phone = normalizePhone(data.phone);
    if (!phone) throw new BadRequestException('Invalid phone number');

    // Use the suffix-aware lookup so a legacy row stored in a
    // non-canonical form (`+8801620307630`) is found by the canonical
    // key (`01620307630`) instead of being shadowed by a fresh insert.
    const existing = await this.findCustomerByPhone(branchId, phone);
    if (existing) return existing;

    return this.prisma.customer.create({
      data: { branchId, phone, name: data.name || 'Walk-in', email: data.email },
    });
  }

  /** Admin CSV bulk import. Per-row status so one bad number doesn't abort
   *  the whole upload. Existing rows (matched by branch + phone) are
   *  updated in place — name fills in if it was previously "Walk-in",
   *  email overwrites when provided. */
  async bulkImport(
    branchId: string,
    items: Array<{ phone: string; name?: string; email?: string }>,
  ): Promise<{ total: number; created: number; updated: number; skipped: number; results: Array<{ phone: string; status: 'created' | 'updated' | 'skipped'; reason?: string }> }> {
    const results: Array<{ phone: string; status: 'created' | 'updated' | 'skipped'; reason?: string }> = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of items) {
      const phone = normalizePhone(row.phone);
      if (!phone) {
        results.push({ phone: row.phone ?? '(empty)', status: 'skipped', reason: 'Invalid phone' });
        skipped++;
        continue;
      }
      const name = (row.name ?? '').trim();
      const email = (row.email ?? '').trim() || undefined;
      const existing = await this.findCustomerByPhone(branchId, phone);
      if (existing) {
        const fields: { name?: string; email?: string } = {};
        if (name && (existing.name === 'Walk-in' || !existing.name)) fields.name = name;
        if (email) fields.email = email;
        if (Object.keys(fields).length > 0) {
          await this.prisma.customer.update({ where: { id: existing.id }, data: fields });
          results.push({ phone, status: 'updated' });
          updated++;
        } else {
          results.push({ phone, status: 'skipped', reason: 'Already exists with same name/email' });
          skipped++;
        }
        continue;
      }
      await this.prisma.customer.create({
        data: { branchId, phone, name: name || 'Walk-in', email, isActive: true },
      });
      results.push({ phone, status: 'created' });
      created++;
    }
    return { total: items.length, created, updated, skipped, results };
  }

  /** POS + admin: rename / re-phone / re-email a customer. Phone must
   *  stay unique inside the branch — surfaces a friendly 400 instead of
   *  letting Prisma's P2002 bubble up as a 500. Doesn't touch
   *  isActive / totalOrders / totalSpent — those are derived. */
  async updateCustomer(
    id: string,
    branchId: string,
    dto: { name?: string; phone?: string; email?: string | null },
  ) {
    const existing = await this.findOne(id, branchId);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name).trim();
      if (!name) throw new BadRequestException('Name cannot be empty');
      data.name = name;
    }
    if (dto.phone !== undefined) {
      const phone = normalizePhone(dto.phone);
      if (!phone) throw new BadRequestException('Invalid phone number');
      if (phone !== existing.phone) {
        // Suffix-aware lookup so saving `01620307630` finds an
        // existing `+8801620307630` row in the same branch instead of
        // raising a fake conflict against a different person.
        const collision = await this.findCustomerByPhone(branchId, phone);
        if (collision && collision.id !== id) {
          throw new BadRequestException(`Another customer in this branch already uses ${phone}`);
        }
        data.phone = phone;
      }
    }
    if (dto.email !== undefined) {
      const email = dto.email == null ? null : String(dto.email).trim() || null;
      data.email = email;
    }
    if (Object.keys(data).length === 0) return existing;

    return this.prisma.customer.update({ where: { id }, data });
  }

  /** Admin soft-delete. Sets isActive=false so the customer disappears
   *  from POS + admin lists but historical orders, reviews, and SMS
   *  logs keep their FK link. No hard delete — losing the customerId
   *  on an Order would orphan its review and break the customer's
   *  lifetime-spend ledger. */
  async deleteCustomer(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.customer.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async assignToOrder(orderId: string, branchId: string, customerId: string | null) {
    if (customerId) {
      const customer = await this.findOne(customerId, branchId);
      return this.prisma.order.update({
        where: { id: orderId },
        data: { customerId, customerName: customer.name, customerPhone: customer.phone },
        include: { items: true, payments: true },
      });
    }
    // Remove customer (set as walk-in)
    return this.prisma.order.update({
      where: { id: orderId },
      data: { customerId: null, customerName: 'Walk-in', customerPhone: null },
      include: { items: true, payments: true },
    });
  }

  // ─── Customer Detail (with order history) ───────────────────────────────────

  async getDetail(id: string, branchId: string) {
    const customer = await this.findOne(id, branchId);
    const orders = await this.prisma.order.findMany({
      where: { customerId: id, deletedAt: null },
      include: { items: { where: { voidedAt: null } }, review: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const reviews = await this.prisma.review.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
    });
    return { customer, orders, reviews };
  }

  // ─── Reviews ───────────────────────────────────────────────────────────────

  async createReview(branchId: string, dto: { orderId: string; customerId?: string; foodScore: number; serviceScore: number; atmosphereScore: number; priceScore: number; notes?: string }) {
    const existing = await this.prisma.review.findUnique({ where: { orderId: dto.orderId } });
    if (existing) throw new BadRequestException('Review already submitted for this order');

    return this.prisma.review.create({
      data: {
        branchId,
        orderId: dto.orderId,
        customerId: dto.customerId || null,
        foodScore: dto.foodScore,
        serviceScore: dto.serviceScore,
        atmosphereScore: dto.atmosphereScore,
        priceScore: dto.priceScore,
        notes: dto.notes || null,
      },
    });
  }

  async getReviews(branchId: string) {
    return this.prisma.review.findMany({
      where: { branchId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        order: { select: { id: true, orderNumber: true, totalAmount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
