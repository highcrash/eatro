import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 404s every /install/* route once the wizard has been finished.
 *
 * Why 404 (not 403): a buyer who completed install shouldn't even be
 * told the wizard exists. 404 makes the routes look like they were
 * never compiled in. Crackers poking at `/install/finish` to seed an
 * admin without going through auth see "not found" — same as any other
 * absent endpoint.
 *
 * No in-memory cache: the wizard is a 5-step one-shot process; even
 * the worst-case access pattern (operator hammering Refresh) is < 10
 * DB round trips total. An earlier version cached `installedAt` here
 * but @UseGuards(InstallGuard) appears to instantiate the guard
 * outside the provider registry on some Nest configurations, so the
 * cache wouldn't be shared with InstallService's "markInstalled" flip.
 * Just hit the DB.
 */
@Injectable()
export class InstallGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(_ctx: ExecutionContext): Promise<boolean> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { id: 'self' },
      select: { installedAt: true },
    });
    if (cfg?.installedAt) {
      throw new NotFoundException();
    }
    return true;
  }
}
