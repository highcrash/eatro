import { Injectable, Logger } from '@nestjs/common';

import type { MenuCard } from '../menu-context';

export const GRAPH = 'https://graph.facebook.com/v21.0';

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
    readonly status?: number,
  ) {
    super(message);
  }
  /** Token expired, revoked or missing a permission: the owner has to reconnect. */
  get needsReconnect() {
    return this.code === 190 || this.code === 102 || this.code === 10 || this.code === 200;
  }
}

/** Page access token, app id and secret for one branch. */
export interface MetaAuth {
  pageId: string;
  pageToken: string;
}

export type Recipient = { id: string } | { comment_id: string };

export interface PageAccount {
  id: string;
  name: string;
  accessToken: string;
  igUserId: string | null;
  igUsername: string | null;
}

const PAGE_FIELDS = ['messages', 'message_echoes', 'messaging_postbacks', 'feed'];
export const LOGIN_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_manage_comments',
  'business_management',
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Messenger allows 2,000 characters per message; split long replies on paragraph or sentence breaks. */
export function splitMessage(text: string, max = 2000): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const cut = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
    const at = cut > max * 0.5 ? cut + 1 : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Dish cards as a Messenger / Instagram generic template (max 10 cards). */
export function cardsTemplate(cards: MenuCard[], bookUrl: string) {
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: cards.slice(0, 10).map((c) => ({
          title: clip(c.name, 80),
          subtitle: clip(`৳${c.price.toLocaleString('en-US')}${c.wasPrice != null ? ` (regular ৳${c.wasPrice.toLocaleString('en-US')})` : ''}`, 80),
          ...(c.imageUrl && /^https:\/\//.test(c.imageUrl) ? { image_url: c.imageUrl } : {}),
          default_action: { type: 'web_url', url: c.url },
          buttons: [
            { type: 'web_url', url: c.url, title: 'View dish' },
            { type: 'web_url', url: bookUrl, title: 'Book a table' },
          ],
        })),
      },
    },
  };
}

/**
 * Graph API calls for the chat assistant. Stateless: every call takes the
 * token it needs, like the WhatsApp and Facebook auto-post clients.
 */
@Injectable()
export class MetaClient {
  private readonly logger = new Logger(MetaClient.name);

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, token: string | null, params: Record<string, unknown> = {}): Promise<T> {
    const url = new URL(path.startsWith('http') ? path : `${GRAPH}/${path.replace(/^\//, '')}`);
    let body: string | undefined;
    if (method === 'GET' || method === 'DELETE') {
      for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      if (token) url.searchParams.set('access_token', token);
    } else {
      body = JSON.stringify(token ? { ...params, access_token: token } : params);
    }
    let res: Response;
    try {
      res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new MetaError(`Could not reach Facebook: ${(err as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number } } & T;
    if (!res.ok || json.error) {
      const e = json.error ?? {};
      this.logger.warn(`Graph ${method} ${url.pathname} failed: ${e.message ?? res.status}`);
      throw new MetaError(e.message ?? `Facebook returned HTTP ${res.status}`, e.code, e.error_subcode, res.status);
    }
    return json;
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  /** Messenger and Instagram both send through the Page's /messages endpoint with the Page token. */
  async sendText(auth: MetaAuth, recipient: Recipient, text: string): Promise<string[]> {
    const ids: string[] = [];
    for (const part of splitMessage(text)) {
      const r = await this.call<{ message_id?: string }>('POST', `${auth.pageId}/messages`, auth.pageToken, {
        recipient,
        messaging_type: 'RESPONSE',
        message: { text: part },
      });
      if (r.message_id) ids.push(r.message_id);
      // A private reply to a comment can only be sent once; later parts go to the person directly.
      if ('comment_id' in recipient) break;
    }
    return ids;
  }

  async sendCards(auth: MetaAuth, recipient: { id: string }, cards: MenuCard[], bookUrl: string): Promise<void> {
    if (cards.length === 0) return;
    await this.call('POST', `${auth.pageId}/messages`, auth.pageToken, { recipient, messaging_type: 'RESPONSE', message: cardsTemplate(cards, bookUrl) });
  }

  async userName(auth: MetaAuth, userId: string, platform: 'FACEBOOK' | 'INSTAGRAM'): Promise<string | null> {
    try {
      const r = await this.call<{ name?: string; first_name?: string; last_name?: string; username?: string }>('GET', userId, auth.pageToken, {
        fields: platform === 'INSTAGRAM' ? 'name,username' : 'first_name,last_name',
      });
      return r.name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || null;
    } catch {
      return null;
    }
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async replyToComment(auth: MetaAuth, platform: 'FACEBOOK' | 'INSTAGRAM', commentId: string, message: string): Promise<string | null> {
    const r = await this.call<{ id?: string }>('POST', platform === 'INSTAGRAM' ? `${commentId}/replies` : `${commentId}/comments`, auth.pageToken, { message });
    return r.id ?? null;
  }

  async likeComment(auth: MetaAuth, commentId: string): Promise<void> {
    await this.call('POST', `${commentId}/likes`, auth.pageToken);
  }

  async setHidden(auth: MetaAuth, platform: 'FACEBOOK' | 'INSTAGRAM', commentId: string, hidden: boolean): Promise<void> {
    await this.call('POST', commentId, auth.pageToken, platform === 'INSTAGRAM' ? { hide: hidden } : { is_hidden: hidden });
  }

  /** Caption and link of a Page post or Instagram media. */
  async postDetails(auth: MetaAuth, platform: 'FACEBOOK' | 'INSTAGRAM', postId: string): Promise<{ caption: string | null; permalink: string | null }> {
    if (platform === 'INSTAGRAM') {
      const r = await this.call<{ caption?: string; permalink?: string }>('GET', postId, auth.pageToken, { fields: 'caption,permalink' });
      return { caption: r.caption ?? null, permalink: r.permalink ?? null };
    }
    const r = await this.call<{ message?: string; permalink_url?: string }>('GET', postId, auth.pageToken, { fields: 'message,permalink_url' });
    return { caption: r.message ?? null, permalink: r.permalink_url ?? null };
  }

  /** Recent comments on recent posts, for the catch-up check. */
  async recentComments(auth: MetaAuth, igUserId: string | null) {
    const out: { platform: 'FACEBOOK' | 'INSTAGRAM'; postId: string; commentId: string; parentId: string | null; authorId: string | null; authorName: string | null; text: string; at: string }[] = [];
    const fb = await this.call<{ data?: { id: string; comments?: { data?: { id: string; message?: string; created_time?: string; from?: { id?: string; name?: string }; parent?: { id: string } }[] } }[] }>(
      'GET', `${auth.pageId}/feed`, auth.pageToken,
      { fields: 'id,comments.order(reverse_chronological).limit(25){id,message,created_time,from,parent}', limit: 10 },
    );
    for (const post of fb.data ?? []) {
      for (const c of post.comments?.data ?? []) {
        out.push({ platform: 'FACEBOOK', postId: post.id, commentId: c.id, parentId: c.parent?.id ?? null, authorId: c.from?.id ?? null, authorName: c.from?.name ?? null, text: c.message ?? '', at: c.created_time ?? '' });
      }
    }
    if (igUserId) {
      const ig = await this.call<{ data?: { id: string; comments?: { data?: { id: string; text?: string; timestamp?: string; username?: string; from?: { id?: string; username?: string } }[] } }[] }>(
        'GET', `${igUserId}/media`, auth.pageToken,
        { fields: 'id,comments.limit(25){id,text,timestamp,username,from}', limit: 10 },
      );
      for (const media of ig.data ?? []) {
        for (const c of media.comments?.data ?? []) {
          out.push({ platform: 'INSTAGRAM', postId: media.id, commentId: c.id, parentId: null, authorId: c.from?.id ?? null, authorName: c.from?.username ?? c.username ?? null, text: c.text ?? '', at: c.timestamp ?? '' });
        }
      }
    }
    return out;
  }

  // ── Facebook Login and setup ──────────────────────────────────────────────

  loginUrl(appId: string, redirectUri: string, state: string): string {
    const u = new URL('https://www.facebook.com/v21.0/dialog/oauth');
    u.searchParams.set('client_id', appId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', LOGIN_SCOPES.join(','));
    return u.toString();
  }

  /** Code → long-lived user token. Page tokens derived from it don't expire. */
  async exchangeCode(appId: string, appSecret: string, redirectUri: string, code: string): Promise<string> {
    const short = await this.call<{ access_token: string }>('GET', 'oauth/access_token', null, { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
    const long = await this.call<{ access_token: string }>('GET', 'oauth/access_token', null, {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: short.access_token,
    });
    return long.access_token;
  }

  async pages(userToken: string): Promise<PageAccount[]> {
    const r = await this.call<{ data?: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>(
      'GET', 'me/accounts', userToken, { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: 100 },
    );
    return (r.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      accessToken: p.access_token,
      igUserId: p.instagram_business_account?.id ?? null,
      igUsername: p.instagram_business_account?.username ?? null,
    }));
  }

  async grantedScopes(userToken: string): Promise<string[]> {
    const r = await this.call<{ data?: { permission: string; status: string }[] }>('GET', 'me/permissions', userToken);
    return (r.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission);
  }

  /** Tells Meta where to send events for this app. Meta calls the verify endpoint straight away. */
  async subscribeApp(appId: string, appSecret: string, object: 'page' | 'instagram' | 'whatsapp_business_account', callbackUrl: string, verifyToken: string, fields: string[]) {
    await this.call('POST', `${appId}/subscriptions`, `${appId}|${appSecret}`, { object, callback_url: callbackUrl, verify_token: verifyToken, fields: fields.join(','), include_values: true });
  }

  async subscribePage(auth: MetaAuth) {
    await this.call('POST', `${auth.pageId}/subscribed_apps`, auth.pageToken, { subscribed_fields: PAGE_FIELDS.join(',') });
  }

  async pageSubscriptions(auth: MetaAuth): Promise<string[]> {
    const r = await this.call<{ data?: { subscribed_fields?: string[] }[] }>('GET', `${auth.pageId}/subscribed_apps`, auth.pageToken);
    return r.data?.[0]?.subscribed_fields ?? [];
  }

  async debugToken(appId: string, appSecret: string, token: string): Promise<{ valid: boolean; expiresAt: number | null; scopes: string[] }> {
    const r = await this.call<{ data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] } }>('GET', 'debug_token', `${appId}|${appSecret}`, { input_token: token });
    return { valid: !!r.data?.is_valid, expiresAt: r.data?.expires_at || null, scopes: r.data?.scopes ?? [] };
  }
}
