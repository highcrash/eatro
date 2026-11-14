import { Injectable, Logger, BadRequestException } from '@nestjs/common';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Thin native-fetch wrapper around the Meta WhatsApp Cloud API. Stateless
 * — every call takes phoneNumberId + accessToken so the same singleton can
 * serve every branch's per-tenant credentials.
 *
 * Mirrors the shape of `apps/api/src/sms/sms.service.ts` (native fetch, no
 * axios) and `apps/api/src/tipsoi/tipsoi.client.ts` (stateless wrapper).
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  /**
   * Upload a PDF (or any media) to Meta. Returns the mediaId that
   * `sendDocumentTemplate` references in its document-header param.
   *
   * Endpoint: POST /{phone-id}/media
   * Multipart body: messaging_product=whatsapp, type=<mime>, file=<binary>
   */
  async uploadMedia(opts: {
    phoneNumberId: string;
    accessToken: string;
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }): Promise<{ mediaId: string }> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', opts.mimeType);
    // `Blob` works on Node 20+. The buffer needs to be wrapped in a Uint8Array
    // copy because passing the raw Buffer to Blob can attach the underlying
    // ArrayBuffer pool and corrupt subsequent calls in the same tick.
    const fileBlob = new Blob([new Uint8Array(opts.buffer)], { type: opts.mimeType });
    form.append('file', fileBlob, opts.filename);

    const res = await fetch(`${GRAPH_BASE}/${opts.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      body: form,
    });

    const json = await this.parse(res);
    const id = (json as any)?.id;
    if (!id) throw new BadRequestException('Meta /media returned no id');
    return { mediaId: String(id) };
  }

  /**
   * Send a pre-approved template message with a document header.
   *
   * Endpoint: POST /{phone-id}/messages
   * Body: full template envelope per
   *   https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
   */
  async sendDocumentTemplate(opts: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    templateName: string;
    languageCode: string;
    bodyParams: string[];
    mediaId: string;
    documentFilename: string;
  }): Promise<{ messageId: string }> {
    const body = {
      messaging_product: 'whatsapp',
      to: opts.to,
      type: 'template',
      template: {
        name: opts.templateName,
        language: { code: opts.languageCode },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'document',
                document: { id: opts.mediaId, filename: opts.documentFilename },
              },
            ],
          },
          {
            type: 'body',
            parameters: opts.bodyParams.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    };

    const res = await fetch(`${GRAPH_BASE}/${opts.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await this.parse(res);
    const messageId = (json as any)?.messages?.[0]?.id;
    if (!messageId) throw new BadRequestException('Meta /messages returned no message id');
    return { messageId: String(messageId) };
  }

  /**
   * Health-check ping used by the Settings → "Test Connection" button.
   * GET /{phone-id} — returns the display phone number when the
   * credentials are valid.
   */
  async pingPhoneNumber(opts: {
    phoneNumberId: string;
    accessToken: string;
  }): Promise<{ displayPhoneNumber: string; verifiedName?: string }> {
    const res = await fetch(`${GRAPH_BASE}/${opts.phoneNumberId}?fields=display_phone_number,verified_name`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    });
    const json = (await this.parse(res)) as any;
    return {
      displayPhoneNumber: String(json.display_phone_number ?? ''),
      verifiedName: json.verified_name ? String(json.verified_name) : undefined,
    };
  }

  // ── Chat assistant (customer service messages) ────────────────────────────

  /** Free-form reply inside the 24-hour customer service window. */
  async sendText(opts: { phoneNumberId: string; accessToken: string; to: string; body: string }): Promise<{ messageId: string }> {
    const res = await fetch(`${GRAPH_BASE}/${opts.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: opts.to, type: 'text', text: { body: opts.body.slice(0, 4096), preview_url: true } }),
    });
    const json = (await this.parse(res)) as any;
    return { messageId: String(json?.messages?.[0]?.id ?? '') };
  }

  /** One photo with a caption (max 1,024 characters). */
  async sendImage(opts: { phoneNumberId: string; accessToken: string; to: string; link: string; caption: string }): Promise<{ messageId: string }> {
    const res = await fetch(`${GRAPH_BASE}/${opts.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: opts.to, type: 'image', image: { link: opts.link, caption: opts.caption.slice(0, 1024) } }),
    });
    const json = (await this.parse(res)) as any;
    return { messageId: String(json?.messages?.[0]?.id ?? '') };
  }

  /** Downloads a photo a customer sent. WhatsApp gives a media id; the file needs the token too. */
  async downloadMedia(opts: { mediaId: string; accessToken: string; maxBytes: number }): Promise<{ mimeType: string; data: Buffer } | null> {
    const meta = await fetch(`${GRAPH_BASE}/${opts.mediaId}`, { headers: { Authorization: `Bearer ${opts.accessToken}` } });
    const info = (await this.parse(meta)) as { url?: string; mime_type?: string; file_size?: number };
    if (!info?.url || (info.file_size && info.file_size > opts.maxBytes)) return null;
    const file = await fetch(info.url, { headers: { Authorization: `Bearer ${opts.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!file.ok) return null;
    const data = Buffer.from(await file.arrayBuffer());
    if (data.length > opts.maxBytes) return null;
    return { mimeType: info.mime_type ?? 'image/jpeg', data };
  }

  /** Tells the WhatsApp Business Account to send its events to our Meta app. */
  async subscribeWaba(opts: { wabaId: string; accessToken: string }): Promise<void> {
    const res = await fetch(`${GRAPH_BASE}/${opts.wabaId}/subscribed_apps`, { method: 'POST', headers: { Authorization: `Bearer ${opts.accessToken}` } });
    await this.parse(res);
  }

  async wabaSubscriptions(opts: { wabaId: string; accessToken: string }): Promise<string[]> {
    const res = await fetch(`${GRAPH_BASE}/${opts.wabaId}/subscribed_apps`, { headers: { Authorization: `Bearer ${opts.accessToken}` } });
    const json = (await this.parse(res)) as { data?: { whatsapp_business_api_data?: { id?: string; name?: string } }[] };
    return (json?.data ?? []).map((d) => String(d.whatsapp_business_api_data?.id ?? '')).filter(Boolean);
  }

  private async parse(res: Response): Promise<unknown> {
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text fallback */ }

    if (!res.ok) {
      const meta = json?.error;
      const detail = meta?.error_data?.details ?? meta?.error_user_msg;
      const msg = meta?.message
        ? `${meta.message}${detail ? ` — ${detail}` : ''}`
        : text || `Meta API HTTP ${res.status}`;
      this.logger.warn(`Meta API failed [${res.status}]: ${msg}`);
      // Resolve the WhatsApp-specific error code. Meta puts it in three
      // possible places and which one is populated varies by endpoint:
      //   1. error_subcode  — the most specific code (e.g. 132000/132001)
      //   2. (#NNNNNN) prefix in the message — present on every WA error
      //   3. error.code     — sometimes a parent group (e.g. 100), so we
      //                       only use it as a last resort
      // Without (2) we'd miss the fallback path because `code` is often
      // `100` instead of `132000`. Match the parens-prefix anywhere in
      // message so we recover the real subcode regardless of layout.
      const subFromMsg = /\(#(\d+)\)/.exec(String(meta?.message ?? ''))?.[1];
      const metaCode =
        Number(meta?.error_subcode ?? 0) ||
        Number(subFromMsg ?? 0) ||
        Number(meta?.code ?? 0);
      const ex = new BadRequestException(`WhatsApp API: ${msg}`) as BadRequestException & { metaCode?: number };
      ex.metaCode = metaCode;
      throw ex;
    }

    return json;
  }
}
