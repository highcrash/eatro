import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { Throttle, seconds } from '@nestjs/throttler';

import { AdminAuthService } from './admin-auth.service';
import { AdminJwtGuard } from './admin-jwt.guard';
import { CurrentAdmin } from './current-admin.decorator';
import type { AdminJwtPayload } from './admin-jwt.strategy';

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) currentPassword!: string;
  @IsString() @MinLength(10) newPassword!: string;
}

@ApiTags('Admin — auth')
@Controller('admin')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  /**
   * Tight throttle on login to blunt password-guessing. Combined with
   * the bcrypt cost (~90ms/attempt) this caps brute-force at ~5 tries
   * per minute per IP, independent of DB-side protections.
   */
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('password')
  @ApiBearerAuth()
  @UseGuards(AdminJwtGuard)
  async changePassword(@CurrentAdmin() admin: AdminJwtPayload, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(admin.sub, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }
}
