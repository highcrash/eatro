import { Controller, Post, Body, UseGuards, Request, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import type { LoginDto, RefreshTokenDto, VerifyCredentialsDto, JwtPayload } from '@restora/types';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(LocalAuthGuard)
  @Throttle({ default: { ttl: 900_000, limit: 5 } }) // 5 req / 15 min
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Request() req: { user: Parameters<AuthService['login']>[0] }, @Body() _dto: LoginDto) {
    return this.authService.login(req.user);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange refresh token for new access token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { ttl: 900_000, limit: 10 } })
  @ApiOperation({ summary: 'Verify manager credentials for approval flows' })
  verify(@Body() dto: VerifyCredentialsDto) {
    return this.authService.verifyCredentials(dto.email, dto.password);
  }

  @Post('verify-self')
  @HttpCode(200)
  @Throttle({ default: { ttl: 900_000, limit: 20 } })
  @ApiOperation({ summary: 'Confirm own password (any role)' })
  verifySelf(@Body() dto: VerifyCredentialsDto) {
    return this.authService.verifySelfPassword(dto.email, dto.password);
  }

  @Post('switch-branch')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'OWNER-only: switch active branch and receive a fresh JWT' })
  switchBranch(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { branchId: string },
  ) {
    return this.authService.switchBranch(user.sub, user.role, dto.branchId);
  }
}
