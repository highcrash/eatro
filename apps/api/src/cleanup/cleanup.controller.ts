import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { CleanupService, type CleanupScope } from './cleanup.service';

@Controller('cleanup')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CleanupController {
  constructor(private readonly svc: CleanupService) {}

  @Post()
  @Roles('OWNER')
  run(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { scope: CleanupScope; password: string; confirmName: string },
  ) {
    return this.svc.run(user.branchId, user.sub, dto.scope, dto.password, dto.confirmName);
  }
}
