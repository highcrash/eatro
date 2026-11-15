import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaService } from '../prisma/prisma.service';
import { ReservationService } from '../reservation/reservation.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { AiAdminService } from './ai/ai-admin.service';
import { AiRouterService } from './ai/ai-router.service';
import type { AiTarget } from './ai/ai.types';
import { OpenAiCompatibleProvider } from './ai/openai-compatible.provider';
import { ChatbotModule } from './chatbot.module';
import { ChatbotService } from './chatbot.service';
import { MetaClient } from './meta/meta.client';
import { createTestBranch, deleteTestBranch } from './test-branch';
import { bookingWhen } from './text';
import { inOpeningHours, normalizeTime, timeOnlyMessage } from './booking-time';

jest.setTimeout(60_000);

describe('chat bookings: wording', () => {
  it('says the day and time the way people do', () => {
    expect(bookingWhen('2026-11-20', '20:00', 'en')).toBe('on Friday 20 Nov at 8:00 pm');
    expect(bookingWhen('2026-11-20', '12:30', 'en')).toBe('on Friday 20 Nov at 12:30 pm');
    expect(bookingWhen('2026-11-20', '20:00', 'bn')).toBe('শুক্রবার 20 নভেম্বর, রাত 8:00-এ');
    expect(bookingWhen('2026-11-20', '13:00', 'bn')).toBe('শুক্রবার 20 নভেম্বর, দুপুর 1:00-এ');
  });

  it('reads times the way customers and models write them', () => {
    expect(normalizeTime('19:30')).toBe('19:30');
    expect(normalizeTime('19.30')).toBe('19:30');
    expect(normalizeTime('7:30 PM')).toBe('19:30');
    expect(normalizeTime('7.30pm')).toBe('19:30');
    expect(normalizeTime('৭:৩০')).toBe('07:30');
    expect(normalizeTime('সন্ধ্যা ৭টা')).toBe('19:00');
    expect(normalizeTime('rat 8')).toBe('20:00');
    expect(normalizeTime('dupur 2')).toBe('14:00');
    expect(normalizeTime('12 am')).toBe('00:00');
    expect(normalizeTime('1930')).toBe('19:30');
    expect(normalizeTime('soon')).toBeNull();
    expect(normalizeTime('25:00')).toBeNull();

    const slots = ['12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00'];
    expect(inOpeningHours('06:30', slots)).toBe('18:30');
    expect(inOpeningHours('07:30', slots)).toBe('19:30');
    expect(inOpeningHours('13:30', slots)).toBe('13:30');
    // Opens at 10: "11:30" is the morning.
    expect(inOpeningHours('11:30', ['10:00', '11:30', '19:00'])).toBe('11:30');

    expect(timeOnlyMessage('19.30')).toBe('19:30');
    expect(timeOnlyMessage('6.30')).toBe('06:30');
    expect(timeOnlyMessage('7.30 pm')).toBe('19:30');
    expect(timeOnlyMessage('রাত ৮টা')).toBe('20:00');
    expect(timeOnlyMessage('at 6:30 please')).toBe('06:30');
    expect(timeOnlyMessage('ji 7:30')).toBe('07:30');
    // Not a time on its own: guests, a question, a sentence.
    expect(timeOnlyMessage('4')).toBeNull();
    expect(timeOnlyMessage('4 jon')).toBeNull();
    expect(timeOnlyMessage('7.30 or 8?')).toBeNull();
    expect(timeOnlyMessage('what time do you close?')).toBeNull();
  });
});

describe('chat bookings: verified numbers, live slots and auto-confirm', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let chatbot: ChatbotService;
  let branchId: string;
  const runId = `b${Date.now().toString(36)}`;
  const tail = String(Date.now()).slice(-7);
  const phone = (n: number) => `018${n}${tail}`;
  const PAGE = `56${Date.now()}`;
  // Three days ahead: always in the future, whatever the time of day.
  const DATE = new Date(Date.now() + 3 * 24 * 3600_000).toISOString().slice(0, 10);
  // Default hours 09:00–23:00, 90-minute slots after a 60-minute block: 10:00, 11:30 … 19:00, 20:30.
  const TIME = '19:00';

  const sms = { sendSms: jest.fn().mockResolvedValue(true) };
  const meta = { sendText: jest.fn().mockResolvedValue(['mid.out']), sendCards: jest.fn().mockResolvedValue(undefined), subscribeApp: jest.fn(), debugToken: jest.fn(), pageSubscriptions: jest.fn() };
  const wa = { sendText: jest.fn().mockResolvedValue({ messageId: 'wamid.out' }), sendImage: jest.fn(), downloadMedia: jest.fn().mockResolvedValue(null) };
  let nextAction: object | null = null;
  const ai = {
    complete: jest.fn(async (_t: AiTarget) => ({
      text: JSON.stringify({ lang: 'en', reply: 'Thank you.', items: [], action: nextAction }),
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 5,
    })),
    listModels: jest.fn(),
    openRouterKeyInfo: jest.fn(),
  };
  const booking = (guests: number, name = 'Rafi Hasan', time = TIME) => ({ type: 'booking_request', date: DATE, time, guests, name, occasion: null });

  const codeSentTo = (to: string) => {
    const call = [...sms.sendSms.mock.calls].reverse().find((c) => c[1] === to && /code is \d{6}/.test(c[2] as string));
    return call ? /code is (\d{6})/.exec(call[2] as string)![1] : null;
  };
  const smsTo = (to: string) => sms.sendSms.mock.calls.filter((c) => c[1] === to).map((c) => c[2] as string);
  const messenger = (user: string, text: string) =>
    chatbot.handleIncoming({ branchId, channel: 'MESSENGER', externalUserId: `${runId}-${user}`, text, customerName: 'Rafi Hasan' });
  const convOf = (channel: 'MESSENGER' | 'WHATSAPP', user: string) =>
    prisma.chatConversation.findUniqueOrThrow({ where: { branchId_channel_externalUserId: { branchId, channel, externalUserId: user } } });
  const bookingsFor = (p: string) => prisma.reservation.findMany({ where: { branchId, customerPhone: p } });

  beforeAll(async () => {
    @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]), ChatbotModule] })
    class TestModule {}
    moduleRef = await Test.createTestingModule({ imports: [TestModule] })
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
    prisma = moduleRef.get(PrismaService);
    chatbot = moduleRef.get(ChatbotService);
    chatbot.burstWaitMs = 0;
    moduleRef.get(AiRouterService).retryDelayMs = 0;

    branchId = await createTestBranch(prisma, `booking ${runId}`);
    await chatbot.getSettings(branchId);
    await prisma.chatbotSetting.update({ where: { branchId }, data: { webMode: 'AUTO', messengerMode: 'AUTO', whatsappMode: 'AUTO', welcomeCouponEnabled: false } });
    await prisma.branchSetting.upsert({
      where: { branchId },
      create: { branchId, fbPageId: PAGE, fbPageAccessToken: 'page-token', whatsappPhoneNumberId: `9${PAGE}`, whatsappAccessToken: 'wa-token', smsEnabled: true, smsApiKey: 'test-key' },
      update: {},
    });
    const owner = await prisma.staff.findFirstOrThrow({ where: { role: 'OWNER', isActive: true } });
    const c = await moduleRef.get(AiAdminService).create(branchId, { name: `Booking ${runId}`, provider: 'OPENAI_COMPATIBLE', apiKey: 'sk-test-booking-1234', model: `fake-booking-${runId}`, inputPricePerM: 0, outputPricePerM: 0 }, { sub: owner.id, role: 'OWNER', branchId } as never);
    await prisma.aiConnection.update({ where: { id: c.id }, data: { selfTestScore: 90 } });
    await prisma.aiRoute.create({ data: { branchId, job: 'CHAT', connectionIds: [c.id] } });
    moduleRef.get(AiRouterService).invalidate(branchId);
  });

  beforeEach(() => {
    sms.sendSms.mockClear();
    nextAction = null;
  });

  afterAll(async () => {
    if (branchId) {
      await prisma.diningTable.deleteMany({ where: { branchId } });
      await deleteTestBranch(prisma, branchId);
    }
    await moduleRef.close();
  });

  it('holds a booking from a new number until the code is typed, then confirms it', async () => {
    nextAction = booking(6);
    let res = await messenger('a', `table for 6 on ${DATE} at 7pm please, ${phone(1)}`);
    expect(res.reply!.text).toMatch(/A table for 6 is free on .* at 7:00 pm/);
    expect(res.reply!.text).toMatch(/type it here and I'll book the table/);
    // One code, and no second "we've texted a code" line under it.
    expect(sms.sendSms.mock.calls.filter((c) => /code is/.test(c[2] as string))).toHaveLength(1);
    expect(res.reply!.text.match(/6-digit code/g)).toHaveLength(1);
    expect(await bookingsFor(phone(1))).toHaveLength(0);
    expect((await convOf('MESSENGER', `${runId}-a`)).pendingBooking).toMatchObject({ date: DATE, time: TIME, guests: 6 });

    nextAction = null;
    res = await messenger('a', codeSentTo(phone(1))!);
    expect(res.reply!.text).toMatch(/your number is verified/);
    expect(res.reply!.text).toMatch(/Your table is confirmed: 6 guests, on .* at 7:00 pm, under the name Rafi Hasan/);

    const [r] = await bookingsFor(phone(1));
    expect(r).toMatchObject({ status: 'CONFIRMED', partySize: 6, timeSlot: TIME, tableId: null });
    expect(r.confirmedAt).toBeTruthy();
    expect(r.customerId).toBeTruthy();
    expect(r.notes).toMatch(/Confirmed automatically/);
    // The customer gets the confirmation SMS, not "received, we will confirm".
    const texts = smsTo(phone(1));
    expect(texts.some((t) => /is confirmed/.test(t))).toBe(true);
    expect(texts.some((t) => /has been received/.test(t))).toBe(false);
    const conv = await convOf('MESSENGER', `${runId}-a`);
    expect(conv.pendingBooking).toBeNull();
    expect(conv.needsStaff).toBe(false);
  });

  it('books a verified customer straight away, and leaves big groups pending for staff', async () => {
    // Verified in an earlier message.
    await messenger('b', `my number is ${phone(2)}`);
    await messenger('b', codeSentTo(phone(2))!);
    sms.sendSms.mockClear();

    nextAction = booking(4);
    let res = await messenger('b', `4 people ${DATE} 7pm`);
    expect(res.reply!.text).toMatch(/Your table is confirmed: 4 guests/);
    expect(codeSentTo(phone(2))).toBeNull();

    nextAction = booking(14);
    res = await messenger('b', `actually also a second table, 14 people ${DATE} 7pm`);
    expect(res.reply!.text).toMatch(/Booking request received: 14 guests/);
    const big = (await bookingsFor(phone(2))).find((x) => x.partySize === 14)!;
    expect(big.status).toBe('PENDING');
    const conv = await convOf('MESSENGER', `${runId}-b`);
    expect(conv.needsStaff).toBe(true);
    expect(conv.needsStaffReason).toMatch(/14 guests to confirm/);
    expect(await prisma.chatLead.count({ where: { conversationId: conv.id, reservationId: big.id } })).toBe(1);
  });

  it('offers other times for a full slot, holds nothing, and books the time the customer picks', async () => {
    // Fill the 20:30 slot.
    await prisma.reservation.create({ data: { branchId, customerName: 'Walk-in', customerPhone: '01799999999', date: new Date(`${DATE}T00:00:00.000Z`), timeSlot: '20:30', partySize: 40, agreedTerms: true } });
    nextAction = booking(2, 'Mina', '20:30');
    let res = await messenger('c', `2 people ${DATE} 8:30pm, ${phone(3)}`);
    expect(res.reply!.text).toMatch(/Sorry, 8:30 pm is not available\. Free times on .*: .*7:00 pm/);
    // The number they gave is still checked, so the next booking needs no wait.
    expect(res.reply!.text).toMatch(/texted a 6-digit code/);
    // Only the offer is remembered: nothing is booked or held for the code.
    expect((await convOf('MESSENGER', `${runId}-c`)).pendingBooking).toMatchObject({ time: '20:30', offered: expect.arrayContaining(['19:00']) });
    expect(await bookingsFor(phone(3))).toHaveLength(0);

    nextAction = null;
    await messenger('c', codeSentTo(phone(3))!);
    expect(await bookingsFor(phone(3))).toHaveLength(0);
    nextAction = booking(2, 'Mina', '19:00');
    res = await messenger('c', '7pm then');
    expect(res.reply!.text).toMatch(/Your table is confirmed: 2 guests/);
    expect((await convOf('MESSENGER', `${runId}-c`)).pendingBooking).toBeNull();
  });

  it('reads "6.30" as the evening, shows only the system line, and books an offered time typed back with no AI', async () => {
    const day = new Date(Date.now() + 4 * 24 * 3600_000).toISOString().slice(0, 10);
    await messenger('e', `my number is ${phone(6)}`);
    await messenger('e', codeSentTo(phone(6))!);

    // The AI passes the customer's own words; 18:30 is not a slot (17:30 and 19:00 are).
    nextAction = { type: 'booking_request', date: day, time: '6.30', guests: 4, name: 'Shahi Uddin', occasion: null };
    let res = await messenger('e', 'table for 4 tomorrow at 6.30');
    expect(res.reply!.text).toMatch(/^Sorry, 6:30 pm is not available\. Free times on .*: .*5:30 pm, .*7:00 pm/);
    expect(res.reply!.text).not.toContain('Thank you.');
    expect(await bookingsFor(phone(6))).toHaveLength(0);

    // The customer types one of the offered times; even an AI that sends no action can't lose it.
    const calls = ai.complete.mock.calls.length;
    nextAction = null;
    res = await messenger('e', '19.00');
    expect(ai.complete.mock.calls.length).toBe(calls);
    expect(res.reply!.text).toMatch(/Your table is confirmed: 4 guests, on .* at 7:00 pm, under the name Shahi Uddin/);
    const [r] = await bookingsFor(phone(6));
    expect(r).toMatchObject({ status: 'CONFIRMED', timeSlot: '19:00', partySize: 4 });
    expect((await convOf('MESSENGER', `${runId}-e`)).pendingBooking).toBeNull();
  });

  it('WhatsApp numbers book with no code; with auto-confirm off the booking waits for staff', async () => {
    const from = `${runId}-wa`;
    nextAction = booking(3, 'Sadia');
    let res = await chatbot.handleIncoming({ branchId, channel: 'WHATSAPP', externalUserId: from, knownPhone: phone(4), text: `3 people ${DATE} 7pm`, customerName: 'Sadia' });
    expect(res.reply!.text).toMatch(/Your table is confirmed: 3 guests/);
    expect(codeSentTo(phone(4))).toBeNull();

    await prisma.chatbotSetting.update({ where: { branchId }, data: { bookingAutoConfirm: false } });
    try {
      nextAction = booking(2, 'Sadia');
      res = await chatbot.handleIncoming({ branchId, channel: 'WHATSAPP', externalUserId: from, knownPhone: phone(4), text: `and 2 people ${DATE} 7pm` });
      expect(res.reply!.text).toMatch(/Booking request received: 2 guests/);
      expect((await bookingsFor(phone(4))).find((x) => x.partySize === 2)!.status).toBe('PENDING');
    } finally {
      await prisma.chatbotSetting.update({ where: { branchId }, data: { bookingAutoConfirm: true } });
    }
  });

  it('without SMS the booking is saved as a pending request, as before', async () => {
    await prisma.branchSetting.update({ where: { branchId }, data: { smsEnabled: false, smsApiKey: null } });
    try {
      nextAction = booking(5, 'Karim');
      const res = await messenger('d', `5 people ${DATE} 7pm, ${phone(5)}`);
      expect(res.reply!.text).toMatch(/Booking request received: 5 guests/);
      expect((await bookingsFor(phone(5)))[0].status).toBe('PENDING');
      expect(codeSentTo(phone(5))).toBeNull();
    } finally {
      await prisma.branchSetting.update({ where: { branchId }, data: { smsEnabled: true, smsApiKey: 'test-key' } });
    }
  });

  it('staff can add a table to an auto-confirmed booking without a second SMS', async () => {
    const reservations = moduleRef.get(ReservationService, { strict: false });
    const r = (await bookingsFor(phone(1)))[0];
    const table = await prisma.diningTable.create({ data: { branchId, tableNumber: `T-${runId}`, capacity: 6 } });
    const owner = await prisma.staff.findFirstOrThrow({ where: { role: 'OWNER', isActive: true } });
    sms.sendSms.mockClear();
    const updated = await reservations.confirm(r.id, branchId, owner.id, { tableIds: [table.id] });
    expect(updated).toMatchObject({ status: 'CONFIRMED', tableId: table.id, timeSlot: TIME });
    expect(sms.sendSms).not.toHaveBeenCalled();
  });
});
