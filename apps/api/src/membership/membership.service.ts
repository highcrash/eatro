import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { JwtPayload, MembershipCard as MembershipCardDto, MembershipMemberInfo, MembershipPlanRuleInput } from '@restora/types';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { CustomerService } from '../customer/customer.service';
import { PrismaService } from '../prisma/prisma.service';
import { memberDiscount } from './membership-discount';
import { MAX_SERIAL, buildCardNumber, formatCardNumber, isValidCardNumber, maskCardNumber, normalizeCardNumber } from './membership-number';

const MAX_BATCH = 500;

const planInclude = {
  rules: {
    include: { menuItem: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
};

const cardInclude = {
  plan: { select: { name: true } },
  customer: { select: { id: true, name: true, phone: true } },
  activatedBy: { select: { name: true } },
};

const addMonths = (from: Date, months: number) => {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
};

const dayLabel = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const maskPhone = (phone: string) => (phone.length > 7 ? `${phone.slice(0, 3)}••••${phone.slice(-4)}` : phone);

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ─── Plans ──────────────────────────────────────────────────────────────

  listPlans(branchId: string) {
    return this.prisma.membershipPlan.findMany({ where: { branchId }, include: planInclude, orderBy: { createdAt: 'asc' } });
  }

  private assertPlanFields(dto: { name?: string; discountPercent?: number; validityMonths?: number }) {
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('Plan name is required');
    if (dto.discountPercent !== undefined && !(dto.discountPercent >= 0 && dto.discountPercent <= 100)) {
      throw new BadRequestException('Discount must be between 0 and 100 percent');
    }
    if (dto.validityMonths !== undefined && !(Number.isInteger(dto.validityMonths) && dto.validityMonths >= 1 && dto.validityMonths <= 120)) {
      throw new BadRequestException('Validity must be between 1 and 120 months');
    }
  }

  createPlan(branchId: string, dto: { name: string; discountPercent: number; validityMonths?: number }) {
    this.assertPlanFields(dto);
    return this.prisma.membershipPlan.create({
      data: { branchId, name: dto.name.trim(), discountPercent: dto.discountPercent, validityMonths: dto.validityMonths ?? 12 },
      include: planInclude,
    });
  }

  private async findPlan(id: string, branchId: string) {
    const plan = await this.prisma.membershipPlan.findFirst({ where: { id, branchId } });
    if (!plan) throw new NotFoundException('Membership plan not found');
    return plan;
  }

  async updatePlan(id: string, branchId: string, dto: { name?: string; discountPercent?: number; validityMonths?: number; isActive?: boolean }) {
    await this.findPlan(id, branchId);
    this.assertPlanFields(dto);
    return this.prisma.membershipPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.discountPercent !== undefined ? { discountPercent: dto.discountPercent } : {}),
        ...(dto.validityMonths !== undefined ? { validityMonths: dto.validityMonths } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: planInclude,
    });
  }

  /** Replaces the plan's whole exclusion / member-rate list. */
  async setRules(id: string, branchId: string, rules: MembershipPlanRuleInput[]) {
    await this.findPlan(id, branchId);
    const seen = new Set<string>();
    for (const r of rules) {
      if (!!r.menuItemId === !!r.categoryId) throw new BadRequestException('Each rule must target one item or one category');
      const key = r.menuItemId ?? r.categoryId!;
      if (seen.has(key)) throw new BadRequestException('The same item or category appears twice');
      seen.add(key);
      if (r.kind === 'SPECIAL') {
        if (r.type !== 'FLAT' && r.type !== 'PERCENTAGE') throw new BadRequestException('A member rate needs a type');
        if (!(Number(r.value) > 0) || (r.type === 'PERCENTAGE' && Number(r.value) > 100)) {
          throw new BadRequestException('Enter a valid member rate');
        }
      } else if (r.kind !== 'EXCLUDE') {
        throw new BadRequestException('Unknown rule kind');
      }
    }
    const itemIds = rules.flatMap((r) => (r.menuItemId ? [r.menuItemId] : []));
    const categoryIds = rules.flatMap((r) => (r.categoryId ? [r.categoryId] : []));
    const [items, categories] = await Promise.all([
      this.prisma.menuItem.count({ where: { id: { in: itemIds }, branchId } }),
      this.prisma.menuCategory.count({ where: { id: { in: categoryIds }, branchId } }),
    ]);
    if (items !== itemIds.length || categories !== categoryIds.length) throw new BadRequestException('Unknown item or category');

    await this.prisma.$transaction([
      this.prisma.membershipPlanRule.deleteMany({ where: { planId: id } }),
      this.prisma.membershipPlanRule.createMany({
        data: rules.map((r) => ({
          planId: id,
          menuItemId: r.menuItemId ?? null,
          categoryId: r.categoryId ?? null,
          kind: r.kind,
          type: r.kind === 'SPECIAL' ? r.type : null,
          value: r.kind === 'SPECIAL' ? r.value : null,
        })),
      }),
    ]);
    return this.prisma.membershipPlan.findUniqueOrThrow({ where: { id }, include: planInclude });
  }

  // ─── Cards ──────────────────────────────────────────────────────────────

  private toDto(
    card: {
      id: string; serial: number; number: string; status: 'IN_STOCK' | 'ACTIVE' | 'BLOCKED'; batchLabel: string | null;
      activatedAt: Date | null; expiresAt: Date | null; blockedReason: string | null;
      plan: { name: string }; customer: { id: string; name: string; phone: string } | null; activatedBy: { name: string } | null;
    },
    usage?: { visits: number; totalDiscount: number },
  ): MembershipCardDto {
    const expired = card.status === 'ACTIVE' && !!card.expiresAt && card.expiresAt < new Date();
    return {
      id: card.id,
      serial: card.serial,
      number: card.number,
      formattedNumber: formatCardNumber(card.number),
      status: card.status,
      state: expired ? 'EXPIRED' : card.status,
      batchLabel: card.batchLabel,
      planName: card.plan.name,
      customer: card.customer,
      activatedAt: card.activatedAt?.toISOString() ?? null,
      activatedByName: card.activatedBy?.name ?? null,
      expiresAt: card.expiresAt?.toISOString() ?? null,
      blockedReason: card.blockedReason,
      visits: usage?.visits ?? 0,
      totalDiscount: usage?.totalDiscount ?? 0,
    };
  }

  /** Every card in the branch with its usage; the page filters them. */
  async listCards(branchId: string) {
    const [cards, usage] = await Promise.all([
      this.prisma.membershipCard.findMany({ where: { branchId }, include: cardInclude, orderBy: { serial: 'asc' } }),
      this.prisma.order.groupBy({
        by: ['membershipCardId'],
        where: { branchId, deletedAt: null, status: 'PAID', membershipCardId: { not: null } },
        _count: { _all: true },
        _sum: { discountAmount: true },
      }),
    ]);
    const byCard = new Map(usage.map((u) => [u.membershipCardId, { visits: u._count._all, totalDiscount: Number(u._sum.discountAmount ?? 0) }]));
    return cards.map((c) => this.toDto(c, byCard.get(c.id)));
  }

  async generateCards(branchId: string, dto: { planId: string; quantity: number; batchLabel?: string }, user: JwtPayload) {
    const plan = await this.findPlan(dto.planId, branchId);
    if (!(Number.isInteger(dto.quantity) && dto.quantity >= 1 && dto.quantity <= MAX_BATCH)) {
      throw new BadRequestException(`Quantity must be between 1 and ${MAX_BATCH}`);
    }
    const { _max } = await this.prisma.membershipCard.aggregate({ where: { branchId }, _max: { serial: true } });
    const first = (_max.serial ?? 0) + 1;
    if (first + dto.quantity - 1 > MAX_SERIAL) throw new BadRequestException('Card serial numbers are used up');

    const batchLabel = dto.batchLabel?.trim() || null;
    await this.prisma.membershipCard.createMany({
      data: Array.from({ length: dto.quantity }, (_, i) => ({
        branchId,
        planId: plan.id,
        serial: first + i,
        number: buildCardNumber(first + i),
        batchLabel,
      })),
    });
    void this.activityLog.log({
      branchId, actor: user, category: 'CUSTOMER', action: 'CREATE', entityType: 'membership_card', entityId: plan.id,
      entityName: `Membership cards ${first}-${first + dto.quantity - 1}`,
      summary: `Generated ${dto.quantity} membership cards (serial ${first}-${first + dto.quantity - 1})`,
    });
    const created = await this.prisma.membershipCard.findMany({
      where: { branchId, serial: { gte: first, lt: first + dto.quantity } },
      include: cardInclude,
      orderBy: { serial: 'asc' },
    });
    return created.map((c) => this.toDto(c));
  }

  private async findByNumber(branchId: string, raw: string) {
    const number = normalizeCardNumber(raw);
    if (!isValidCardNumber(number)) {
      throw new BadRequestException('CARD_INVALID: that is not a valid card number. Check the 16 digits and try again.');
    }
    const card = await this.prisma.membershipCard.findFirst({
      where: { branchId, number },
      include: { ...cardInclude, plan: { select: { id: true, name: true, validityMonths: true, isActive: true } } },
    });
    if (!card) throw new BadRequestException('CARD_NOT_FOUND: this card is not in the system.');
    return card;
  }

  private async findCard(id: string, branchId: string) {
    const card = await this.prisma.membershipCard.findFirst({
      where: { id, branchId },
      include: { ...cardInclude, plan: { select: { id: true, name: true, validityMonths: true, isActive: true } } },
    });
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  private memberInfo(card: { number: string; expiresAt: Date | null; plan: { name: string }; customer: { name: string; phone: string } | null }): MembershipMemberInfo {
    return {
      name: card.customer?.name ?? '',
      maskedPhone: maskPhone(card.customer?.phone ?? ''),
      maskedNumber: maskCardNumber(card.number),
      planName: card.plan.name,
      expiresAt: card.expiresAt?.toISOString() ?? '',
    };
  }

  /** Hand a card over: links the customer and starts its validity. */
  async activate(branchId: string, dto: { number: string; phone: string; name?: string }, user: JwtPayload) {
    const card = await this.findByNumber(branchId, dto.number);
    if (card.status !== 'IN_STOCK') throw new BadRequestException('CARD_ALREADY_USED: this card has already been given out.');
    if (!card.plan.isActive) throw new BadRequestException('CARD_PLAN_INACTIVE: this membership plan is switched off.');

    const name = dto.name?.trim();
    let customer = await this.customers.createFromPos(branchId, { phone: dto.phone, name });
    if (name && customer.name === 'Walk-in') {
      customer = await this.prisma.customer.update({ where: { id: customer.id }, data: { name } });
    }
    const now = new Date();
    const existing = await this.prisma.membershipCard.findFirst({
      where: { branchId, customerId: customer.id, status: 'ACTIVE', expiresAt: { gt: now } },
    });
    if (existing) {
      throw new BadRequestException(`CUSTOMER_HAS_CARD: ${customer.name} already has an active card (${maskCardNumber(existing.number)}).`);
    }

    const expiresAt = addMonths(now, card.plan.validityMonths);
    const { count } = await this.prisma.membershipCard.updateMany({
      where: { id: card.id, status: 'IN_STOCK' },
      data: { status: 'ACTIVE', customerId: customer.id, activatedAt: now, activatedById: user.sub, expiresAt },
    });
    if (count === 0) throw new BadRequestException('CARD_ALREADY_USED: this card has already been given out.');

    void this.activityLog.log({
      branchId, actor: user, category: 'CUSTOMER', action: 'UPDATE', entityType: 'membership_card', entityId: card.id,
      entityName: `Card ${maskCardNumber(card.number)}`,
      summary: `Gave membership card ${maskCardNumber(card.number)} to ${customer.name} (${customer.phone})`,
    });
    const updated = await this.findCard(card.id, branchId);
    return { card: this.toDto(updated), member: this.memberInfo(updated) };
  }

  /** A card that may give a discount right now, or a clear refusal. */
  async resolveForOrder(branchId: string, rawNumber: string) {
    const card = await this.findByNumber(branchId, rawNumber);
    if (card.status === 'IN_STOCK') throw new BadRequestException('CARD_NOT_ACTIVE: this card has not been given to a customer yet.');
    if (card.status === 'BLOCKED') throw new BadRequestException('CARD_BLOCKED: this card has been blocked.');
    if (!card.customer || !card.expiresAt) throw new BadRequestException('CARD_NOT_ACTIVE: this card has no member linked.');
    if (card.expiresAt < new Date()) throw new BadRequestException(`CARD_EXPIRED: this card expired on ${dayLabel(card.expiresAt)}. Renew it in admin.`);
    if (!card.plan.isActive) throw new BadRequestException('CARD_PLAN_INACTIVE: this membership plan is switched off.');
    return { id: card.id, number: card.number, planName: card.plan.name, customer: card.customer, member: this.memberInfo(card) };
  }

  /** Member discount in paisa on these order lines, under the card's plan. */
  async discountForCard(branchId: string, cardId: string, items: { menuItemId: string; quantity: number; totalPrice: number }[]) {
    const card = await this.prisma.membershipCard.findFirst({ where: { id: cardId, branchId }, include: { plan: { include: { rules: true } } } });
    if (!card) return 0;
    const menu = await this.prisma.menuItem.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.menuItemId))] }, branchId },
      select: { id: true, categoryId: true, variantParentId: true, category: { select: { parentId: true } } },
    });
    const byId = new Map(menu.map((m) => [m.id, m]));
    return memberDiscount(
      Number(card.plan.discountPercent),
      card.plan.rules.map((r) => ({ menuItemId: r.menuItemId, categoryId: r.categoryId, kind: r.kind, type: r.type, value: r.value === null ? null : Number(r.value) })),
      items.map((i) => {
        const m = byId.get(i.menuItemId);
        return { ...i, variantParentId: m?.variantParentId ?? null, categoryId: m?.categoryId ?? null, parentCategoryId: m?.category?.parentId ?? null };
      }),
    );
  }

  async block(id: string, branchId: string, reason: string | undefined, user: JwtPayload) {
    const card = await this.findCard(id, branchId);
    if (card.status === 'BLOCKED') throw new BadRequestException('This card is already blocked');
    await this.prisma.membershipCard.update({ where: { id }, data: { status: 'BLOCKED', blockedReason: reason?.trim() || 'Blocked' } });
    this.logCard(branchId, user, card, `Blocked membership card ${maskCardNumber(card.number)}`);
    return this.toDto(await this.findCard(id, branchId));
  }

  async unblock(id: string, branchId: string, user: JwtPayload) {
    const card = await this.findCard(id, branchId);
    if (card.status !== 'BLOCKED') throw new BadRequestException('This card is not blocked');
    if (card.replacedById) throw new BadRequestException('This card was replaced by another card');
    await this.prisma.membershipCard.update({ where: { id }, data: { status: card.customerId ? 'ACTIVE' : 'IN_STOCK', blockedReason: null } });
    this.logCard(branchId, user, card, `Unblocked membership card ${maskCardNumber(card.number)}`);
    return this.toDto(await this.findCard(id, branchId));
  }

  /** Another validity period, counted from today or the current expiry, whichever is later. */
  async renew(id: string, branchId: string, user: JwtPayload) {
    const card = await this.findCard(id, branchId);
    if (card.status !== 'ACTIVE' || !card.expiresAt) throw new BadRequestException('Only a card given to a customer can be renewed');
    const from = card.expiresAt > new Date() ? card.expiresAt : new Date();
    const expiresAt = addMonths(from, card.plan.validityMonths);
    await this.prisma.membershipCard.update({ where: { id }, data: { expiresAt } });
    this.logCard(branchId, user, card, `Renewed membership card ${maskCardNumber(card.number)} until ${dayLabel(expiresAt)}`);
    return this.toDto(await this.findCard(id, branchId));
  }

  /** Lost card: blocks it and moves its member to a new card, same expiry. */
  async replace(id: string, branchId: string, newNumber: string, user: JwtPayload) {
    const old = await this.findCard(id, branchId);
    if (!old.customerId || old.replacedById) throw new BadRequestException('This card cannot be replaced');
    const fresh = await this.findByNumber(branchId, newNumber);
    if (fresh.status !== 'IN_STOCK') throw new BadRequestException('CARD_ALREADY_USED: the new card has already been given out.');
    await this.prisma.$transaction([
      this.prisma.membershipCard.update({
        where: { id: fresh.id },
        data: { status: 'ACTIVE', customerId: old.customerId, activatedAt: new Date(), activatedById: user.sub, expiresAt: old.expiresAt },
      }),
      this.prisma.membershipCard.update({ where: { id: old.id }, data: { status: 'BLOCKED', blockedReason: 'Replaced', replacedById: fresh.id } }),
    ]);
    this.logCard(branchId, user, old, `Replaced membership card ${maskCardNumber(old.number)} with ${maskCardNumber(fresh.number)}`);
    return this.toDto(await this.findCard(fresh.id, branchId));
  }

  private logCard(branchId: string, user: JwtPayload, card: { id: string; number: string }, summary: string) {
    void this.activityLog.log({
      branchId, actor: user, category: 'CUSTOMER', action: 'UPDATE', entityType: 'membership_card', entityId: card.id,
      entityName: `Card ${maskCardNumber(card.number)}`, summary,
    });
  }
}
