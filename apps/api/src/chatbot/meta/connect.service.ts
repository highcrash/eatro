import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import type { JwtPayload } from '@restora/types';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { ActivityLogService } from '../../activity-log/activity-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../secrets';
import { MetaAccountService } from './meta-account.service';
import { LOGIN_SCOPES, MetaClient, MetaError, PageAccount } from './meta.client';

const STATE_MINUTES = 15;
const REQUIRED_PAGE_FIELDS = ['messages', 'message_echoes', 'feed'];

export interface HealthItem { key: string; label: string; ok: boolean; detail: string | null }

/**
 * The admin "Connect" wizard: the owner pastes the Meta app id and secret,
 * clicks Connect with Facebook, and this sets up the webhooks, the Page
 * token and the Instagram link, then keeps checking they still work.
 */
@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: MetaAccountService,
    private readonly meta: MetaClient,
    private readonly activity: ActivityLogService,
  ) {}

  async status(branchId: string) {
    const app = await this.accounts.app(branchId);
    const bs = await this.prisma.branchSetting.findUnique({ where: { branchId }, select: { fbPageId: true, fbPageName: true, fbPageAccessToken: true } });
    const pending = Array.isArray(app.pendingPages) && app.pendingUntil && app.pendingUntil > new Date() ? (app.pendingPages as { id: string; name: string; igUsername: string | null }[]) : [];
    const granted = (app.grantedScopes as string[] | null) ?? [];
    return {
      appId: app.appId,
      appSecretSet: !!this.accounts.appSecret(app),
      appSecretUnreadable: !!app.appSecretEnc && !this.accounts.appSecret(app),
      verifyToken: app.verifyToken,
      webhookUrl: this.accounts.webhookUrl('meta'),
      whatsappWebhookUrl: this.accounts.webhookUrl('whatsapp'),
      redirectUri: this.accounts.redirectUri(),
      privacyUrl: 'https://eatrobd.com/privacy',
      dataDeletionUrl: 'https://eatrobd.com/data-deletion',
      page: bs?.fbPageId ? { id: bs.fbPageId, name: bs.fbPageName, tokenSet: !!bs.fbPageAccessToken } : null,
      instagram: app.igUserId ? { id: app.igUserId, username: app.igUsername } : null,
      grantedScopes: granted,
      missingScopes: LOGIN_SCOPES.filter((s) => !granted.includes(s)),
      appSubscribedAt: app.appSubscribedAt,
      pageSubscribedAt: app.pageSubscribedAt,
      lastWebhookAt: app.lastWebhookAt,
      lastError: app.lastError,
      health: (app.health as HealthItem[] | null) ?? [],
      healthCheckedAt: app.healthCheckedAt,
      pendingPages: pending.map((p) => ({ id: p.id, name: p.name, igUsername: p.igUsername })),
    };
  }

  /** Saves the app and tells Meta where to send events. Meta checks the webhook address straight away. */
  async saveApp(branchId: string, input: { appId?: string; appSecret?: string }, user: JwtPayload) {
    const appId = String(input.appId ?? '').trim();
    if (!/^\d{6,20}$/.test(appId)) throw new BadRequestException('The App ID is a long number from developers.facebook.com → your app → App settings → Basic');
    const app = await this.accounts.app(branchId);
    const data: Prisma.MetaAppSettingUpdateInput = { appId, lastError: null };
    if (input.appSecret?.trim()) {
      if (!/^[a-f0-9]{32}$/i.test(input.appSecret.trim())) throw new BadRequestException('The App Secret is 32 letters and numbers. Copy it again from App settings → Basic.');
      data.appSecretEnc = encryptSecret(input.appSecret.trim(), this.accounts.key());
    } else if (!this.accounts.appSecret(app)) {
      throw new BadRequestException('Paste the App Secret too');
    }
    const saved = await this.prisma.metaAppSetting.update({ where: { branchId }, data });
    void this.activity.log({ branchId, actor: user, category: 'SETTINGS', action: 'UPDATE', entityType: 'MetaAppSetting', entityId: saved.id, entityName: 'Meta app', summary: `Saved Meta app ${appId}${input.appSecret ? ' and secret' : ''}` });

    const secret = this.accounts.appSecret(saved)!;
    try {
      const url = this.accounts.webhookUrl('meta');
      await this.meta.subscribeApp(appId, secret, 'page', url, saved.verifyToken, ['messages', 'message_echoes', 'messaging_postbacks', 'feed']);
      await this.meta.subscribeApp(appId, secret, 'instagram', url, saved.verifyToken, ['messages', 'comments']);
      await this.prisma.metaAppSetting.update({ where: { branchId }, data: { appSubscribedAt: new Date() } });
    } catch (err) {
      const msg = (err as Error).message;
      await this.prisma.metaAppSetting.update({ where: { branchId }, data: { lastError: `Webhook setup: ${msg}` } });
      throw new BadRequestException(`Saved, but Meta did not accept the webhook yet: ${msg}`);
    }
    return this.status(branchId);
  }

  // ── Facebook Login ────────────────────────────────────────────────────────

  private signState(payload: string, secret: string) {
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  async startLogin(branchId: string, user: JwtPayload) {
    const app = await this.accounts.app(branchId);
    const secret = this.accounts.appSecret(app);
    if (!app.appId || !secret) throw new BadRequestException('Save the Meta App ID and App Secret first');
    const payload = [branchId, user.sub, Date.now() + STATE_MINUTES * 60_000, randomBytes(6).toString('base64url')].join('.');
    const state = `${payload}.${this.signState(payload, secret)}`;
    return { url: this.meta.loginUrl(app.appId, this.accounts.redirectUri(), state) };
  }

  /** Facebook sends the owner back here. Returns where to send the browser next. */
  async callback(code: string | undefined, state: string | undefined, error?: string): Promise<string> {
    const admin = `${this.accounts.adminUrl()}/chatbot?tab=connect`;
    const fail = (msg: string) => `${admin}&fb=error&msg=${encodeURIComponent(msg)}`;
    if (error) return fail('Facebook login was cancelled');
    const parts = (state ?? '').split('.');
    if (parts.length !== 5 || !code) return fail('The login link was incomplete. Try Connect with Facebook again.');
    const [branchId, staffId, exp, nonce, sig] = parts;
    const app = await this.prisma.metaAppSetting.findUnique({ where: { branchId } });
    const secret = app ? this.accounts.appSecret(app) : null;
    if (!app?.appId || !secret) return fail('The Meta app is not saved for this branch');
    const expected = Buffer.from(this.signState([branchId, staffId, exp, nonce].join('.'), secret));
    if (expected.length !== Buffer.from(sig).length || !timingSafeEqual(expected, Buffer.from(sig)) || Number(exp) < Date.now()) {
      return fail('The login link expired. Try Connect with Facebook again.');
    }
    const actor = { sub: staffId, role: 'OWNER' };
    try {
      const userToken = await this.meta.exchangeCode(app.appId, secret, this.accounts.redirectUri(), code);
      const [pages, scopes] = await Promise.all([this.meta.pages(userToken), this.meta.grantedScopes(userToken)]);
      await this.prisma.metaAppSetting.update({ where: { branchId }, data: { grantedScopes: scopes } });
      if (pages.length === 0) return fail('No Facebook Page was shared. Run Connect again and tick the EATRO Page.');
      if (pages.length === 1) {
        await this.finalize(branchId, pages[0], actor);
        return `${admin}&fb=ok`;
      }
      const key = this.accounts.key();
      await this.prisma.metaAppSetting.update({
        where: { branchId },
        data: {
          pendingPages: pages.map((p) => ({ ...p, accessToken: encryptSecret(p.accessToken, key) })) as unknown as Prisma.InputJsonValue,
          pendingUntil: new Date(Date.now() + STATE_MINUTES * 60_000),
        },
      });
      return `${admin}&fb=pick`;
    } catch (err) {
      this.logger.warn(`Facebook connect failed: ${(err as Error).message}`);
      return fail((err as Error).message);
    }
  }

  async pickPage(branchId: string, pageId: string, user: JwtPayload) {
    const app = await this.accounts.app(branchId);
    const pending = Array.isArray(app.pendingPages) && app.pendingUntil && app.pendingUntil > new Date() ? (app.pendingPages as unknown as PageAccount[]) : [];
    const page = pending.find((p) => p.id === pageId);
    if (!page) throw new BadRequestException('That choice expired. Click Connect with Facebook again.');
    const token = decryptSecret(page.accessToken, this.accounts.key());
    if (!token) throw new BadRequestException('That choice expired. Click Connect with Facebook again.');
    await this.finalize(branchId, { ...page, accessToken: token }, user);
    return this.status(branchId);
  }

  private async finalize(branchId: string, page: PageAccount, actor: JwtPayload | { sub: string; role: string }) {
    await this.prisma.branchSetting.upsert({
      where: { branchId },
      create: { branchId, fbPageId: page.id, fbPageName: page.name, fbPageAccessToken: page.accessToken },
      update: { fbPageId: page.id, fbPageName: page.name, fbPageAccessToken: page.accessToken },
    });
    await this.prisma.metaAppSetting.update({
      where: { branchId },
      data: { igUserId: page.igUserId, igUsername: page.igUsername, pendingPages: [], pendingUntil: null, lastError: null },
    });
    try {
      await this.meta.subscribePage({ pageId: page.id, pageToken: page.accessToken });
      await this.prisma.metaAppSetting.update({ where: { branchId }, data: { pageSubscribedAt: new Date() } });
    } catch (err) {
      await this.prisma.metaAppSetting.update({ where: { branchId }, data: { lastError: `Page subscription: ${(err as Error).message}` } });
    }
    void this.activity.log({ branchId, actor, category: 'SETTINGS', action: 'UPDATE', entityType: 'MetaAppSetting', entityId: page.id, entityName: page.name, summary: `Connected Facebook Page ${page.name}${page.igUsername ? ` and Instagram @${page.igUsername}` : ''} to the chat assistant` });
    await this.check(branchId);
  }

  // ── Health ────────────────────────────────────────────────────────────────

  async check(branchId: string) {
    const app = await this.accounts.app(branchId);
    const secret = this.accounts.appSecret(app);
    const auth = await this.accounts.auth(branchId);
    const items: HealthItem[] = [];
    const add = (key: string, label: string, ok: boolean, detail: string | null = null) => items.push({ key, label, ok, detail });

    add('app', 'Meta app saved', !!app.appId && !!secret, !app.appId ? 'Paste the App ID' : !secret ? 'Paste the App Secret' : null);
    add('webhook', 'Webhook registered with Meta', !!app.appSubscribedAt, app.appSubscribedAt ? null : 'Save the app again to register it');
    add('page', 'Facebook Page connected', !!auth, auth ? null : 'Click Connect with Facebook');
    if (auth && app.appId && secret) {
      try {
        const t = await this.meta.debugToken(app.appId, secret, auth.pageToken);
        add('token', 'Page token valid', t.valid, t.valid ? (t.expiresAt ? `Expires ${new Date(t.expiresAt * 1000).toISOString().slice(0, 10)}` : 'Does not expire') : 'Reconnect with Facebook');
        const missing = LOGIN_SCOPES.filter((s) => !t.scopes.includes(s));
        add('scopes', 'Permissions granted', missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : null);
        await this.prisma.metaAppSetting.update({ where: { branchId }, data: { grantedScopes: t.scopes } });
      } catch (err) {
        add('token', 'Page token valid', false, err instanceof MetaError && err.needsReconnect ? 'Reconnect with Facebook' : (err as Error).message);
      }
      try {
        const fields = await this.meta.pageSubscriptions(auth);
        const missing = REQUIRED_PAGE_FIELDS.filter((f) => !fields.includes(f));
        add('subscription', 'Page sends messages and comments to the assistant', missing.length === 0, missing.length ? `Not subscribed: ${missing.join(', ')}. Reconnect with Facebook.` : null);
      } catch (err) {
        add('subscription', 'Page sends messages and comments to the assistant', false, (err as Error).message);
      }
    }
    add('instagram', 'Instagram account linked', !!app.igUserId, app.igUserId ? `@${app.igUsername ?? app.igUserId}` : 'Link a professional Instagram account to the Page, then reconnect');
    add('received', 'Messages arriving', !!app.lastWebhookAt, app.lastWebhookAt ? `Last event ${app.lastWebhookAt.toISOString().replace('T', ' ').slice(0, 16)} UTC` : 'Nothing received yet. Send a test message to the Page.');

    await this.prisma.metaAppSetting.update({ where: { branchId }, data: { health: items as unknown as Prisma.InputJsonValue, healthCheckedAt: new Date() } });
    return this.status(branchId);
  }

  @Cron('0 15 * * * *')
  async hourly() {
    const apps = await this.prisma.metaAppSetting.findMany({ where: { appId: { not: null } }, select: { branchId: true } });
    for (const a of apps) await this.check(a.branchId).catch((err: Error) => this.logger.debug(`Health check failed: ${err.message}`));
  }
}
