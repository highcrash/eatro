import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class CustomerService {
  // In-memory OTP store for customer auth
  private otpStore = new Map<string, { otp: string; expiresAt: Date; branchId: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
  ) {}

  // ─── Auth (public endpoints for QR) ────────────────────────────────────────

  async requestOtp(branchId: string, phone: string) {
    if (!phone || phone.length < 8) throw new BadRequestException('Invalid phone number');

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const key = `${branchId}:${phone}`;
    this.otpStore.set(key, { otp, expiresAt: new Date(Date.now() + 5 * 60 * 1000), branchId });

    const sent = await this.smsService.sendSms(branchId, phone, `Your login OTP: ${otp}. Valid for 5 minutes.`);

    // In dev mode, return OTP if SMS not sent
    return { sent, ...(sent ? {} : { otp }) };
  }

  async verifyOtp(branchId: string, phone: string, inputOtp: string) {
    const key = `${branchId}:${phone}`;
    const stored = this.otpStore.get(key);

    if (!stored) throw new BadRequestException('No OTP found. Please request a new one.');
    if (new Date() > stored.expiresAt) { this.otpStore.delete(key); throw new BadRequestException('OTP expired'); }
    if (stored.otp !== inputOtp) throw new BadRequestException('Invalid OTP');

    this.otpStore.delete(key);

    // Find or create customer
    let customer = await this.prisma.customer.findUnique({
      where: { branchId_phone: { branchId, phone } },
    });

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: { branchId, phone, name: 'Customer' },
      });
    }

    return { customer };
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
    if (!data.phone || data.phone.length < 8) throw new BadRequestException('Invalid phone number');

    const existing = await this.prisma.customer.findUnique({
      where: { branchId_phone: { branchId, phone: data.phone } },
    });
    if (existing) return existing;

    return this.prisma.customer.create({
      data: { branchId, phone: data.phone, name: data.name || 'Walk-in', email: data.email },
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
