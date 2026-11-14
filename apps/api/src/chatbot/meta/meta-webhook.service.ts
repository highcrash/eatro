import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import type { AiImage, AiImageMediaType } from '../ai/ai.types';
import { ChatbotService } from '../chatbot.service';
import { CommentService } from '../comment.service';
import type { PostRef } from '../post-context.service';
import { MetaAccountService } from './meta-account.service';
import { MetaClient } from './meta.client';

/** Meta signs each webhook body with the app secret: `sha256=<hex hmac>`. */
export function validSignature(rawBody: Buffer | undefined, header: string | undefined, secrets: string[]): boolean {
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  return secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

interface Attachment { type?: string; payload?: { url?: string; title?: string; id?: string; ig_post_media_id?: string; sticker_id?: number } }
interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; app_id?: number | string; attachments?: Attachment[]; sticker_id?: number; is_deleted?: boolean; is_unsupported?: boolean; quick_reply?: { payload?: string } };
  postback?: { title?: string; payload?: string; mid?: string };
  reaction?: unknown;
  read?: unknown;
  delivery?: unknown;
}
interface Change { field?: string; value?: Record<string, unknown> }
export interface MetaWebhookBody { object?: string; entry?: { id?: string; time?: number; messaging?: MessagingEvent[]; changes?: Change[] }[] }

const MAX_PHOTO_BYTES = 4_500_000;

/**
 * Turns Meta's webhook events into chats and comments. Runs after the HTTP
 * response has gone back, so Meta never waits on the AI.
 */
@Injectable()
export class MetaWebhookService {
  private readonly logger = new Logger(MetaWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: MetaAccountService,
    private readonly meta: MetaClient,
    private readonly chatbot: ChatbotService,
    private readonly comments: CommentService,
  ) {}

  async process(body: MetaWebhookBody): Promise<void> {
    const object = body.object === 'instagram' ? 'instagram' : body.object === 'page' ? 'page' : null;
    if (!object) return;
    for (const entry of body.entry ?? []) {
      if (!entry.id) continue;
      const branchId = await this.accounts.branchForEntry(object, entry.id);
      if (!branchId) {
        this.logger.warn(`Webhook for unknown ${object} ${entry.id}`);
        continue;
      }
      await this.prisma.metaAppSetting.updateMany({ where: { branchId }, data: { lastWebhookAt: new Date() } });
      for (const ev of entry.messaging ?? []) {
        await this.onMessaging(branchId, object, entry.id, ev).catch((err: Error) => this.logger.warn(`Message event failed: ${err.message}`));
      }
      for (const ch of entry.changes ?? []) {
        await this.onChange(branchId, object, entry.id, ch).catch((err: Error) => this.logger.warn(`Change event failed: ${err.message}`));
      }
    }
  }

  private async onMessaging(branchId: string, object: 'page' | 'instagram', ownId: string, ev: MessagingEvent) {
    const channel = object === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';
    const msg = ev.message;
    if (ev.reaction || ev.read || ev.delivery || msg?.is_deleted) return;

    if (msg?.is_echo) {
      // Our own replies come back with our app id; anything else is staff typing in the Page inbox.
      const app = await this.prisma.metaAppSetting.findUnique({ where: { branchId }, select: { appId: true } });
      if (msg.app_id != null && app?.appId && String(msg.app_id) === app.appId) return;
      const customer = ev.recipient?.id;
      if (customer) await this.chatbot.recordStaffEcho(branchId, channel, customer, msg.text ?? '', msg.mid ?? null);
      return;
    }

    const from = ev.sender?.id;
    if (!from || from === ownId) return;

    let text = msg?.text ?? ev.postback?.title ?? '';
    let image: AiImage | null = null;
    let hasPhoto = false;
    let voice = false;
    let sharedPost: PostRef | null = null;
    for (const a of msg?.attachments ?? []) {
      const p = a.payload ?? {};
      if (a.type === 'image') {
        if (p.sticker_id != null) continue;
        hasPhoto = true;
        const settings = await this.chatbot.getSettings(branchId);
        if (settings.visionEnabled && p.url) image = await downloadImage(p.url).catch(() => null);
      } else if (a.type === 'audio') {
        voice = true;
      } else if (['share', 'ig_post', 'post', 'fallback', 'ig_reel', 'reel', 'template'].includes(a.type ?? '')) {
        sharedPost = { postId: p.ig_post_media_id ?? p.id ?? null, url: p.url ?? null, title: p.title ?? null };
      } else if (a.type === 'story_mention') {
        return; // a story mention is not a question; nothing to answer
      }
    }
    if (msg?.sticker_id != null && !text) return; // thumbs-up and stickers
    if (!text && !hasPhoto && !voice && !sharedPost) {
      if (msg?.is_unsupported) text = '[a message type the assistant cannot read]';
      else return;
    }

    const existing = await this.prisma.chatConversation.findUnique({ where: { branchId_channel_externalUserId: { branchId, channel, externalUserId: from } }, select: { customerName: true } });
    let customerName: string | null = existing?.customerName ?? null;
    if (!existing) {
      const auth = await this.accounts.auth(branchId);
      if (auth) customerName = await this.meta.userName(auth, from, object === 'instagram' ? 'INSTAGRAM' : 'FACEBOOK');
    }

    await this.chatbot.handleIncoming({
      branchId,
      channel,
      externalUserId: from,
      text,
      image,
      hasPhoto: hasPhoto && !image,
      voice,
      sharedPost,
      externalId: msg?.mid ?? ev.postback?.mid ?? null,
      customerName,
    });
  }

  private async onChange(branchId: string, object: 'page' | 'instagram', ownId: string, ch: Change) {
    const v = ch.value ?? {};
    if (object === 'page' && ch.field === 'feed') {
      if (v.item !== 'comment' || v.verb !== 'add') return;
      const fromId = (v.from as { id?: string } | undefined)?.id ?? null;
      if (fromId === ownId) return;
      await this.comments.handle({
        branchId,
        platform: 'FACEBOOK',
        postId: String(v.post_id ?? ''),
        commentId: String(v.comment_id ?? ''),
        parentCommentId: v.parent_id ? String(v.parent_id) : null,
        authorId: fromId,
        authorName: (v.from as { name?: string } | undefined)?.name ?? null,
        text: String(v.message ?? ''),
        commentedAt: typeof v.created_time === 'number' ? new Date(v.created_time * 1000) : new Date(),
      });
      return;
    }
    if (object === 'instagram' && ch.field === 'comments') {
      const from = v.from as { id?: string; username?: string } | undefined;
      if (from?.id === ownId) return;
      await this.comments.handle({
        branchId,
        platform: 'INSTAGRAM',
        postId: String((v.media as { id?: string } | undefined)?.id ?? ''),
        commentId: String(v.id ?? ''),
        parentCommentId: v.parent_id ? String(v.parent_id) : null,
        authorId: from?.id ?? null,
        authorName: from?.username ?? null,
        text: String(v.text ?? ''),
      });
    }
  }
}

async function downloadImage(url: string): Promise<AiImage | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PHOTO_BYTES) return null;
  const mediaType = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type) ? type : 'image/jpeg') as AiImageMediaType;
  return { mediaType, data: buf.toString('base64') };
}
