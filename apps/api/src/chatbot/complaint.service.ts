import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { ChatConversation, ComplaintLevel, ComplaintStatus, Prisma } from '@prisma/client';
import type { JwtPayload } from '@restora/types';

import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';

const STATUSES: ComplaintStatus[] = ['NEW', 'CONTACTED', 'RESOLVED'];
const LEVELS: ComplaintLevel[] = ['SERIOUS', 'ORDINARY', 'MILD'];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Complaints from comments and chats become tickets. A person decides what
 * EATRO says; this service records, alerts and reminds.
 */
@Injectable()
export class ComplaintService {
  private readonly logger = new Logger(ComplaintService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly ws: RestoraPosGateway,
  ) {}

  private notify(branchId: string, complaintId: string, reminder = false) {
    try {
      this.ws.emitToBranch(branchId, 'chat:updated', { complaintId, reminder });
    } catch {
      /* admin also polls */
    }
  }

  async create(input: {
    branchId: string;
    source: 'COMMENT' | 'CHAT';
    level: ComplaintLevel;
    topic: string;
    text: string;
    commentId?: string | null;
    conversationId?: string | null;
    channel?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    draftReply?: string | null;
  }) {
    const row = await this.prisma.chatComplaint.create({
      data: {
        branchId: input.branchId,
        source: input.source,
        level: input.level,
        topic: input.topic,
        text: clip(input.text, 4000),
        commentId: input.commentId ?? null,
        conversationId: input.conversationId ?? null,
        channel: input.channel ?? null,
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        draftReply: input.draftReply ?? null,
      },
    });
    this.notify(input.branchId, row.id);
    if (row.level === 'SERIOUS') await this.smsManager(row.id);
    return row;
  }

  fromChat(conv: ChatConversation, text: string, level: ComplaintLevel, topic: string) {
    return this.create({
      branchId: conv.branchId,
      source: 'CHAT',
      level,
      topic,
      text,
      conversationId: conv.id,
      channel: conv.channel,
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
    });
  }

  /** Optional SMS to the manager, for serious complaints only, once per ticket. */
  private async smsManager(complaintId: string) {
    const c = await this.prisma.chatComplaint.findUnique({ where: { id: complaintId } });
    if (!c || c.managerSmsAt) return;
    const s = await this.prisma.chatbotSetting.findUnique({ where: { branchId: c.branchId }, select: { complaintSmsEnabled: true, managerPhone: true } });
    if (!s?.complaintSmsEnabled || !s.managerPhone) return;
    const where = c.channel ? c.channel.charAt(0) + c.channel.slice(1).toLowerCase() : c.source.toLowerCase();
    const body = `EATRO: serious complaint (${where}) from ${c.customerName ?? 'a customer'}: "${clip(c.text, 90)}". Open admin > Chat Assistant > Complaints.`;
    try {
      await this.sms.sendSms(c.branchId, s.managerPhone, body);
      await this.prisma.chatComplaint.update({ where: { id: c.id }, data: { managerSmsAt: new Date() } });
    } catch (err) {
      this.logger.warn(`Manager SMS failed: ${(err as Error).message}`);
    }
  }

  /** Serious complaints nobody has opened get a repeating reminder in admin. */
  @Interval(60_000)
  async remind() {
    const settings = await this.prisma.chatbotSetting.findMany({ select: { branchId: true, complaintReminderMins: true } });
    for (const s of settings) {
      const cutoff = new Date(Date.now() - s.complaintReminderMins * 60_000);
      const due = await this.prisma.chatComplaint.findMany({
        where: { branchId: s.branchId, level: 'SERIOUS', status: 'NEW', openedAt: null, createdAt: { lt: cutoff }, OR: [{ remindedAt: null }, { remindedAt: { lt: cutoff } }] },
        select: { id: true },
      });
      for (const c of due) {
        await this.prisma.chatComplaint.update({ where: { id: c.id }, data: { remindedAt: new Date() } });
        this.notify(s.branchId, c.id, true);
      }
    }
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async list(branchId: string, q: { status?: string; level?: string }) {
    const where: Prisma.ChatComplaintWhereInput = { branchId };
    if (q.status && STATUSES.includes(q.status as ComplaintStatus)) where.status = q.status as ComplaintStatus;
    else if (q.status === 'open') where.status = { not: 'RESOLVED' };
    if (q.level && LEVELS.includes(q.level as ComplaintLevel)) where.level = q.level as ComplaintLevel;
    const rows = await this.prisma.chatComplaint.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 });
    const order: Record<ComplaintLevel, number> = { SERIOUS: 0, ORDINARY: 1, MILD: 2 };
    return rows.sort((a, b) => (a.status === 'RESOLVED' ? 1 : 0) - (b.status === 'RESOLVED' ? 1 : 0) || order[a.level] - order[b.level] || b.createdAt.getTime() - a.createdAt.getTime());
  }

  async get(branchId: string, id: string) {
    const c = await this.prisma.chatComplaint.findFirst({ where: { id, branchId } });
    if (!c) throw new NotFoundException('Complaint not found');
    return c;
  }

  /** Opening a ticket stops the reminders and shows what we know about the customer. */
  async open(branchId: string, id: string) {
    let c = await this.get(branchId, id);
    if (!c.openedAt) c = await this.prisma.chatComplaint.update({ where: { id }, data: { openedAt: new Date() } });
    const comment = c.commentId ? await this.prisma.chatComment.findUnique({ where: { commentId: c.commentId } }) : null;
    const phone = c.customerPhone ?? (c.conversationId ? (await this.prisma.chatConversation.findUnique({ where: { id: c.conversationId }, select: { customerPhone: true } }))?.customerPhone : null);
    const orders = phone
      ? await this.prisma.order.findMany({
          where: { branchId, customer: { phone } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, orderNumber: true, createdAt: true, totalAmount: true, status: true, type: true, items: { select: { menuItemName: true, quantity: true }, take: 8 } },
        })
      : [];
    return { ...c, comment, customerPhone: phone ?? null, recentOrders: orders.map((o) => ({ ...o, totalAmount: Number(o.totalAmount) })) };
  }

  async update(branchId: string, id: string, input: { status?: ComplaintStatus; notes?: string | null; outcome?: string | null }, user: JwtPayload) {
    const c = await this.get(branchId, id);
    if (input.status !== undefined && !STATUSES.includes(input.status)) throw new BadRequestException('Unknown status');
    const data: Prisma.ChatComplaintUpdateInput = {};
    if (input.status) {
      data.status = input.status;
      if (input.status !== 'NEW' && !c.firstResponseAt) data.firstResponseAt = new Date();
      if (input.status === 'RESOLVED') data.resolvedAt = new Date();
      if (!c.assignedStaffId) data.assignedStaffId = user.sub;
    }
    if (input.notes !== undefined) data.notes = input.notes?.slice(0, 4000) || null;
    if (input.outcome !== undefined) data.outcome = input.outcome?.slice(0, 200) || null;
    return this.prisma.chatComplaint.update({ where: { id }, data });
  }

  async markResponded(id: string, user: JwtPayload) {
    const c = await this.prisma.chatComplaint.findUnique({ where: { id } });
    if (!c) return;
    await this.prisma.chatComplaint.update({
      where: { id },
      data: { status: c.status === 'NEW' ? 'CONTACTED' : c.status, firstResponseAt: c.firstResponseAt ?? new Date(), assignedStaffId: c.assignedStaffId ?? user.sub, openedAt: c.openedAt ?? new Date() },
    });
  }

  async report(branchId: string, since: Date) {
    const rows = await this.prisma.chatComplaint.findMany({ where: { branchId, createdAt: { gte: since } }, select: { topic: true, level: true, status: true, createdAt: true, firstResponseAt: true } });
    const byTopic: Record<string, number> = {};
    for (const r of rows) byTopic[r.topic] = (byTopic[r.topic] ?? 0) + 1;
    const responded = rows.filter((r) => r.firstResponseAt);
    const avgMins = responded.length ? Math.round(responded.reduce((s, r) => s + (r.firstResponseAt!.getTime() - r.createdAt.getTime()), 0) / responded.length / 60_000) : null;
    return { total: rows.length, open: rows.filter((r) => r.status !== 'RESOLVED').length, serious: rows.filter((r) => r.level === 'SERIOUS').length, byTopic, avgFirstResponseMins: avgMins };
  }
}
