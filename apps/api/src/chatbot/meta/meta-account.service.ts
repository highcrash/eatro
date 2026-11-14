import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { decryptSecret, secretsKey } from '../secrets';
import type { MetaAuth } from './meta.client';

export interface BranchMeta extends MetaAuth {
  branchId: string;
  igUserId: string | null;
  appId: string | null;
}

/** Where a branch's Meta connection lives: Page id/token in BranchSetting, the app and Instagram in MetaAppSetting. */
@Injectable()
export class MetaAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: ConfigService,
  ) {}

  key() {
    return secretsKey({ SECRETS_KEY: this.env.get<string>('SECRETS_KEY'), JWT_SECRET: this.env.get<string>('JWT_SECRET') });
  }

  apiBaseUrl() {
    return (this.env.get<string>('PUBLIC_API_URL') ?? 'https://api.eatrobd.com').replace(/\/+$/, '');
  }

  adminUrl() {
    return (this.env.get<string>('ADMIN_URL') ?? 'https://admin.eatrobd.com').replace(/\/+$/, '');
  }

  webhookUrl(kind: 'meta' | 'whatsapp') {
    return `${this.apiBaseUrl()}/api/v1/chatbot/webhook/${kind}`;
  }

  redirectUri() {
    return `${this.apiBaseUrl()}/api/v1/chatbot/connect/facebook/callback`;
  }

  async app(branchId: string) {
    const existing = await this.prisma.metaAppSetting.findUnique({ where: { branchId } });
    if (existing) return existing;
    return this.prisma.metaAppSetting.upsert({ where: { branchId }, create: { branchId, verifyToken: randomBytes(18).toString('base64url') }, update: {} });
  }

  appSecret(setting: { appSecretEnc: string | null }): string | null {
    return setting.appSecretEnc ? decryptSecret(setting.appSecretEnc, this.key()) : null;
  }

  async auth(branchId: string): Promise<BranchMeta | null> {
    const [bs, app] = await Promise.all([
      this.prisma.branchSetting.findUnique({ where: { branchId }, select: { fbPageId: true, fbPageAccessToken: true } }),
      this.prisma.metaAppSetting.findUnique({ where: { branchId } }),
    ]);
    if (!bs?.fbPageId || !bs.fbPageAccessToken) return null;
    return { branchId, pageId: bs.fbPageId, pageToken: bs.fbPageAccessToken, igUserId: app?.igUserId ?? null, appId: app?.appId ?? null };
  }

  /** The branch a webhook entry belongs to: entry.id is the Page id (Messenger, feed) or the Instagram account id. */
  async branchForEntry(object: 'page' | 'instagram', entryId: string): Promise<string | null> {
    if (object === 'instagram') {
      const app = await this.prisma.metaAppSetting.findFirst({ where: { igUserId: entryId }, select: { branchId: true } });
      if (app) return app.branchId;
    }
    const bs = await this.prisma.branchSetting.findFirst({ where: { fbPageId: entryId }, select: { branchId: true } });
    return bs?.branchId ?? null;
  }

  /** Every app secret on file, for checking webhook signatures. Usually one. */
  async allAppSecrets(): Promise<string[]> {
    const rows = await this.prisma.metaAppSetting.findMany({ where: { appSecretEnc: { not: null } }, select: { appSecretEnc: true } });
    return rows.map((r) => this.appSecret(r)).filter((s): s is string => !!s);
  }

  async verifyTokens(): Promise<string[]> {
    const rows = await this.prisma.metaAppSetting.findMany({ select: { verifyToken: true } });
    return rows.map((r) => r.verifyToken);
  }
}
