import { Injectable, Logger } from '@nestjs/common';
import type { SocialPlatform } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MenuContextService, matchDishes, MenuUnit } from './menu-context';
import { MetaAccountService } from './meta/meta-account.service';
import { MetaClient } from './meta/meta.client';

export interface PostRef {
  postId?: string | null;
  url?: string | null;
  title?: string | null;
}

export interface ResolvedPost {
  /** Menu units of the dishes the post is about, cheapest option first per dish. */
  units: MenuUnit[];
  dishCount: number;
  permalink: string | null;
}

const CACHE_HOURS = 24;

/**
 * Works out which dish a Facebook/Instagram post is about. Posts made by
 * the discount auto-poster are known exactly; any other post is matched by
 * the dish names in its caption, fetched once and cached.
 */
@Injectable()
export class PostContextService {
  private readonly logger = new Logger(PostContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly menus: MenuContextService,
    private readonly meta: MetaClient,
    private readonly accounts: MetaAccountService,
  ) {}

  async resolve(branchId: string, platform: SocialPlatform, ref: PostRef): Promise<ResolvedPost> {
    const menu = await this.menus.get(branchId);
    const pick = (dishIds: string[], permalink: string | null): ResolvedPost => {
      const units = dishIds.flatMap((id) => menu.units.filter((u) => u.dishId === id || u.itemId === id).sort((a, b) => a.price - b.price));
      return { units, dishCount: new Set(units.map((u) => u.dishId)).size, permalink };
    };

    // 1. Our own discount posts: post id → discount → dish.
    const ids = [ref.postId, ...((ref.url ?? '').match(/\d{8,}/g) ?? [])].filter((x): x is string => !!x);
    for (const id of ids) {
      const posted = await this.prisma.scheduledFbPost.findFirst({
        where: { branchId, OR: [{ fbPostId: id }, { fbPostId: { endsWith: `_${id}` } }] },
        select: { menuDiscount: { select: { menuItemId: true } } },
      });
      const itemId = posted?.menuDiscount?.menuItemId;
      if (itemId) {
        const unit = menu.units.find((u) => u.itemId === itemId || u.dishId === itemId);
        if (unit) return pick([unit.dishId], null);
      }
    }

    // 2. Cached or freshly fetched caption.
    let caption: string | null = null;
    let permalink: string | null = null;
    if (ref.postId) {
      const cached = await this.prisma.chatPostContext.findUnique({ where: { postId: ref.postId } });
      if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_HOURS * 3600_000) {
        const dishIds = ((cached.menuItemIds as string[] | null) ?? []).filter((id) => menu.units.some((u) => u.dishId === id));
        if (dishIds.length > 0 || !ref.title) return pick(dishIds, cached.permalink);
      } else {
        const auth = await this.accounts.auth(branchId);
        if (auth) {
          try {
            ({ caption, permalink } = await this.meta.postDetails(auth, platform, ref.postId));
          } catch (err) {
            this.logger.debug(`Could not read post ${ref.postId}: ${(err as Error).message}`);
          }
        }
        const dishIds = matchDishes(caption, menu);
        await this.prisma.chatPostContext.upsert({
          where: { postId: ref.postId },
          create: { branchId, platform, postId: ref.postId, caption, permalink, menuItemIds: dishIds },
          update: { caption, permalink, menuItemIds: dishIds, fetchedAt: new Date() },
        });
        if (dishIds.length > 0) return pick(dishIds, permalink);
      }
    }

    // 3. Whatever title Meta sent with a shared post.
    return pick(matchDishes(ref.title, menu), permalink);
  }
}
