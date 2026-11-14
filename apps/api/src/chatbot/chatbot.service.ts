import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ChatChannel, ChatConversation, ChatbotSetting, Prisma } from '@prisma/client';

import { CustomerService } from '../customer/customer.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationService } from '../reservation/reservation.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { AiRouterService, AiRunResult } from './ai/ai-router.service';
import type { AiImage, AiMessage, AiRequest } from './ai/ai.types';
import { CHAT_COMPLAINT_LINE, complaintLevel, topicOf } from './classify';
import { ComplaintService } from './complaint.service';
import { MenuCard, MenuContextService, MenuSnapshot, toCard } from './menu-context';
import { MetaAccountService } from './meta/meta-account.service';
import { MetaClient, MetaError } from './meta/meta.client';
import { PostContextService, PostRef } from './post-context.service';
import { formatPartyQuote, priceParty } from './party-planner';
import { buildSystemPrompt, buildVisionPrompt, contextLine } from './prompt';
import { AiReply, checkReply, detectLang, ownerAmounts, parseAiReply } from './reply';
import { extractPhone, fillPlaceholders, matchQuickReply, phrase, ReplyLang } from './text';

export interface IncomingMessage {
  branchId: string;
  channel: ChatChannel;
  externalUserId: string;
  text: string;
  image?: AiImage | null;
  /** A photo arrived but was not downloaded (photo recognition is off). */
  hasPhoto?: boolean;
  /** The customer shared a Facebook/Instagram post into the chat. */
  sharedPost?: PostRef | null;
  voice?: boolean;
  /** The channel's own message id, for de-duplicating webhook retries. */
  externalId?: string | null;
  customerName?: string | null;
  /** Admin "Test bot": always answers, saves no bookings or enquiries. */
  isTest?: boolean;
}

export interface BotOutput {
  text: string;
  cards: MenuCard[];
  source: 'QUICK_REPLY' | 'AI' | 'FALLBACK' | 'SYSTEM';
}

export interface HandleResult {
  conversationId: string;
  reply: BotOutput | null;
  /** REPLIED: sent now. DRAFTED: waiting for staff. HUMAN: staff are handling the chat. OFF: channel switched off. */
  status: 'REPLIED' | 'DRAFTED' | 'HUMAN' | 'OFF' | 'DUPLICATE';
}

const HISTORY_LIMIT = 12;

const DEFAULT_QUICK_REPLIES: { title: string; keywords: string[]; answer: string }[] = [
  {
    title: 'Opening hours',
    keywords: ['opening hours', 'open time', 'when do you open', 'when are you open', 'what time do you open', 'are you open', 'open now', 'closing time', 'kokhon khole', 'kokhon khola', 'kokhon bondho', 'khola ache', 'koyta e khole', 'কখন খোলে', 'কখন খোলা', 'খোলা আছে', 'কয়টায় খোলে', 'কখন বন্ধ'],
    answer: "We're open {openingHours}. See you soon!\nআমরা খোলা থাকি {openingHours}।",
  },
  {
    title: 'Location',
    keywords: ['location', 'address', 'where are you', 'where is it', 'direction', 'directions', 'map', 'kothay', 'kotha', 'thikana', 'location ta', 'কোথায়', 'ঠিকানা', 'লোকেশন'],
    answer: 'We are at {address}. Map and directions: {siteUrl}/contact\nআমাদের ঠিকানা: {address}',
  },
  {
    title: 'Phone number',
    keywords: ['phone number', 'contact number', 'call you', 'your number', 'number dao', 'number den', 'নম্বর', 'ফোন নম্বর'],
    answer: 'You can call us on {phone}.\nআমাদের নম্বর: {phone}',
  },
  {
    title: 'Menu',
    keywords: ['menu', 'full menu', 'see the menu', 'menu dekhte chai', 'menu ta', 'মেনু'],
    answer: 'Here is our full menu with photos and prices: {siteUrl}/menu\nIs there a dish you would like to know about?',
  },
  {
    title: 'Book online',
    keywords: ['booking link', 'book online', 'reservation link', 'reservation page'],
    answer: 'You can book a table here: {siteUrl}/reservation, or tell me the date, time and number of guests and I will send the request.',
  },
];

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: AiRouterService,
    private readonly menus: MenuContextService,
    private readonly reservations: ReservationService,
    private readonly customers: CustomerService,
    private readonly ws: RestoraPosGateway,
    private readonly complaints: ComplaintService,
    private readonly meta: MetaClient,
    private readonly metaAccounts: MetaAccountService,
    private readonly posts: PostContextService,
  ) {}

  /** Live values for {placeholders} in pre-ready answers. */
  async placeholderValues(branchId: string) {
    const facts = await this.branchFacts(branchId);
    const siteUrl = this.menus.siteUrl();
    return { openingHours: facts.openingHours, address: facts.address, phone: facts.phone, siteUrl, menuUrl: `${siteUrl}/menu`, reservationUrl: `${siteUrl}/reservation` };
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  /** The branch's settings, created with starter quick replies on first use. */
  async getSettings(branchId: string): Promise<ChatbotSetting> {
    const existing = await this.prisma.chatbotSetting.findUnique({ where: { branchId } });
    if (existing) return existing;
    const created = await this.prisma.chatbotSetting.upsert({ where: { branchId }, create: { branchId }, update: {} });
    if ((await this.prisma.chatQuickReply.count({ where: { branchId } })) === 0) {
      await this.prisma.chatQuickReply.createMany({
        data: DEFAULT_QUICK_REPLIES.map((q, i) => ({ branchId, title: q.title, keywords: q.keywords.join('\n'), answer: q.answer, priority: 10 - i })),
      });
    }
    return created;
  }

  modeFor(settings: ChatbotSetting, channel: ChatChannel) {
    return { WEB: settings.webMode, MESSENGER: settings.messengerMode, INSTAGRAM: settings.instagramMode, WHATSAPP: settings.whatsappMode }[channel];
  }

  private async branchFacts(branchId: string) {
    const [branch, content, branchSetting, rules] = await Promise.all([
      this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { name: true, address: true, phone: true, timezone: true, vatEnabled: true, taxRate: true, serviceChargeEnabled: true, serviceChargeRate: true },
      }),
      this.prisma.websiteContent.findUnique({ where: { branchId }, select: { openingHours: true } }),
      this.prisma.branchSetting.findUnique({ where: { branchId }, select: { openingTime: true, closingTime: true } }),
      this.prisma.chatRuleVersion.findFirst({ where: { branchId }, orderBy: { createdAt: 'desc' } }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');
    const openingHours = content?.openingHours?.trim() || (branchSetting ? `daily ${branchSetting.openingTime} - ${branchSetting.closingTime}` : null);
    return {
      brand: branch.name,
      address: branch.address || null,
      phone: branch.phone || null,
      timezone: branch.timezone || 'Asia/Dhaka',
      openingHours,
      rules: Array.isArray(rules?.rules) ? (rules!.rules as unknown[]).map(String).filter(Boolean) : [],
      charges: {
        vatPercent: branch.vatEnabled ? Number(branch.taxRate) : 0,
        servicePercent: branch.serviceChargeEnabled ? Number(branch.serviceChargeRate) : 0,
      },
    };
  }

  // ── Incoming message ───────────────────────────────────────────────────────

  async handleIncoming(msg: IncomingMessage): Promise<HandleResult> {
    const settings = await this.getSettings(msg.branchId);
    const mode = msg.isTest ? 'AUTO' : this.modeFor(settings, msg.channel);

    if (msg.externalId && (await this.prisma.chatMessage.findUnique({ where: { externalId: msg.externalId } }))) {
      const conv = await this.prisma.chatConversation.findUnique({
        where: { branchId_channel_externalUserId: { branchId: msg.branchId, channel: msg.channel, externalUserId: msg.externalUserId } },
      });
      return { conversationId: conv?.id ?? '', reply: null, status: 'DUPLICATE' };
    }
    if (mode === 'OFF') return { conversationId: '', reply: null, status: 'OFF' };

    const text = (msg.text ?? '').trim().slice(0, 2000);
    const { phone } = extractPhone(text);
    let conv = await this.prisma.chatConversation.upsert({
      where: { branchId_channel_externalUserId: { branchId: msg.branchId, channel: msg.channel, externalUserId: msg.externalUserId } },
      create: {
        branchId: msg.branchId,
        channel: msg.channel,
        externalUserId: msg.externalUserId,
        customerName: msg.customerName ?? null,
        customerPhone: phone,
        isTest: !!msg.isTest,
      },
      update: {},
    });
    const now = new Date();
    conv = await this.prisma.chatConversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: now,
        lastCustomerMessageAt: now,
        ...(phone && phone !== conv.customerPhone ? { customerPhone: phone } : {}),
        ...(!conv.customerName && msg.customerName ? { customerName: msg.customerName } : {}),
        ...(conv.status === 'CLOSED' ? { status: 'BOT' } : {}),
      },
    });
    const hasImage = !!msg.image || !!msg.hasPhoto;
    const shown = text || (hasImage ? '[photo]' : msg.voice ? '[voice message]' : msg.sharedPost ? `[shared a post${msg.sharedPost.title ? `: ${msg.sharedPost.title}` : ''}]` : '');
    await this.prisma.chatMessage.create({
      data: { conversationId: conv.id, sender: 'CUSTOMER', text: shown, hasImage, externalId: msg.externalId ?? null },
    });

    if (!msg.isTest && (conv.status === 'HUMAN' || (conv.humanUntil && conv.humanUntil > now))) {
      await this.prisma.chatConversation.update({ where: { id: conv.id }, data: { staffUnread: { increment: 1 } } });
      this.notify(msg.branchId, conv.id);
      return { conversationId: conv.id, reply: null, status: 'HUMAN' };
    }

    // A complaint in a private chat: one fixed line, then a person takes over.
    const level = hasImage ? null : complaintLevel(text);
    if (level === 'SERIOUS' || level === 'ORDINARY') {
      if (!msg.isTest) await this.complaints.fromChat(conv, text, level, topicOf(text));
      const result = await this.deliverBotReply(conv, settings, { text: CHAT_COMPLAINT_LINE[detectLang(text)], cards: [], source: 'SYSTEM' }, mode === 'SUGGEST');
      if (!msg.isTest) {
        await this.prisma.chatConversation.update({
          where: { id: conv.id },
          data: { status: 'HUMAN', humanUntil: new Date(Date.now() + settings.humanPauseHours * 3600_000), needsStaff: true, needsStaffReason: `Complaint (${level.toLowerCase()})` },
        });
        this.notify(conv.branchId, conv.id);
      }
      return result;
    }

    const output = await this.compose(conv, settings, msg, text);
    return this.deliverBotReply(conv, settings, output, mode === 'SUGGEST');
  }

  private async compose(conv: ChatConversation, settings: ChatbotSetting, msg: IncomingMessage, original: string): Promise<BotOutput> {
    const isTest = !!msg.isTest;
    let text = original;
    const lang = detectLang(text);
    if (msg.voice && !text) {
      await this.flagStaff(conv, 'Customer sent a voice message', isTest);
      return { text: phrase('voice', lang), cards: [], source: 'SYSTEM' };
    }
    if (msg.image || msg.hasPhoto) return this.composeForImage(conv, settings, text, msg.image ?? null, lang);
    if (msg.sharedPost) {
      const shared = await this.composeForSharedPost(conv, msg.sharedPost, lang);
      if (shared) return shared;
      if (!text) text = `[The customer shared a post${msg.sharedPost.title ? `: "${msg.sharedPost.title}"` : ''} and wants to know about it]`;
    }

    const facts = await this.branchFacts(conv.branchId);
    const siteUrl = this.menus.siteUrl();

    const replies = await this.prisma.chatQuickReply.findMany({ where: { branchId: conv.branchId, isActive: true }, orderBy: { priority: 'desc' } });
    const quick = matchQuickReply(text, replies);
    if (quick) {
      void this.prisma.chatQuickReply.update({ where: { id: quick.id }, data: { hits: { increment: 1 } } }).catch(() => undefined);
      return {
        text: fillPlaceholders(quick.answer, { openingHours: facts.openingHours, address: facts.address, phone: facts.phone, siteUrl, menuUrl: `${siteUrl}/menu`, reservationUrl: `${siteUrl}/reservation` }),
        cards: [],
        source: 'QUICK_REPLY',
      };
    }

    const menu = await this.menus.get(conv.branchId);
    const request = await this.chatRequest(conv, settings, facts, menu, text);
    const allowedAmounts = ownerAmounts(...facts.rules, settings.partyRules);
    let lastProblem = 'No AI connection answered';
    const outcome = await this.router.run<AiReply>(conv.branchId, 'CHAT', request, {
      conversationId: conv.id,
      conversationKey: conv.id,
      accept: (result) => {
        const parsed = parseAiReply(result.text, text);
        if (!parsed) {
          lastProblem = 'The AI reply could not be read';
          return null;
        }
        const checked = checkReply(parsed, menu, allowedAmounts);
        if (!checked.ok) {
          lastProblem = checked.reason === 'UNKNOWN_PRICE' ? 'The AI quoted a price that is not on the menu' : checked.reason === 'UNKNOWN_ITEM' ? 'The AI mentioned a dish that is not on the menu' : 'The AI reply was too long';
          return null;
        }
        return checked.reply;
      },
    });

    if (!outcome) {
      await this.flagStaff(conv, lastProblem, isTest);
      if (!isTest) await this.prisma.chatUnanswered.create({ data: { branchId: conv.branchId, conversationId: conv.id, question: text, reason: lastProblem } });
      return { text: settings.fallbackText, cards: [], source: 'FALLBACK' };
    }

    if (!isTest) void this.runShadow(conv, request, menu, allowedAmounts, text);
    const reply = outcome.value;
    const cards = reply.items.map((ref) => menu.byRef.get(ref)).filter((u): u is NonNullable<typeof u> => !!u).map(toCard);
    const extra = await this.applyAction(conv, reply, menu, facts, isTest, text);
    return { text: [reply.reply, extra].filter(Boolean).join('\n\n'), cards, source: 'AI' };
  }

  private async chatRequest(
    conv: ChatConversation,
    settings: ChatbotSetting,
    facts: Awaited<ReturnType<ChatbotService['branchFacts']>>,
    menu: MenuSnapshot,
    text: string,
  ): Promise<AiRequest> {
    const system = buildSystemPrompt({
      assistantName: settings.assistantName,
      brand: facts.brand,
      address: facts.address,
      phone: facts.phone,
      openingHours: facts.openingHours,
      siteUrl: this.menus.siteUrl(),
      rules: facts.rules,
      partyRules: settings.partyRules,
      menu,
    });

    const past = await this.prisma.chatMessage.findMany({
      where: { conversationId: conv.id, status: 'SENT' },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT + 1,
    });
    // The newest row is the message being answered; it is added below with its context line.
    const history = past.slice(1).reverse();
    const messages: AiMessage[] = [];
    for (const m of history) {
      const role = m.sender === 'CUSTOMER' ? 'user' : 'assistant';
      if (messages.length === 0 && role === 'assistant') continue;
      const content = m.sender === 'CUSTOMER' ? `${extractPhone(m.text).masked}${m.hasImage ? ' [sent a photo]' : ''}` : m.text;
      if (content.trim()) messages.push({ role, content });
    }
    const line = contextLine({ now: new Date(), timezone: facts.timezone, phoneOnFile: !!conv.customerPhone, nameOnFile: conv.customerName });
    messages.push({ role: 'user', content: `${line}\n${extractPhone(text).masked}` });
    return { system, messages };
  }

  /** A post shared into the chat: our own posts are priced exactly, with no AI. */
  private async composeForSharedPost(conv: ChatConversation, post: PostRef, lang: ReplyLang): Promise<BotOutput | null> {
    const resolved = await this.posts.resolve(conv.branchId, conv.channel === 'INSTAGRAM' ? 'INSTAGRAM' : 'FACEBOOK', post).catch(() => null);
    if (!resolved || resolved.units.length === 0) return null;
    if (resolved.dishCount === 1) {
      const cheapest = resolved.units[0];
      return { text: phrase('sharedPostOne', lang, { name: cheapest.dishName, price: cheapest.price }), cards: resolved.units.slice(0, 3).map(toCard), source: 'SYSTEM' };
    }
    return { text: phrase('visionChoices', lang), cards: resolved.units.slice(0, 5).map(toCard), source: 'SYSTEM' };
  }

  private async composeForImage(conv: ChatConversation, settings: ChatbotSetting, text: string, image: AiImage | null, lang: ReplyLang): Promise<BotOutput> {
    if (!settings.visionEnabled || !image) {
      await this.flagStaff(conv, 'Customer sent a photo', conv.isTest);
      return { text: phrase('imageOff', lang), cards: [], source: 'SYSTEM' };
    }
    const since = new Date(Date.now() - 24 * 3600_000);
    const recent = await this.prisma.chatMessage.count({ where: { conversationId: conv.id, hasImage: true, createdAt: { gte: since } } });
    if (recent > settings.imageDailyLimit) return { text: phrase('imageLimit', lang), cards: [], source: 'SYSTEM' };

    const facts = await this.branchFacts(conv.branchId);
    const menu = await this.menus.get(conv.branchId);
    const request: AiRequest = {
      system: buildVisionPrompt(facts.brand, menu),
      messages: [{ role: 'user', content: text ? `The customer wrote: ${extractPhone(text).masked}` : 'Which dish is this?', images: [image] }],
    };
    const outcome = await this.router.run(conv.branchId, 'VISION', request, {
      conversationId: conv.id,
      conversationKey: conv.id,
      accept: (result) => parseVisionMatches(result.text, menu),
    });
    const matches = outcome?.value ?? [];
    const [top, second] = matches;
    if (top && top.confidence >= 0.75 && (!second || top.confidence - second.confidence >= 0.2)) {
      const unit = menu.byRef.get(top.ref)!;
      return { text: phrase('visionSure', lang, { name: unit.name, price: unit.price }), cards: [toCard(unit)], source: 'AI' };
    }
    const likely = matches.filter((m) => m.confidence >= 0.4);
    if (likely.length > 0) {
      return { text: phrase('visionChoices', lang), cards: likely.slice(0, 3).map((m) => toCard(menu.byRef.get(m.ref)!)), source: 'AI' };
    }
    await this.flagStaff(conv, outcome ? 'Photo did not match the menu' : 'Photo could not be read by the AI', conv.isTest);
    return { text: phrase('visionNone', lang), cards: [], source: outcome ? 'AI' : 'FALLBACK' };
  }

  // ── Actions the AI asked for ──────────────────────────────────────────────

  private async applyAction(
    conv: ChatConversation,
    reply: AiReply,
    menu: MenuSnapshot,
    facts: Awaited<ReturnType<ChatbotService['branchFacts']>>,
    isTest: boolean,
    customerText: string,
  ): Promise<string | null> {
    const action = reply.action;
    if (!action) return null;
    const lang = reply.lang;

    if (action.type === 'handoff') {
      await this.flagStaff(conv, action.reason, isTest);
      if (!isTest) await this.prisma.chatUnanswered.create({ data: { branchId: conv.branchId, conversationId: conv.id, question: customerText, reason: `Handed to staff: ${action.reason}` } });
      return null;
    }

    if (action.type === 'party_quote') {
      const priced = priceParty(action.guests, action.options, menu.byRef, facts.charges);
      const parts: string[] = [];
      if (priced.length > 0) parts.push(formatPartyQuote(action.guests, priced), phrase('estimate', lang));
      if (isTest) {
        parts.push(phrase('testMode', lang));
        return parts.join('\n\n') || null;
      }
      const lead = await this.prisma.chatLead.create({
        data: {
          branchId: conv.branchId,
          conversationId: conv.id,
          name: conv.customerName,
          phone: conv.customerPhone,
          guests: action.guests,
          date: action.date,
          time: action.time,
          occasion: action.occasion,
          quote: priced as unknown as Prisma.InputJsonValue,
        },
      });
      await this.flagStaff(conv, priced.length > 0 ? `Party enquiry: ${action.guests} guests` : `Party enquiry (${action.guests} guests) could not be priced`, false);
      if (action.date && action.time && conv.customerPhone && conv.customerName) {
        const booked = await this.book(conv, { date: action.date, time: action.time, guests: action.guests, name: conv.customerName, occasion: action.occasion }, lang, facts.timezone);
        if (booked.reservationId) await this.prisma.chatLead.update({ where: { id: lead.id }, data: { reservationId: booked.reservationId } });
        parts.push(booked.text);
      }
      return parts.join('\n\n') || null;
    }

    // booking_request
    const name = action.name ?? conv.customerName;
    if (!action.date || !action.time || !action.guests || !name || !conv.customerPhone) return null;
    if (!conv.customerName && action.name) {
      await this.prisma.chatConversation.update({ where: { id: conv.id }, data: { customerName: action.name } });
      conv.customerName = action.name;
    }
    if (isTest) return `${phrase('bookingReceived', lang, { guests: action.guests, date: action.date, time: action.time })}\n${phrase('testMode', lang)}`;
    const booked = await this.book(conv, { date: action.date, time: action.time, guests: action.guests, name, occasion: action.occasion }, lang, facts.timezone);
    return booked.text;
  }

  /** Turns a complete booking request into a PENDING reservation, or a staff task when it can't be. */
  private async book(
    conv: ChatConversation,
    req: { date: string; time: string; guests: number; name: string; occasion: string | null },
    lang: ReplyLang,
    timezone: string,
  ): Promise<{ text: string; reservationId?: string }> {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date) || req.date < today || !/^\d{1,2}:\d{2}$/.test(req.time)) {
      await this.flagStaff(conv, 'Booking request with an unclear date or time', false);
      return { text: phrase('largeParty', lang, { guests: req.guests }) };
    }
    const time = req.time.padStart(5, '0');
    const settings = await this.reservations.getSettings(conv.branchId);

    const lead = () =>
      this.prisma.chatLead.create({
        data: { branchId: conv.branchId, conversationId: conv.id, name: req.name, phone: conv.customerPhone, guests: req.guests, date: req.date, time, occasion: req.occasion },
      });

    if (req.guests > settings.reservationMaxPersonsPerSlot) {
      await lead();
      await this.flagStaff(conv, `Booking for ${req.guests} guests (more than one slot holds)`, false);
      return { text: phrase('largeParty', lang, { guests: req.guests }) };
    }

    const nowTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const slots = (await this.reservations.getAvailableSlots(conv.branchId, req.date)).filter((s) => req.date > today || s.time > nowTime);
    const fits = (s: (typeof slots)[number]) => !s.isFull && s.availableBookings > 0 && s.availablePersons >= req.guests;
    const chosen = slots.find((s) => s.time === time);
    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const offer = () => {
      const open = slots.filter(fits).sort((a, b) => Math.abs(minutes(a.time) - minutes(time)) - Math.abs(minutes(b.time) - minutes(time)));
      return open.slice(0, 6).map((s) => s.time).sort();
    };
    if (!chosen || !fits(chosen)) {
      const choices = offer();
      if (choices.length === 0) {
        await lead();
        await this.flagStaff(conv, `No free slot for ${req.guests} guests on ${req.date}`, false);
        return { text: phrase('noSlots', lang, { guests: req.guests, date: req.date }) };
      }
      return { text: phrase('slotChoices', lang, { date: req.date, slots: choices.join(', ') }) };
    }

    try {
      const customer = await this.customers.createFromPos(conv.branchId, { phone: conv.customerPhone!, name: req.name });
      if (!conv.customerId) await this.prisma.chatConversation.update({ where: { id: conv.id }, data: { customerId: customer.id } });
      const reservation = await this.reservations.create(conv.branchId, {
        customerName: req.name,
        customerPhone: conv.customerPhone!,
        customerId: customer.id,
        date: req.date,
        timeSlot: time,
        partySize: req.guests,
        notes: [`Booked through the chat assistant (${conv.channel.toLowerCase()})`, req.occasion ? `Occasion: ${req.occasion}` : null].filter(Boolean).join('. '),
        // The customer has not seen the terms in chat; when the branch has terms, staff take it from here.
        agreedTerms: !settings.reservationTermsOfService,
      });
      return { text: phrase('bookingReceived', lang, { guests: req.guests, date: req.date, time }), reservationId: reservation.id };
    } catch (err) {
      if (err instanceof ConflictException) {
        const choices = offer().filter((t) => t !== time);
        if (choices.length > 0) return { text: phrase('slotChoices', lang, { date: req.date, slots: choices.join(', ') }) };
      }
      this.logger.warn(`Chat booking failed: ${(err as Error).message}`);
      await lead();
      await this.flagStaff(conv, err instanceof BadRequestException ? 'Booking needs staff (terms or details)' : 'Booking request could not be saved', false);
      return { text: phrase('largeParty', lang, { guests: req.guests }) };
    }
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  private async deliverBotReply(conv: ChatConversation, settings: ChatbotSetting, output: BotOutput, suggestOnly: boolean): Promise<HandleResult> {
    let text = output.text;
    if (conv.channel !== 'WEB' && !suggestOnly) {
      const spokeBefore = await this.prisma.chatMessage.count({ where: { conversationId: conv.id, sender: 'BOT', status: 'SENT' } });
      if (spokeBefore === 0) text = `${text}\n\n- ${settings.assistantName} (automated)`;
    }
    await this.prisma.chatMessage.create({
      data: {
        conversationId: conv.id,
        sender: 'BOT',
        source: output.source,
        status: suggestOnly ? 'DRAFT' : 'SENT',
        text,
        cards: output.cards.length > 0 ? (output.cards as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
    await this.prisma.chatConversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: new Date(),
        ...(suggestOnly ? { needsStaff: true, needsStaffReason: conv.needsStaffReason ?? 'Reply waiting for approval', staffUnread: { increment: 1 } } : {}),
      },
    });
    this.notify(conv.branchId, conv.id);
    if (suggestOnly) return { conversationId: conv.id, reply: null, status: 'DRAFTED' };
    if (conv.channel !== 'WEB') {
      try {
        await this.sendToChannel(conv, text, output.cards);
      } catch (err) {
        this.logger.warn(`Reply to ${conv.channel} not delivered: ${(err as Error).message}`);
        await this.flagStaff(conv, `Reply could not be sent: ${(err as Error).message.replace(/^[A-Z_]+:\s*/, '')}`, false);
      }
    }
    return { conversationId: conv.id, reply: { ...output, text }, status: 'REPLIED' };
  }

  /**
   * Website messages are fetched by the chat widget, so nothing is pushed.
   * Messenger and Instagram go through the Page's Send API, only inside
   * Meta's 24-hour window after the customer's last message.
   */
  async sendToChannel(conv: ChatConversation, text: string, cards: MenuCard[]): Promise<void> {
    if (conv.channel === 'WEB') return;
    if (conv.channel === 'WHATSAPP') throw new BadRequestException('WhatsApp replies are not connected yet');
    const auth = await this.metaAccounts.auth(conv.branchId);
    if (!auth) throw new BadRequestException('META_NOT_CONNECTED: connect the Facebook Page in Chat Assistant → Connect first');
    const last = conv.lastCustomerMessageAt;
    if (!last || Date.now() - last.getTime() > 24 * 3600_000) {
      throw new BadRequestException("OUTSIDE_WINDOW: Meta allows replies only within 24 hours of the customer's last message. Ask them to message again, or call them.");
    }
    try {
      await this.meta.sendText(auth, { id: conv.externalUserId }, text);
    } catch (err) {
      throw new BadRequestException(err instanceof MetaError && err.needsReconnect ? 'META_RECONNECT: Facebook rejected the Page token. Reconnect in Chat Assistant → Connect.' : `Facebook: ${(err as Error).message}`);
    }
    if (cards.length > 0) {
      await this.meta.sendCards(auth, { id: conv.externalUserId }, cards, `${this.menus.siteUrl()}/reservation`).catch((err: Error) => this.logger.warn(`Dish cards not sent: ${err.message}`));
    }
  }

  /** Staff replied from Meta Business Suite or the Page inbox: record it and keep the bot quiet. */
  async recordStaffEcho(branchId: string, channel: ChatChannel, externalUserId: string, text: string, externalId: string | null) {
    if (externalId && (await this.prisma.chatMessage.findUnique({ where: { externalId } }))) return;
    const conv = await this.prisma.chatConversation.findUnique({ where: { branchId_channel_externalUserId: { branchId, channel, externalUserId } } });
    if (!conv) return;
    const settings = await this.getSettings(branchId);
    await this.prisma.chatMessage.create({ data: { conversationId: conv.id, sender: 'STAFF', source: 'STAFF', text: text || '[attachment]', externalId } });
    await this.prisma.chatConversation.update({
      where: { id: conv.id },
      data: { status: 'HUMAN', humanUntil: new Date(Date.now() + settings.humanPauseHours * 3600_000), needsStaff: false, needsStaffReason: null, staffUnread: 0, lastMessageAt: new Date() },
    });
    await this.prisma.chatMessage.updateMany({ where: { conversationId: conv.id, status: 'DRAFT' }, data: { status: 'DISCARDED' } });
    this.notify(branchId, conv.id);
  }

  async flagStaff(conv: ChatConversation, reason: string, isTest: boolean) {
    if (isTest) return;
    await this.prisma.chatConversation.update({ where: { id: conv.id }, data: { needsStaff: true, needsStaffReason: reason.slice(0, 200), staffUnread: { increment: 1 } } });
    conv.needsStaff = true;
    conv.needsStaffReason = reason;
    this.notify(conv.branchId, conv.id);
  }

  notify(branchId: string, conversationId: string) {
    try {
      this.ws.emitToBranch(branchId, 'chat:updated', { conversationId });
    } catch {
      /* the inbox also refreshes on a timer */
    }
  }

  /** Trial model: drafts a reply that only the owner sees. Never sent, never blocks the real reply. */
  private async runShadow(conv: ChatConversation, request: AiRequest, menu: MenuSnapshot, allowed: Set<number>, text: string) {
    try {
      const connection = await this.router.shadowConnection(conv.branchId, 'CHAT');
      if (!connection) return;
      const result: AiRunResult = await this.router.call(connection, 'CHAT', request, { conversationId: conv.id, outcome: 'SHADOW' });
      const parsed = parseAiReply(result.text, text);
      const checked = parsed ? checkReply(parsed, menu, allowed) : null;
      const shown = checked?.ok ? checked.reply.reply : `[would have been withheld: ${parsed ? (checked as { reason: string }).reason : 'unreadable reply'}] ${result.text.slice(0, 400)}`;
      await this.prisma.chatMessage.create({
        data: { conversationId: conv.id, sender: 'BOT', source: 'AI', status: 'SHADOW', text: shown, aiConnectionId: connection.id },
      });
    } catch (err) {
      this.logger.debug(`Shadow reply failed: ${(err as Error).message}`);
    }
  }
}

export function parseVisionMatches(raw: string, menu: MenuSnapshot): { ref: string; confidence: number }[] | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { matches?: { ref?: unknown; confidence?: unknown }[] };
    if (!Array.isArray(obj.matches)) return null;
    return obj.matches
      .map((m) => ({ ref: String(m?.ref ?? '').trim(), confidence: Math.max(0, Math.min(1, Number(m?.confidence) || 0)) }))
      .filter((m) => menu.byRef.has(m.ref))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  } catch {
    return null;
  }
}
