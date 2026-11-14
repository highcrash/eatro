import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { ChatbotSetting } from '@prisma/client';
import { createHmac } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { OpenAiCompatibleProvider } from './ai/openai-compatible.provider';
import { ChatbotModule } from './chatbot.module';
import { ChatbotService } from './chatbot.service';
import { classifyComment, complaintLevel } from './classify';
import { CommentService } from './comment.service';
import { ComplaintService } from './complaint.service';
import { buildMenuSnapshot, matchDishes, MenuContextService } from './menu-context';
import { ConnectService } from './meta/connect.service';
import { MetaAccountService } from './meta/meta-account.service';
import { validSignature } from './meta/meta-webhook.service';
import { cardsTemplate, MetaClient, splitMessage } from './meta/meta.client';
import { encryptSecret } from './secrets';
import { createTestBranch, deleteTestBranch } from './test-branch';

jest.setTimeout(60_000);

// ─── Pure pieces ─────────────────────────────────────────────────────────────

describe('social: pure pieces', () => {
  it.each([
    ['price?', 'PRICE'],
    ['dam koto?', 'PRICE'],
    ['pp', 'PRICE'],
    ['দাম কত?', 'PRICE'],
    ['can we book a table for 6 tonight?', 'BOOKING'],
    ['birthday party kora jabe?', 'BOOKING'],
    ['kothay apnara?', 'INFO'],
    ['love this place ❤️', 'PRAISE'],
    ['অসাধারণ খাবার', 'PRAISE'],
    ['the food was cold and service slow', 'COMPLAINT'],
    ['price ta beshi but food was cold', 'COMPLAINT'],
    ['😍😍', 'IGNORE'],
    ['Rahim Ahmed', 'IGNORE'],
    ['@nadia cholo jai', 'IGNORE'],
    ['Earn 5000 daily visit bit.ly/xyz', 'SPAM'],
    ['menu here https://eatrobd.com/menu dam koto', 'PRICE'],
    ['you bastards', 'ABUSE'],
    ['my cousin went there with her colleagues last week', 'OTHER'],
  ])('sorts "%s" as %s', (text, kind) => {
    expect(classifyComment(text).kind).toBe(kind);
  });

  it('grades complaints', () => {
    expect(complaintLevel('found a hair in my biryani')).toBe('SERIOUS');
    expect(complaintLevel('got sick after eating here')).toBe('SERIOUS');
    expect(complaintLevel('খাবারে তেলাপোকা')).toBe('SERIOUS');
    expect(complaintLevel('we waited 50 minutes')).toBe('ORDINARY');
    expect(complaintLevel('a bit pricey')).toBe('MILD');
    expect(complaintLevel('chocolate cake please')).toBeNull();
    expect(classifyComment('a bit pricey but delicious').kind).toBe('PRAISE');
  });

  it('checks Meta signatures against the raw body', () => {
    const body = Buffer.from('{"object":"page"}');
    const sig = `sha256=${createHmac('sha256', 'secret-a').update(body).digest('hex')}`;
    expect(validSignature(body, sig, ['other', 'secret-a'])).toBe(true);
    expect(validSignature(body, sig, ['other'])).toBe(false);
    expect(validSignature(Buffer.from('{"object":"pagex"}'), sig, ['secret-a'])).toBe(false);
    expect(validSignature(body, undefined, ['secret-a'])).toBe(false);
  });

  it('matches dishes named in a caption, longest name first', () => {
    const menu = buildMenuSnapshot(
      {
        categories: [{ id: 'c', name: 'Burgers', parentId: null, sortOrder: 1 }],
        items: [
          { id: 'b1', categoryId: 'c', name: 'Cheese Burger', price: 30_000, sortOrder: 1 },
          { id: 'b2', categoryId: 'c', name: 'Chicken Cheese Burger', price: 38_000, sortOrder: 2 },
          { id: 'b3', categoryId: 'c', name: 'Fries', price: 15_000, sortOrder: 3 },
        ],
      },
      'https://eatrobd.com',
    );
    expect(matchDishes('🔥 New! Chicken Cheese Burger, only today', menu)).toEqual(['b2']);
    expect(matchDishes('Cheese Burger + Fries combo', menu)).toEqual(['b1', 'b3']);
    expect(matchDishes('Happy Friday!', menu)).toEqual([]);
  });

  it('splits long messages and builds dish cards', () => {
    const parts = splitMessage(`${'a'.repeat(1500)}\n\n${'b'.repeat(1500)}`);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
    const t = cardsTemplate([{ name: 'X'.repeat(100), price: 450, wasPrice: 500, imageUrl: 'https://x/y.jpg', url: 'https://eatrobd.com/menu/x' }], 'https://eatrobd.com/reservation');
    const el = t.attachment.payload.elements[0];
    expect(el.title.length).toBe(80);
    expect(el.subtitle).toBe('৳450 (regular ৳500)');
    expect(el.buttons.map((b) => b.title)).toEqual(['View dish', 'Book a table']);
  });
});

// ─── Webhooks, comments and complaints against the local database ────────────

describe('social: webhooks, comments, complaints', () => {
  let app: INestApplication;
  let origin: string;
  let prisma: PrismaService;
  let chatbot: ChatbotService;
  let comments: CommentService;
  let complaints: ComplaintService;
  let connect: ConnectService;
  let accounts: MetaAccountService;
  let menus: MenuContextService;
  let branchId: string;
  let ownerId: string;
  const runId = `s${Date.now().toString(36)}`;
  const PAGE = `9${Date.now()}`;
  const IG = `17${Date.now()}`;
  const APP_ID = '1234567890123';
  const SECRET = 'a'.repeat(32);
  const dishName = `Test Social Kacchi ${runId}`;
  let dishId: string;
  let categoryId: string;
  let discountId: string;
  const sms = { sendSms: jest.fn().mockResolvedValue(true) };
  const meta = {
    sendText: jest.fn().mockResolvedValue(['mid.out']),
    sendCards: jest.fn().mockResolvedValue(undefined),
    userName: jest.fn().mockResolvedValue('Rafi Hasan'),
    replyToComment: jest.fn().mockResolvedValue('reply-1'),
    likeComment: jest.fn().mockResolvedValue(undefined),
    setHidden: jest.fn().mockResolvedValue(undefined),
    postDetails: jest.fn().mockResolvedValue({ caption: null, permalink: null }),
    recentComments: jest.fn().mockResolvedValue([]),
    loginUrl: jest.fn((_appId: string, _redirect: string, state: string) => `https://facebook.test/oauth?state=${encodeURIComponent(state)}`),
    exchangeCode: jest.fn().mockResolvedValue('user-token'),
    pages: jest.fn(),
    grantedScopes: jest.fn().mockResolvedValue(['pages_messaging']),
    subscribeApp: jest.fn().mockResolvedValue(undefined),
    subscribePage: jest.fn().mockResolvedValue(undefined),
    pageSubscriptions: jest.fn().mockResolvedValue(['messages', 'message_echoes', 'feed']),
    debugToken: jest.fn().mockResolvedValue({ valid: true, expiresAt: null, scopes: ['pages_messaging'] }),
  };

  const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  const post = async (payload: object, signature?: string) => {
    const body = JSON.stringify(payload);
    return fetch(`${origin}/api/v1/chatbot/webhook/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature ?? sign(body) }, body });
  };
  const settle = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 40; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('webhook event was not processed in time');
  };
  const message = (from: string, text: string, mid: string, extra: object = {}) => ({
    object: 'page',
    entry: [{ id: PAGE, time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: PAGE }, timestamp: Date.now(), message: { mid, text, ...extra } }] }],
  });
  const comment = (input: { id: string; text: string; from?: string; name?: string; post?: string }) =>
    comments.handle({ branchId, platform: 'FACEBOOK', postId: input.post ?? `${PAGE}_111`, commentId: `${runId}-${input.id}`, authorId: input.from ?? `u-${input.id}`, authorName: input.name ?? 'Nadia Islam', text: input.text });
  const setSettings = (data: Partial<ChatbotSetting>) => prisma.chatbotSetting.update({ where: { branchId }, data });

  beforeAll(async () => {
    @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]), ChatbotModule] })
    class TestModule {}
    const { Test } = await import('@nestjs/testing');
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideProvider(RestoraPosGateway)
      .useValue({ emitToBranch: jest.fn(), emitToKds: jest.fn(), emitToOrder: jest.fn(), emitOrderUpdate: jest.fn() })
      .overrideProvider(SmsService)
      .useValue(sms)
      .overrideProvider(MetaClient)
      .useValue(meta)
      .overrideProvider(OpenAiCompatibleProvider)
      .useValue({ complete: jest.fn().mockRejectedValue(new Error('no AI in this test')) })
      .compile();
    void NestFactory;
    app = moduleRef.createNestApplication({ rawBody: true });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    prisma = moduleRef.get(PrismaService);
    chatbot = moduleRef.get(ChatbotService);
    chatbot.burstWaitMs = 0;
    comments = moduleRef.get(CommentService);
    complaints = moduleRef.get(ComplaintService);
    connect = moduleRef.get(ConnectService);
    accounts = moduleRef.get(MetaAccountService);
    menus = moduleRef.get(MenuContextService);

    branchId = await createTestBranch(prisma, `social ${runId}`);
    ownerId = (await prisma.staff.findFirstOrThrow({ where: { role: 'OWNER', isActive: true } })).id;
    await chatbot.getSettings(branchId);
    await setSettings({ messengerMode: 'AUTO', instagramMode: 'AUTO', commentMode: 'AUTO', complaintMode: 'DRAFT', autoHideSpam: false, complaintSmsEnabled: false, managerPhone: null, commentHourlyCap: 30 });

    await prisma.branchSetting.upsert({ where: { branchId }, create: { branchId, fbPageId: PAGE, fbPageName: 'Test Page', fbPageAccessToken: 'page-token' }, update: { fbPageId: PAGE, fbPageName: 'Test Page', fbPageAccessToken: 'page-token' } });
    await accounts.app(branchId);
    await prisma.metaAppSetting.update({ where: { branchId }, data: { appId: APP_ID, appSecretEnc: encryptSecret(SECRET, accounts.key()), igUserId: IG, igUsername: 'eatro.test', pageSubscribedAt: new Date() } });

    categoryId = (await prisma.menuCategory.create({ data: { branchId, name: `Test Social ${runId}` } })).id;
    dishId = (await prisma.menuItem.create({ data: { branchId, categoryId, name: dishName, type: 'FOOD', price: 45_000 } })).id;
    discountId = (await prisma.menuItemDiscount.create({ data: { menuItemId: dishId, type: 'FLAT', value: 0, startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 86_400_000), isActive: false } })).id;
    await prisma.scheduledFbPost.create({ data: { branchId, menuDiscountId: discountId, status: 'POSTED', scheduledAt: new Date(), postedAt: new Date(), fbPostId: `${PAGE}_${runId.length}777`, message: 'x', imagePath: 'x' } });
    menus.clear(branchId);
  });

  beforeEach(() => {
    for (const fn of Object.values(meta)) if (typeof fn === 'function' && 'mockClear' in fn) (fn as jest.Mock).mockClear();
    sms.sendSms.mockClear();
  });

  afterAll(async () => {
    if (branchId) await deleteTestBranch(prisma, branchId);
    await app.close();
  });

  it('answers Meta webhook verification only with the right token', async () => {
    const appRow = await prisma.metaAppSetting.findUniqueOrThrow({ where: { branchId } });
    const ok = await fetch(`${origin}/api/v1/chatbot/webhook/meta?hub.mode=subscribe&hub.verify_token=${appRow.verifyToken}&hub.challenge=abc123`);
    expect([ok.status, await ok.text()]).toEqual([200, 'abc123']);
    const bad = await fetch(`${origin}/api/v1/chatbot/webhook/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
    expect(bad.status).toBe(403);
  });

  it('rejects a webhook with a bad signature', async () => {
    const res = await post(message(`${runId}-x`, 'hi', `${runId}-m0`), 'sha256=deadbeef');
    expect(res.status).toBe(403);
  });

  it('replies on Messenger with the disclosure, once per message', async () => {
    const user = `${runId}-u1`;
    await prisma.chatQuickReply.create({ data: { branchId, title: `Test ${runId} hours`, keywords: `opening hours ${runId}`, answer: 'We open at noon.', priority: 99 } });
    const payload = message(user, `opening hours ${runId}`, `${runId}-m1`);
    expect((await post(payload)).status).toBe(200);
    await settle(async () => meta.sendText.mock.calls.length > 0);
    expect(meta.sendText).toHaveBeenCalledWith(expect.objectContaining({ pageId: PAGE, pageToken: 'page-token' }), { id: user }, 'We open at noon.\n\n- EATRO Assistant (automated)');
    const conv = await prisma.chatConversation.findUniqueOrThrow({ where: { branchId_channel_externalUserId: { branchId, channel: 'MESSENGER', externalUserId: user } } });
    expect(conv.customerName).toBe('Rafi Hasan');

    // Meta retries the same event: no second reply.
    await post(payload);
    await new Promise((r) => setTimeout(r, 400));
    expect(meta.sendText).toHaveBeenCalledTimes(1);
    await prisma.chatQuickReply.deleteMany({ where: { title: `Test ${runId} hours` } });
  });

  it('ignores its own echoes, and goes quiet when staff reply from the Page inbox', async () => {
    const user = `${runId}-u2`;
    await chatbot.handleIncoming({ branchId, channel: 'MESSENGER', externalUserId: user, text: 'hello', externalId: `${runId}-m2` });
    const echo = (appId: string | null, mid: string, text: string) => ({
      object: 'page',
      entry: [{ id: PAGE, messaging: [{ sender: { id: PAGE }, recipient: { id: user }, message: { mid, text, is_echo: true, ...(appId ? { app_id: appId } : {}) } }] }],
    });
    await post(echo(APP_ID, `${runId}-e1`, 'our own reply'));
    await post(echo(null, `${runId}-e2`, 'Hi, Nadia here from EATRO'));
    const conv = await prisma.chatConversation.findUniqueOrThrow({ where: { branchId_channel_externalUserId: { branchId, channel: 'MESSENGER', externalUserId: user } } });
    await settle(async () => (await prisma.chatMessage.count({ where: { conversationId: conv.id, sender: 'STAFF' } })) === 1);
    expect(await prisma.chatMessage.count({ where: { conversationId: conv.id, text: 'our own reply' } })).toBe(0);
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe('HUMAN');
    meta.sendText.mockClear();
    expect((await chatbot.handleIncoming({ branchId, channel: 'MESSENGER', externalUserId: user, text: 'thanks!', externalId: `${runId}-m3` })).status).toBe('HUMAN');
    expect(meta.sendText).not.toHaveBeenCalled();
  });

  it('answers a complaint in chat with one line, opens a ticket and hands over', async () => {
    const user = `${runId}-u3`;
    const res = await chatbot.handleIncoming({ branchId, channel: 'MESSENGER', externalUserId: user, text: 'There was a hair in my biryani yesterday', externalId: `${runId}-m4` });
    expect(res.reply?.text).toContain("I'm sorry about this. I'm passing it to our manager now");
    const conv = await prisma.chatConversation.findUniqueOrThrow({ where: { id: res.conversationId } });
    expect(conv).toMatchObject({ status: 'HUMAN', needsStaff: true, needsStaffReason: 'Complaint (serious)' });
    expect(await prisma.chatComplaint.findFirst({ where: { conversationId: conv.id } })).toMatchObject({ level: 'SERIOUS', topic: 'HYGIENE', source: 'CHAT' });
    expect((await chatbot.handleIncoming({ branchId, channel: 'MESSENGER', externalUserId: user, text: 'hello?', externalId: `${runId}-m5` })).status).toBe('HUMAN');
  });

  it('refuses staff replies outside the 24-hour window', async () => {
    const user = `${runId}-u4`;
    const res = await chatbot.handleIncoming({ branchId, channel: 'MESSENGER', externalUserId: user, text: 'hi there friend', externalId: `${runId}-m6` });
    const conv = await prisma.chatConversation.update({ where: { id: res.conversationId }, data: { lastCustomerMessageAt: new Date(Date.now() - 25 * 3600_000) } });
    await expect(chatbot.sendToChannel(conv, 'late reply', [])).rejects.toThrow(/OUTSIDE_WINDOW/);
  });

  it('prices a post our auto-poster made, from the live menu', async () => {
    const row = await comment({ id: 'c1', text: 'dam koto?', post: `${PAGE}_${runId.length}777` });
    expect(row?.kind).toBe('PRICE');
    expect(row?.status).toBe('REPLIED');
    expect(meta.replyToComment.mock.calls[0][3]).toContain('৳450');
    expect(meta.replyToComment.mock.calls[0][3]).toContain(dishName);
    expect(meta.sendText.mock.calls[0][1]).toEqual({ comment_id: `${runId}-c1` });
    expect(meta.sendText.mock.calls[0][2]).toContain(`${dishName}: ৳450`);
    expect(row?.privateReplySent).toBe(true);
  });

  it('matches other posts by caption, and answers one person once per post', async () => {
    meta.postDetails.mockResolvedValueOnce({ caption: `Weekend special: ${dishName}!`, permalink: 'https://fb.test/p' });
    const first = await comment({ id: 'c2', text: 'price please', post: `${PAGE}_222`, from: 'u-same' });
    expect(meta.replyToComment.mock.calls[0][3]).toContain('৳450');
    expect(first?.status).toBe('REPLIED');
    const second = await comment({ id: 'c3', text: 'pp?', post: `${PAGE}_222`, from: 'u-same' });
    expect(second?.status).toBe('IGNORED');
    expect(meta.replyToComment).toHaveBeenCalledTimes(1);
    expect(meta.postDetails).toHaveBeenCalledTimes(1);
  });

  it('never answers a complaint in public automatically, and drafts for staff', async () => {
    const row = await comment({ id: 'c4', text: 'Food was cold and we waited an hour', name: 'Karim Uddin' });
    expect(row).toMatchObject({ kind: 'COMPLAINT', status: 'ESCALATED' });
    expect(row?.draftPublicReply).toContain('Karim');
    expect(meta.replyToComment).not.toHaveBeenCalled();
    expect(meta.sendText).not.toHaveBeenCalled();
    expect(await prisma.chatComplaint.findFirst({ where: { commentId: `${runId}-c4` } })).toMatchObject({ level: 'ORDINARY', status: 'NEW' });
  });

  it('holding-reply mode answers ordinary complaints but never serious ones', async () => {
    await setSettings({ complaintMode: 'HOLDING' });
    const ordinary = await comment({ id: 'c5', text: 'service was so slow today' });
    expect(ordinary?.publicReply).toContain("We're sorry to hear this");
    expect(meta.sendText).toHaveBeenCalledTimes(1);
    meta.replyToComment.mockClear();
    const serious = await comment({ id: 'c6', text: 'got sick after eating here' });
    expect(serious?.status).toBe('ESCALATED');
    expect(serious?.publicReply).toBeNull();
    expect(meta.replyToComment).not.toHaveBeenCalled();
    await setSettings({ complaintMode: 'DRAFT' });
  });

  it('texts the manager for serious complaints when switched on', async () => {
    await setSettings({ complaintSmsEnabled: true, managerPhone: '01700000000' });
    await comment({ id: 'c7', text: 'cockroach in the soup!!' });
    expect(sms.sendSms).toHaveBeenCalledWith(branchId, '01700000000', expect.stringContaining('serious complaint'));
    sms.sendSms.mockClear();
    await comment({ id: 'c8', text: 'portion was small' });
    expect(sms.sendSms).not.toHaveBeenCalled();
    await setSettings({ complaintSmsEnabled: false, managerPhone: null });
  });

  it('reminds staff about an unopened serious complaint, and stops once opened', async () => {
    const c = await prisma.chatComplaint.findFirstOrThrow({ where: { commentId: `${runId}-c6` } });
    await prisma.chatComplaint.update({ where: { id: c.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
    await complaints.remind();
    const reminded = await prisma.chatComplaint.findUniqueOrThrow({ where: { id: c.id } });
    expect(reminded.remindedAt).not.toBeNull();
    await complaints.open(branchId, c.id);
    await prisma.chatComplaint.update({ where: { id: c.id }, data: { remindedAt: new Date(Date.now() - 60 * 60_000) } });
    await complaints.remind();
    expect((await prisma.chatComplaint.findUniqueOrThrow({ where: { id: c.id } })).remindedAt!.getTime()).toBeLessThan(Date.now() - 30 * 60_000);
  });

  it('hides spam only when auto-hide is on, and never hides complaints', async () => {
    expect((await comment({ id: 'c9', text: 'Earn money fast visit cheap-deals.xyz' }))?.hidden).toBe(false);
    await setSettings({ autoHideSpam: true });
    expect((await comment({ id: 'c10', text: 'Earn money fast visit cheap-deals.xyz' }))?.status).toBe('HIDDEN');
    expect((await comment({ id: 'c11', text: 'worst food ever, never again' }))?.hidden).toBe(false);
    expect(meta.setHidden).toHaveBeenCalledTimes(1);
    await setSettings({ autoHideSpam: false });
  });

  it('drafts instead of posting in Suggest mode, then sends when approved', async () => {
    await setSettings({ commentMode: 'SUGGEST' });
    const row = await comment({ id: 'c12', text: 'birthday party kora jabe?', from: 'u-party' });
    expect(row?.status).toBe('DRAFT');
    expect(meta.replyToComment).not.toHaveBeenCalled();
    const sent = await comments.approve(branchId, row!.id, {}, { sub: ownerId, role: 'OWNER', branchId } as never);
    expect(sent.status).toBe('REPLIED');
    expect(meta.replyToComment).toHaveBeenCalledTimes(1);
    expect(meta.sendText.mock.calls[0][2]).toContain('date, time');
    await setSettings({ commentMode: 'AUTO' });
  });

  it('ignores tags, emojis and the Page itself, and does nothing with comments off', async () => {
    expect((await comment({ id: 'c13', text: 'Rahim Ahmed' }))?.status).toBe('IGNORED');
    expect(await comment({ id: 'c14', text: 'price?', from: PAGE })).toBeNull();
    await setSettings({ commentMode: 'OFF' });
    expect(await comment({ id: 'c15', text: 'price?' })).toBeNull();
    await setSettings({ commentMode: 'AUTO' });
    expect(meta.replyToComment).not.toHaveBeenCalled();
  });

  it('turns a shared post into the dish card without the AI', async () => {
    const user = `${runId}-u5`;
    await post(message(user, '', `${runId}-m7`, { attachments: [{ type: 'post', payload: { id: `${runId.length}777`, title: 'EATRO', url: 'https://facebook.com/x' } }] }));
    await settle(async () => meta.sendText.mock.calls.length > 0);
    expect(meta.sendText.mock.calls[0][2]).toContain(`That post is our ${dishName}: ৳450.`);
    expect(meta.sendCards).toHaveBeenCalledTimes(1);
  });

  it('asks for text when a voice note arrives, and skips stickers', async () => {
    await post(message(`${runId}-u6`, '', `${runId}-m8`, { attachments: [{ type: 'audio', payload: { url: 'https://cdn/x.mp4' } }] }));
    await settle(async () => meta.sendText.mock.calls.length > 0);
    expect(meta.sendText.mock.calls[0][2]).toContain("can't listen to voice messages");
    meta.sendText.mockClear();
    await post(message(`${runId}-u7`, '', `${runId}-m9`, { sticker_id: 369239263222822, attachments: [{ type: 'image', payload: { url: 'https://cdn/like.png', sticker_id: 369239263222822 } }] }));
    await new Promise((r) => setTimeout(r, 400));
    expect(meta.sendText).not.toHaveBeenCalled();
  });

  it('handles Instagram comments and DMs on the linked account', async () => {
    await post({ object: 'instagram', entry: [{ id: IG, changes: [{ field: 'comments', value: { id: `${runId}-ig1`, text: 'love it 😍 so tasty', from: { id: 'ig-user', username: 'foodie.bd' }, media: { id: 'media-1' } } }] }] });
    await settle(async () => !!(await prisma.chatComment.findUnique({ where: { commentId: `${runId}-ig1` } }))?.publicReply);
    expect(meta.replyToComment.mock.calls[0][1]).toBe('INSTAGRAM');
    expect(meta.likeComment).not.toHaveBeenCalled();
  });

  it('connects through Facebook Login and refuses a tampered state', async () => {
    const user = { sub: ownerId, role: 'OWNER', branchId } as never;
    const { url } = await connect.startLogin(branchId, user);
    const state = decodeURIComponent(new URL(url).searchParams.get('state')!);
    expect(await connect.callback('code', state.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toContain('fb=error');

    meta.pages.mockResolvedValueOnce([
      { id: PAGE, name: 'Test Page', accessToken: 'new-page-token', igUserId: IG, igUsername: 'eatro.test' },
      { id: '42', name: 'Other Page', accessToken: 'other', igUserId: null, igUsername: null },
    ]);
    expect(await connect.callback('code', state)).toContain('fb=pick');
    const status = await connect.status(branchId);
    expect(status.pendingPages.map((p) => p.name)).toEqual(['Test Page', 'Other Page']);
    expect(JSON.stringify(status)).not.toContain('new-page-token');
    expect(JSON.stringify(status)).not.toContain(SECRET);

    await connect.pickPage(branchId, PAGE, user);
    expect(meta.subscribePage).toHaveBeenCalledWith({ pageId: PAGE, pageToken: 'new-page-token' });
    expect((await prisma.branchSetting.findUniqueOrThrow({ where: { branchId } })).fbPageAccessToken).toBe('new-page-token');
    const after = await connect.status(branchId);
    expect(after.health.find((h) => h.key === 'page')?.ok).toBe(true);
    expect(after.missingScopes).toContain('instagram_manage_messages');
  });
});
