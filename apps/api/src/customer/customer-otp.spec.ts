import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';
import type { SmsService } from '../sms/sms.service';
import { CustomerService } from './customer.service';

process.env.JWT_SECRET ||= 'test-secret-for-customer-tokens';

/** Customer login codes reach the customer by SMS only, and can't be guessed. No database needed. */
describe('customer login OTP', () => {
  const PHONE = '01712345678';
  const customer = { id: 'c1', name: 'Rafi', phone: PHONE };
  const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(customer), findFirst: jest.fn() } };
  const sms = { sendSms: jest.fn() };
  const make = () => new CustomerService(prisma as unknown as PrismaService, sms as unknown as SmsService);
  const textedCode = () => /OTP: (\d{6})/.exec(sms.sendSms.mock.calls.at(-1)![2] as string)![1];

  beforeEach(() => sms.sendSms.mockReset());

  it('never hands the code back when the SMS is not sent (the reported takeover)', async () => {
    sms.sendSms.mockResolvedValue(false);
    const service = make();
    const res = service.requestOtp('b1', PHONE);
    await expect(res).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Nothing is left to verify against either.
    await expect(service.verifyOtp('b1', PHONE, '123456')).rejects.toThrow('No OTP found');
  });

  it('never returns the code in the response when the SMS is sent', async () => {
    sms.sendSms.mockResolvedValue(true);
    const res = await make().requestOtp('b1', PHONE);
    expect(res).toEqual({ sent: true, phone: PHONE });
    expect(JSON.stringify(res)).not.toContain(textedCode());
  });

  it('logs in with the texted code once', async () => {
    sms.sendSms.mockResolvedValue(true);
    const service = make();
    await service.requestOtp('b1', PHONE);
    const code = textedCode();
    await expect(service.verifyOtp('b1', PHONE, code)).resolves.toMatchObject({ customer, isNew: false });
    await expect(service.verifyOtp('b1', PHONE, code)).rejects.toThrow('No OTP found');
  });

  it('throws the code away after 5 wrong guesses', async () => {
    sms.sendSms.mockResolvedValue(true);
    const service = make();
    await service.requestOtp('b1', PHONE);
    const code = textedCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) await expect(service.verifyOtp('b1', PHONE, wrong)).rejects.toThrow('Invalid OTP');
    await expect(service.verifyOtp('b1', PHONE, wrong)).rejects.toThrow('Too many wrong codes');
    await expect(service.verifyOtp('b1', PHONE, code)).rejects.toThrow('No OTP found');
  });

  it('does not text a new code within a minute, and stops after 5 codes an hour', async () => {
    sms.sendSms.mockResolvedValue(true);
    const service = make();
    await service.requestOtp('b1', PHONE);
    await service.requestOtp('b1', PHONE);
    expect(sms.sendSms).toHaveBeenCalledTimes(1);

    const realNow = Date.now;
    let t = realNow();
    Date.now = () => t;
    try {
      for (let i = 0; i < 4; i++) {
        t += 61_000;
        await service.requestOtp('b1', PHONE);
      }
      expect(sms.sendSms).toHaveBeenCalledTimes(5);
      t += 61_000;
      const err = await service.requestOtp('b1', PHONE).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    } finally {
      Date.now = realNow;
    }
  });

  it('rejects a code that is not a string of the right length', async () => {
    sms.sendSms.mockResolvedValue(true);
    const service = make();
    await service.requestOtp('b1', PHONE);
    await expect(service.verifyOtp('b1', PHONE, undefined as unknown as string)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.verifyOtp('b1', PHONE, '12' as string)).rejects.toThrow('Invalid OTP');
  });
});
