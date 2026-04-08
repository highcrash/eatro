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

  async updateSettings(branchId: string, data: { smsEnabled?: boolean; smsApiKey?: string; smsApiUrl?: string; notifyVoidOtp?: boolean }) {
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
    const settings = await this.getSettings(branchId);
    if (!settings.smsEnabled || !settings.smsApiKey) {
      console.warn(`[SMS] SMS disabled or no API key for branch ${branchId}`);
      return false;
    }

    // Auto-prefix with [BranchName] if the body doesn't already start with a tag
    let finalBody = body;
    if (!body.startsWith('[')) {
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId }, select: { name: true } });
      if (branch?.name) finalBody = `[${branch.name}] ${body}`;
    }

    // Normalize BD phone numbers: 01XXXXXXXXX -> 8801XXXXXXXXX
    let to = phoneNumber.replace(/[^\d]/g, '');
    if (to.startsWith('0')) to = '88' + to;
    else if (!to.startsWith('880')) to = '880' + to.replace(/^880?/, '');

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
      if (!res.ok) {
        console.error(`[SMS] Failed to send to ${to}: ${res.status} ${res.statusText} ${text}`);
        return false;
      }
      // sms.net.bd returns JSON: { error: 0, msg: "...", data: {...} }
      try {
        const json = JSON.parse(text);
        if (json.error && json.error !== 0) {
          console.error(`[SMS] sms.net.bd error to ${to}: ${json.msg || text}`);
          return false;
        }
      } catch { /* non-json response, treat 2xx as ok */ }
      console.warn(`[SMS] Sent to ${to}: ${finalBody.slice(0, 50)}...`);
      return true;
    } catch (err) {
      console.error(`[SMS] Error sending to ${phoneNumber}:`, err);
      return false;
    }
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
