import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
  ConflictException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, Matches, MinLength } from 'class-validator';

import { PrismaService } from '../prisma/prisma.service';
import { SigningKeyService } from '../signing-key/signing-key.service';
import { AdminJwtGuard } from '../admin-auth/admin-jwt.guard';

class CreateProductDto {
  @IsString() @MinLength(3) @MaxLength(40)
  @Matches(/^[a-z0-9][a-z0-9-]{2,39}$/, { message: 'sku must be lowercase alphanumeric/dashes (3-40 chars)' })
  sku!: string;

  @IsString() @MinLength(1) @MaxLength(80)
  name!: string;

  @IsString() @MinLength(1) @MaxLength(20)
  version!: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsOptional() @IsString() @MaxLength(40)
  envatoItemId?: string;
}

class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(80)
  name?: string;

  @IsOptional() @IsString() @MaxLength(20)
  version?: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsOptional() @IsString() @MaxLength(40)
  envatoItemId?: string;
}

@ApiTags('Admin — products')
@ApiBearerAuth()
@Controller('admin/products')
@UseGuards(AdminJwtGuard)
export class ProductAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signingKeys: SigningKeyService,
  ) {}

  /**
   * List products with a summary: total purchase codes (paid + unused +
   * revoked) and total active licenses. Gives the Dashboard and Products
   * page the counts they need in a single query.
   */
  @Get()
  async list() {
    const rows = await this.prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { purchaseCodes: true, licenses: true, signingKeys: true } },
        signingKeys: {
          where: { isActive: true },
          select: { kid: true, ed25519PublicKey: true, createdAt: true },
          take: 1,
        },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      version: p.version,
      description: p.description,
      envatoItemId: p.envatoItemId,
      envatoLastSyncedAt: p.envatoLastSyncedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      counts: p._count,
      activeKey: p.signingKeys[0] ?? null,
    }));
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        signingKeys: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, kid: true, ed25519PublicKey: true, isActive: true, createdAt: true, rotatedAt: true, retiresAt: true },
        },
        _count: { select: { purchaseCodes: true, licenses: true } },
      },
    });
    if (!product) throw new NotFoundException({ result: 'NOT_FOUND' });
    return product;
  }

  /**
   * Atomic: creates the product AND its first signing key in a single
   * response. The admin only cares about "my product is ready for
   * clients to activate against" — separating the two steps would be
   * a foot-gun (you'd see "no active signing key" errors on the first
   * activate attempt).
   */
  @Post()
  async create(@Body() dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { sku: dto.sku } });
    if (existing) throw new ConflictException({ result: 'SKU_TAKEN' });

    const product = await this.prisma.product.create({
      data: {
        sku: dto.sku,
        name: dto.name,
        version: dto.version,
        description: dto.description ?? null,
        envatoItemId: dto.envatoItemId ?? null,
      },
    });
    const key = await this.signingKeys.createForProduct(product.id);
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      version: product.version,
      activeKey: {
        kid: key.kid,
        publicKey: key.publicKey,
      },
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException({ result: 'NOT_FOUND' });
    return this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        version: dto.version ?? undefined,
        description: dto.description ?? undefined,
        envatoItemId: dto.envatoItemId ?? undefined,
      },
    });
  }

  @Post(':id/rotate-key')
  async rotateKey(@Param('id') id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException({ result: 'NOT_FOUND' });
    return this.signingKeys.rotate(id);
  }
}
