import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import type { ApiScope } from './dto/api-scope.const';

const PREFIX_BYTES = 4;
const SECRET_BYTES = 32;
const BCRYPT_ROUNDS = 12;
const MAX_PREFIX_RETRIES = 5;

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /// Generate a new key for a branch. Returns the full plaintext key
  /// EXACTLY ONCE — callers must surface it to the user immediately and
  /// then forget it. Only the prefix + bcrypt hash are stored.
  async create(params: {
    branchId: string;
    createdById: string;
    name: string;
    scopes: ApiScope[];
    expiresAt?: Date;
  }): Promise<{ id: string; prefix: string; plaintextKey: string }> {
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const keyHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);

    for (let attempt = 0; attempt < MAX_PREFIX_RETRIES; attempt++) {
      const prefix = randomBytes(PREFIX_BYTES).toString('hex');
      try {
        const row = await this.prisma.externalApiKey.create({
          data: {
            branchId: params.branchId,
            createdById: params.createdById,
            name: params.name,
            scopes: params.scopes,
            prefix,
            keyHash,
            expiresAt: params.expiresAt ?? null,
          },
        });
        return {
          id: row.id,
          prefix: row.prefix,
          plaintextKey: `rk_${prefix}_${secret}`,
        };
      } catch (err: unknown) {
        if (isUniqueViolation(err) && attempt < MAX_PREFIX_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }

    throw new ConflictException('Could not allocate unique key prefix');
  }

  /// List keys for a branch. Never returns keyHash; the secret is
  /// already lost by the time the row exists in this state.
  list(branchId: string) {
    return this.prisma.externalApiKey.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
        expiresAt: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async revoke(branchId: string, id: string) {
    const existing = await this.prisma.externalApiKey.findFirst({
      where: { id, branchId },
    });
    if (!existing) throw new NotFoundException('API key not found');
    if (existing.revokedAt) return existing;
    return this.prisma.externalApiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}
