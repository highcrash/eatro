import { INestApplication, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { AiAdminService } from './ai/ai-admin.service';
import { AiRouterService } from './ai/ai-router.service';
import type { AiRequest, AiTarget } from './ai/ai.types';
import { OpenAiCompatibleProvider } from './ai/openai-compatible.provider';
import { ChatbotModule } from './chatbot.module';
import { ChatbotService } from './chatbot.service';
import { MetaClient } from './meta/meta.client';
import { createTestBranch, deleteTestBranch } from './test-branch';
import { greetingOnly } from './text';
import { codeIn } from './verification.service';

jest.setTimeout(60_000);

describe('chat verification: pure pieces', () => {
  it('reads a code however it is typed, and only when the line is just the code', () => {
    expect(codeIn('123456')).toBe('123456');
    expect(codeIn('123 456')).toBe('123456');
    expect(codeIn('১২৩৪৫৬')).toBe('123456');
    expect(codeIn('ok\n482913')).toBe('482913');
    expect(codeIn('table for 4 at 8pm')).toBeNull();
    expect(codeIn('01712345678')).toBeNull();
  });

  it('treats greetings and thanks as nothing asked yet', () => {
    expect(greetingOnly('Assalamu alaikum vai')).toBe(true);
    expect(greetingOnly('hi!')).toBe(true);
    expect(greetingOnly('আসসালামু আলাইকুম')).toBe(true);
    expect(greetingOnly('biryani ache?')).toBe(false);
  });
});

describe('chat verification: codes, customers and the welcome coupon', () => {
  let app: INestApplication;
  let origin: string;
  let prisma: PrismaService;
  let chatbot: ChatbotService;
  let branchId: string;
  const runId = `v${Date.now().toString(36)}`;
  const tail = String(Date.now()).slice(-7);
  const phone = (n: number) => `017${n}${tail}`;
  const PAGE = `55${Date.now()}`;

  const sms = { sendSms: jest.fn().mockResolvedValue(true) };
  const meta = { sendText: jest.fn().mockResolvedValue(['mid.out']), sendCards: jest.fn().mockResolvedValue(undefined), subscribeApp: jest.fn(), debugToken: jest.fn(), pageSubscriptions: jest.fn() };
  const wa = { sendText: jest.fn().mockResolvedValue({ messageId: 'wamid.out' }), sendImage: jest.fn(), downloadMedia: jest.fn().mockResolvedValue(null) };
  const seen: AiRequest[] = [];
  const ai = {
    complete: jest.fn(async (_t: AiTarget, request: AiRequest) => {
      seen.push(request);
      return { text: JSON.stringify({ lang: 'en', reply: 'We have pasta and burgers.', items: [], action: null }), inputTokens: 10, outputTokens: 5, latencyMs: 5 };
    }),
    listModels: jest.fn(),
    openRouterKeyInfo: jest.fn(),
  };

  const codeSentTo = (to: string) => {
    const call = [...sms.sendSms.mock.calls].reverse().find((c) => c[1] === to && /code is \d{6}/.test(c[2] as string));
    return call ? /code is (\d{6})/.exec(call[2] as string)![1] : null;
  };
  const messenger = (user: string, text: string, extra: object = {}) =>
    chatbot.handleIncoming({ branchId, channel: 'MESSENGER', externalUserId: `${runId}-${user}`, text, customerName: 'Rafi Hasan', ...extra });
  const convOf = (channel: 'MESSENGER' | 'WEB' | 'WHATSAPP', user: string) =>
    prisma.chatConversation.findUniqueOrThrow({ where: { branchId_channel_externalUserId: { branchId, channel, externalUserId: user } } });
  const setSms = (on: boolean) => prisma.branchSetting.update({ where: { branchId }, data: { smsEnabled: on, smsApiKey: on ? 'test-key' : null } });

  beforeAll(async () => {
    @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]), ChatbotModule] })
    class TestModule {}
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideProvider(RestoraPosGateway)
      .useValue({ emitToBranch: jest.fn(), emitToKds: jest.fn(), emitToOrder: jest.fn(), emitOrderUpdate: jest.fn() })
      .overrideProvider(SmsService)
      .useValue(sms)
      .overrideProvider(MetaClient)
      .useValue(meta)
      .overrideProvider(WhatsAppService)
      .useValue(wa)
      .overrideProvider(OpenAiCompatibleProvider)
      .useValue(ai)
      .compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = moduleRef.get(PrismaService);
    chatbot = moduleRef.get(ChatbotService);
    chatbot.burstWaitMs = 0;
    moduleRef.get(AiRouterService).retryDelayMs = 0;

    branchId = await createTestBranch(prisma, `verify ${runId}`);
    await chatbot.getSettings(branchId);
    await prisma.chatbotSetting.update({ where: { branchId }, data: { webMode: 'AUTO', messengerMode: 'AUTO', whatsappMode: 'AUTO', welcomeCouponPercent: 5, welcomeCouponDays: 30 } });
    await prisma.branchSetting.upsert({
      where: { branchId },
      create: { branchId, fbPageId: PAGE, fbPageAccessToken: 'page-token', whatsappPhoneNumberId: `9${PAGE}`, whatsappAccessToken: 'wa-token', smsEnabled: true, smsApiKey: 'test-key' },
      update: {},
    });
    const owner = await prisma.staff.findFirstOrThrow({ where: { role: 'OWNER', isActive: true } });
    const c = await moduleRef.get(AiAdminService).create(branchId, { name: `Verify ${runId}`, provider: 'OPENAI_COMPATIBLE', apiKey: 'sk-test-verify-1234', model: `fake-verify-${runId}`, inputPricePerM: 0, outputPricePerM: 0 }, { sub: owner.id, role: 'OWNER', branchId } as never);
    await prisma.aiConnection.update({ where: { id: c.id }, data: { selfTestScore: 90 } });
    await prisma.aiRoute.create({ data: { branchId, job: 'CHAT', connectionIds: [c.id] } });
    moduleRef.get(AiRouterService).invalidate(branchId);
  });

  beforeEach(() => {
    sms.sendSms.mockClear();
    ai.complete.mockClear();
    seen.length = 0;
  });

  afterAll(async () => {
    if (branchId) {
      await prisma.coupon.deleteMany({ where: { branchId } });
      await deleteTestBranch(prisma, branchId);
    }
    await app.close();
  });

  it('Messenger: offers the coupon once, texts a code for a number, and verifies it without the AI', async () => {
    // A bare greeting gets no offer.
    let res = await messenger('a', 'Assalamu alaikum');
    expect(res.reply!.text).not.toMatch(/welcome coupon/);

    res = await messenger('a', 'what pasta do you have?');
    expect(res.reply!.text).toMatch(/text you a 5% welcome coupon/);
    expect((await convOf('MESSENGER', `${runId}-a`)).numberInvites).toBe(1);

    // Not again in the same sitting.
    res = await messenger('a', 'and burgers?');
    expect(res.reply!.text).not.toMatch(/welcome coupon/);

    res = await messenger('a', `sure, ${phone(1)}`);
    expect(res.reply!.text).toMatch(/texted a 6-digit code/);
    const code = codeSentTo(phone(1));
    expect(code).toMatch(/^\d{6}$/);
    // The AI never sees the number.
    expect(JSON.stringify(seen)).not.toContain(phone(1));

    const callsBefore = ai.complete.mock.calls.length;
    const wrong = code === '000000' ? '111111' : '000000';
    res = await messenger('a', wrong);
    expect(res.reply!.text).toMatch(/doesn't match.*4 tries left/);

    res = await messenger('a', code!.split('').join(' '));
    expect(res.reply!.text).toMatch(/^Thank you, Rafi Hasan, your number is verified\. We've texted you a 5% welcome coupon/);
    expect(ai.complete.mock.calls.length).toBe(callsBefore);

    // Codes are stored as a placeholder only.
    const conv = await convOf('MESSENGER', `${runId}-a`);
    const texts = (await prisma.chatMessage.findMany({ where: { conversationId: conv.id, sender: 'CUSTOMER' } })).map((m) => m.text);
    expect(texts.filter((t) => t === '[verification code]')).toHaveLength(2);
    expect(texts.join(' ')).not.toContain(code!);

    // Linked to a new customer with one welcome coupon, sent by SMS.
    expect(conv.verifiedPhone).toBe(phone(1));
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: conv.customerId! } });
    expect(customer).toMatchObject({ phone: phone(1), name: 'Rafi Hasan' });
    const coupons = await prisma.coupon.findMany({ where: { customerId: customer.id } });
    expect(coupons).toHaveLength(1);
    expect(coupons[0]).toMatchObject({ campaignTag: 'first-visit', type: 'PERCENTAGE', maxUses: 1 });
    expect(Number(coupons[0].value)).toBe(5);
    expect(sms.sendSms).toHaveBeenCalledWith(branchId, phone(1), expect.stringContaining(coupons[0].code));

    // The AI now knows the number is verified.
    await messenger('a', 'do you have pasta?');
    expect(seen.at(-1)!.messages.at(-1)!.content).toMatch(/customer phone on file: yes \(verified\)/);
    expect(seen.at(-1)!.messages.map((m) => m.content).join(' ')).not.toContain(code!);
  });

  it('locks a code after five wrong tries', async () => {
    await messenger('b', `my number ${phone(2)}`);
    const code = codeSentTo(phone(2))!;
    const wrong = code === '000000' ? '111111' : '000000';
    let res;
    for (let i = 0; i < 5; i++) res = await messenger('b', wrong);
    expect(res!.reply!.text).toMatch(/tried too many times/);
    res = await messenger('b', code);
    expect(res.reply!.text).toMatch(/tried too many times/);
    expect((await convOf('MESSENGER', `${runId}-b`)).verifiedPhone).toBeNull();
  });

  it('sends at most three codes per chat per day', async () => {
    for (const n of [3, 4, 5]) {
      const res = await messenger('c', `call me on ${phone(n)}`);
      expect(res.reply!.text).toMatch(/texted a 6-digit code/);
    }
    const res = await messenger('c', `or ${phone(6)}`);
    expect(res.reply!.text).toMatch(/can't send another code today/);
    expect(codeSentTo(phone(6))).toBeNull();
  });

  it('a returning customer is recognised and gets no coupon', async () => {
    const regular = await prisma.customer.create({ data: { branchId, phone: phone(7), name: 'Nadia Islam', totalOrders: 4 } });
    await messenger('d', `${phone(7)}`);
    const res = await messenger('d', codeSentTo(phone(7))!);
    expect(res.reply!.text).toBe('Welcome back, Nadia Islam! Your number is verified.');
    expect((await convOf('MESSENGER', `${runId}-d`)).customerId).toBe(regular.id);
    expect(await prisma.coupon.count({ where: { customerId: regular.id } })).toBe(0);

    await messenger('d', 'any offers?');
    expect(seen.at(-1)!.messages.at(-1)!.content).toMatch(/returning customer, 4 visits/);
  });

  it('website card: name and number, then the code; the chat shows the confirmation', async () => {
    const session = `${runId}web0000000000000`;
    const post = (path: string, body: object) =>
      fetch(`${origin}/api/v1/public/chatbot/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branchId, sessionId: session, ...body }) });

    const config = (await (await fetch(`${origin}/api/v1/public/chatbot/config?branchId=${branchId}`)).json()) as { verify: unknown };
    expect(config.verify).toEqual({ coupon: 5 });

    expect((await post('verify/start', { name: 'Tania', phone: phone(8) })).status).toBe(400); // no chat yet
    await chatbot.handleIncoming({ branchId, channel: 'WEB', externalUserId: session, text: 'what pasta do you have?' });
    expect((await post('verify/start', { name: 'Tania', phone: '12345' })).status).toBe(400);
    const started = await post('verify/start', { name: 'Tania', phone: phone(8) });
    expect(await started.json()).toEqual({ status: 'SENT' });

    const bad = await post('verify/confirm', { code: codeSentTo(phone(8)) === '000000' ? '111111' : '000000' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toMatch(/4 tries left/);

    const ok = await post('verify/confirm', { code: codeSentTo(phone(8)) });
    expect(await ok.json()).toMatchObject({ status: 'VERIFIED', name: 'Tania', returning: false, coupon: { percent: 5 } });

    const thread = (await (await fetch(`${origin}/api/v1/public/chatbot/messages?branchId=${branchId}&sessionId=${session}`)).json()) as { verified: boolean; messages: { text: string }[] };
    expect(thread.verified).toBe(true);
    expect(thread.messages.at(-1)!.text).toMatch(/^Thank you, Tania, your number is verified/);
  });

  it('WhatsApp numbers count as verified with no code, and get the coupon once', async () => {
    const from = `880${phone(9).slice(1)}`;
    await chatbot.handleIncoming({ branchId, channel: 'WHATSAPP', externalUserId: from, knownPhone: phone(9), text: 'what pasta do you have?', customerName: 'Sadia' });
    const conv = await convOf('WHATSAPP', from);
    expect(conv.verifiedPhone).toBe(phone(9));
    expect(codeSentTo(phone(9))).toBeNull();
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
    expect(sms.sendSms.mock.calls[0][2]).toMatch(/welcome coupon/);
    expect(wa.sendText.mock.calls.at(-1)![0].body).toMatch(/We've texted you a 5% welcome coupon/);

    // A second chat from the same number never gets a second coupon.
    await prisma.chatConversation.update({ where: { id: conv.id }, data: { verifiedPhone: null } });
    await chatbot.handleIncoming({ branchId, channel: 'WHATSAPP', externalUserId: from, knownPhone: phone(9), text: 'and burgers?' });
    expect(await prisma.coupon.count({ where: { customerId: conv.customerId! } })).toBe(1);
  });

  it('sends nothing from the Test bot or when SMS is not set up', async () => {
    const res = await chatbot.handleIncoming({ branchId, channel: 'WEB', externalUserId: `test:${runId}`, text: `book for 2, ${phone(0)}`, isTest: true });
    expect(res.reply!.text).not.toMatch(/code/);
    await setSms(false);
    try {
      const r1 = await messenger('e', 'what pasta do you have?');
      expect(r1.reply!.text).not.toMatch(/welcome coupon/);
      const r2 = await messenger('e', `${phone(0)}`);
      expect(r2.reply!.text).not.toMatch(/code/);
      const config = (await (await fetch(`${origin}/api/v1/public/chatbot/config?branchId=${branchId}`)).json()) as { verify: unknown };
      expect(config.verify).toBeNull();
    } finally {
      await setSms(true);
    }
    expect(sms.sendSms).not.toHaveBeenCalled();
  });
});
