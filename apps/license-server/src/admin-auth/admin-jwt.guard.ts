import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Named passport guard matching the `admin-jwt` strategy. Applied at
 * the controller or route level on every /admin/* endpoint.
 */
@Injectable()
export class AdminJwtGuard extends AuthGuard('admin-jwt') {}
