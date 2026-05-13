import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import type { ApiClient } from '../types/api-client.type';

export const CurrentApiClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiClient => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.apiClient) {
      throw new UnauthorizedException('No API client on request');
    }
    return req.apiClient;
  },
);
