import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { QrGateService, extractClientIp } from './qr-gate.service';

// Public — no auth. Called by the customer-facing QR app on boot before
// it renders the menu. If the branch has qrGateEnabled=true, the client
// IP must appear in qrAllowedIps (or fall inside one of its CIDR
// blocks); otherwise the app shows a "please connect to our Wi-Fi" page
// using the branch's SSID + password + custom instructions.
@Controller('public/qr-gate')
export class QrGateController {
  constructor(private readonly svc: QrGateService) {}

  @Get(':branchId')
  async check(@Param('branchId') branchId: string, @Req() req: Request) {
    // extractClientIp prefers CF-Connecting-IP / X-Forwarded-For[0] over
    // req.ip because DO → CF is a 2-hop chain and the latter can point
    // at the intermediate edge rather than the real guest.
    const ip = extractClientIp(req);
    return this.svc.evaluate(branchId, ip);
  }
}
