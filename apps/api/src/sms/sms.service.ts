import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SmsService {
  // In-memory OTP store: key = `${branchId}:${context}:${ref}`, value = { otp, expiresAt }
  private otpStore = new Map<string, { otp: string; expiresAt: Date; details: string }>();

  constructor(private readonly prisma: PrismaService) {}

  async getSettings(branchId: string) {
    let settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings) {
      settings = await this.prisma.branchSetting.create({
        data: { branchId },
      });
    }
    return settings;
  }

  async updateSettings(branchId: string, data: {
    smsEnabled?: boolean;
    smsApiKey?: string;
    smsApiUrl?: string;
    notifyVoidOtp?: boolean;
    smsPaymentNotifyEnabled?: boolean;
    smsPaymentTemplate?: string | null;
  }) {
    let settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings) {
      settings = await this.prisma.branchSetting.create({ data: { branchId } });
    }
    return this.prisma.branchSetting.update({
      where: { branchId },
      data,
    });
  }

  async sendSms(branchId: string, phoneNumber: string, body: string): Promise<boolean> {
    const { ok } = await this.sendAndLog(branchId, phoneNumber, body, { kind: 'OTHER' });
    return ok;
  }

  /**
   * Send an SMS through the gateway AND create an SmsLog row tracking its
   * status (QUEUED → SENT → DELIVERED / FAILED / EXPIRED). Returns the log
   * row so callers can reference it (e.g. to show per-recipient result in a
   * campaign response).
   *
   * Gateway contract (api.sms.net.bd):
   *   POST /sendsms with api_key + msg + to
   *   → JSON { error: 0|N, msg: "...", data: { request_id: "..." } }
   *   request_id is later polled via /report/request/:id/?api_key=...
   */
  async sendAndLog(
    branchId: string,
    phoneNumber: string,
    body: string,
    opts: {
      kind?: 'CAMPAIGN' | 'PAYMENT' | 'RESERVATION' | 'OTP' | 'OTHER';
      customerId?: string | null;
      orderId?: string | null;
      campaignId?: string | null;
    } = {},
  ): Promise<{ ok: boolean; log: { id: string; requestId: string | null; status: string; errorText: string | null } }> {
    const settings = await this.getSettings(branchId);
    const to = this.normalizePhone(phoneNumber);
    const finalBody = await this.applyBranchPrefix(branchId, body);
    const kind = opts.kind ?? 'OTHER';

    // Create the log row up-front so even a pre-flight failure is recorded.
    const initial = await this.prisma.smsLog.create({
      data: {
        branchId,
        toPhone: to,
        body: finalBody,
        kind: kind as never,
        status: 'QUEUED' as never,
        customerId: opts.customerId ?? null,
        orderId: opts.orderId ?? null,
        campaignId: opts.campaignId ?? null,
      },
    });

    if (!settings.smsEnabled || !settings.smsApiKey) {
      const updated = await this.prisma.smsLog.update({
        where: { id: initial.id },
        data: { status: 'FAILED' as never, errorText: 'SMS disabled or no API key' },
      });
      return { ok: false, log: { id: updated.id, requestId: null, status: 'FAILED', errorText: updated.errorText } };
    }

    try {
      const params = new URLSearchParams();
      params.append('api_key', settings.smsApiKey);
      params.append('msg', finalBody);
      params.append('to', to);
      const res = await fetch(settings.smsApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const text = await res.text();
      let requestId: string | null = null;
      let gatewayOk = res.ok;
      let errorText: string | null = null;
      try {
        const json = JSON.parse(text) as { error?: number; msg?: string; data?: { request_id?: string | number } };
        if (json.error && json.error !== 0) {
          gatewayOk = false;
          errorText = json.msg ?? text.slice(0, 240);
        }
        if (json.data?.request_id != null) requestId = String(json.data.request_id);
      } catch {
        if (!res.ok) errorText = `${res.status} ${res.statusText}`;
      }

      const updated = await this.prisma.smsLog.update({
        where: { id: initial.id },
        data: {
          status: (gatewayOk ? 'SENT' : 'FAILED') as never,
          requestId,
          errorText,
        },
      });
      return { ok: gatewayOk, log: { id: updated.id, requestId: updated.requestId, status: updated.status as string, errorText: updated.errorText } };
    } catch (err) {
      const updated = await this.prisma.smsLog.update({
        where: { id: initial.id },
        data: { status: 'FAILED' as never, errorText: (err as Error).message.slice(0, 240) },
      });
      return { ok: false, log: { id: updated.id, requestId: null, status: 'FAILED', errorText: updated.errorText } };
    }
  }

  private normalizePhone(phoneNumber: string): string {
    let to = phoneNumber.replace(/[^\d]/g, '');
    if (to.startsWith('0')) to = '88' + to;
    else if (!to.startsWith('880')) to = '880' + to.replace(/^880?/, '');
    return to;
  }

  private async applyBranchPrefix(branchId: string, body: string): Promise<string> {
    if (body.startsWith('[')) return body;
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId }, select: { name: true } });
    return branch?.name ? `[${branch.name}] ${body}` : body;
  }

  // ─── Admin / campaign helpers ─────────────────────────────────────────────

  /** Substitute `{{name}}` and `{{phone}}` placeholders. Unknown placeholders
   *  stay as-is. `{{name}}` falls back to "Dear Customer" when the customer
   *  record has no name or the raw name is the "Walk-in" placeholder. */
  renderTemplate(
    body: string,
    ctx: { name?: string | null; phone?: string | null; amount?: number | string | null; method?: string | null },
  ): string {
    const niceName = (ctx.name && ctx.name.trim() && ctx.name.trim().toLowerCase() !== 'walk-in') ? ctx.name.trim() : 'Dear Customer';
    return body
      .replace(/\{\{\s*name\s*\}\}/gi, niceName)
      .replace(/\{\{\s*phone\s*\}\}/gi, ctx.phone ?? '')
      .replace(/\{\{\s*amount\s*\}\}/gi, ctx.amount != null ? String(ctx.amount) : '')
      .replace(/\{\{\s*method\s*\}\}/gi, ctx.method ?? '');
  }

  /** Query the gateway's balance endpoint. Returns null if SMS isn't
   *  configured on this branch so the caller can display "—". */
  async getBalance(branchId: string): Promise<{ balance: number | null; raw?: string }> {
    const settings = await this.getSettings(branchId);
    if (!settings.smsEnabled || !settings.smsApiKey) return { balance: null };
    const base = settings.smsApiUrl.replace(/\/sendsms\/?$/, '');
    try {
      const url = `${base}/user/balance/?api_key=${encodeURIComponent(settings.smsApiKey)}`;
      const res = await fetch(url);
      const text = await res.text();
      try {
        const json = JSON.parse(text) as { error?: number; data?: { balance?: number | string } };
        if (json.error && json.error !== 0) return { balance: null, raw: text.slice(0, 240) };
        const b = json.data?.balance;
        return { balance: b != null ? Number(b) : null, raw: text.slice(0, 240) };
      } catch {
        return { balance: null, raw: text.slice(0, 240) };
      }
    } catch (err) {
      return { balance: null, raw: (err as Error).message };
    }
  }

  /** Poll the gateway's per-request status and flip the log row. Called by
   *  SmsStatusScheduler and the admin "refresh" button. */
  async refreshLogStatus(logId: string): Promise<{ status: string }> {
    const log = await this.prisma.smsLog.findUnique({ where: { id: logId } });
    if (!log || !log.requestId) return { status: (log?.status as string) ?? 'UNKNOWN' };
    if (log.status === 'DELIVERED' || log.status === 'FAILED' || log.status === 'EXPIRED') {
      return { status: log.status as string };
    }
    const settings = await this.getSettings(log.branchId);
    if (!settings.smsApiKey) return { status: log.status as string };
    const base = settings.smsApiUrl.replace(/\/sendsms\/?$/, '');
    try {
      const url = `${base}/report/request/${encodeURIComponent(log.requestId)}/?api_key=${encodeURIComponent(settings.smsApiKey)}`;
      const res = await fetch(url);
      const text = await res.text();
      const json = JSON.parse(text) as { error?: number; data?: { status?: string; msg?: string }; msg?: string };
      let nextStatus: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'EXPIRED' = log.status as never;
      let nextError: string | null = log.errorText;
      const s = (json.data?.status ?? '').toString().toLowerCase();
      if (s.includes('deliver')) nextStatus = 'DELIVERED';
      else if (s.includes('expire')) nextStatus = 'EXPIRED';
      else if (s.includes('fail') || s.includes('reject') || s.includes('error')) {
        nextStatus = 'FAILED';
        nextError = json.data?.msg ?? json.msg ?? nextError;
      }
      else if (s.includes('sent') || s.includes('submit') || s.includes('pend')) nextStatus = 'SENT';
      const updated = await this.prisma.smsLog.update({
        where: { id: log.id },
        data: { status: nextStatus as never, errorText: nextError, lastChecked: new Date() },
      });
      return { status: updated.status as string };
    } catch {
      await this.prisma.smsLog.update({ where: { id: log.id }, data: { lastChecked: new Date() } });
      return { status: log.status as string };
    }
  }

  /** Retry a failed/expired SMS: creates a NEW log row (keeps audit trail
   *  on the original) and sends again with a fresh request_id. */
  async retryLog(logId: string): Promise<{ ok: boolean; newLogId: string | null }> {
    const log = await this.prisma.smsLog.findUnique({ where: { id: logId } });
    if (!log) return { ok: false, newLogId: null };
    const { ok, log: next } = await this.sendAndLog(log.branchId, log.toPhone, log.body, {
      kind: log.kind as never,
      customerId: log.customerId,
      orderId: log.orderId,
      campaignId: log.campaignId,
    });
    await this.prisma.smsLog.update({ where: { id: log.id }, data: { attempts: { increment: 1 } } });
    return { ok, newLogId: next.id };
  }

  /** Send a campaign to many customers. Each send is logged independently
   *  under a single campaignId so the admin can filter the log table by it. */
  async sendCampaign(
    branchId: string,
    input: { customerIds: string[]; body: string; templateId?: string | null },
  ): Promise<{ campaignId: string; sent: number; failed: number; skipped: number }> {
    const customers = await this.prisma.customer.findMany({
      where: { branchId, id: { in: input.customerIds }, isActive: true },
      select: { id: true, name: true, phone: true },
    });
    const campaignId = `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const c of customers) {
      if (!c.phone) { skipped++; continue; }
      const rendered = this.renderTemplate(input.body, { name: c.name, phone: c.phone });
      const { ok } = await this.sendAndLog(branchId, c.phone, rendered, {
        kind: 'CAMPAIGN',
        customerId: c.id,
        campaignId,
      });
      if (ok) sent++;
      else failed++;
    }
    return { campaignId, sent, failed, skipped };
  }

  async listLogs(
    branchId: string,
    opts: { status?: string; kind?: string; from?: string; to?: string; campaignId?: string; limit?: number } = {},
  ) {
    return this.prisma.smsLog.findMany({
      where: {
        branchId,
        ...(opts.status ? { status: opts.status as never } : {}),
        ...(opts.kind ? { kind: opts.kind as never } : {}),
        ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
        ...(opts.from || opts.to ? {
          createdAt: {
            ...(opts.from ? { gte: new Date(opts.from + 'T00:00:00') } : {}),
            ...(opts.to ? { lte: new Date(opts.to + 'T23:59:59.999') } : {}),
          },
        } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 200, 500),
    });
  }

  // ─── Template CRUD ────────────────────────────────────────────────────────
  listTemplates(branchId: string) {
    return this.prisma.smsTemplate.findMany({ where: { branchId }, orderBy: { name: 'asc' } });
  }
  createTemplate(branchId: string, data: { name: string; body: string }) {
    return this.prisma.smsTemplate.create({ data: { branchId, name: data.name, body: data.body } });
  }
  updateTemplate(id: string, branchId: string, data: { name?: string; body?: string }) {
    return this.prisma.smsTemplate.updateMany({ where: { id, branchId }, data });
  }
  deleteTemplate(id: string, branchId: string) {
    return this.prisma.smsTemplate.deleteMany({ where: { id, branchId } });
  }

  // ─── OTP ───────────────────────────────────────────────────────────────────

  generateOtp(): string {
    return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
  }

  async sendVoidOtp(branchId: string, orderId: string, itemName: string, itemQty: number, reason: string): Promise<{ sent: boolean; otp?: string; managerName?: string }> {
    const settings = await this.getSettings(branchId);

    // Find manager/owner with phone number
    const managers = await this.prisma.staff.findMany({
      where: { branchId, isActive: true, role: { in: ['MANAGER', 'OWNER'] }, phone: { not: null } },
      select: { id: true, name: true, phone: true, role: true },
      orderBy: { role: 'asc' }, // MANAGER first
    });

    if (managers.length === 0) {
      console.warn(`[SMS] No managers with phone numbers found for branch ${branchId}`);
      return { sent: false };
    }

    const otp = this.generateOtp();
    const key = `${branchId}:void:${orderId}`;
    this.otpStore.set(key, {
      otp,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min expiry
      details: `${itemQty}× ${itemName} — ${reason}`,
    });

    const manager = managers[0];
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId }, select: { name: true } });
    const brandName = branch?.name ?? 'Restora';
    const message = `[${brandName}] Void OTP: ${otp}\n${itemQty}x ${itemName}\nReason: ${reason}\nExpires in 5 min.`;

    if (settings.smsEnabled && settings.smsApiKey && settings.notifyVoidOtp) {
      await this.sendSms(branchId, manager.phone!, message);
      return { sent: true, managerName: manager.name };
    }

    // SMS not enabled — return OTP directly for development/testing
    console.warn(`[SMS] Void OTP for ${manager.name}: ${otp} (SMS disabled — shown in console)`);
    return { sent: false, otp, managerName: manager.name };
  }

  verifyVoidOtp(branchId: string, orderId: string, inputOtp: string): { valid: boolean; error?: string } {
    const key = `${branchId}:void:${orderId}`;
    const stored = this.otpStore.get(key);

    if (!stored) return { valid: false, error: 'No OTP found. Please request a new one.' };
    if (new Date() > stored.expiresAt) {
      this.otpStore.delete(key);
      return { valid: false, error: 'OTP expired. Please request a new one.' };
    }
    if (stored.otp !== inputOtp) return { valid: false, error: 'Invalid OTP.' };

    this.otpStore.delete(key); // One-time use
    return { valid: true };
  }

  // ─── Generic Action OTP (Phase 6) ──────────────────────────────────────────
  // Used by Purchase Order create / Receive / Return / Pay Supplier / Expense /
  // Pay Payroll / Pre-Ready KT and any other future cashier-action approval flow.

  async sendActionOtp(
    branchId: string,
    action: string,
    summary: string,
  ): Promise<{ sent: boolean; otp?: string; managerName?: string }> {
    const settings = await this.getSettings(branchId);

    const managers = await this.prisma.staff.findMany({
      where: { branchId, isActive: true, role: { in: ['MANAGER', 'OWNER'] }, phone: { not: null } },
      select: { id: true, name: true, phone: true, role: true },
      orderBy: { role: 'asc' },
    });

    if (managers.length === 0) {
      console.warn(`[SMS] No managers with phone numbers found for branch ${branchId}`);
      return { sent: false };
    }

    const otp = this.generateOtp();
    const key = `${branchId}:action:${action}`;
    this.otpStore.set(key, {
      otp,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      details: summary,
    });

    const manager = managers[0];
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId }, select: { name: true } });
    const brandName = branch?.name ?? 'Restora';
    const message = `[${brandName}] ${action} OTP: ${otp}\n${summary}\nExpires in 5 min.`;

    if (settings.smsEnabled && settings.smsApiKey && settings.notifyVoidOtp) {
      await this.sendSms(branchId, manager.phone!, message);
      return { sent: true, managerName: manager.name };
    }

    console.warn(`[SMS] Action OTP for ${manager.name} (${action}): ${otp} (SMS disabled)`);
    return { sent: false, otp, managerName: manager.name };
  }

  verifyActionOtp(branchId: string, action: string, inputOtp: string): { valid: boolean; error?: string } {
    const key = `${branchId}:action:${action}`;
    const stored = this.otpStore.get(key);

    if (!stored) return { valid: false, error: 'No OTP found. Please request a new one.' };
    if (new Date() > stored.expiresAt) {
      this.otpStore.delete(key);
      return { valid: false, error: 'OTP expired. Please request a new one.' };
    }
    if (stored.otp !== inputOtp) return { valid: false, error: 'Invalid OTP.' };

    this.otpStore.delete(key);
    return { valid: true };
  }
}
