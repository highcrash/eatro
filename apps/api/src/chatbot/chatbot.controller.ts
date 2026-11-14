import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Logger, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AiJob, ChatLeadStatus, ComplaintStatus } from '@prisma/client';
import type { JwtPayload } from '@restora/types';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AiAdminService, ConnectionInput } from './ai/ai-admin.service';
import type { AiImage, AiImageMediaType } from './ai/ai.types';
import { ChatbotAdminService, SettingsInput } from './chatbot-admin.service';
import { ChatbotService } from './chatbot.service';
import { CommentService } from './comment.service';
import { ComplaintService } from './complaint.service';
import { ConnectService } from './meta/connect.service';
import { MetaAccountService } from './meta/meta-account.service';
import { MetaWebhookBody, MetaWebhookService, validSignature } from './meta/meta-webhook.service';
import { WhatsAppWebhookBody, WhatsAppWebhookService } from './meta/whatsapp-webhook.service';

const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** About 1.5 MB of photo; the widget shrinks photos well below this. */
const MAX_IMAGE_CHARS = 2_000_000;

export function parseImage(dataUrl: unknown): AiImage | null {
  if (dataUrl == null || dataUrl === '') return null;
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_IMAGE_CHARS) throw new BadRequestException('That photo is too large');
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new BadRequestException('Send the photo as a JPEG, PNG or WebP image');
  return { mediaType: m[1] as AiImageMediaType, data: m[2] };
}

// ─── Website chat widget (no login) ──────────────────────────────────────────

@Controller('public/chatbot')
@UseGuards(ThrottlerGuard)
export class ChatbotPublicController {
  constructor(
    private readonly chatbot: ChatbotService,
    private readonly prisma: PrismaService,
  ) {}

  private async branch(branchId: unknown) {
    if (typeof branchId !== 'string' || !branchId) throw new BadRequestException('branchId is required');
    const b = await this.prisma.branch.findFirst({ where: { id: branchId, isActive: true, deletedAt: null }, select: { id: true } });
    if (!b) throw new NotFoundException('Branch not found');
    return b.id;
  }

  @Get('config')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async config(@Query('branchId') branchId: string) {
    const id = await this.branch(branchId);
    const s = await this.chatbot.getSettings(id);
    return { enabled: s.webMode !== 'OFF', assistantName: s.assistantName, greeting: s.greeting, photos: s.visionEnabled, retentionDays: s.retentionDays };
  }

  @Post('message')
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  async message(@Body() body: { branchId?: string; sessionId?: string; text?: string; image?: string; name?: string }) {
    const branchId = await this.branch(body?.branchId);
    if (!SESSION_RE.test(body?.sessionId ?? '')) throw new BadRequestException('Bad chat session');
    const text = typeof body.text === 'string' ? body.text : '';
    const image = parseImage(body.image);
    if (!text.trim() && !image) throw new BadRequestException('Type a message');
    if (text.length > 2000) throw new BadRequestException('That message is too long');
    const result = await this.chatbot.handleIncoming({ branchId, channel: 'WEB', externalUserId: body.sessionId!, text, image });
    if (result.status === 'OFF') throw new BadRequestException('CHAT_OFF: chat is not available right now');
    return { status: result.status, reply: result.reply ? { text: result.reply.text, cards: result.reply.cards } : null };
  }

  /** Staff replies (and approved drafts) reach the website by polling. */
  @Get('messages')
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  async messages(@Query('branchId') branchId: string, @Query('sessionId') sessionId: string, @Query('after') after?: string) {
    const id = await this.branch(branchId);
    if (!SESSION_RE.test(sessionId ?? '')) throw new BadRequestException('Bad chat session');
    const conv = await this.prisma.chatConversation.findUnique({ where: { branchId_channel_externalUserId: { branchId: id, channel: 'WEB', externalUserId: sessionId } } });
    if (!conv) return { messages: [], staffActive: false };
    const since = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : undefined;
    const rows = await this.prisma.chatMessage.findMany({
      where: { conversationId: conv.id, status: 'SENT', ...(since ? { createdAt: { gt: since } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, sender: true, text: true, cards: true, hasImage: true, createdAt: true },
    });
    return { messages: rows, staffActive: conv.status === 'HUMAN' };
  }
}

// ─── Admin: inbox, knowledge, settings (owner and manager) ───────────────────

@Controller('chatbot')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class ChatbotAdminController {
  constructor(private readonly svc: ChatbotAdminService) {}

  @Get('settings')
  settings(@CurrentUser() u: JwtPayload) {
    return this.svc.settings(u.branchId);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() u: JwtPayload, @Body() body: SettingsInput) {
    return this.svc.updateSettings(u.branchId, body ?? {}, u);
  }

  @Get('conversations')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  conversations(@CurrentUser() u: JwtPayload, @Query('filter') filter?: string, @Query('channel') channel?: string, @Query('search') search?: string) {
    return this.svc.conversations(u.branchId, { filter, channel, search });
  }

  @Get('conversations/:id')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  conversation(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.conversation(u.branchId, id);
  }

  @Post('conversations/:id/reply')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  reply(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { text: string }) {
    return this.svc.staffReply(u.branchId, id, body?.text, u);
  }

  @Post('conversations/:id/take-over')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  takeOver(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.takeOver(u.branchId, id);
  }

  @Post('conversations/:id/hand-back')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  handBack(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.handBack(u.branchId, id);
  }

  @Post('conversations/:id/resolve')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  resolve(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.resolve(u.branchId, id);
  }

  @Post('messages/:id/send')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  sendDraft(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { text?: string }) {
    return this.svc.sendDraft(u.branchId, id, body?.text, u);
  }

  @Post('messages/:id/discard')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  discardDraft(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.discardDraft(u.branchId, id);
  }

  @Post('test')
  test(@CurrentUser() u: JwtPayload, @Body() body: { sessionKey: string; text?: string; image?: string }) {
    return this.svc.testBot(u.branchId, u, body?.sessionKey, body?.text ?? '', parseImage(body?.image));
  }

  @Post('test/reset')
  resetTest(@CurrentUser() u: JwtPayload, @Body() body: { sessionKey: string }) {
    return this.svc.resetTest(u.branchId, u, body?.sessionKey);
  }

  @Get('quick-replies')
  quickReplies(@CurrentUser() u: JwtPayload) {
    return this.svc.quickReplies(u.branchId);
  }

  @Post('quick-replies')
  createQuickReply(@CurrentUser() u: JwtPayload, @Body() body: { title?: string; keywords?: string; answer?: string; isActive?: boolean; priority?: number }) {
    return this.svc.createQuickReply(u.branchId, body ?? {});
  }

  @Post('quick-replies/test')
  testQuickReply(@CurrentUser() u: JwtPayload, @Body() body: { text: string }) {
    return this.svc.testQuickReply(u.branchId, body?.text);
  }

  @Patch('quick-replies/:id')
  updateQuickReply(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { title?: string; keywords?: string; answer?: string; isActive?: boolean; priority?: number }) {
    return this.svc.updateQuickReply(u.branchId, id, body ?? {});
  }

  @Delete('quick-replies/:id')
  deleteQuickReply(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.deleteQuickReply(u.branchId, id);
  }

  @Get('rules')
  rules(@CurrentUser() u: JwtPayload) {
    return this.svc.rules(u.branchId);
  }

  @Put('rules')
  saveRules(@CurrentUser() u: JwtPayload, @Body() body: { rules: string[] }) {
    return this.svc.saveRules(u.branchId, body?.rules ?? [], u);
  }

  @Post('rules/:versionId/restore')
  restoreRules(@CurrentUser() u: JwtPayload, @Param('versionId') versionId: string) {
    return this.svc.restoreRules(u.branchId, versionId, u);
  }

  @Get('unanswered')
  unanswered(@CurrentUser() u: JwtPayload, @Query('all') all?: string) {
    return this.svc.unanswered(u.branchId, all === '1');
  }

  @Post('unanswered/:id/resolve')
  resolveUnanswered(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.resolveUnanswered(u.branchId, id);
  }

  @Get('leads')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  leads(@CurrentUser() u: JwtPayload, @Query('status') status?: string) {
    return this.svc.leads(u.branchId, status);
  }

  @Patch('leads/:id')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  updateLead(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { status?: ChatLeadStatus; notes?: string | null }) {
    return this.svc.updateLead(u.branchId, id, body ?? {});
  }

  @Get('report')
  report(@CurrentUser() u: JwtPayload, @Query('days') days?: string) {
    return this.svc.report(u.branchId, Number(days ?? 30));
  }
}

// ─── Admin: AI models (owner only) ───────────────────────────────────────────

@Controller('chatbot/ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class AiAdminController {
  constructor(private readonly svc: AiAdminService) {}

  @Get('connections')
  list(@CurrentUser() u: JwtPayload) {
    return this.svc.list(u.branchId);
  }

  @Post('connections')
  create(@CurrentUser() u: JwtPayload, @Body() body: ConnectionInput) {
    return this.svc.create(u.branchId, body ?? {}, u);
  }

  @Patch('connections/:id')
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: ConnectionInput) {
    return this.svc.update(u.branchId, id, body ?? {}, u);
  }

  @Delete('connections/:id')
  remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.remove(u.branchId, id, u);
  }

  @Post('connections/:id/self-test')
  selfTest(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.startSelfTest(u.branchId, id);
  }

  @Get('connections/:id/models')
  models(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.listModels(u.branchId, id);
  }

  @Get('routes')
  routes(@CurrentUser() u: JwtPayload) {
    return this.svc.routes(u.branchId);
  }

  @Put('routes/:job')
  setRoute(
    @CurrentUser() u: JwtPayload,
    @Param('job') job: AiJob,
    @Body() body: { connectionIds?: string[]; splitConnectionId?: string | null; splitPercent?: number; shadowConnectionId?: string | null },
  ) {
    return this.svc.setRoute(u.branchId, job, body ?? {}, u);
  }

  @Post('switch-back')
  switchBack(@CurrentUser() u: JwtPayload) {
    return this.svc.switchBack(u.branchId, u);
  }

  @Post('openrouter/check')
  checkOpenRouter(@Body() body: { apiKey: string }) {
    return this.svc.checkOpenRouterKey(body?.apiKey);
  }

  @Get('usage')
  usage(@CurrentUser() u: JwtPayload, @Query('days') days?: string) {
    return this.svc.usage(u.branchId, Number(days ?? 30));
  }
}

// ─── Meta webhook (Messenger, Instagram, Page comments) ───────────────────────

@Controller('chatbot/webhook/meta')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    private readonly accounts: MetaAccountService,
    private readonly webhook: MetaWebhookService,
  ) {}

  /** Meta checks the address once by sending back our verify token. */
  @Get()
  async verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const tokens = await this.accounts.verifyTokens();
    if (mode === 'subscribe' && token && tokens.includes(token)) {
      res.type('text/plain').send(challenge ?? '');
      return;
    }
    res.status(403).send('Verification failed');
  }

  /** Answers at once; the messages are handled after the response. */
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string, @Body() body: MetaWebhookBody) {
    const secrets = await this.accounts.allAppSecrets();
    if (!validSignature(req.rawBody, signature, secrets)) throw new ForbiddenException('Bad signature');
    setImmediate(() => void this.webhook.process(body).catch((err: Error) => this.logger.warn(`Webhook processing failed: ${err.message}`)));
    return 'EVENT_RECEIVED';
  }
}

// ─── WhatsApp webhook ────────────────────────────────────────────────────────

@Controller('chatbot/webhook/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly accounts: MetaAccountService,
    private readonly webhook: WhatsAppWebhookService,
  ) {}

  @Get()
  async verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const tokens = await this.accounts.verifyTokens();
    if (mode === 'subscribe' && token && tokens.includes(token)) {
      res.type('text/plain').send(challenge ?? '');
      return;
    }
    res.status(403).send('Verification failed');
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string, @Body() body: WhatsAppWebhookBody) {
    const secrets = await this.accounts.allAppSecrets();
    if (!validSignature(req.rawBody, signature, secrets)) throw new ForbiddenException('Bad signature');
    setImmediate(() => void this.webhook.process(body).catch((err: Error) => this.logger.warn(`WhatsApp webhook failed: ${err.message}`)));
    return 'EVENT_RECEIVED';
  }
}

// ─── Connect wizard ──────────────────────────────────────────────────────────

/** Facebook sends the owner's browser back here after Facebook Login. */
@Controller('chatbot/connect/facebook')
export class ConnectCallbackController {
  constructor(private readonly connect: ConnectService) {}

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    res.redirect(await this.connect.callback(code, state, error));
  }
}

@Controller('chatbot/connect')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class ConnectController {
  constructor(private readonly connect: ConnectService) {}

  @Get()
  status(@CurrentUser() u: JwtPayload) {
    return this.connect.status(u.branchId);
  }

  @Put('app')
  saveApp(@CurrentUser() u: JwtPayload, @Body() body: { appId?: string; appSecret?: string }) {
    return this.connect.saveApp(u.branchId, body ?? {}, u);
  }

  @Post('facebook/start')
  start(@CurrentUser() u: JwtPayload) {
    return this.connect.startLogin(u.branchId, u);
  }

  @Post('page')
  pickPage(@CurrentUser() u: JwtPayload, @Body() body: { pageId: string }) {
    return this.connect.pickPage(u.branchId, body?.pageId, u);
  }

  @Post('check')
  check(@CurrentUser() u: JwtPayload) {
    return this.connect.check(u.branchId);
  }

  @Post('whatsapp')
  whatsapp(@CurrentUser() u: JwtPayload) {
    return this.connect.subscribeWhatsApp(u.branchId, u);
  }
}

// ─── Comments and complaints ─────────────────────────────────────────────────

@Controller('chatbot')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class SocialAdminController {
  constructor(
    private readonly comments: CommentService,
    private readonly complaints: ComplaintService,
    private readonly admin: ChatbotAdminService,
  ) {}

  @Get('comments')
  listComments(@CurrentUser() u: JwtPayload, @Query('filter') filter?: string) {
    return this.comments.list(u.branchId, filter);
  }

  @Post('comments/:id/approve')
  approve(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { publicReply?: string | null; privateReply?: string | null }) {
    return this.comments.approve(u.branchId, id, body ?? {}, u);
  }

  @Post('comments/:id/reply')
  replyComment(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { text: string }) {
    return this.comments.reply(u.branchId, id, body?.text, u);
  }

  @Post('comments/:id/private')
  privateMessage(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { text: string }) {
    return this.comments.privateMessage(u.branchId, id, body?.text, u);
  }

  @Post('comments/:id/like')
  like(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.comments.like(u.branchId, id, u);
  }

  @Post('comments/:id/hide')
  hide(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { hidden?: boolean }) {
    return this.comments.setHidden(u.branchId, id, body?.hidden !== false, u);
  }

  @Post('comments/:id/dismiss')
  dismiss(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.comments.dismiss(u.branchId, id, u);
  }

  @Get('complaints')
  listComplaints(@CurrentUser() u: JwtPayload, @Query('status') status?: string, @Query('level') level?: string) {
    return this.complaints.list(u.branchId, { status, level });
  }

  @Get('complaints/:id')
  openComplaint(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.complaints.open(u.branchId, id);
  }

  @Patch('complaints/:id')
  updateComplaint(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { status?: ComplaintStatus; notes?: string | null; outcome?: string | null }) {
    return this.complaints.update(u.branchId, id, body ?? {}, u);
  }

  /** Sends the (edited) reply where the complaint came from: under the comment, or in the chat. */
  @Post('complaints/:id/reply')
  async replyComplaint(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { publicReply?: string | null; privateReply?: string | null; text?: string }) {
    const c = await this.complaints.get(u.branchId, id);
    if (c.source === 'COMMENT' && c.commentId) {
      const comment = await this.comments.findByCommentId(u.branchId, c.commentId);
      await this.comments.approve(u.branchId, comment.id, { publicReply: body?.publicReply, privateReply: body?.privateReply }, u);
    } else if (c.conversationId) {
      if (!body?.text?.trim()) throw new BadRequestException('Write a reply first');
      await this.admin.staffReply(u.branchId, c.conversationId, body.text, u);
    } else {
      throw new BadRequestException('There is nowhere to reply to');
    }
    await this.complaints.markResponded(id, u);
    return this.complaints.open(u.branchId, id);
  }
}
