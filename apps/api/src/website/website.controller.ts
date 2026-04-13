import { Body, Controller, Get, Param, Patch, UseGuards, ValidationPipe } from '@nestjs/common';
import type { JwtPayload } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WebsiteService } from './website.service';

/** Authenticated admin endpoints — read + write the active branch's website content. */
@Controller('website')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class WebsiteController {
  constructor(private readonly service: WebsiteService) {}

  @Get()
  get(@CurrentUser() user: JwtPayload) {
    return this.service.getContent(user.branchId);
  }

  @Patch()
  update(@CurrentUser() user: JwtPayload, @Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false, transform: false })) dto: Record<string, unknown>) {
    return this.service.updateContent(user.branchId, dto);
  }
}

/** Public — used by apps/web on boot. No auth. */
@Controller('public/website')
export class WebsitePublicController {
  constructor(private readonly service: WebsiteService) {}

  @Get(':branchId')
  get(@Param('branchId') branchId: string) {
    return this.service.getContent(branchId);
  }
}
