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
      throw new BadRequestException(`WhatsApp API: ${msg}`);
    }

    return json;
  }
}
