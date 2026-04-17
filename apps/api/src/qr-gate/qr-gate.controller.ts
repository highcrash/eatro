import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { QrGateService } from './qr-gate.service';

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
    // Express trust-proxy is enabled in main.ts so req.ip reflects
    // X-Forwarded-For correctly behind CloudFlare / DO load balancer.
    const ip = req.ip ?? null;
    return this.svc.evaluate(branchId, ip);
  }
}
