import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import type { ChatComment, CommentKind, ComplaintLevel, SocialPlatform } from '@prisma/client';
import type { JwtPayload } from '@restora/types';

import { PrismaService } from '../prisma/prisma.service';
import { AiRouterService } from './ai/ai-router.service';
import { ChatbotService } from './chatbot.service';
import { Classification, classifyComment, COMMENT_REPLIES, fill, PRIVATE_REPLIES, rotate, topicOf } from './classify';
import { ComplaintService } from './complaint.service';
import { MenuContextService } from './menu-context';
import { MetaAccountService } from './meta/meta-account.service';
import { MetaClient } from './meta/meta.client';
import { PostContextService } from './post-context.service';
import { PushService } from './push/push.service';
import { fillPlaceholders, matchQuickReply } from './text';

export interface IncomingComment {
  branchId: string;
  platform: SocialPlatform;
  postId: string;
  commentId: string;
  parentCommentId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  text: string;
  commentedAt?: Date;
}

const PRIVATE_REPLY_DAYS = 7;
const KINDS: CommentKind[] = ['PRICE', 'BOOKING', 'INFO', 'PRAISE', 'COMPLAINT', 'SPAM', 'ABUSE', 'IGNORE', 'OTHER'];
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there';

/**
 * Facebook and Instagram post comments. Keywords sort most comments; the
 * AI sees only unclear ones. Prices always come from the live menu, and a
 * complaint never gets an automatic public answer unless the owner chose
 * the holding reply.
 */
@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatbot: ChatbotService,
    private readonly complaints: ComplaintService,
    private readonly posts: PostContextService,
    private readonly meta: MetaClient,
    private readonly accounts: MetaAccountService,
    private readonly push: PushService,
    private readonly router: AiRouterService,
    private readonly menus: MenuContextService,
  ) {}

  async handle(c: IncomingComment): Promise<ChatComment | null> {
    const settings = await this.chatbot.getSettings(c.branchId);
    if (settings.commentMode === 'OFF') return null;
    const auth = await this.accounts.auth(c.branchId);
    if (auth && (c.authorId === auth.pageId || (auth.igUserId && c.authorId === auth.igUserId))) return null;
    if (await this.prisma.chatComment.findUnique({ where: { commentId: c.commentId } })) return null;

    let cls = classifyComment(c.text);
    if (!cls.sure) cls = (await this.aiClassify(c)) ?? cls;

    let row: ChatComment;
    try {
      row = await this.prisma.chatComment.create({
        data: {
          branchId: c.branchId,
          platform: c.platform,
          postId: c.postId,
          commentId: c.commentId,
          parentCommentId: c.parentCommentId && c.parentCommentId !== c.postId ? c.parentCommentId : null,
          authorId: c.authorId ?? null,
          authorName: c.authorName ?? null,
          text: c.text.slice(0, 4000),
          kind: cls.kind,
          status: cls.kind === 'IGNORE' ? 'IGNORED' : 'NEW',
          commentedAt: c.commentedAt ?? new Date(),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null; // Meta sent it twice
      throw err;
    }
    if (cls.kind === 'IGNORE') return row;

    try {
      row = await this.act(row, cls, settings.commentMode === 'AUTO');
    } catch (err) {
      this.logger.warn(`Comment ${row.commentId} not handled: ${(err as Error).message}`);
      row = await this.prisma.chatComment.update({ where: { id: row.id }, data: { lastError: (err as Error).message.slice(0, 300), status: 'NEW' } });
    }
    this.chatbot.notify(c.branchId, `comment:${row.id}`);
    if (['NEW', 'DRAFT', 'ESCALATED'].includes(row.status) && !['PRAISE', 'IGNORE', 'SPAM'].includes(row.kind)) {
      const where = row.platform === 'INSTAGRAM' ? 'Instagram' : 'Facebook';
      void this.push.notifyBranch(
        row.branchId,
        { title: `${row.authorName?.trim() || 'Someone'} commented`, body: `${where} post: ${row.status === 'DRAFT' ? 'reply waiting for approval' : 'needs a person'}`, url: `/comments/${row.id}`, tag: `comment-${row.id}` },
        `comment:${row.commentId}`,
      );
    }
    return row;
  }

  private async act(row: ChatComment, cls: Classification, auto: boolean): Promise<ChatComment> {
    const settings = await this.chatbot.getSettings(row.branchId);
    const name = firstName(row.authorName);
    const lang = cls.lang;

    if (cls.kind === 'SPAM' || cls.kind === 'ABUSE') {
      if (settings.autoHideSpam) {
        const auth = await this.mustAuth(row.branchId);
        await this.meta.setHidden(auth, row.platform, row.commentId, true);
        return this.prisma.chatComment.update({ where: { id: row.id }, data: { hidden: true, status: 'HIDDEN' } });
      }
      return row;
    }

    if (cls.kind === 'COMPLAINT') {
      const level: ComplaintLevel = cls.level ?? 'ORDINARY';
      const publicDraft = settings.complaintMode === 'STAFF_ONLY' ? null : fill(rotate(COMMENT_REPLIES.complaintHolding[lang], row.commentId), { name });
      const privateDraft = settings.complaintMode === 'STAFF_ONLY' ? null : fill(PRIVATE_REPLIES.complaint[lang], { name });
      await this.complaints.create({
        branchId: row.branchId, source: 'COMMENT', level, topic: cls.topic ?? topicOf(row.text), text: row.text,
        commentId: row.commentId, channel: row.platform, customerName: row.authorName, draftReply: publicDraft,
      });
      // The holding reply is the only automatic answer to a complaint, never for a serious one.
      if (auto && settings.complaintMode === 'HOLDING' && level !== 'SERIOUS' && publicDraft) {
        return this.send(row, publicDraft, privateDraft, 'ESCALATED');
      }
      return this.prisma.chatComment.update({ where: { id: row.id }, data: { status: 'ESCALATED', draftPublicReply: publicDraft, draftPrivateReply: privateDraft } });
    }

    if (cls.kind === 'OTHER') return row;

    // One answer per person per post, and a cap per hour across the Page.
    if (row.authorId) {
      const answered = await this.prisma.chatComment.count({ where: { branchId: row.branchId, postId: row.postId, authorId: row.authorId, id: { not: row.id }, status: { in: ['REPLIED', 'DRAFT'] } } });
      if (answered > 0) return this.prisma.chatComment.update({ where: { id: row.id }, data: { status: 'IGNORED', lastError: 'Already answered this person on this post' } });
    }

    const drafts = await this.draftReplies(row, cls.kind, lang, name);
    if (!drafts) return row;
    if (!auto) return this.prisma.chatComment.update({ where: { id: row.id }, data: { status: 'DRAFT', draftPublicReply: drafts.public, draftPrivateReply: drafts.private } });

    const lastHour = await this.prisma.chatComment.count({ where: { branchId: row.branchId, status: 'REPLIED', updatedAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (lastHour >= settings.commentHourlyCap) {
      return this.prisma.chatComment.update({ where: { id: row.id }, data: { status: 'DRAFT', draftPublicReply: drafts.public, draftPrivateReply: drafts.private, lastError: 'Hourly reply limit reached; waiting for staff' } });
    }
    const sent = await this.send(row, drafts.public, drafts.private, 'REPLIED');
    if (cls.kind === 'PRAISE' && row.platform === 'FACEBOOK') {
      const auth = await this.mustAuth(row.branchId);
      await this.meta.likeComment(auth, row.commentId).then(
        () => this.prisma.chatComment.update({ where: { id: row.id }, data: { liked: true } }),
        (err: Error) => this.logger.debug(`Like failed: ${err.message}`),
      );
    }
    return sent;
  }

  /** Public reply and private message for the answerable kinds. Null when nothing should be said. */
  async draftReplies(row: ChatComment, kind: CommentKind, lang: 'en' | 'bn', name: string): Promise<{ public: string | null; private: string | null } | null> {
    if (kind === 'PRICE') {
      const resolved = await this.posts.resolve(row.branchId, row.platform, { postId: row.postId });
      const menuUrl = `${this.menus.siteUrl()}/menu`;
      if (resolved.dishCount === 1) {
        const u = resolved.units[0];
        const options = resolved.units.slice(0, 5).map((x) => `${x.name}: ৳${x.price}${x.wasPrice != null ? ` (regular ৳${x.wasPrice})` : ''}`).join('\n');
        return {
          public: fill(rotate(COMMENT_REPLIES.priceOne[lang], row.commentId), { name: u.dishName, price: u.price }),
          private: fill(PRIVATE_REPLIES.price[lang], { name, details: `${options}\n${u.url}` }),
        };
      }
      const details = resolved.units.length > 0
        ? resolved.units.slice(0, 5).map((x) => `${x.name}: ৳${x.price}`).join('\n')
        : fill(PRIVATE_REPLIES.priceMenu[lang], { menuUrl });
      return { public: rotate(COMMENT_REPLIES.priceInbox[lang], row.commentId), private: fill(PRIVATE_REPLIES.price[lang], { name, details }) };
    }
    if (kind === 'BOOKING') {
      return { public: rotate(COMMENT_REPLIES.booking[lang], row.commentId), private: fill(PRIVATE_REPLIES.booking[lang], { name }) };
    }
    if (kind === 'INFO') {
      const replies = await this.prisma.chatQuickReply.findMany({ where: { branchId: row.branchId, isActive: true }, orderBy: { priority: 'desc' } });
      const hit = matchQuickReply(row.text, replies);
      if (!hit) return null;
      return { public: fillPlaceholders(hit.answer, await this.chatbot.placeholderValues(row.branchId)), private: null };
    }
    if (kind === 'PRAISE') return { public: rotate(COMMENT_REPLIES.praise[lang], row.commentId), private: null };
    return null;
  }

  private async mustAuth(branchId: string) {
    const auth = await this.accounts.auth(branchId);
    if (!auth) throw new BadRequestException('META_NOT_CONNECTED: connect the Facebook Page in Chat Assistant → Connect first');
    return auth;
  }

  /** Posts the public reply and, within Meta's 7 days, the one private message. */
  private async send(row: ChatComment, publicText: string | null, privateText: string | null, status: 'REPLIED' | 'ESCALATED'): Promise<ChatComment> {
    const auth = await this.mustAuth(row.branchId);
    const data: Prisma.ChatCommentUpdateInput = { status, draftPublicReply: null, draftPrivateReply: null, lastError: null };
    if (publicText) {
      data.publicReplyId = await this.meta.replyToComment(auth, row.platform, row.commentId, publicText);
      data.publicReply = publicText;
    }
    if (privateText && !row.privateReplySent) {
      if (Date.now() - row.commentedAt.getTime() > PRIVATE_REPLY_DAYS * 86_400_000) {
        data.lastError = 'Too late for a private message (Meta allows 7 days after the comment)';
      } else {
        await this.meta.sendText(auth, { comment_id: row.commentId }, privateText);
        data.privateReplySent = true;
      }
    }
    return this.prisma.chatComment.update({ where: { id: row.id }, data });
  }

  /** Unclear comments: one short AI request through the "Unclear comments" connections. */
  private async aiClassify(c: IncomingComment): Promise<Classification | null> {
    const system = `You sort comments left on a Bangladeshi restaurant's Facebook and Instagram posts. Comments may be in English, Bangla or Banglish. Respond with one JSON object and nothing else:
{"kind": "PRICE" | "BOOKING" | "INFO" | "PRAISE" | "COMPLAINT" | "SPAM" | "ABUSE" | "IGNORE" | "OTHER", "level": "SERIOUS" | "ORDINARY" | "MILD" | null}
PRICE: asks what something costs. BOOKING: wants a table, party or event. INFO: asks about location, hours, delivery, parking and similar. PRAISE: compliments. COMPLAINT: unhappy about food, service, waiting, hygiene, price or a bill; include sarcasm, and set level SERIOUS for illness, hygiene, rudeness or billing problems, ORDINARY for other bad experiences, MILD for gentle grumbles. SPAM: adverts or links. ABUSE: insults or slurs. IGNORE: tagging friends, emojis or chatter. OTHER: anything else.`;
    const res = await this.router
      .run(c.branchId, 'COMMENT', { system, messages: [{ role: 'user', content: c.text.slice(0, 1000) }] }, {
        accept: (r) => {
          const m = /\{[\s\S]*\}/.exec(r.text);
          if (!m) return null;
          try {
            const o = JSON.parse(m[0]) as { kind?: string; level?: string };
            const kind = KINDS.find((k) => k === o.kind);
            if (!kind) return null;
            const level = kind === 'COMPLAINT' ? ((['SERIOUS', 'ORDINARY', 'MILD'] as const).find((l) => l === o.level) ?? 'ORDINARY') : null;
            return { kind, level };
          } catch {
            return null;
          }
        },
      })
      .catch(() => null);
    if (!res) return null;
    const base = classifyComment(c.text);
    return { ...base, kind: res.value.kind, level: res.value.level, topic: res.value.kind === 'COMPLAINT' ? topicOf(c.text) : null, sure: true };
  }

  // ── Catch-up: comments Meta's notifications missed ────────────────────────

  @Interval(5 * 60_000)
  async catchUp() {
    const settings = await this.prisma.chatbotSetting.findMany({ where: { commentMode: { not: 'OFF' } }, select: { branchId: true } });
    for (const s of settings) {
      const auth = await this.accounts.auth(s.branchId);
      const app = await this.prisma.metaAppSetting.findUnique({ where: { branchId: s.branchId } });
      if (!auth || !app?.pageSubscribedAt) continue;
      // Never reach back before the Page was connected, or further than two hours.
      const cutoff = Math.max(Date.now() - 2 * 3600_000, app.pageSubscribedAt.getTime());
      try {
        const recent = await this.meta.recentComments(auth, auth.igUserId);
        for (const r of recent) {
          const at = Date.parse(r.at);
          if (!at || at < cutoff || !r.text) continue;
          await this.handle({ branchId: s.branchId, platform: r.platform, postId: r.postId, commentId: r.commentId, parentCommentId: r.parentId, authorId: r.authorId, authorName: r.authorName, text: r.text, commentedAt: new Date(at) });
        }
      } catch (err) {
        this.logger.debug(`Comment catch-up failed: ${(err as Error).message}`);
      }
    }
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  list(branchId: string, filter?: string) {
    const where: Prisma.ChatCommentWhereInput = { branchId };
    if (filter === 'action') where.status = { in: ['NEW', 'DRAFT', 'ESCALATED'] };
    else if (filter === 'complaints') where.kind = 'COMPLAINT';
    else if (filter === 'spam') where.kind = { in: ['SPAM', 'ABUSE'] };
    else where.status = { not: 'IGNORED' };
    return this.prisma.chatComment.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }).then(async (rows) => {
      const posts = await this.prisma.chatPostContext.findMany({ where: { postId: { in: [...new Set(rows.map((r) => r.postId))] } }, select: { postId: true, caption: true, permalink: true } });
      const byPost = new Map(posts.map((p) => [p.postId, p]));
      return rows.map((r) => ({ ...r, post: byPost.get(r.postId) ?? null }));
    });
  }

  async findByCommentId(branchId: string, commentId: string) {
    const row = await this.prisma.chatComment.findFirst({ where: { commentId, branchId } });
    if (!row) throw new NotFoundException('The comment is no longer on file');
    return row;
  }

  private async find(branchId: string, id: string) {
    const row = await this.prisma.chatComment.findFirst({ where: { id, branchId } });
    if (!row) throw new NotFoundException('Comment not found');
    return row;
  }

  private async afterStaff(row: ChatComment, user: JwtPayload) {
    await this.prisma.chatComment.update({ where: { id: row.id }, data: { handledById: user.sub } });
    if (row.kind === 'COMPLAINT') {
      const ticket = await this.prisma.chatComplaint.findFirst({ where: { commentId: row.commentId } });
      if (ticket) await this.complaints.markResponded(ticket.id, user);
    }
    this.chatbot.notify(row.branchId, `comment:${row.id}`);
  }

  async approve(branchId: string, id: string, input: { publicReply?: string | null; privateReply?: string | null }, user: JwtPayload) {
    const row = await this.find(branchId, id);
    const pub = input.publicReply !== undefined ? input.publicReply?.trim() || null : row.draftPublicReply;
    const priv = input.privateReply !== undefined ? input.privateReply?.trim() || null : row.draftPrivateReply;
    if (!pub && !priv) throw new BadRequestException('There is nothing to send');
    const sent = await this.send(row, pub, priv, row.kind === 'COMPLAINT' ? 'ESCALATED' : 'REPLIED');
    await this.afterStaff(sent, user);
    return sent;
  }

  async reply(branchId: string, id: string, text: string, user: JwtPayload) {
    if (!text?.trim()) throw new BadRequestException('Write a reply first');
    const row = await this.find(branchId, id);
    const sent = await this.send(row, text.trim(), null, row.kind === 'COMPLAINT' ? 'ESCALATED' : 'REPLIED');
    await this.afterStaff(sent, user);
    return sent;
  }

  async privateMessage(branchId: string, id: string, text: string, user: JwtPayload) {
    if (!text?.trim()) throw new BadRequestException('Write the message first');
    const row = await this.find(branchId, id);
    if (row.privateReplySent) throw new BadRequestException('Meta allows one private message per comment, and it was already sent. Reply in the Inbox once they answer.');
    const sent = await this.send(row, null, text.trim(), row.status === 'REPLIED' ? 'REPLIED' : row.kind === 'COMPLAINT' ? 'ESCALATED' : 'REPLIED');
    if (sent.lastError) throw new BadRequestException(sent.lastError);
    await this.afterStaff(sent, user);
    return sent;
  }

  async like(branchId: string, id: string, user: JwtPayload) {
    const row = await this.find(branchId, id);
    if (row.platform !== 'FACEBOOK') throw new BadRequestException('Instagram does not allow liking comments through the API');
    await this.meta.likeComment(await this.mustAuth(branchId), row.commentId);
    await this.prisma.chatComment.update({ where: { id }, data: { liked: true } });
    await this.afterStaff(row, user);
    return { ok: true };
  }

  async setHidden(branchId: string, id: string, hidden: boolean, user: JwtPayload) {
    const row = await this.find(branchId, id);
    await this.meta.setHidden(await this.mustAuth(branchId), row.platform, row.commentId, hidden);
    await this.prisma.chatComment.update({ where: { id }, data: { hidden, status: hidden ? 'HIDDEN' : row.status === 'HIDDEN' ? 'NEW' : row.status } });
    await this.afterStaff(row, user);
    return { ok: true };
  }

  async dismiss(branchId: string, id: string, user: JwtPayload) {
    const row = await this.find(branchId, id);
    await this.prisma.chatComment.update({ where: { id }, data: { status: 'IGNORED', draftPublicReply: null, draftPrivateReply: null } });
    await this.afterStaff(row, user);
    return { ok: true };
  }
}
