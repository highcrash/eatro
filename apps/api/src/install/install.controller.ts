import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../license/public.decorator';
import { InstallGuard } from './install.guard';
import { InstallService } from './install.service';

// Silence "imported but not used at value level" by referencing via type-only.
// (InstallGuard IS used — as a @UseGuards argument below — but TS's unused
//  checker sometimes flags the import depending on metadata settings.)

class CreateOwnerDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString() @MinLength(8) @MaxLength(128)
  password!: string;
}

class CreateBranchDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsString() @MinLength(2) @MaxLength(255)
  address!: string;

  @IsString() @MinLength(4) @MaxLength(40)
  phone!: string;

  @IsOptional() @IsString() @MaxLength(40)
  timezone?: string;

  @IsOptional() @IsString() @MaxLength(8)
  currency?: string;
}

class FinishDto {
  @IsOptional() @IsString() @MaxLength(80)
  brandName?: string;

  @IsOptional() @IsString() @MaxLength(80)
  siteName?: string;

  @IsOptional() @IsEmail()
  supportEmail?: string;
}

/**
 * Install wizard public API. Two route groups:
 *
 *   /install/status             — always reachable, returns
 *                                 needsInstall + step completion. UI
 *                                 polls this on app boot.
 *   /install/{system-check,
 *            branch, owner,
 *            finish}            — guarded by InstallGuard which 404s
 *                                 once finish() persists installedAt.
 *
 * All routes are also `@Public()` so the LicenseGuard doesn't block
 * the wizard from running on a fresh install (no license, no admin
 * staff yet — both gates would otherwise reject).
 */
@ApiTags('Install')
@Public()
@Controller('install')
export class InstallController {
  constructor(private readonly install: InstallService) {}

  /** Status is intentionally NOT behind InstallGuard — the admin UI
   *  calls it on EVERY page load to know which view to render. After
   *  install finishes it returns `{needsInstall: false}` forever. */
  @Get('status')
  status() {
    return this.install.getStatus();
  }

  // The next four are gated. Once installed → 404.
  @Post('system-check')
  @UseGuards(InstallGuard)
  @HttpCode(HttpStatus.OK)
  systemCheck() {
    return this.install.runSystemCheck();
  }

  @Post('branch')
  @UseGuards(InstallGuard)
  @HttpCode(HttpStatus.OK)
  createBranch(@Body() dto: CreateBranchDto) {
    return this.install.createBranch(dto);
  }

  @Post('owner')
  @UseGuards(InstallGuard)
  @HttpCode(HttpStatus.OK)
  createOwner(@Body() dto: CreateOwnerDto) {
    return this.install.createOwner(dto);
  }

  @Post('finish')
  @UseGuards(InstallGuard)
  @HttpCode(HttpStatus.OK)
  finish(@Body() dto: FinishDto) {
    return this.install.finish(dto);
  }
}
