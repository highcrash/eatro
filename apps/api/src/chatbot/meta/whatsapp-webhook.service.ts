import { Injectable, Logger } from '@nestjs/common';

import { normalizePhone } from '../../customer/customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import type { AiImage, AiImageMediaType } from '../ai/ai.types';
import { ChatbotService } from '../chatbot.service';

interface WaMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  context?: { referred_product?: unknown };
}
export interface WhatsAppWebhookBody {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: WaMessage[];
        statuses?: unknown[];
      };
    }[];
  }[];
}

const MAX_PHOTO_BYTES = 4_500_000;
const UNSUPPORTED = ['location', 'contacts', 'document', 'video', 'order', 'unsupported'];

/** WhatsApp Cloud API events: customer messages become chats; delivery statuses are ignored. */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsApp: WhatsAppService,
    private readonly chatbot: ChatbotService,
  ) {}

  async process(body: WhatsAppWebhookBody): Promise<void> {
    if (body.object !== 'whatsapp_business_account') return;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const v = change.value ?? {};
        const phoneNumberId = v.metadata?.phone_number_id;
        if (!phoneNumberId || !v.messages?.length) continue;
        const bs = await this.prisma.branchSetting.findFirst({ where: { whatsappPhoneNumberId: phoneNumberId }, select: { branchId: true, whatsappAccessToken: true } });
        if (!bs) {
          this.logger.warn(`WhatsApp event for unknown number ${phoneNumberId}`);
          continue;
        }
        await this.prisma.metaAppSetting.updateMany({ where: { branchId: bs.branchId }, data: { lastWebhookAt: new Date() } });
        for (const m of v.messages) {
          const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
          await this.onMessage(bs.branchId, bs.whatsappAccessToken, m, name).catch((err: Error) => this.logger.warn(`WhatsApp message failed: ${err.message}`));
        }
      }
    }
  }

  private async onMessage(branchId: string, token: string | null, m: WaMessage, name: string | null) {
    if (!m.from || !m.id) return;
    if (m.type === 'reaction' || m.type === 'sticker' || m.type === 'system') return;

    let text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
    let image: AiImage | null = null;
    let hasPhoto = false;
    if (m.type === 'image') {
      hasPhoto = true;
      text = m.image?.caption ?? '';
      const settings = await this.chatbot.getSettings(branchId);
      if (settings.visionEnabled && m.image?.id && token) {
        const file = await this.whatsApp.downloadMedia({ mediaId: m.image.id, accessToken: token.trim(), maxBytes: MAX_PHOTO_BYTES }).catch(() => null);
        if (file) {
          const type = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimeType) ? file.mimeType : 'image/jpeg') as AiImageMediaType;
          image = { mediaType: type, data: file.data.toString('base64') };
        }
      }
    }

    await this.chatbot.handleIncoming({
      branchId,
      channel: 'WHATSAPP',
      externalUserId: m.from,
      text,
      image,
      hasPhoto: hasPhoto && !image,
      voice: m.type === 'audio',
      unsupported: UNSUPPORTED.includes(m.type ?? ''),
      externalId: m.id,
      customerName: name,
      knownPhone: normalizePhone(m.from),
    });
  }
}
