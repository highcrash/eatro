import { INestApplication, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { createHmac } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { AiAdminService } from './ai/ai-admin.service';
import { AiRouterService } from './ai/ai-router.service';
import type { AiRequest, AiTarget } from './ai/ai.types';
import { OpenAiCompatibleProvider } from './ai/openai-compatible.provider';
import { ChatbotModule } from './chatbot.module';
import { ChatbotService, monthStart } from './chatbot.service';
import { ConnectService } from './meta/connect.service';
import { MetaAccountService } from './meta/meta-account.service';
import { MetaClient } from './meta/meta.client';
import { encryptSecret } from './secrets';
import { createTestBranch, deleteTestBranch } from './test-branch';

jest.setTimeout(60_000);

describe('whatsapp: month boundary', () => {
  it('starts the month at local midnight on the 1st', () => {
    expect(monthStart('Asia/Dhaka', new Date('2026-11-15T10:00:00Z')).toISOString()).toBe('2026-10-31T18:00:00.000Z');
    // 1 Dec 02:00 in Dhaka is still 30 Nov in UTC, but it is December's count.
    expect(monthStart('Asia/Dhaka', new Date('2026-11-30T20:00:00Z')).toISOString()).toBe('2026-11-30T18:00:00.000Z');
  });
});

describe('whatsapp: webhook and replies', () => {
  let app: INestApplication;
  let origin: string;
  let prisma: PrismaService;
  let chatbot: ChatbotService;
  let connect: ConnectService;
  let accounts: MetaAccountService;
  let branchId: string;
  let moduleRefGet: <T>(t: new (...args: never[]) => T) => T;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const runId = `w${Date.now().toString(36)}`;
  const PHONE_ID = `10${Date.now()}`;
  const SECRET = 'b'.repeat(32);
  const tail = String(Date.now()).slice(-8);
  const waNumber = (i: number) => `88017${i}${tail.slice(1)}`;
  const wa = {
    sendText: jest.fn().mockResolvedValue({ messageId: 'wamid.out' }),
    sendImage: jest.fn().mockResolvedValue({ messageId: 'wamid.img' }),
    downloadMedia: jest.fn().mockResolvedValue(null),
    subscribeWaba: jest.fn().mockResolvedValue(undefined),
    wabaSubscriptions: jest.fn().mockResolvedValue(['1234567890123']),
  };
  const meta = { subscribeApp: jest.fn().mockResolvedValue(undefined), debugToken: jest.fn(), pageSubscriptions: jest.fn() };
  const noAi = async (): Promise<never> => {
    throw new Error('no AI in this test');
  };
  const ai = { complete: jest.fn<Promise<{ text: string; inputTokens: number; outputTokens: number; latencyMs: number }>, [AiTarget, AiRequest]>(noAi), listModels: jest.fn(), openRouterKeyInfo: jest.fn() };

  const payload = (messages: object[], name = 'Sadia Rahman', from?: string) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: from ?? (messages[0] as { from?: string })?.from, profile: { name } }], messages } }] }],
  });
  const post = async (body: object, signature?: string) => {
    const raw = JSON.stringify(body);
    return fetch(`${origin}/api/v1/chatbot/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature ?? `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` },
      body: raw,
    });
  };
  const settle = async (check: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 40; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('event not processed in time');
  };
  const conv = (from: string) => prisma.chatConversation.findUnique({ where: { branchId_channel_externalUserId: { branchId, channel: 'WHATSAPP', externalUserId: from } } });

  beforeAll(async () => {
    @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]), ChatbotModule] })
    class TestModule {}
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideProvider(RestoraPosGateway)
      .useValue({ emitToBranch: jest.fn(), emitToKds: jest.fn(), emitToOrder: jest.fn(), emitOrderUpdate: jest.fn() })
      .overrideProvider(SmsService)
      .useValue({ sendSms: jest.fn() })
      .overrideProvider(WhatsAppService)
      .useValue(wa)
      .overrideProvider(MetaClient)
      .useValue(meta)
      .overrideProvider(OpenAiCompatibleProvider)
      .useValue(ai)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = moduleRef.get(PrismaService);
    chatbot = moduleRef.get(ChatbotService);
    chatbot.burstWaitMs = 0;
    connect = moduleRef.get(ConnectService);
    accounts = moduleRef.get(MetaAccountService);
    moduleRefGet = (t) => moduleRef.get(t);

    branchId = await createTestBranch(prisma, `whatsapp ${runId}`);
    await chatbot.getSettings(branchId);
    await prisma.chatbotSetting.update({ where: { branchId }, data: { whatsappMode: 'AUTO', whatsappMonthlyCap: 1000 } });
    await prisma.branchSetting.upsert({
      where: { branchId },
      create: { branchId, whatsappPhoneNumberId: PHONE_ID, whatsappWabaId: 'waba-1', whatsappAccessToken: 'wa-token' },
      update: { whatsappPhoneNumberId: PHONE_ID, whatsappWabaId: 'waba-1', whatsappAccessToken: 'wa-token' },
    });
    await accounts.app(branchId);
    await prisma.metaAppSetting.update({ where: { branchId }, data: { appId: '1234567890123', appSecretEnc: encryptSecret(SECRET, accounts.key()) } });
    await prisma.chatQuickReply.create({ data: { branchId, title: `Test ${runId}`, keywords: `wa hours ${runId}`, answer: 'Open 12 to 11.', priority: 99 } });
  });

  beforeEach(() => {
    for (const fn of [...Object.values(wa), ...Object.values(meta)]) fn.mockClear();
  });

  afterAll(async () => {
    if (branchId) await deleteTestBranch(prisma, branchId);
    await app.close();
  });

  it('verifies the webhook address and rejects unsigned events', async () => {
    const token = (await prisma.metaAppSetting.findUniqueOrThrow({ where: { branchId } })).verifyToken;
    const ok = await fetch(`${origin}/api/v1/chatbot/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=xyz`);
    expect([ok.status, await ok.text()]).toEqual([200, 'xyz']);
    expect((await post(payload([]), 'sha256=00')).status).toBe(403);
  });

  it('answers a WhatsApp message once, and keeps the number as the phone', async () => {
    const from = waNumber(1);
    const body = payload([{ from, id: `${runId}-1`, type: 'text', text: { body: `wa hours ${runId}` } }]);
    expect((await post(body)).status).toBe(200);
    await settle(() => wa.sendText.mock.calls.length > 0);
    expect(wa.sendText).toHaveBeenCalledWith({ phoneNumberId: PHONE_ID, accessToken: 'wa-token', to: from, body: 'Open 12 to 11.\n\n- EATRO Assistant (automated)' });
    expect(await conv(from)).toMatchObject({ customerName: 'Sadia Rahman', customerPhone: `017${from.slice(5)}` });
    await post(body);
    await new Promise((r) => setTimeout(r, 400));
    expect(wa.sendText).toHaveBeenCalledTimes(1);
  });

  it('ignores delivery statuses and reactions', async () => {
    await post({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: 'x', status: 'delivered' }] } }] }] });
    await post(payload([{ from: waNumber(2), id: `${runId}-2`, type: 'reaction', reaction: { emoji: '👍' } }]));
    await new Promise((r) => setTimeout(r, 400));
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it('handles photos, voice notes, files and button replies', async () => {
    await post(payload([{ from: waNumber(3), id: `${runId}-3`, type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } }]));
    await settle(() => wa.sendText.mock.calls.length > 0);
    expect(wa.sendText.mock.calls[0][0].body).toContain('Thanks for the photo');
    expect(wa.downloadMedia).not.toHaveBeenCalled(); // photo recognition is off

    wa.sendText.mockClear();
    await post(payload([{ from: waNumber(4), id: `${runId}-4`, type: 'audio', audio: { id: 'a' } }]));
    await settle(() => wa.sendText.mock.calls.length > 0);
    expect(wa.sendText.mock.calls[0][0].body).toContain("can't listen to voice messages");

    wa.sendText.mockClear();
    await post(payload([{ from: waNumber(5), id: `${runId}-5`, type: 'location', location: { latitude: 23.8, longitude: 90.4 } }]));
    await settle(() => wa.sendText.mock.calls.length > 0);
    expect((await conv(waNumber(5)))?.needsStaffReason).toBe('Customer sent a file, location or contact');

    wa.sendText.mockClear();
    await post(payload([{ from: waNumber(6), id: `${runId}-6`, type: 'button', button: { text: `wa hours ${runId}` } }]));
    await settle(() => wa.sendText.mock.calls.length > 0);
    expect(wa.sendText.mock.calls[0][0].body).toContain('Open 12 to 11.');
  });

  it('sends one message per reply: the dish photo with the text as caption', async () => {
    const c = await conv(waNumber(1));
    await chatbot.sendToChannel(c!, 'Here you go', [{ name: 'Kacchi', price: 450, wasPrice: null, imageUrl: 'https://cdn.test/k.jpg', url: 'https://eatrobd.com/menu/kacchi' }]);
    expect(wa.sendImage).toHaveBeenCalledWith(expect.objectContaining({ link: 'https://cdn.test/k.jpg', caption: 'Here you go\n\n• Kacchi: ৳450\nhttps://eatrobd.com/menu/kacchi' }));
    expect(wa.sendText).not.toHaveBeenCalled();
    await chatbot.sendToChannel(c!, 'No photo', [{ name: 'Tea', price: 30, wasPrice: null, imageUrl: null, url: 'https://eatrobd.com/menu/tea' }]);
    expect(wa.sendText).toHaveBeenCalledTimes(1);
  });

  it('refuses to reply outside the 24-hour window', async () => {
    const c = await prisma.chatConversation.update({ where: { id: (await conv(waNumber(1)))!.id }, data: { lastCustomerMessageAt: new Date(Date.now() - 25 * 3600_000) } });
    await expect(chatbot.sendToChannel(c, 'late', [])).rejects.toThrow(/OUTSIDE_WINDOW/);
  });

  it('stops auto-replying at the monthly limit and hands the chat to staff', async () => {
    const used = await chatbot.whatsappSentThisMonth(branchId);
    expect(used).toBeGreaterThan(0);
    await prisma.chatbotSetting.update({ where: { branchId }, data: { whatsappMonthlyCap: used } });
    const res = await chatbot.handleIncoming({ branchId, channel: 'WHATSAPP', externalUserId: waNumber(7), text: `wa hours ${runId}`, externalId: `${runId}-7` });
    expect(res.status).toBe('CAPPED');
    expect(wa.sendText).not.toHaveBeenCalled();
    expect((await conv(waNumber(7)))?.needsStaffReason).toMatch(/WhatsApp monthly limit reached/);
    await prisma.chatbotSetting.update({ where: { branchId }, data: { whatsappMonthlyCap: 1000 } });
  });

  it('answers a burst of messages once, and a message sent mid-reply in its own turn', async () => {
    const owner = await prisma.staff.findFirstOrThrow({ where: { role: 'OWNER', isActive: true } });
    const user = { sub: owner.id, role: 'OWNER', branchId } as never;
    const c = await moduleRefGet(AiAdminService).create(branchId, { name: `Burst ${runId}`, provider: 'OPENAI_COMPATIBLE', apiKey: 'sk-test-burst-1234', model: `fake-burst-${runId}`, inputPricePerM: 0, outputPricePerM: 0 }, user);
    await prisma.aiConnection.update({ where: { id: c.id }, data: { selfTestScore: 90 } });
    await prisma.aiRoute.upsert({ where: { branchId_job: { branchId, job: 'CHAT' } }, create: { branchId, job: 'CHAT', connectionIds: [c.id] }, update: { connectionIds: [c.id] } });
    moduleRefGet(AiRouterService).invalidate(branchId);

    const seen: AiRequest[] = [];
    let thinkMs = 50;
    ai.complete.mockImplementation(async (_target, request) => {
      seen.push(request);
      const n = seen.length;
      await pause(thinkMs);
      return { text: JSON.stringify({ lang: 'banglish', reply: `uttor ${n}`, items: [], action: null }), inputTokens: 10, outputTokens: 5, latencyMs: 5 };
    });
    chatbot.burstWaitMs = 300;
    const from = waNumber(9);
    const send = (i: number, text: string) => chatbot.handleIncoming({ branchId, channel: 'WHATSAPP', externalUserId: from, text, externalId: `${runId}-b${i}` });
    try {
      // Three messages typed quickly: one AI request, one reply.
      const first = await Promise.all([send(1, 'vai'), pause(40).then(() => send(2, 'jhal kichu ache?')), pause(80).then(() => send(3, 'dam koto'))]);
      expect(first.map((r) => r.status)).toEqual(['MERGED', 'MERGED', 'REPLIED']);
      expect(seen).toHaveLength(1);
      expect(seen[0].messages.filter((m) => m.role === 'user')).toHaveLength(1);
      expect(seen[0].messages.at(-1)!.content).toMatch(/\nvai\njhal kichu ache\?\ndam koto$/);

      // A message that arrives while a reply is being written waits for it,
      // and is answered alone, with that reply in the history.
      thinkMs = 700;
      const a = send(4, 'ar ki ache');
      await pause(350);
      const b = send(5, 'thik ache, ar?');
      expect((await a).status).toBe('REPLIED');
      expect((await b).status).toBe('REPLIED');
      expect(seen).toHaveLength(3);
      const last = seen[2].messages;
      expect(last.at(-1)!.content).toMatch(/\nthik ache, ar\?$/);
      expect(last.at(-1)!.content).not.toContain('ar ki ache');
      expect(last.at(-2)).toEqual({ role: 'assistant', content: 'uttor 2' });

      // The "automated" note goes on the first reply only.
      const bodies = wa.sendText.mock.calls.map((call) => (call[0] as { to: string; body: string })).filter((m) => m.to === from).map((m) => m.body);
      expect(bodies).toHaveLength(3);
      expect(bodies.filter((t) => t.includes('(automated)'))).toHaveLength(1);
      expect(bodies[0]).toContain('(automated)');
    } finally {
      chatbot.burstWaitMs = 0;
      ai.complete.mockImplementation(noAi);
    }
  });

  it('connects the WhatsApp number to the assistant from the Connect tab', async () => {
    const owner = await prisma.staff.findFirstOrThrow({ where: { role: 'OWNER', isActive: true } });
    const status = await connect.subscribeWhatsApp(branchId, { sub: owner.id, role: 'OWNER', branchId } as never);
    expect(meta.subscribeApp).toHaveBeenCalledWith('1234567890123', SECRET, 'whatsapp_business_account', expect.stringContaining('/chatbot/webhook/whatsapp'), expect.any(String), ['messages']);
    expect(wa.subscribeWaba).toHaveBeenCalledWith({ wabaId: 'waba-1', accessToken: 'wa-token' });
    expect(status.whatsapp).toMatchObject({ phoneNumberId: PHONE_ID, tokenSet: true });
    expect(status.whatsapp.subscribedAt).not.toBeNull();
    expect(status.health.find((h) => h.key === 'whatsapp')?.ok).toBe(true);
    expect(JSON.stringify(status)).not.toContain('wa-token');
  });
});
