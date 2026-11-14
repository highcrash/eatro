import { ExecutionContext, INestApplication, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { OpenAiCompatibleProvider } from './ai/openai-compatible.provider';
import { ChatbotModule } from './chatbot.module';
import { ChatbotService } from './chatbot.service';
import { ComplaintService } from './complaint.service';
import { PushService, WebPushSender } from './push/push.service';
import { createTestBranch, deleteTestBranch } from './test-branch';

jest.setTimeout(60_000);

describe('staff chat app: access and notifications', () => {
  let app: INestApplication;
  let origin: string;
  let prisma: PrismaService;
  let chatbot: ChatbotService;
  let complaints: ComplaintService;
  let push: PushService;
  let branchId: string;
  const runId = `s${Date.now().toString(36)}`;
  const staff: Record<'owner' | 'on' | 'off', string> = { owner: '', on: '', off: '' };
  const role: Record<keyof typeof staff, string> = { owner: 'OWNER', on: 'WAITER', off: 'WAITER' };
  const sender = {
    send: jest.fn().mockResolvedValue({ statusCode: 201 }),
    generateKeys: jest.fn(() => new WebPushSender().generateKeys()),
  };

  const call = async (who: keyof typeof staff, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${origin}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-test-sub': staff[who], 'x-test-role': role[who], 'x-test-branch': branchId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const endpoint = (n: number) => `https://push.example.test/${runId}/${n}`;
  const subscribe = (who: keyof typeof staff, n: number) => call(who, 'POST', '/chatbot/push/subscribe', { endpoint: endpoint(n), keys: { p256dh: `p256-${n}`, auth: `auth-${n}` } });
  const newConversation = (name: string) =>
    prisma.chatConversation.create({ data: { branchId, channel: 'MESSENGER', externalUserId: `${runId}-${name}`, customerName: name, lastCustomerMessageAt: new Date() } });

  beforeAll(async () => {
    @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]), ChatbotModule] })
    class TestModule {}
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideProvider(RestoraPosGateway)
      .useValue({ emitToBranch: jest.fn(), emitToKds: jest.fn(), emitToOrder: jest.fn(), emitOrderUpdate: jest.fn() })
      .overrideProvider(SmsService)
      .useValue({ sendSms: jest.fn().mockResolvedValue(true) })
      .overrideProvider(WhatsAppService)
      .useValue({ sendText: jest.fn(), sendImage: jest.fn() })
      .overrideProvider(OpenAiCompatibleProvider)
      .useValue({ complete: jest.fn().mockRejectedValue(new Error('no AI in this test')) })
      .overrideProvider(WebPushSender)
      .useValue(sender)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { sub: req.headers['x-test-sub'], role: req.headers['x-test-role'], branchId: req.headers['x-test-branch'] };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = moduleRef.get(PrismaService);
    chatbot = moduleRef.get(ChatbotService);
    complaints = moduleRef.get(ComplaintService);
    push = moduleRef.get(PushService);

    branchId = await createTestBranch(prisma, `staff ${runId}`);
    for (const k of ['owner', 'on', 'off'] as const) {
      const s = await prisma.staff.create({
        data: { branchId, name: `Test ${k} ${runId}`, email: `${k}-${runId}@test.local`, passwordHash: 'x', role: role[k] as never, canHandleChats: k === 'on' },
      });
      staff[k] = s.id;
    }
  });

  beforeEach(() => {
    sender.send.mockClear();
    sender.send.mockResolvedValue({ statusCode: 201 });
  });

  afterAll(async () => {
    if (branchId) await deleteTestBranch(prisma, branchId);
    await app.close();
  });

  it('lets in Owner and staff with "Can handle chats", and keeps settings for managers', async () => {
    expect((await call('off', 'GET', '/chatbot/conversations')).status).toBe(403);
    expect((await call('off', 'GET', '/chatbot/comments')).status).toBe(403);
    expect((await call('on', 'GET', '/chatbot/conversations')).status).toBe(200);
    expect((await call('on', 'GET', '/chatbot/comments')).status).toBe(200);
    expect((await call('owner', 'GET', '/chatbot/conversations')).status).toBe(200);
    expect((await call('on', 'GET', '/chatbot/settings')).status).toBe(403);
    expect((await call('owner', 'GET', '/chatbot/settings')).status).toBe(200);
    const me = await call('on', 'GET', '/chatbot/staff/me');
    expect(me.body).toMatchObject({ id: staff.on, role: 'WAITER', branchId });
  });

  it('saves a phone subscription and sends a test notification', async () => {
    expect((await call('on', 'GET', '/chatbot/push/key')).body.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect((await call('on', 'POST', '/chatbot/push/subscribe', { endpoint: 'http://not-secure', keys: { p256dh: 'a', auth: 'b' } })).status).toBe(400);
    expect((await subscribe('on', 1)).status).toBe(201);
    const res = await call('on', 'POST', '/chatbot/push/test');
    expect(res.body).toEqual({ devices: 1, sent: 1 });
    expect(sender.send).toHaveBeenCalledWith({ endpoint: endpoint(1), keys: { p256dh: 'p256-1', auth: 'auth-1' } }, expect.stringContaining('Notifications are working'), expect.objectContaining({ publicKey: expect.any(String), privateKey: expect.any(String) }));
  });

  it('notifies once per chat in 5 minutes, without the customer message, and skips staff without access', async () => {
    await subscribe('owner', 2);
    // Someone whose switch is off never gets chat notifications.
    await prisma.staffPushSubscription.create({ data: { staffId: staff.off, branchId, endpoint: endpoint(3), p256dh: 'p', auth: 'a' } });
    const conv = await newConversation('Rahim');
    await chatbot.flagStaff(conv, 'Customer needs a team member', false);
    await new Promise((r) => setTimeout(r, 200));
    const targets = sender.send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();
    expect(targets).toEqual([endpoint(1), endpoint(2)]);
    const note = JSON.parse(sender.send.mock.calls[0][1] as string);
    expect(note).toEqual({ title: 'Rahim needs a reply', body: 'Messenger: Customer needs a team member', url: `/chat/${conv.id}`, tag: `chat-${conv.id}` });

    for (let i = 0; i < 4; i++) await chatbot.flagStaff(conv, 'again', false);
    await new Promise((r) => setTimeout(r, 200));
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('notifies about a complaint with the topic only', async () => {
    const conv = await newConversation('Karim');
    await complaints.create({ branchId, source: 'CHAT', level: 'SERIOUS', topic: 'HYGIENE', text: 'there was a hair in my soup', conversationId: conv.id, channel: 'MESSENGER', customerName: 'Karim' });
    await new Promise((r) => setTimeout(r, 200));
    const note = JSON.parse(sender.send.mock.calls[0][1] as string);
    expect(note.title).toBe('Serious complaint: Karim');
    expect(JSON.stringify(note)).not.toContain('hair');
  });

  it('removes a subscription the phone has dropped', async () => {
    sender.send.mockResolvedValue({ statusCode: 410 });
    const conv = await newConversation('Sadia');
    expect(await push.notifyBranch(branchId, { title: 't', body: 'b', url: '/', tag: 't' }, conv.id)).toBe(0);
    expect(await prisma.staffPushSubscription.count({ where: { branchId, staffId: { in: [staff.on, staff.owner] } } })).toBe(0);
  });
});
