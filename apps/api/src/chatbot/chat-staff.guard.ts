import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@restora/types';

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

export const CHAT_STAFF_KEY = 'chatStaff';

/**
 * Route open to anyone who handles customer chats: Owner and Manager always,
 * other staff when "Can handle chats" is switched on for them.
 */
export const ChatStaff = () => SetMetadata(CHAT_STAFF_KEY, true);

const CACHE_MS = 30_000;

/**
 * Drop-in for RolesGuard on the chat controllers: routes marked @ChatStaff()
 * check the per-staff switch, every other route keeps its @Roles() rule.
 */
@Injectable()
export class ChatStaffGuard implements CanActivate {
  private static readonly cache = new Map<string, { ok: boolean; at: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  /** Call after the switch changes so it applies at once. */
  static forget(staffId: string) {
    ChatStaffGuard.cache.delete(staffId);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const { user } = context.switchToHttp().getRequest<{ user: { sub: string; role: UserRole } }>();
    if (this.reflector.getAllAndOverride<boolean>(CHAT_STAFF_KEY, targets)) return this.canHandleChats(user);
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    if (!required || required.length === 0) return true;
    return required.includes(user.role);
  }

  async canHandleChats(user: { sub: string; role: UserRole } | undefined): Promise<boolean> {
    if (!user) return false;
    if (user.role === 'OWNER' || user.role === 'MANAGER') return true;
    const cached = ChatStaffGuard.cache.get(user.sub);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.ok;
    const staff = await this.prisma.staff.findUnique({ where: { id: user.sub }, select: { canHandleChats: true, isActive: true, deletedAt: true } });
    const ok = !!staff && staff.isActive && !staff.deletedAt && staff.canHandleChats;
    ChatStaffGuard.cache.set(user.sub, { ok, at: Date.now() });
    return ok;
  }
}
