import { ExecutionContext, INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { ChatbotSetting } from '@prisma/client';
import type { JwtPayload } from '@restora/types';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationService } from '../reservation/reservation.service';
import { SmsService } from '../sms/sms.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { AiAdminService } from './ai/ai-admin.service';
import { AiRouterService, splitBucket } from './ai/ai-router.service';
import { AiError, AiRequest, AiTarget } from './ai/ai.types';
import { OpenAiCompatibleProvider } from './ai/openai-compatible.provider';
import { ChatbotModule } from './chatbot.module';
import { ChatbotService } from './chatbot.service';
import { buildMenuSnapshot, MenuContextService } from './menu-context';
import { formatPartyQuote, priceParty } from './party-planner';
import { CHAT_SELF_TEST } from './ai/model-selftest';
import { amountsIn, checkReply, detectLang, ownerAmounts, parseAiReply } from './reply';
import { decryptSecret, encryptSecret, secretsKey } from './secrets';
import { extractPhone, matchQuickReply, phrase } from './text';

jest.setTimeout(60_000);

// ─── Pure pieces ─────────────────────────────────────────────────────────────

const menu = buildMenuSnapshot(
  {
    categories: [
      { id: 'pasta', name: 'Pasta', parentId: null, sortOrder: 1 },
      { id: 'drinks', name: 'Drinks', parentId: null, sortOrder: 2 },
    ],
    items: [
      { id: 'p1', categoryId: 'pasta', name: 'Alfredo Pasta', price: 45_000, sortOrder: 12, description: 'Creamy' },
      { id: 'p2', categoryId: 'pasta', name: 'Arrabbiata', price: 39_000, discountedPrice: 35_100, sortOrder: 13 },
      {
        id: 'w',
        categoryId: 'drinks',
        name: 'Water',
        price: 0,
        sortOrder: 1000,
        isVariantParent: true,
        variants: [
          { id: 'w1', categoryId: 'drinks', name: '500ml', price: 2_000, sortOrder: 1 },
          { id: 'w2', categoryId: 'drinks', name: '1L', price: 3_500, sortOrder: 2 },
        ],
      },
    ],
  },
  'https://eatrobd.com',
);

describe('chat assistant: pure pieces', () => {
  it('builds a menu snapshot with live and offer prices, numbers and variants', () => {
    expect(menu.units.map((u) => [u.ref, u.name, u.price, u.wasPrice, u.menuNumber])).toEqual([
      ['#1', 'Alfredo Pasta', 450, null, 12],
      ['#2', 'Arrabbiata', 351, 390, 13],
      ['#3', 'Water - 500ml', 20, null, 1],
      ['#4', 'Water - 1L', 35, null, 2],
    ]);
    expect(menu.text).toContain('#2 Arrabbiata = ৳351 (on offer now, regular ৳390) [menu no. 13]');
  });

  it('pulls Bangladeshi phone numbers out of messages in any format, including Bangla digits', () => {
    expect(extractPhone('my number is 01712-345678 thanks')).toEqual({ phone: '01712345678', masked: 'my number is [phone number] thanks' });
    expect(extractPhone('+880 1812 345678').phone).toBe('01812345678');
    expect(extractPhone('আমার নম্বর ০১৯১২৩৪৫৬৭৮').phone).toBe('01912345678');
    expect(extractPhone('table for 4 at 8pm').phone).toBeNull();
  });

  it('matches short messages to pre-ready answers and leaves mixed questions to the AI', () => {
    const replies = [
      { id: 'hours', keywords: 'opening hours\nkokhon khole\nকখন খোলে', answer: 'x', priority: 2 },
      { id: 'loc', keywords: 'location\nkothay', answer: 'y', priority: 1 },
    ];
    expect(matchQuickReply('What are your opening hours?', replies)?.id).toBe('hours');
    expect(matchQuickReply('apnara kokhon khole?', replies)?.id).toBe('hours');
    expect(matchQuickReply('আপনারা কখন খোলে?', replies)?.id).toBe('hours');
    expect(matchQuickReply('location', replies)?.id).toBe('loc');
    expect(matchQuickReply('opening hours and location please', replies)).toBeNull();
    expect(matchQuickReply('we want a birthday party for 40 people next friday what are your opening hours', replies)).toBeNull();
    expect(matchQuickReply('relocation', replies)).toBeNull();
  });

  it('reads money amounts written several ways', () => {
    expect(amountsIn('৳450, 390 taka, Tk 351, ১২০০ টাকা')).toEqual([450, 390, 1200, 351]);
  });

  it('lets through replies that quote live prices and blocks invented ones', () => {
    const ok = parseAiReply('{"lang":"en","reply":"Alfredo Pasta is ৳450, two are ৳900.","items":["#1"],"action":null}', 'hi')!;
    expect(checkReply(ok, menu, new Set())).toMatchObject({ ok: true });
    const offer = parseAiReply('{"reply":"Arrabbiata is ৳351 today (usually ৳390)","items":["#2"]}', 'hi')!;
    expect(checkReply(offer, menu, new Set())).toMatchObject({ ok: true });
    const made = parseAiReply('{"reply":"Alfredo Pasta is ৳420","items":["#1"]}', 'hi')!;
    expect(checkReply(made, menu, new Set())).toEqual({ ok: false, reason: 'UNKNOWN_PRICE' });
    const ghost = parseAiReply('{"reply":"Try our sushi","items":["#99"]}', 'hi')!;
    expect(checkReply(ghost, menu, new Set())).toEqual({ ok: false, reason: 'UNKNOWN_ITEM' });
    const advance = parseAiReply('{"reply":"Parties over 30 need a ৳5,000 advance"}', 'hi')!;
    expect(checkReply(advance, menu, ownerAmounts('Advance ৳5,000 for parties over 30'))).toMatchObject({ ok: true });
  });

  it('accepts a plain-sentence reply but refuses broken JSON', () => {
    expect(parseAiReply('Sure, we are open till 11pm.', 'kokhon bondho')).toMatchObject({ reply: 'Sure, we are open till 11pm.', lang: 'bn', action: null });
    expect(parseAiReply('{"reply": "half', 'hi')).toBeNull();
    expect(parseAiReply('```json\n{"lang":"bn","reply":"হ্যাঁ","items":[],"action":null}\n```', 'x')).toMatchObject({ lang: 'bn', reply: 'হ্যাঁ' });
  });

  it('answers Banglish in Bangla script, never in Latin letters', () => {
    expect(detectLang('biryani ache? kom dam e ki ki ache')).toBe('bn');
    expect(detectLang('Amar jhal khabar vallage')).toBe('bn');
    expect(detectLang('বিরিয়ানি আছে?')).toBe('bn');
    expect(detectLang('Do you have biryani?')).toBe('en');
    expect(phrase('voice', detectLang('vai voice dilam'))).toMatch(/[ঀ-৿]/);
    expect(parseAiReply('{"lang":"banglish","reply":"জি, আছে"}', 'ache?')).toMatchObject({ lang: 'bn' });
    expect(parseAiReply('{"lang":"bn","reply":"নমস্কার! বার্গার আছে।"}', 'burger ache?')!.reply).toBe('আসসালামু আলাইকুম! বার্গার আছে।');
    expect(parseAiReply('Namaste, yes we do.', 'hi')!.reply).toBe('Assalamu alaikum, yes we do.');
    const test = CHAT_SELF_TEST.find((c) => c.name === 'Banglish price question')!;
    const menu = buildMenuSnapshot({ categories: [], items: [] }, 'https://eatrobd.com');
    const charges = { vatPercent: 0, servicePercent: 0 };
    expect(test.judge({ lang: 'bn', reply: 'Ji bhai, burger ache!', items: [], action: null }, menu, charges)).toMatch(/Latin letters/);
    expect(test.judge({ lang: 'bn', reply: 'জি, বার্গার আছে।', items: [], action: null }, menu, charges)).toBeNull();
  });

  it('prices party options from the live menu with service charge then VAT', () => {
    const priced = priceParty(
      10,
      [
        { label: 'Value', lines: [{ ref: '#1', qty: 10 }, { ref: '#3', qty: 10 }] },
        { label: 'Bad', lines: [{ ref: '#99', qty: 1 }] },
        { label: 'Silly', lines: [{ ref: '#1', qty: 500 }] },
      ],
      menu.byRef,
      { vatPercent: 5, servicePercent: 10 },
    );
    expect(priced).toHaveLength(1);
    expect(priced[0]).toMatchObject({ label: 'Value', subtotal: 4700, serviceCharge: 470, vat: 259, total: 5429, perHead: 543 });
    expect(formatPartyQuote(10, priced)).toContain('Value: ৳543 per head, ৳5,429 for 10 (incl. service charge ৳470, VAT ৳259)');
    expect(priceParty(1, [{ label: 'x', lines: [{ ref: '#1', qty: 1 }] }], menu.byRef, { vatPercent: 0, servicePercent: 0 })).toEqual([]);
  });

  it('encrypts keys so they can only be read with the same server secret', () => {
    const key = secretsKey({ JWT_SECRET: 'one' });
    const stored = encryptSecret('sk-or-v1-abcdef123456', key);
    expect(stored).not.toContain('abcdef');
    expect(decryptSecret(stored, key)).toBe('sk-or-v1-abcdef123456');
    expect(decryptSecret(stored, secretsKey({ JWT_SECRET: 'two' }))).toBeNull();
    expect(secretsKey({ SECRETS_KEY: 'a', JWT_SECRET: 'b' }).equals(secretsKey({ SECRETS_KEY: 'a' }))).toBe(true);
  });

  it('splits conversations between models in stable buckets', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `conv-${i}-x`);
    const share = ids.filter((id) => splitBucket(id) < 20).length / ids.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
    expect(splitBucket('same')).toBe(splitBucket('same'));
  });
});

// ─── Full pipeline on the local database, fake AI ───────────────────────────

type Script = (request: AiRequest) => string;

describe('chat assistant: pipeline and admin', () => {
  let app: INestApplication;
  let origin: string;
  let prisma: PrismaService;
  let chatbot: ChatbotService;
  let aiAdmin: AiAdminService;
  let reservations: ReservationService;
  let router: AiRouterService;
  let menus: MenuContextService;
  let user: JwtPayload;
  let original: ChatbotSetting | null;
  let originalRoutes: { job: string; connectionIds: unknown; splitConnectionId: string | null; splitPercent: number; shadowConnectionId: string | null }[];
  const sms = { sendSms: jest.fn().mockResolvedValue(true) };
  const scripts: Record<string, Script> = {};
  const fakeProvider = {
    complete: jest.fn(async (target: AiTarget, request: AiRequest) => {
      const script = scripts[target.model];
      if (!script) throw new AiError('OTHER', `no script for ${target.model}`);
      return { text: script(request), inputTokens: 1000, outputTokens: 100, latencyMs: 5 };
    }),
    listModels: jest.fn(),
    openRouterKeyInfo: jest.fn(),
  };

  const branchId = 'branch-main';
  const runId = `t${Date.now().toString(36)}`;
  const phoneTail = String(Date.now()).slice(-8);
  const phone = `013${phoneTail}`;
  const dishName = `Test Chat Lasagna ${runId}`;
  let categoryId: string;
  let dishId: string;
  const conn: Record<'primary' | 'backup' | 'shadow', string> = { primary: '', backup: '', shadow: '' };

  const dishRef = (request: AiRequest) => {
    const m = new RegExp(`(#\\d+) ${dishName} = ৳(\\d+)`).exec(request.system);
    if (!m) throw new Error('test dish missing from the menu prompt');
    return { ref: m[1], price: Number(m[2]) };
  };
  const json = (o: object) => JSON.stringify(o);
  const say = (externalUserId: string, text: string, extra: object = {}) =>
    chatbot.handleIncoming({ branchId, channel: 'WEB', externalUserId: `${runId}-${externalUserId}`, text, ...extra });
  const setRoute = (connectionIds: string[], extra: object = {}) =>
    prisma.aiRoute.upsert({
      where: { branchId_job: { branchId, job: 'CHAT' } },
      create: { branchId, job: 'CHAT', connectionIds, ...extra },
      update: { connectionIds, splitConnectionId: null, splitPercent: 0, shadowConnectionId: null, ...extra },
    }).then(() => router.invalidate(branchId));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]), ChatbotModule],
    })
      .overrideProvider(RestoraPosGateway)
      .useValue({ emitToBranch: jest.fn(), emitToKds: jest.fn(), emitToOrder: jest.fn(), emitOrderUpdate: jest.fn() })
      .overrideProvider(SmsService)
      .useValue(sms)
      .overrideProvider(OpenAiCompatibleProvider)
      .useValue(fakeProvider)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { ...user, role: req.headers['x-test-role'] ?? 'OWNER' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    prisma = moduleRef.get(PrismaService);
    chatbot = moduleRef.get(ChatbotService);
    aiAdmin = moduleRef.get(AiAdminService);
    reservations = moduleRef.get(ReservationService);
    router = moduleRef.get(AiRouterService);
    menus = moduleRef.get(MenuContextService);

    const owner = await prisma.staff.findFirstOrThrow({ where: { branchId, role: 'OWNER', isActive: true } });
    user = { sub: owner.id, role: 'OWNER', branchId, email: owner.email } as JwtPayload;

    original = await prisma.chatbotSetting.findUnique({ where: { branchId } });
    originalRoutes = await prisma.aiRoute.findMany({ where: { branchId } });
    await chatbot.getSettings(branchId);
    await prisma.chatbotSetting.update({ where: { branchId }, data: { webMode: 'AUTO', visionEnabled: false, partyRules: null } });

    categoryId = (await prisma.menuCategory.create({ data: { branchId, name: `Test Chat ${runId}` } })).id;
    dishId = (await prisma.menuItem.create({ data: { branchId, categoryId, name: dishName, type: 'FOOD', price: 52_500, imageUrl: 'https://eatrobd.com/x.jpg' } })).id;
    menus.clear(branchId);

    for (const k of ['primary', 'backup', 'shadow'] as const) {
      const c = await aiAdmin.create(branchId, { name: `Test ${k} ${runId}`, provider: 'OPENAI_COMPATIBLE', apiKey: `sk-test-${k}-secret-1234`, model: `fake-${k}-${runId}`, inputPricePerM: 1, outputPricePerM: 2 }, user);
      conn[k] = c.id;
    }
    await prisma.aiConnection.updateMany({ where: { id: { in: Object.values(conn) } }, data: { selfTestScore: 90 } });
    await setRoute([conn.primary, conn.backup]);
  });

  afterEach(() => {
    for (const k of Object.keys(scripts)) delete scripts[k];
  });

  afterAll(async () => {
    const convs = await prisma.chatConversation.findMany({ where: { branchId, externalUserId: { startsWith: runId } }, select: { id: true } });
    await prisma.chatLead.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
    await prisma.chatUnanswered.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
    await prisma.chatConversation.deleteMany({ where: { id: { in: convs.map((c) => c.id) } } });
    await prisma.chatConversation.deleteMany({ where: { branchId, isTest: true, externalUserId: { startsWith: `test:${user.sub}:${runId}` } } });
    await prisma.reservation.deleteMany({ where: { branchId, customerPhone: phone } });
    await prisma.customer.deleteMany({ where: { branchId, phone } });
    await prisma.aiUsage.deleteMany({ where: { connectionId: { in: Object.values(conn) } } });
    await prisma.aiConfigHistory.deleteMany({ where: { branchId, createdAt: { gte: new Date(Date.now() - 600_000) } } });
    await prisma.aiRoute.deleteMany({ where: { branchId } });
    for (const r of originalRoutes) {
      await prisma.aiRoute.create({ data: { branchId, job: r.job as never, connectionIds: r.connectionIds as never, splitConnectionId: r.splitConnectionId, splitPercent: r.splitPercent, shadowConnectionId: r.shadowConnectionId } });
    }
    await prisma.aiConnection.deleteMany({ where: { id: { in: Object.values(conn) } } });
    await prisma.chatQuickReply.deleteMany({ where: { branchId, title: { startsWith: `Test ${runId}` } } });
    await prisma.menuItem.deleteMany({ where: { id: dishId } });
    await prisma.menuCategory.deleteMany({ where: { id: categoryId } });
    if (original) await prisma.chatbotSetting.update({ where: { branchId }, data: { webMode: original.webMode, visionEnabled: original.visionEnabled, partyRules: original.partyRules } });
    await app.close();
  });

  it('answers a pre-ready question without calling the AI', async () => {
    await prisma.chatQuickReply.create({ data: { branchId, title: `Test ${runId} wifi`, keywords: `wifi password ${runId}`, answer: 'Ask our staff for the Wi-Fi. Menu: {menuUrl}', priority: 99 } });
    const calls = fakeProvider.complete.mock.calls.length;
    const res = await say('quick', `wifi password ${runId}`);
    expect(res.status).toBe('REPLIED');
    expect(res.reply).toMatchObject({ source: 'QUICK_REPLY', text: 'Ask our staff for the Wi-Fi. Menu: https://eatrobd.com/menu' });
    expect(fakeProvider.complete.mock.calls.length).toBe(calls);
  });

  it('answers with the live price and a dish card, and keeps the phone number from the AI', async () => {
    let seen = '';
    scripts[`fake-primary-${runId}`] = (req) => {
      seen = JSON.stringify(req.messages);
      const d = dishRef(req);
      return json({ lang: 'en', reply: `${dishName} is ৳${d.price}. ${d.ref}`, items: [d.ref], action: null });
    };
    const res = await say('price', `how much is the lasagna? call me on ${phone}`);
    expect(res.reply?.source).toBe('AI');
    expect(res.reply?.text).toBe(`${dishName} is ৳525.`);
    expect(res.reply?.cards).toEqual([{ name: dishName, price: 525, wasPrice: null, imageUrl: 'https://eatrobd.com/x.jpg', url: expect.stringContaining('/menu/') }]);
    expect(seen).not.toContain(phone);
    expect(seen).toContain('[phone number]');
    const conv = await prisma.chatConversation.findUniqueOrThrow({ where: { id: res.conversationId } });
    expect(conv.customerPhone).toBe(phone);
  });

  it('withholds an invented price, sends the fallback and flags staff', async () => {
    scripts[`fake-primary-${runId}`] = (req) => json({ reply: `${dishName} is only ৳99 today!`, items: [dishRef(req).ref] });
    scripts[`fake-backup-${runId}`] = () => json({ reply: 'Our sushi is ৳1234' });
    const res = await say('invent', 'lasagna price?');
    expect(res.reply?.source).toBe('FALLBACK');
    const conv = await prisma.chatConversation.findUniqueOrThrow({ where: { id: res.conversationId } });
    expect(conv).toMatchObject({ needsStaff: true, needsStaffReason: 'The AI quoted a price that is not on the menu' });
    expect(await prisma.chatUnanswered.count({ where: { conversationId: conv.id } })).toBe(1);
    const usage = await prisma.aiUsage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' } });
    expect(usage.map((u) => u.outcome)).toEqual(['BLOCKED', 'BLOCKED']);
  });

  it('falls through to the backup model when the primary is rate limited', async () => {
    scripts[`fake-primary-${runId}`] = () => {
      throw new AiError('RATE_LIMIT', 'free limit reached', 429);
    };
    scripts[`fake-backup-${runId}`] = () => json({ reply: 'Hello from the backup!' });
    const res = await say('backup', 'hello there friend');
    expect(res.reply?.text).toBe('Hello from the backup!');
    const usage = await prisma.aiUsage.findMany({ where: { conversationId: res.conversationId }, orderBy: { createdAt: 'asc' } });
    expect(usage.map((u) => [u.connectionId, u.outcome])).toEqual([[conn.primary, 'ERROR'], [conn.backup, 'OK']]);
  });

  it('skips a connection over its daily limit or monthly budget', async () => {
    await prisma.aiConnection.update({ where: { id: conn.primary }, data: { monthlyBudget: 0.0001 } });
    router.invalidate(branchId);
    scripts[`fake-primary-${runId}`] = () => json({ reply: 'primary' });
    scripts[`fake-backup-${runId}`] = () => json({ reply: 'backup' });
    await prisma.aiUsage.create({ data: { branchId, connectionId: conn.primary, job: 'CHAT', costUsd: 1, outcome: 'OK' } });
    (router as unknown as { spend: Map<string, unknown> }).spend.clear();
    expect((await say('budget', 'hello again there')).reply?.text).toBe('backup');
    await prisma.aiConnection.update({ where: { id: conn.primary }, data: { monthlyBudget: null } });
    router.invalidate(branchId);
  });

  it('books a table as PENDING once it has date, time, guests, name and phone', async () => {
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86_400_000));
    const slot = (await reservations.getAvailableSlots(branchId, tomorrow)).find((s) => !s.isFull && s.availablePersons >= 4)!;
    scripts[`fake-primary-${runId}`] = () =>
      json({ lang: 'en', reply: 'Lovely, I have sent your request.', items: [], action: { type: 'booking_request', date: tomorrow, time: slot.time, guests: 4, name: 'Rafi Test', occasion: 'birthday' } });
    const res = await say('book', `Table for 4 tomorrow at ${slot.time}, Rafi Test, ${phone}`);
    expect(res.reply?.text).toContain(`Booking request received: 4 guests, ${tomorrow} at ${slot.time}`);
    const r = await prisma.reservation.findFirstOrThrow({ where: { branchId, customerPhone: phone, date: new Date(`${tomorrow}T00:00:00.000Z`) } });
    expect(r).toMatchObject({ status: 'PENDING', partySize: 4, customerName: 'Rafi Test', timeSlot: slot.time });
    expect(r.notes).toContain('Booked through the chat assistant');
    expect(sms.sendSms).toHaveBeenCalled();
  });

  it('offers open times when the asked time is not a slot', async () => {
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86_400_000));
    scripts[`fake-primary-${runId}`] = () => json({ reply: 'Let me check.', action: { type: 'booking_request', date: tomorrow, time: '03:17', guests: 2, name: 'Rafi Test' } });
    const res = await say('slot', `2 people tomorrow 3:17am, ${phone}`);
    expect(res.reply?.text).toMatch(/That time is not available\. Open times on .*: \d\d:\d\d/);
  });

  it('turns a party bigger than a slot into an enquiry instead of a failed booking', async () => {
    const max = (await reservations.getSettings(branchId)).reservationMaxPersonsPerSlot;
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86_400_000));
    scripts[`fake-primary-${runId}`] = () => json({ reply: 'Wonderful!', action: { type: 'booking_request', date: tomorrow, time: '19:30', guests: max + 10, name: 'Big Party' } });
    const res = await say('big', `party of ${max + 10}, ${phone}`);
    expect(res.reply?.text).toContain(`For ${max + 10} guests our team arranges the booking personally`);
    expect(await prisma.chatLead.count({ where: { conversationId: res.conversationId, guests: max + 10 } })).toBe(1);
    expect(await prisma.reservation.count({ where: { branchId, customerPhone: phone, partySize: max + 10 } })).toBe(0);
  });

  it('prices party options itself and records the enquiry for staff', async () => {
    scripts[`fake-primary-${runId}`] = (req) =>
      json({ lang: 'en', reply: 'Here are some ideas for your birthday:', items: [], action: { type: 'party_quote', guests: 20, occasion: 'birthday', options: [{ label: 'Popular', lines: [{ ref: dishRef(req).ref, qty: 20 }] }] } });
    const res = await say('party', 'birthday party for 20, how much per person?');
    expect(res.reply?.text).toMatch(new RegExp(`Popular: ৳[\\d,]+ per head, ৳[\\d,]+ for 20`));
    expect(res.reply?.text).toContain(`20× ${dishName}`);
    expect(res.reply?.text).toContain('These are estimates.');
    const lead = await prisma.chatLead.findFirstOrThrow({ where: { conversationId: res.conversationId } });
    expect(lead).toMatchObject({ guests: 20, occasion: 'birthday', status: 'NEW' });
    expect((lead.quote as { subtotal: number }[])[0].subtotal).toBe(10_500);
  });

  it('hands over to staff when the AI asks for it', async () => {
    scripts[`fake-primary-${runId}`] = () => json({ reply: "I'm passing this to our manager.", action: { type: 'handoff', reason: 'Question about a past order' } });
    const res = await say('handoff', 'I need to talk to someone about my order from yesterday');
    const conv = await prisma.chatConversation.findUniqueOrThrow({ where: { id: res.conversationId } });
    expect(conv).toMatchObject({ needsStaff: true, needsStaffReason: 'Question about a past order' });
  });

  it('stays quiet while staff handle the chat, and drafts instead of sending in Suggest mode', async () => {
    scripts[`fake-primary-${runId}`] = () => json({ reply: 'bot reply' });
    const first = await say('human', 'hello there team');
    await prisma.chatConversation.update({ where: { id: first.conversationId }, data: { status: 'HUMAN', humanUntil: new Date(Date.now() + 3600_000) } });
    expect((await say('human', 'are you there?')).status).toBe('HUMAN');

    await prisma.chatbotSetting.update({ where: { branchId }, data: { webMode: 'SUGGEST' } });
    const drafted = await say('suggest', 'hello suggest mode');
    expect(drafted).toMatchObject({ status: 'DRAFTED', reply: null });
    expect(await prisma.chatMessage.count({ where: { conversationId: drafted.conversationId, sender: 'BOT', status: 'DRAFT' } })).toBe(1);
    await prisma.chatbotSetting.update({ where: { branchId }, data: { webMode: 'OFF' } });
    expect((await say('off', 'hello')).status).toBe('OFF');
    await prisma.chatbotSetting.update({ where: { branchId }, data: { webMode: 'AUTO' } });
  });

  it('ignores a repeated delivery of the same message', async () => {
    scripts[`fake-primary-${runId}`] = () => json({ reply: 'once' });
    const ext = `ext-${runId}`;
    expect((await say('dup', 'hi there you', { externalId: ext })).status).toBe('REPLIED');
    expect((await say('dup', 'hi there you', { externalId: ext })).status).toBe('DUPLICATE');
  });

  it('drafts a shadow reply for a trial model without sending it', async () => {
    await setRoute([conn.primary], { shadowConnectionId: conn.shadow });
    scripts[`fake-primary-${runId}`] = () => json({ reply: 'real reply' });
    scripts[`fake-shadow-${runId}`] = () => json({ reply: 'trial reply' });
    const res = await say('shadow', 'hello shadow test');
    expect(res.reply?.text).toBe('real reply');
    await new Promise((r) => setTimeout(r, 300));
    const shadow = await prisma.chatMessage.findMany({ where: { conversationId: res.conversationId, status: 'SHADOW' } });
    expect(shadow.map((m) => m.text)).toEqual(['trial reply']);
    await setRoute([conn.primary, conn.backup]);
  });

  it('runs the admin test bot without saving bookings', async () => {
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86_400_000));
    scripts[`fake-primary-${runId}`] = () => json({ reply: 'Sent!', action: { type: 'booking_request', date: tomorrow, time: '20:00', guests: 3, name: 'Test Bot' } });
    const before = await prisma.reservation.count({ where: { branchId } });
    const res = await chatbot.handleIncoming({ branchId, channel: 'WEB', externalUserId: `test:${user.sub}:${runId}`, text: `3 people tomorrow 8pm, ${phone}`, isTest: true });
    expect(res.reply?.text).toContain('(Test mode: nothing was saved.)');
    expect(await prisma.reservation.count({ where: { branchId } })).toBe(before);
  });

  // ── Admin over HTTP ────────────────────────────────────────────────────────

  const call = async (method: string, path: string, role = 'OWNER', body?: unknown) => {
    const res = await fetch(`${origin}/api/v1${path}`, {
      method,
      headers: { 'x-test-role': role, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json().catch(() => null)) as any, raw: res };
  };

  it('never returns an API key, and only the owner manages AI connections', async () => {
    const list = await call('GET', '/chatbot/ai/connections');
    expect(list.status).toBe(200);
    const text = JSON.stringify(list.body);
    expect(text).not.toContain('secret-1234');
    expect(text).not.toContain('apiKeyEnc');
    expect(list.body.find((c: { id: string }) => c.id === conn.primary)).toMatchObject({ keySet: true, keyHint: '…1234' });
    expect((await call('GET', '/chatbot/ai/connections', 'MANAGER')).status).toBe(403);
    expect((await call('GET', '/chatbot/conversations', 'MANAGER')).status).toBe(200);
    expect((await call('GET', '/chatbot/conversations', 'WAITER')).status).toBe(403);
  });

  it('requires a passed self-test before a model answers chats, and can switch back', async () => {
    await prisma.aiConnection.update({ where: { id: conn.shadow }, data: { selfTestScore: 40 } });
    const refused = await call('PUT', '/chatbot/ai/routes/CHAT', 'OWNER', { connectionIds: [conn.shadow] });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('SELF_TEST_REQUIRED');

    const swapped = await call('PUT', '/chatbot/ai/routes/CHAT', 'OWNER', { connectionIds: [conn.backup] });
    expect(swapped.status).toBe(200);
    expect(swapped.body.routes.find((r: { job: string }) => r.job === 'CHAT').connectionIds).toEqual([conn.backup]);
    scripts[`fake-backup-${runId}`] = () => json({ reply: 'swapped in at once' });
    expect((await say('swap', 'hello swap test')).reply?.text).toBe('swapped in at once');

    const back = await call('POST', '/chatbot/ai/switch-back');
    expect(back.body.routes.find((r: { job: string }) => r.job === 'CHAT').connectionIds).toEqual([conn.primary, conn.backup]);
    await prisma.aiConnection.update({ where: { id: conn.shadow }, data: { selfTestScore: 90 } });
  });

  it('scores a model on the self-test exam', async () => {
    scripts[`fake-shadow-${runId}`] = (req) => {
      const msg = req.messages[0].content;
      if (msg.includes('birthday party for 30')) return json({ lang: 'en', reply: 'Some ideas:', action: { type: 'party_quote', guests: 30, options: [{ label: 'Value', lines: [{ ref: dishRef(req).ref, qty: 30 }] }] } });
      if (msg.includes('waiter was rude')) return json({ lang: 'en', reply: 'Sorry, passing to the manager.', action: { type: 'handoff', reason: 'complaint' } });
      if (/[\u0980-\u09FF]/.test(msg.split('\n')[1])) return json({ lang: 'bn', reply: 'আমাদের মেনু দেখুন।' });
      if (msg.includes('bhai')) return json({ lang: 'bn', reply: 'জি, আছে!' });
      return json({ lang: 'en', reply: 'Happy to help!' });
    };
    await aiAdmin.startSelfTest(branchId, conn.shadow);
    for (let i = 0; i < 50 && (aiAdmin as unknown as { running: Set<string> }).running.has(conn.shadow); i++) await new Promise((r) => setTimeout(r, 100));
    const c = await prisma.aiConnection.findUniqueOrThrow({ where: { id: conn.shadow } });
    expect(c.selfTestScore).toBe(100);
    expect((c.selfTestDetail as { total: number }).total).toBe(8);
  });

  it('serves the website widget: config, message and polling for staff replies', async () => {
    const sessionId = `${runId}-widget-session-abc`;
    const cfg = await call('GET', `/public/chatbot/config?branchId=${branchId}`);
    expect(cfg.body).toMatchObject({ enabled: true, photos: false });
    expect((await call('POST', '/public/chatbot/message', 'OWNER', { branchId, sessionId: 'short', text: 'hi' })).status).toBe(400);

    scripts[`fake-primary-${runId}`] = () => json({ reply: 'Hi! How can I help?' });
    const sent = await call('POST', '/public/chatbot/message', 'OWNER', { branchId, sessionId, text: 'hello from the site' });
    expect(sent.body).toMatchObject({ status: 'REPLIED', reply: { text: 'Hi! How can I help?' } });

    const conv = await prisma.chatConversation.findUniqueOrThrow({ where: { branchId_channel_externalUserId: { branchId, channel: 'WEB', externalUserId: sessionId } } });
    const staff = await call('POST', `/chatbot/conversations/${conv.id}/reply`, 'MANAGER', { text: 'Hi, this is Nadia from EATRO.' });
    expect(staff.status).toBe(201);
    const poll = await call('GET', `/public/chatbot/messages?branchId=${branchId}&sessionId=${sessionId}`);
    expect(poll.body.staffActive).toBe(true);
    expect(poll.body.messages.map((m: { sender: string; text: string }) => [m.sender, m.text])).toEqual([
      ['CUSTOMER', 'hello from the site'],
      ['BOT', 'Hi! How can I help?'],
      ['STAFF', 'Hi, this is Nadia from EATRO.'],
    ]);
    expect((await call('POST', '/public/chatbot/message', 'OWNER', { branchId, sessionId, text: 'thanks' })).body.status).toBe('HUMAN');
  });
});
