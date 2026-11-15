import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { QrOrderController } from '../order/order.controller';
import type { OrderService } from '../order/order.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { QrGateService } from '../qr-gate/qr-gate.service';
import { CustomerPublicController } from './customer.controller';
import type { CustomerService } from './customer.service';
import { customerSessionToken, sessionCustomerId, signupPhone, signupToken } from './customer-token';

process.env.JWT_SECRET ||= 'test-secret-for-customer-tokens';

describe('customer login tokens', () => {
  it('names the customer and branch, and refuses tampering, other branches and expiry', () => {
    const t = customerSessionToken('cust-1', 'branch-1');
    expect(sessionCustomerId(t, 'branch-1')).toBe('cust-1');
    expect(sessionCustomerId(t)).toBe('cust-1');
    expect(sessionCustomerId(t, 'branch-2')).toBeNull();

    const [v, body, mac] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'session', cid: 'someone-else', bid: 'branch-1', exp: Date.now() + 1e9 })).toString('base64url');
    expect(sessionCustomerId(`${v}.${forged}.${mac}`)).toBeNull();
    expect(sessionCustomerId(`${v}.${body}.${mac.slice(0, -2)}xx`)).toBeNull();
    expect(sessionCustomerId('')).toBeNull();
    expect(sessionCustomerId(undefined)).toBeNull();

    const realNow = Date.now;
    Date.now = () => realNow() + 31 * 24 * 3600_000;
    try {
      expect(sessionCustomerId(t)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('keeps signup proofs and logins apart', () => {
    const s = signupToken('branch-1', '01712345678');
    expect(signupPhone(s, 'branch-1')).toBe('01712345678');
    expect(signupPhone(s, 'branch-2')).toBeNull();
    expect(sessionCustomerId(s)).toBeNull();
    expect(signupPhone(customerSessionToken('c', 'branch-1'), 'branch-1')).toBeNull();
  });
});

describe('customer endpoints trust the login, not the customer id', () => {
  const service = {
    updateProfile: jest.fn().mockResolvedValue({ id: 'cust-1' }),
    getOrderHistory: jest.fn().mockResolvedValue({ orders: [] }),
    getActiveOrder: jest.fn().mockResolvedValue({ order: null }),
    getCustomerReviewHistory: jest.fn().mockResolvedValue([]),
    createReview: jest.fn().mockResolvedValue({ id: 'r1' }),
    createFromQr: jest.fn().mockResolvedValue({ id: 'cust-9', name: 'New', phone: '01712345678' }),
  };
  const controller = new CustomerPublicController(service as unknown as CustomerService);
  const mine = customerSessionToken('cust-1', 'b1');

  beforeEach(() => jest.clearAllMocks());

  it('refuses customer data without a login, and someone else\'s with one', () => {
    expect(() => controller.getOrderHistory('b1', undefined, { customerId: 'cust-1' })).toThrow(UnauthorizedException);
    expect(() => controller.getOrderHistory('b1', mine, { customerId: 'cust-2' })).toThrow(ForbiddenException);
    expect(() => controller.getActiveOrder('b1', undefined, { customerId: 'cust-1' })).toThrow(UnauthorizedException);
    expect(() => controller.getCustomerReviewHistory('b1', undefined, {})).toThrow(UnauthorizedException);
    expect(() => controller.updateProfile(undefined, { customerId: 'cust-1', name: 'X' })).toThrow(UnauthorizedException);
    // A login for another branch is no login here.
    expect(() => controller.getOrderHistory('b2', mine, {})).toThrow(UnauthorizedException);
    expect(service.getOrderHistory).not.toHaveBeenCalled();
  });

  it('serves the logged-in customer', async () => {
    await controller.getOrderHistory('b1', mine, { limit: 3 });
    expect(service.getOrderHistory).toHaveBeenCalledWith('b1', 'cust-1', 3);
    await controller.updateProfile(mine, { name: 'Rafi' });
    expect(service.updateProfile).toHaveBeenCalledWith('cust-1', { name: 'Rafi', email: undefined });
  });

  it('ties a review to the logged-in customer only', async () => {
    const dto = { orderId: 'o1', customerId: 'cust-2', foodScore: 5, serviceScore: 5, atmosphereScore: 5, priceScore: 5 };
    await controller.createReview('b1', undefined, dto);
    expect(service.createReview).toHaveBeenLastCalledWith('b1', expect.objectContaining({ customerId: undefined }));
    await controller.createReview('b1', mine, dto);
    expect(service.createReview).toHaveBeenLastCalledWith('b1', expect.objectContaining({ customerId: 'cust-1' }));
  });

  it('signs up only a phone proven by SMS code (an existing customer\'s record was returned to anyone before)', async () => {
    await expect(controller.signup('b1', { phone: '01712345678', name: 'Mallory' })).rejects.toBeInstanceOf(UnauthorizedException);
    const proof = signupToken('b1', '01799999999');
    await expect(controller.signup('b1', { phone: '01712345678', name: 'Mallory', signupToken: proof })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.createFromQr).not.toHaveBeenCalled();

    const ok = await controller.signup('b1', { phone: '01712345678', name: 'New', signupToken: signupToken('b1', '01712345678') });
    expect(sessionCustomerId(ok.token, 'b1')).toBe('cust-9');
  });
});

describe('QR orders: the customer comes from the login', () => {
  const order = { id: 'o1', branchId: 'b1', customerId: null as string | null, primaryDeviceId: 'dev-1', sharedDeviceIds: null, tableId: 't1' };
  const prisma = {
    order: { findFirst: jest.fn(async () => order), update: jest.fn(async () => order) },
    customer: { findFirst: jest.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: 'Rafi', phone: '01712345678' })) },
  };
  const orders = { applyLoyalty: jest.fn().mockResolvedValue({}), createQrOrder: jest.fn().mockResolvedValue({}) };
  const gate = { evaluate: jest.fn().mockResolvedValue({ allowed: true }) };
  const controller = new QrOrderController(orders as unknown as OrderService, prisma as unknown as PrismaService, gate as unknown as QrGateService);
  const req = { headers: {}, ip: '127.0.0.1', socket: {} } as unknown as Request;
  const mine = customerSessionToken('cust-1', 'b1');

  beforeEach(() => {
    jest.clearAllMocks();
    order.customerId = null;
  });

  it('identify-customer needs a login and links only that customer', async () => {
    await expect(controller.identifyCustomer('o1', 'b1', 'dev-1', undefined, req)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.order.update).not.toHaveBeenCalled();
    await controller.identifyCustomer('o1', 'b1', 'dev-1', mine, req);
    expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerId: 'cust-1' }) }));
  });

  it('identify-customer refuses a device that is not on the order, and an order already linked to someone else', async () => {
    await expect(controller.identifyCustomer('o1', 'b1', 'dev-other', mine, req)).rejects.toBeInstanceOf(ForbiddenException);
    order.customerId = 'cust-2';
    await expect(controller.identifyCustomer('o1', 'b1', 'dev-1', mine, req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('spends points only for the logged-in customer, whatever id the body names', async () => {
    await expect(controller.applyLoyalty('o1', 'b1', 'dev-1', undefined, { points: 100, customerId: 'cust-2' }, req)).rejects.toBeInstanceOf(UnauthorizedException);
    await controller.applyLoyalty('o1', 'b1', 'dev-1', mine, { points: 100, customerId: 'cust-2' }, req);
    expect(orders.applyLoyalty).toHaveBeenCalledWith('o1', 'b1', 'cust-1', 100);
  });

  it('a new order keeps a customer id only when it is the logged-in customer', async () => {
    prisma.order.findFirst.mockImplementationOnce(async () => order);
    const branchSetting = { findUnique: jest.fn().mockResolvedValue(null) };
    Object.assign(prisma, { branchSetting });
    await controller.createQr('b1', 'dev-1', undefined, { type: 'DINE_IN', items: [], customerId: 'cust-2' } as never, req);
    expect(orders.createQrOrder).toHaveBeenLastCalledWith('b1', expect.objectContaining({ customerId: undefined }), expect.anything());
    await controller.createQr('b1', 'dev-1', mine, { type: 'DINE_IN', items: [], customerId: 'cust-1' } as never, req);
    expect(orders.createQrOrder).toHaveBeenLastCalledWith('b1', expect.objectContaining({ customerId: 'cust-1' }), expect.anything());
  });
});
