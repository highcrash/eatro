import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@restora/types';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

/// Staff-facing admin surface for managing external API keys. Lives
/// under /admin/api-keys (NOT under /v1/external/*) because it is
/// authenticated with the staff JWT, not an API key. OWNER-only.
@ApiTags('Admin / API Keys')
@ApiBearerAuth()
@Controller('admin/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List API keys for the current branch' })
  list(@CurrentUser() user: JwtPayload) {
    return this.apiKeys.list(user.branchId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new API key',
    description:
      'Returns the plaintext key in the `plaintextKey` field. This is the ONLY time the secret is returned — store it immediately.',
  })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateApiKeyDto) {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    return this.apiKeys.create({
      branchId: user.branchId,
      createdById: user.sub,
      name: dto.name,
      scopes: dto.scopes,
      expiresAt,
    });
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke an API key (permanent)' })
  revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.apiKeys.revoke(user.branchId, id);
  }
}
