import {
  Body,
  Controller,
  Header,
  HttpException,
  Post,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import type { Request } from 'express';

import { LicenseService } from './license.service';
import { LogService } from '../log/log.service';
import { AbuseTracker } from './abuse-tracker';
import { extractClientIp } from './client-ip';
import { ActivateDto, VerifyDto, DeactivateDto } from './dto';
import { ActivateThrottlerGuard, VerifyThrottlerGuard } from './guards/license-throttler.guard';
import { HmacRequestGuard } from './guards/hmac-request.guard';

/**
 * Public license endpoints called by installed copies of products that
 * use this license server. Open CORS (any origin) — these are server-to-
 * server in production but allowed from browsers too in case a SPA-only
 * product needs them. No credentials.
 */
@ApiTags('Licenses (public)')
@Controller('licenses')
export class LicenseController {
  private readonly logger = new Logger(LicenseController.name);

  constructor(
    private readonly licenses: LicenseService,
    private readonly logs: LogService,
    private readonly abuse: AbuseTracker,
  ) {}

  // ── activate ──────────────────────────────────────────────────────────

  @Post('activate')
  @UseGuards(ActivateThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Allow-Origin', '*')
  async activate(@Body() body: ActivateDto, @Req() req: Request) {
    const ip = extractClientIp(req);
    const ua = req.header('user-agent') ?? null;

    if (this.abuse.isBlocked(ip)) {
      if (this.abuse.markBlockedHit(ip)) {
        this.logs.write({ action: 'BLOCKED', result: 'IP_BLOCKED', ip, userAgent: ua, detail: { endpoint: 'activate' } });
      }
      throw new HttpException({ result: 'BLOCKED', message: 'Too many failed attempts. Try again later.' }, 429);
    }

    try {
      const result = await this.licenses.activate(body);
      this.logs.write({
        action: 'ACTIVATE',
        result: 'OK',
        licenseId: result.licenseId,
        ip,
        userAgent: ua,
        detail: { domain: body.domain, productSku: body.productSku },
      });
      return result;
    } catch (err) {
      const exc = err as HttpException;
      const resp = (typeof exc.getResponse === 'function' ? exc.getResponse() : null) as
        | { result?: string }
        | string
        | null;
      const result = (typeof resp === 'object' && resp?.result) ? resp.result : 'ERROR';

      // INVALID_CODE feeds the abuse tracker — repeat hits from the
      // same IP earn a 15-minute block.
      if (result === 'INVALID_CODE') {
        const justBlocked = this.abuse.recordInvalidCode(ip);
        if (justBlocked) {
          this.logs.write({ action: 'BLOCKED', result: 'IP_BLOCKED_AFTER_FAILS', ip, userAgent: ua });
          this.logger.warn(`Blocked ${ip} for 15min after 10 INVALID_CODE in 5min`);
        }
      }

      this.logs.write({
        action: 'ACTIVATE',
        result,
        ip,
        userAgent: ua,
        detail: { domain: body.domain, productSku: body.productSku },
      });
      throw err;
    }
  }

  // ── verify ────────────────────────────────────────────────────────────

  @Post('verify')
  @UseGuards(VerifyThrottlerGuard, HmacRequestGuard)
  @Throttle({ default: { limit: 60, ttl: seconds(60) } })
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Allow-Origin', '*')
  async verify(@Body() body: VerifyDto, @Req() req: Request) {
    const ip = extractClientIp(req);
    try {
      const result = await this.licenses.verify({
        licenseId: body.licenseId,
        fingerprint: body.fingerprint,
        ip,
      });
      this.logs.write({
        action: 'VERIFY',
        result: 'OK',
        licenseId: body.licenseId,
        ip,
        userAgent: req.header('user-agent') ?? null,
        detail: { status: result.status },
      });
      return result;
    } catch (err) {
      const exc = err as HttpException;
      const resp = (typeof exc.getResponse === 'function' ? exc.getResponse() : null) as { result?: string } | null;
      this.logs.write({
        action: 'VERIFY',
        result: resp?.result ?? 'ERROR',
        licenseId: body.licenseId,
        ip,
        userAgent: req.header('user-agent') ?? null,
      });
      throw err;
    }
  }

  // ── deactivate ────────────────────────────────────────────────────────

  @Post('deactivate')
  @UseGuards(VerifyThrottlerGuard, HmacRequestGuard)
  @Throttle({ default: { limit: 60, ttl: seconds(60) } })
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Allow-Origin', '*')
  async deactivate(@Body() body: DeactivateDto, @Req() req: Request) {
    const ip = extractClientIp(req);
    try {
      const result = await this.licenses.deactivate({
        licenseId: body.licenseId,
        fingerprint: body.fingerprint,
      });
      this.logs.write({
        action: 'DEACTIVATE',
        result: 'OK',
        licenseId: body.licenseId,
        ip,
        userAgent: req.header('user-agent') ?? null,
      });
      return result;
    } catch (err) {
      const exc = err as HttpException;
      const resp = (typeof exc.getResponse === 'function' ? exc.getResponse() : null) as { result?: string } | null;
      this.logs.write({
        action: 'DEACTIVATE',
        result: resp?.result ?? 'ERROR',
        licenseId: body.licenseId,
        ip,
        userAgent: req.header('user-agent') ?? null,
      });
      throw err;
    }
  }
}
