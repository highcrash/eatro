import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { SCOPES_KEY } from '../decorators/scopes.decorator';
import type { ApiScope } from '../dto/api-scope.const';

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiScope[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const held = req.apiClient?.scopes ?? [];

    const missing = required.filter((s) => !held.includes(s));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing scopes: ${missing.join(', ')}`);
    }
    return true;
  }
}
