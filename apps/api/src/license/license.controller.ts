import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { LicenseService } from './license.service';
import { Public } from './public.decorator';

class ActivateDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  purchaseCode!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  domain!: string;
}

/**
 * The gate's own three endpoints. All `@Public()` because they have to
 * be reachable from a locked install — that's the whole point.
 *
 *   POST /license/activate    operator pastes purchase code + domain
 *   GET  /license/status      poll target for the admin UI banner
 *   POST /license/deactivate  release the seat before re-installing
 *
 * Routes are NOT versioned (`/license/*`, not `/api/v1/license/*`) so
 * they don't drift if we bump the API version. The license API on the
 * neawaslic side IS versioned; this is the LOCAL gate.
 */
@Controller('license')
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  @Public()
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  async activate(@Body() dto: ActivateDto): Promise<{
    mode: string;
    status: string | null;
    domain: string | null;
    daysRemaining: number;
  }> {
    const v = await this.license.activate({
      purchaseCode: dto.purchaseCode.trim(),
      domain: dto.domain.trim(),
    });
    return {
      mode: v.mode,
      status: v.status,
      domain: v.domain,
      daysRemaining: v.graceDaysRemaining,
    };
  }

  @Public()
  @Get('status')
  status(): {
    mode: string;
    status: string | null;
    daysRemaining: number;
    domain: string | null;
    reason: string;
  } {
    return this.license.getPublicStatus();
  }

  @Public()
  @Post('deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(): Promise<{ ok: true }> {
    await this.license.deactivate();
    return { ok: true };
  }
}
