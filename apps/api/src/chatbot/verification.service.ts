import { createHmac, randomInt, timingSafeEqual } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { ChatbotSetting, ChatConversation } from '@prisma/client';

import { CustomerService } from '../customer/customer.service';
import { MarketingService } from '../marketing/marketing.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { secretsKey } from './secrets';
import { toAsciiDigits } from './text';

const CODE_TTL_MS = 10 * 60_000;
export const MAX_TRIES = 5;
const CODES_PER_CHAT_PER_DAY = 3;
const CODES_PER_PHONE_PER_DAY = 5;
/** A second request for the same number inside this window does not text a new code. */
const RESEND_AFTER_MS = 60_000;
const DAY_MS = 24 * 3600_000;
export const WELCOME_TAG = 'first-visit';

export type StartResult = 'SENT' | 'RECENT' | 'ALREADY' | 'LIMIT' | 'SMS_FAILED';
export type CheckResult =
  | { status: 'OK'; verified: Verified }
  | { status: 'WRONG'; triesLeft: number }
  | { status: 'LOCKED' }
  | { status: 'EXPIRED' }
  | { status: 'NONE' };

export interface Verified {
  name: string | null;
  returning: boolean;
  coupon: { percent: number; validUntil: Date } | null;
}

/** A message that is only a code, as customers type it: "123456", "123 456", "১২৩৪৫৬". */
export function codeIn(text: string): string | null {
  for (const line of toAsciiDigits(text).split('\n')) {
    const digits = line.replace(/[\s-]/g, '');
    if (/^\d{4,6}$/.test(digits)) return digits;
  }
  return null;
}

/**
 * Phone verification for chat customers, and what follows it: linking the
 * chat to the customer record and the one-time welcome coupon. Codes are
 * kept only as a keyed hash and never logged or shown to the AI.
 */
@Injectable()
export class ChatVerificationService {
  private readonly logger = new Logger(ChatVerificationService.name);
  private readonly key = secretsKey(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly customers: CustomerService,
    private readonly marketing: MarketingService,
  ) {}

  /** SMS can only be sent when the branch has a gateway set up. */
  async smsReady(branchId: string): Promise<boolean> {
    const bs = await this.prisma.branchSetting.findUnique({ where: { branchId }, select: { smsEnabled: true, smsApiKey: true } });
    return !!bs?.smsEnabled && !!bs.smsApiKey;
  }

  private hash(conversationId: string, code: string) {
    return createHmac('sha256', this.key).update(`${conversationId}:${code}`).digest('hex');
  }

  /** Texts a code to `phone` for this chat, within the daily limits. */
  async start(conv: ChatConversation, phone: string, name: string | null): Promise<StartResult> {
    if (conv.verifiedPhone === phone) return 'ALREADY';
    const since = new Date(Date.now() - DAY_MS);
    const latest = await this.prisma.chatPhoneVerification.findFirst({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' } });
    if (latest && latest.phone === phone && !latest.verifiedAt && Date.now() - latest.createdAt.getTime() < RESEND_AFTER_MS) return 'RECENT';
    const [forChat, forPhone] = await Promise.all([
      this.prisma.chatPhoneVerification.count({ where: { conversationId: conv.id, createdAt: { gte: since } } }),
      this.prisma.chatPhoneVerification.count({ where: { phone, createdAt: { gte: since } } }),
    ]);
    if (forChat >= CODES_PER_CHAT_PER_DAY || forPhone >= CODES_PER_PHONE_PER_DAY) return 'LIMIT';

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = await this.prisma.chatPhoneVerification.create({
      data: { conversationId: conv.id, phone, name: name?.trim().slice(0, 60) || null, codeHash: this.hash(conv.id, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    const brand = await this.brand(conv.branchId);
    const ok = await Promise.resolve(this.sms
      .sendSms(conv.branchId, phone, `Your ${brand} code is ${code}. It expires in 10 minutes. Do not share it with anyone.`))
      .catch(() => false);
    if (!ok) {
      // A code nobody received should not use up the customer's tries.
      await this.prisma.chatPhoneVerification.delete({ where: { id: row.id } }).catch(() => undefined);
      return 'SMS_FAILED';
    }
    return 'SENT';
  }

  /**
   * The newest unused code for this chat. After half an hour a number-only
   * message ("2000", "4") is just a message again, not a code attempt.
   */
  open(conversationId: string) {
    return this.prisma.chatPhoneVerification.findFirst({
      where: { conversationId, verifiedAt: null, createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async check(conv: ChatConversation, settings: ChatbotSetting, code: string): Promise<CheckResult> {
    const row = await this.open(conv.id);
    if (!row) return { status: 'NONE' };
    if (row.attempts >= MAX_TRIES) return { status: 'LOCKED' };
    if (row.expiresAt < new Date()) return { status: 'EXPIRED' };
    const expected = Buffer.from(row.codeHash, 'hex');
    const given = Buffer.from(this.hash(conv.id, code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      const updated = await this.prisma.chatPhoneVerification.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      return updated.attempts >= MAX_TRIES ? { status: 'LOCKED' } : { status: 'WRONG', triesLeft: MAX_TRIES - updated.attempts };
    }
    await this.prisma.chatPhoneVerification.update({ where: { id: row.id }, data: { verifiedAt: new Date() } });
    return { status: 'OK', verified: await this.markVerified(conv, settings, row.phone, row.name) };
  }

  /**
   * The number is the customer's: link the chat to their customer record
   * (creating one if needed) and send a new customer the welcome coupon.
   */
  async markVerified(conv: ChatConversation, settings: ChatbotSetting, phone: string, name: string | null): Promise<Verified> {
    const chosenName = name?.trim() || conv.customerName?.trim() || null;
    const customer = await this.customers.createFromPos(conv.branchId, { phone, name: chosenName ?? undefined });
    if (chosenName && (!customer.name || customer.name === 'Walk-in')) {
      await this.prisma.customer.update({ where: { id: customer.id }, data: { name: chosenName } });
      customer.name = chosenName;
    }
    const now = new Date();
    await this.prisma.chatConversation.update({
      where: { id: conv.id },
      data: { verifiedPhone: phone, phoneVerifiedAt: now, customerPhone: phone, customerId: customer.id, ...(chosenName ? { customerName: chosenName } : {}) },
    });
    Object.assign(conv, { verifiedPhone: phone, phoneVerifiedAt: now, customerPhone: phone, customerId: customer.id, customerName: chosenName ?? conv.customerName });

    const paid = await this.prisma.order.count({ where: { branchId: conv.branchId, customerId: customer.id, status: 'PAID', deletedAt: null } });
    const returning = paid > 0 || customer.totalOrders > 0;
    const coupon = returning || !settings.welcomeCouponEnabled ? null : await this.welcomeCoupon(conv.branchId, customer.id, customer.name, phone, settings);
    const shownName = customer.name && customer.name !== 'Walk-in' ? customer.name : chosenName;
    return { name: shownName, returning, coupon };
  }

  /** One welcome coupon per customer, ever. Tagged so the first-paid-bill coupon is not issued as well. */
  private async welcomeCoupon(branchId: string, customerId: string, name: string, phone: string, settings: ChatbotSetting) {
    const already = await this.prisma.coupon.count({ where: { branchId, customerId, campaignTag: WELCOME_TAG } });
    // The code only reaches the customer by SMS, so no SMS means no coupon yet.
    if (already > 0 || !(await this.smsReady(branchId))) return null;
    const validUntil = new Date(Date.now() + settings.welcomeCouponDays * DAY_MS);
    try {
      const coupon = await this.prisma.$transaction((tx) =>
        this.marketing.createUniqueCouponForCustomer(tx, {
          branchId,
          customerId,
          campaignTag: WELCOME_TAG,
          name: 'Welcome — chat coupon',
          type: 'PERCENTAGE',
          value: settings.welcomeCouponPercent,
          expiresAt: validUntil,
          customerNameForCode: name,
        }),
      );
      const brand = await this.brand(branchId);
      const until = validUntil.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' });
      const sent = await Promise.resolve(this.sms
        .sendSms(branchId, phone, `Welcome to ${brand}! Your ${settings.welcomeCouponPercent}% welcome coupon: ${coupon.code}. One use, valid until ${until}. Show this SMS when you pay.`))
        .catch(() => false);
      if (!sent) this.logger.warn(`Welcome coupon SMS not sent for customer ${customerId}`);
      return { percent: settings.welcomeCouponPercent, validUntil };
    } catch (err) {
      this.logger.warn(`Welcome coupon not created: ${(err as Error).message}`);
      return null;
    }
  }

  private async brand(branchId: string) {
    const b = await this.prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
    return b?.name || 'EATRO';
  }
}
