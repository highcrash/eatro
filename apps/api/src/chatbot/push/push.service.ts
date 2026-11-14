import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';

import { PrismaService } from '../../prisma/prisma.service';
import { decryptSecret, encryptSecret, secretsKey } from '../secrets';

export interface PushNote {
  title: string;
  /** Who and why only: never the customer's message, it shows on a lock screen. */
  body: string;
  /** Path inside the staff app to open on tap, e.g. /chat/abc. */
  url: string;
  /** Same tag replaces the earlier notification instead of stacking. */
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The actual sending, kept separate so tests can replace it. */
@Injectable()
export class WebPushSender {
  async send(target: PushTarget, payload: string, vapid: { subject: string; publicKey: string; privateKey: string }): Promise<{ statusCode: number }> {
    try {
      const res = await webpush.sendNotification(target, payload, { vapidDetails: vapid, TTL: 6 * 3600, urgency: 'high' });
      return { statusCode: res.statusCode };
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) return { statusCode };
      throw err;
    }
  }

  generateKeys(): { publicKey: string; privateKey: string } {
    return webpush.generateVAPIDKeys();
  }
}

/** One notification per chat in this window, however often it is flagged. */
const QUIET_MS = 5 * 60_000;

/**
 * Notifications for the staff chat app (chat.eatrobd.com) when the bot needs
 * a person: a handoff, a complaint, a reply waiting for approval, a comment.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly lastSent = new Map<string, number>();
  private keys: { publicKey: string; privateKey: string } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: ConfigService,
    private readonly sender: WebPushSender,
  ) {}

  private key() {
    return secretsKey({ SECRETS_KEY: this.env.get<string>('SECRETS_KEY'), JWT_SECRET: this.env.get<string>('JWT_SECRET') });
  }

  /** VAPID keys, made and stored (private key encrypted) on first use. */
  async vapid(): Promise<{ publicKey: string; privateKey: string }> {
    if (this.keys) return this.keys;
    let row = await this.prisma.pushKeys.findUnique({ where: { id: 'default' } });
    if (!row) {
      const fresh = this.sender.generateKeys();
      try {
        row = await this.prisma.pushKeys.create({ data: { id: 'default', publicKey: fresh.publicKey, privateKeyEnc: encryptSecret(fresh.privateKey, this.key()) } });
      } catch {
        // Another request made them first.
        row = await this.prisma.pushKeys.findUniqueOrThrow({ where: { id: 'default' } });
      }
    }
    const privateKey = decryptSecret(row.privateKeyEnc, this.key());
    if (!privateKey) throw new Error('Push keys cannot be read; the server secret has changed');
    this.keys = { publicKey: row.publicKey, privateKey };
    return this.keys;
  }

  async publicKey(): Promise<string> {
    return (await this.vapid()).publicKey;
  }

  async subscribe(user: { sub: string; branchId: string }, target: PushTarget, userAgent: string | null) {
    const data = { staffId: user.sub, branchId: user.branchId, p256dh: target.keys.p256dh, auth: target.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null };
    await this.prisma.staffPushSubscription.upsert({ where: { endpoint: target.endpoint }, create: { endpoint: target.endpoint, ...data }, update: data });
    return { ok: true };
  }

  async unsubscribe(user: { sub: string }, endpoint: string) {
    await this.prisma.staffPushSubscription.deleteMany({ where: { endpoint, staffId: user.sub } });
    return { ok: true };
  }

  /** Sends to one staff member's devices; used by the app's "Send test" button. */
  async test(user: { sub: string }) {
    const subs = await this.prisma.staffPushSubscription.findMany({ where: { staffId: user.sub } });
    const sent = await this.deliver(subs, { title: 'EATRO Staff Chat', body: 'Notifications are working.', url: '/', tag: 'test' });
    return { devices: subs.length, sent };
  }

  /**
   * Notify every subscribed staff member of the branch who can handle chats.
   * `quietKey` (usually the conversation id) limits it to one per 5 minutes.
   * Never throws: a failed notification must not break a customer reply.
   */
  async notifyBranch(branchId: string, note: PushNote, quietKey?: string): Promise<number> {
    try {
      if (quietKey) {
        const last = this.lastSent.get(quietKey);
        if (last && Date.now() - last < QUIET_MS) return 0;
        this.lastSent.set(quietKey, Date.now());
        if (this.lastSent.size > 5000) this.lastSent.clear();
      }
      const subs = await this.prisma.staffPushSubscription.findMany({ where: { branchId } });
      if (subs.length === 0) return 0;
      const staff = await this.prisma.staff.findMany({
        where: { id: { in: [...new Set(subs.map((s) => s.staffId))] }, isActive: true, deletedAt: null, OR: [{ role: { in: ['OWNER', 'MANAGER'] } }, { canHandleChats: true }] },
        select: { id: true },
      });
      const allowed = new Set(staff.map((s) => s.id));
      return await this.deliver(subs.filter((s) => allowed.has(s.staffId)), note);
    } catch (err) {
      this.logger.warn(`Push failed: ${(err as Error).message}`);
      return 0;
    }
  }

  private async deliver(subs: { id: string; endpoint: string; p256dh: string; auth: string }[], note: PushNote): Promise<number> {
    if (subs.length === 0) return 0;
    const keys = await this.vapid();
    const vapid = { subject: (this.env.get<string>('PUBLIC_SITE_URL') ?? 'https://eatrobd.com').replace(/\/+$/, ''), ...keys };
    const payload = JSON.stringify(note);
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          const { statusCode } = await this.sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, vapid);
          if (statusCode === 404 || statusCode === 410) {
            // The phone unsubscribed or the app was removed.
            await this.prisma.staffPushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
          } else if (statusCode >= 200 && statusCode < 300) {
            sent += 1;
            await this.prisma.staffPushSubscription.update({ where: { id: s.id }, data: { lastOkAt: new Date() } }).catch(() => undefined);
          } else {
            this.logger.warn(`Push to a staff device answered HTTP ${statusCode}`);
          }
        } catch (err) {
          this.logger.warn(`Push to a staff device failed: ${(err as Error).message}`);
        }
      }),
    );
    return sent;
  }
}
