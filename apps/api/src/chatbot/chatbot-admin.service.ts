import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ChatChannel, ChatLeadStatus, ChatMode, Prisma } from '@prisma/client';
import type { JwtPayload } from '@restora/types';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { normalizePhone } from '../customer/customer.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AiImage } from './ai/ai.types';
import { ChatbotService } from './chatbot.service';
import { ComplaintService } from './complaint.service';
import { MenuContextService } from './menu-context';
import { fillPlaceholders, matchQuickReply } from './text';

const MODES: ChatMode[] = ['OFF', 'SUGGEST', 'AUTO'];
const LEAD_STATUSES: ChatLeadStatus[] = ['NEW', 'CONTACTED', 'BOOKED', 'LOST'];
const CHANNELS: ChatChannel[] = ['WEB', 'MESSENGER', 'INSTAGRAM', 'WHATSAPP'];
const MAX_RULES = 40;

export interface SettingsInput {
  webMode?: ChatMode;
  messengerMode?: ChatMode;
  instagramMode?: ChatMode;
  whatsappMode?: ChatMode;
  assistantName?: string;
  greeting?: string;
  fallbackText?: string;
  partyRules?: string | null;
  visionEnabled?: boolean;
  imageDailyLimit?: number;
  humanPauseHours?: number;
  retentionDays?: number;
  usdRate?: number;
  commentMode?: ChatMode;
  autoHideSpam?: boolean;
  complaintMode?: 'DRAFT' | 'HOLDING' | 'STAFF_ONLY';
  complaintReminderMins?: number;
  managerPhone?: string | null;
  complaintSmsEnabled?: boolean;
  commentHourlyCap?: number;
  whatsappMonthlyCap?: number;
}

@Injectable()
export class ChatbotAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatbot: ChatbotService,
    private readonly menus: MenuContextService,
    private readonly activity: ActivityLogService,
    private readonly complaints: ComplaintService,
  ) {}

  // ── Settings ───────────────────────────────────────────────────────────────

  async settings(branchId: string) {
    const s = await this.chatbot.getSettings(branchId);
    const [bs, app] = await Promise.all([
      this.prisma.branchSetting.findUnique({ where: { branchId }, select: { fbPageId: true, fbPageAccessToken: true, whatsappPhoneNumberId: true, whatsappAccessToken: true } }),
      this.prisma.metaAppSetting.findUnique({ where: { branchId }, select: { igUserId: true } }),
    ]);
    const pageConnected = !!bs?.fbPageId && !!bs.fbPageAccessToken;
    const whatsappConnected = !!bs?.whatsappPhoneNumberId && !!bs.whatsappAccessToken;
    return {
      ...s,
      usdRate: Number(s.usdRate),
      pageConnected,
      instagramConnected: pageConnected && !!app?.igUserId,
      whatsappConnected,
      whatsappSentThisMonth: whatsappConnected ? await this.chatbot.whatsappSentThisMonth(branchId) : 0,
    };
  }

  async updateSettings(branchId: string, input: SettingsInput, user: JwtPayload) {
    const before = await this.chatbot.getSettings(branchId);
    const data: Prisma.ChatbotSettingUpdateInput = {};
    for (const key of ['webMode', 'messengerMode', 'instagramMode', 'whatsappMode', 'commentMode'] as const) {
      if (input[key] !== undefined) {
        if (!MODES.includes(input[key]!)) throw new BadRequestException('Mode must be OFF, SUGGEST or AUTO');
        data[key] = input[key];
      }
    }
    for (const key of ['assistantName', 'greeting', 'fallbackText'] as const) {
      if (input[key] !== undefined) {
        const v = String(input[key] ?? '').trim();
        if (!v) throw new BadRequestException('This text cannot be empty');
        data[key] = v.slice(0, key === 'assistantName' ? 40 : 600);
      }
    }
    if (input.partyRules !== undefined) data.partyRules = input.partyRules?.trim().slice(0, 2000) || null;
    if (input.visionEnabled !== undefined) data.visionEnabled = !!input.visionEnabled;
    const ranged = (v: unknown, min: number, max: number, label: string) => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`${label} must be between ${min} and ${max}`);
      return n;
    };
    if (input.imageDailyLimit !== undefined) data.imageDailyLimit = ranged(input.imageDailyLimit, 0, 50, 'Photos per day');
    if (input.humanPauseHours !== undefined) data.humanPauseHours = ranged(input.humanPauseHours, 1, 168, 'Quiet hours after takeover');
    if (input.retentionDays !== undefined) data.retentionDays = ranged(input.retentionDays, 7, 365, 'Days to keep chats');
    if (input.autoHideSpam !== undefined) data.autoHideSpam = !!input.autoHideSpam;
    if (input.complaintSmsEnabled !== undefined) data.complaintSmsEnabled = !!input.complaintSmsEnabled;
    if (input.complaintMode !== undefined) {
      if (!['DRAFT', 'HOLDING', 'STAFF_ONLY'].includes(input.complaintMode)) throw new BadRequestException('Unknown complaint setting');
      data.complaintMode = input.complaintMode;
    }
    if (input.complaintReminderMins !== undefined) data.complaintReminderMins = ranged(input.complaintReminderMins, 5, 240, 'Reminder minutes');
    if (input.whatsappMonthlyCap !== undefined) data.whatsappMonthlyCap = ranged(input.whatsappMonthlyCap, 0, 100_000, 'WhatsApp replies per month');
    if (input.commentHourlyCap !== undefined) data.commentHourlyCap = ranged(input.commentHourlyCap, 1, 500, 'Comment replies per hour');
    if (input.managerPhone !== undefined) {
      const phone = input.managerPhone?.trim() ? normalizePhone(input.managerPhone) : null;
      if (input.managerPhone?.trim() && !phone) throw new BadRequestException('Enter a valid phone number for the manager');
      data.managerPhone = phone;
    }
    if (input.usdRate !== undefined) {
      const n = Number(input.usdRate);
      if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new BadRequestException('Enter a valid taka per dollar rate');
      data.usdRate = n;
    }
    const after = await this.prisma.chatbotSetting.update({ where: { branchId }, data });
    void this.activity.log({
      branchId, actor: user, category: 'SETTINGS', action: 'UPDATE', entityType: 'ChatbotSetting', entityId: after.id, entityName: 'Chat assistant',
      before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown>,
    });
    return { ...after, usdRate: Number(after.usdRate) };
  }

  // ── Inbox ──────────────────────────────────────────────────────────────────

  async conversations(branchId: string, q: { filter?: string; channel?: string; search?: string }) {
    const where: Prisma.ChatConversationWhereInput = { branchId, isTest: false };
    if (q.filter === 'staff') where.needsStaff = true;
    if (q.filter === 'drafts') where.messages = { some: { status: 'DRAFT' } };
    if (q.filter === 'human') where.status = 'HUMAN';
    if (q.channel && CHANNELS.includes(q.channel as ChatChannel)) where.channel = q.channel as ChatChannel;
    const search = q.search?.trim();
    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search.replace(/\D/g, '') || search } },
        { messages: { some: { text: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    const rows = await this.prisma.chatConversation.findMany({
      where,
      orderBy: [{ needsStaff: 'desc' }, { lastMessageAt: 'desc' }],
      take: 100,
      include: {
        messages: { where: { status: { in: ['SENT', 'DRAFT'] } }, orderBy: { createdAt: 'desc' }, take: 1, select: { text: true, sender: true, status: true, createdAt: true } },
        _count: { select: { messages: { where: { status: 'DRAFT' } } } },
      },
    });
    return rows.map(({ messages, _count, ...c }) => ({ ...c, lastMessage: messages[0] ?? null, drafts: _count.messages }));
  }

  private async conv(branchId: string, id: string) {
    const c = await this.prisma.chatConversation.findFirst({ where: { id, branchId } });
    if (!c) throw new NotFoundException('Conversation not found');
    return c;
  }

  async conversation(branchId: string, id: string) {
    const c = await this.conv(branchId, id);
    const [messages, leads] = await Promise.all([
      this.prisma.chatMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'asc' }, take: 300 }),
      this.prisma.chatLead.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' } }),
    ]);
    const staffIds = [...new Set(messages.map((m) => m.staffId).filter((x): x is string => !!x))];
    const staff = staffIds.length ? await this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [];
    const connIds = [...new Set(messages.map((m) => m.aiConnectionId).filter((x): x is string => !!x))];
    const conns = connIds.length ? await this.prisma.aiConnection.findMany({ where: { id: { in: connIds } }, select: { id: true, name: true } }) : [];
    if (c.staffUnread > 0) await this.prisma.chatConversation.update({ where: { id }, data: { staffUnread: 0 } });
    return {
      ...c,
      staffUnread: 0,
      customer: await this.customerCard(branchId, c.customerId, c.customerPhone),
      messages: messages.map((m) => ({
        ...m,
        staffName: staff.find((s) => s.id === m.staffId)?.name ?? null,
        aiConnectionName: conns.find((x) => x.id === m.aiConnectionId)?.name ?? null,
      })),
      leads,
    };
  }

  /** What staff need to know about the customer: visits, spend and upcoming bookings. */
  private async customerCard(branchId: string, customerId: string | null, phone: string | null) {
    const customer = customerId
      ? await this.prisma.customer.findFirst({ where: { id: customerId, branchId } })
      : phone
        ? await this.prisma.customer.findFirst({ where: { branchId, phone } })
        : null;
    if (!customer) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = await this.prisma.reservation.findMany({
      where: { branchId, customerId: customer.id, date: { gte: today }, status: { in: ['PENDING', 'CONFIRMED'] } },
      orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
      take: 3,
      select: { id: true, date: true, timeSlot: true, partySize: true, status: true },
    });
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      totalOrders: customer.totalOrders,
      /** Taka. */
      totalSpent: Number(customer.totalSpent) / 100,
      lastVisit: customer.lastVisit,
      loyaltyPoints: customer.loyaltyPoints,
      customerSince: customer.createdAt,
      upcoming,
    };
  }

  async staffReply(branchId: string, id: string, text: string, user: JwtPayload) {
    const body = (text ?? '').trim();
    if (!body) throw new BadRequestException('Write a reply first');
    const c = await this.conv(branchId, id);
    const settings = await this.chatbot.getSettings(branchId);
    await this.chatbot.sendToChannel(c, body, []);
    const message = await this.prisma.chatMessage.create({ data: { conversationId: id, sender: 'STAFF', source: 'STAFF', text: body.slice(0, 2000), staffId: user.sub } });
    await this.prisma.chatConversation.update({
      where: { id },
      data: { status: 'HUMAN', humanUntil: new Date(Date.now() + settings.humanPauseHours * 3600_000), needsStaff: false, needsStaffReason: null, staffUnread: 0, lastMessageAt: new Date() },
    });
    await this.prisma.chatMessage.updateMany({ where: { conversationId: id, status: 'DRAFT' }, data: { status: 'DISCARDED' } });
    this.chatbot.notify(branchId, id);
    return message;
  }

  async takeOver(branchId: string, id: string) {
    await this.conv(branchId, id);
    const settings = await this.chatbot.getSettings(branchId);
    await this.prisma.chatConversation.update({ where: { id }, data: { status: 'HUMAN', humanUntil: new Date(Date.now() + settings.humanPauseHours * 3600_000) } });
    this.chatbot.notify(branchId, id);
    return { ok: true };
  }

  async handBack(branchId: string, id: string) {
    await this.conv(branchId, id);
    await this.prisma.chatConversation.update({ where: { id }, data: { status: 'BOT', humanUntil: null, needsStaff: false, needsStaffReason: null } });
    this.chatbot.notify(branchId, id);
    return { ok: true };
  }

  async resolve(branchId: string, id: string) {
    await this.conv(branchId, id);
    await this.prisma.chatConversation.update({ where: { id }, data: { needsStaff: false, needsStaffReason: null, staffUnread: 0 } });
    this.chatbot.notify(branchId, id);
    return { ok: true };
  }

  private async draft(branchId: string, messageId: string) {
    const m = await this.prisma.chatMessage.findFirst({ where: { id: messageId, status: 'DRAFT', conversation: { branchId } }, include: { conversation: true } });
    if (!m) throw new NotFoundException('That suggested reply was already sent or removed');
    return m;
  }

  /** Suggest mode: staff approve (and may edit) the bot's draft. */
  async sendDraft(branchId: string, messageId: string, text: string | undefined, user: JwtPayload) {
    const m = await this.draft(branchId, messageId);
    const body = (text ?? m.text).trim();
    if (!body) throw new BadRequestException('The reply is empty');
    await this.chatbot.sendToChannel(m.conversation, body, (m.cards as never) ?? []);
    await this.prisma.chatMessage.update({ where: { id: m.id }, data: { status: 'SENT', text: body.slice(0, 2000), staffId: user.sub, createdAt: new Date() } });
    const remaining = await this.prisma.chatMessage.count({ where: { conversationId: m.conversationId, status: 'DRAFT' } });
    if (remaining === 0 && m.conversation.needsStaffReason === 'Reply waiting for approval') {
      await this.prisma.chatConversation.update({ where: { id: m.conversationId }, data: { needsStaff: false, needsStaffReason: null } });
    }
    this.chatbot.notify(branchId, m.conversationId);
    return { ok: true };
  }

  async discardDraft(branchId: string, messageId: string) {
    const m = await this.draft(branchId, messageId);
    await this.prisma.chatMessage.update({ where: { id: m.id }, data: { status: 'DISCARDED' } });
    this.chatbot.notify(branchId, m.conversationId);
    return { ok: true };
  }

  /** Admin "Test bot": same pipeline as a real customer, nothing saved for real. */
  async testBot(branchId: string, user: JwtPayload, sessionKey: string, text: string, image?: AiImage | null) {
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(sessionKey ?? '')) throw new BadRequestException('Bad test session');
    if (!text?.trim() && !image) throw new BadRequestException('Type a message');
    const result = await this.chatbot.handleIncoming({ branchId, channel: 'WEB', externalUserId: `test:${user.sub}:${sessionKey}`, text: text ?? '', image, isTest: true });
    return result;
  }

  async resetTest(branchId: string, user: JwtPayload, sessionKey: string) {
    await this.prisma.chatConversation.deleteMany({ where: { branchId, isTest: true, externalUserId: `test:${user.sub}:${sessionKey}` } });
    return { ok: true };
  }

  // ── Quick replies ─────────────────────────────────────────────────────────

  quickReplies(branchId: string) {
    return this.prisma.chatQuickReply.findMany({ where: { branchId }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
  }

  private cleanQuick(input: { title?: string; keywords?: string; answer?: string; isActive?: boolean; priority?: number }, creating: boolean) {
    const data: Prisma.ChatQuickReplyUncheckedUpdateInput = {};
    if (input.title !== undefined || creating) {
      if (!input.title?.trim()) throw new BadRequestException('Give it a short title');
      data.title = input.title.trim().slice(0, 80);
    }
    if (input.keywords !== undefined || creating) {
      const lines = (input.keywords ?? '').split(/\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) throw new BadRequestException('Add at least one keyword or phrase');
      data.keywords = lines.slice(0, 80).join('\n');
    }
    if (input.answer !== undefined || creating) {
      if (!input.answer?.trim()) throw new BadRequestException('Write the answer');
      data.answer = input.answer.trim().slice(0, 1500);
    }
    if (input.isActive !== undefined) data.isActive = !!input.isActive;
    if (input.priority !== undefined) data.priority = Math.round(Number(input.priority)) || 0;
    return data;
  }

  createQuickReply(branchId: string, input: { title?: string; keywords?: string; answer?: string; isActive?: boolean; priority?: number }) {
    return this.prisma.chatQuickReply.create({ data: { ...(this.cleanQuick(input, true) as Prisma.ChatQuickReplyUncheckedCreateInput), branchId } });
  }

  async updateQuickReply(branchId: string, id: string, input: { title?: string; keywords?: string; answer?: string; isActive?: boolean; priority?: number }) {
    const row = await this.prisma.chatQuickReply.findFirst({ where: { id, branchId } });
    if (!row) throw new NotFoundException('Quick reply not found');
    return this.prisma.chatQuickReply.update({ where: { id }, data: this.cleanQuick(input, false) });
  }

  async deleteQuickReply(branchId: string, id: string) {
    const row = await this.prisma.chatQuickReply.findFirst({ where: { id, branchId } });
    if (!row) throw new NotFoundException('Quick reply not found');
    await this.prisma.chatQuickReply.delete({ where: { id } });
    return { ok: true };
  }

  /** "Which answer would fire for this message?" */
  async testQuickReply(branchId: string, text: string) {
    const replies = await this.prisma.chatQuickReply.findMany({ where: { branchId, isActive: true }, orderBy: { priority: 'desc' } });
    const hit = matchQuickReply(text ?? '', replies);
    if (!hit) return { matched: false, title: null, answer: null };
    const [branch, content, bs] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: branchId }, select: { address: true, phone: true } }),
      this.prisma.websiteContent.findUnique({ where: { branchId }, select: { openingHours: true } }),
      this.prisma.branchSetting.findUnique({ where: { branchId }, select: { openingTime: true, closingTime: true } }),
    ]);
    const site = this.menus.siteUrl();
    const openingHours = content?.openingHours?.trim() || (bs ? `daily ${bs.openingTime} - ${bs.closingTime}` : null);
    return {
      matched: true,
      title: hit.title,
      answer: fillPlaceholders(hit.answer, { openingHours, address: branch?.address, phone: branch?.phone, siteUrl: site, menuUrl: `${site}/menu`, reservationUrl: `${site}/reservation` }),
    };
  }

  // ── Teach-the-bot rules ───────────────────────────────────────────────────

  async rules(branchId: string) {
    const versions = await this.prisma.chatRuleVersion.findMany({ where: { branchId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return { current: (versions[0]?.rules as string[] | undefined) ?? [], history: versions.map((v) => ({ id: v.id, rules: v.rules, createdAt: v.createdAt, createdByName: v.createdByName })) };
  }

  async saveRules(branchId: string, rules: string[], user: JwtPayload) {
    const clean = (Array.isArray(rules) ? rules : []).map((r) => String(r).trim()).filter(Boolean).map((r) => r.slice(0, 400));
    if (clean.length > MAX_RULES) throw new BadRequestException(`Keep it to ${MAX_RULES} rules or fewer`);
    const staff = await this.prisma.staff.findUnique({ where: { id: user.sub }, select: { name: true } });
    await this.prisma.chatRuleVersion.create({ data: { branchId, rules: clean, createdByName: staff?.name ?? null } });
    void this.activity.log({ branchId, actor: user, category: 'SETTINGS', action: 'UPDATE', entityType: 'ChatRules', entityId: branchId, entityName: 'Chat assistant rules', summary: `Saved ${clean.length} chat assistant rules` });
    return this.rules(branchId);
  }

  async restoreRules(branchId: string, versionId: string, user: JwtPayload) {
    const v = await this.prisma.chatRuleVersion.findFirst({ where: { id: versionId, branchId } });
    if (!v) throw new NotFoundException('That version is no longer kept');
    return this.saveRules(branchId, (v.rules as string[]) ?? [], user);
  }

  // ── Unanswered and party enquiries ────────────────────────────────────────

  unanswered(branchId: string, showResolved: boolean) {
    return this.prisma.chatUnanswered.findMany({ where: { branchId, ...(showResolved ? {} : { resolved: false }) }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async resolveUnanswered(branchId: string, id: string) {
    const r = await this.prisma.chatUnanswered.updateMany({ where: { id, branchId }, data: { resolved: true } });
    if (r.count === 0) throw new NotFoundException('Not found');
    return { ok: true };
  }

  leads(branchId: string, status?: string) {
    return this.prisma.chatLead.findMany({
      where: { branchId, ...(status && LEAD_STATUSES.includes(status as ChatLeadStatus) ? { status: status as ChatLeadStatus } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { conversation: { select: { channel: true, customerName: true, customerPhone: true } } },
    });
  }

  async updateLead(branchId: string, id: string, input: { status?: ChatLeadStatus; notes?: string | null }) {
    const lead = await this.prisma.chatLead.findFirst({ where: { id, branchId } });
    if (!lead) throw new NotFoundException('Enquiry not found');
    if (input.status !== undefined && !LEAD_STATUSES.includes(input.status)) throw new BadRequestException('Unknown status');
    return this.prisma.chatLead.update({ where: { id }, data: { ...(input.status ? { status: input.status } : {}), ...(input.notes !== undefined ? { notes: input.notes?.slice(0, 2000) || null } : {}) } });
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  async report(branchId: string, days: number) {
    const span = Math.max(1, Math.min(90, Math.round(days) || 30));
    const since = new Date(Date.now() - span * 86_400_000);
    const [customerMsgs, botBySource, leads, bookings, unanswered, conversations, needStaff] = await Promise.all([
      this.prisma.chatMessage.count({ where: { sender: 'CUSTOMER', createdAt: { gte: since }, conversation: { branchId, isTest: false } } }),
      this.prisma.chatMessage.groupBy({ by: ['source'], where: { sender: 'BOT', status: 'SENT', createdAt: { gte: since }, conversation: { branchId, isTest: false } }, _count: true }),
      this.prisma.chatLead.count({ where: { branchId, createdAt: { gte: since } } }),
      this.prisma.reservation.count({ where: { branchId, createdAt: { gte: since }, notes: { startsWith: 'Booked through the chat assistant' } } }),
      this.prisma.chatUnanswered.findMany({ where: { branchId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 10, select: { question: true, reason: true, createdAt: true } }),
      this.prisma.chatConversation.groupBy({ by: ['channel'], where: { branchId, isTest: false, lastMessageAt: { gte: since } }, _count: true }),
      this.prisma.chatConversation.count({ where: { branchId, isTest: false, needsStaff: true } }),
    ]);
    const daily = await this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', m."createdAt") AS day, COUNT(*)::bigint AS count
      FROM "chat_messages" m JOIN "chat_conversations" c ON c.id = m."conversationId"
      WHERE c."branchId" = ${branchId} AND c."isTest" = false AND m.sender = 'CUSTOMER' AND m."createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1`;
    const replies = Object.fromEntries(botBySource.map((b) => [b.source ?? 'OTHER', b._count]));
    const totalReplies = botBySource.reduce((s, b) => s + b._count, 0);
    return {
      days: span,
      customerMessages: customerMsgs,
      replies,
      answeredWithoutAiPercent: totalReplies ? Math.round(((replies.QUICK_REPLY ?? 0) / totalReplies) * 100) : 0,
      fallbackPercent: totalReplies ? Math.round(((replies.FALLBACK ?? 0) / totalReplies) * 100) : 0,
      partyEnquiries: leads,
      bookingRequests: bookings,
      waitingForStaff: needStaff,
      byChannel: Object.fromEntries(conversations.map((c) => [c.channel, c._count])),
      perDay: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), messages: Number(d.count) })),
      recentUnanswered: unanswered,
      complaints: await this.complaints.report(branchId, since),
    };
  }
}
