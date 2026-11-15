import { Injectable, Logger } from '@nestjs/common';
import type { SocialPlatform } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AiRouterService } from './ai/ai-router.service';
import type { AiRequest } from './ai/ai.types';
import { downloadImage } from './image-fetch';
import { MenuContextService, matchDishes, MenuSnapshot, MenuUnit } from './menu-context';
import { MetaAccountService } from './meta/meta-account.service';
import { MetaClient } from './meta/meta.client';
import { buildPostPrompt } from './prompt';

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
/** Below this the AI's guess is not used: a wrong dish means a wrong price in public. */
const AI_MIN_CONFIDENCE = 0.6;

/**
 * Works out which dish a Facebook/Instagram post is about. Posts made by
 * the discount auto-poster are known exactly; any other post is matched by
 * the dish names in its caption. When the caption names no dish, the AI
 * reads the caption and the photo once. The answer is cached per post.
 */
@Injectable()
export class PostContextService {
  private readonly logger = new Logger(PostContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly menus: MenuContextService,
    private readonly meta: MetaClient,
    private readonly accounts: MetaAccountService,
    private readonly router: AiRouterService,
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

    // 2. Cached or freshly fetched caption (and the AI's reading of the post).
    let caption: string | null = null;
    let permalink: string | null = null;
    if (ref.postId) {
      const cached = await this.prisma.chatPostContext.findUnique({ where: { postId: ref.postId } });
      const known = (ids: unknown) => ((ids as string[] | null) ?? []).filter((id) => menu.units.some((u) => u.dishId === id));
      const fresh = !!cached && Date.now() - cached.fetchedAt.getTime() < CACHE_HOURS * 3600_000;
      // A fresh cache answers, unless nothing matched and the AI has not looked yet.
      if (fresh && (known(cached.menuItemIds).length > 0 || cached.aiCheckedAt)) {
        const dishIds = known(cached.menuItemIds);
        if (dishIds.length > 0 || !ref.title) return pick(dishIds, cached.permalink);
      } else {
        let imageUrl: string | null = null;
        const auth = await this.accounts.auth(branchId);
        if (auth) {
          try {
            ({ caption, permalink, imageUrl = null } = await this.meta.postDetails(auth, platform, ref.postId));
          } catch (err) {
            this.logger.debug(`Could not read post ${ref.postId}: ${(err as Error).message}`);
          }
        }
        let dishIds = matchDishes(caption, menu);
        let aiCheckedAt: Date | null = null;
        if (dishIds.length === 0) {
          if (cached?.aiCheckedAt && cached.caption === caption) {
            // Same post as before: reuse what the AI said, no new AI request.
            dishIds = known(cached.menuItemIds);
            aiCheckedAt = cached.aiCheckedAt;
          } else {
            const read = await this.aiMatch(branchId, caption, imageUrl, menu);
            if (read) {
              dishIds = read;
              aiCheckedAt = new Date();
            }
          }
        }
        await this.prisma.chatPostContext.upsert({
          where: { postId: ref.postId },
          create: { branchId, platform, postId: ref.postId, caption, permalink, menuItemIds: dishIds, aiCheckedAt },
          update: { caption, permalink, menuItemIds: dishIds, aiCheckedAt, fetchedAt: new Date() },
        });
        if (dishIds.length > 0) return pick(dishIds, permalink);
      }
    }

    // 3. Whatever title Meta sent with a shared post.
    return pick(matchDishes(ref.title, menu), permalink);
  }

  /**
   * The AI reads the post: the photo through the "Customer photos"
   * connections when photo reading is on, else the caption through the
   * "Unclear comments" ones. Null when no AI answered, so a later comment
   * tries again; an empty list means the AI saw no particular dish.
   */
  private async aiMatch(branchId: string, caption: string | null, imageUrl: string | null, menu: MenuSnapshot): Promise<string[] | null> {
    const text = caption?.trim() ? `Post caption:\n${caption.trim().slice(0, 1500)}` : 'This post has no caption.';
    const settings = await this.prisma.chatbotSetting.findUnique({ where: { branchId }, select: { visionEnabled: true } });
    const image = settings?.visionEnabled && imageUrl ? await downloadImage(imageUrl).catch(() => null) : null;
    if (!image && !caption?.trim()) return null;

    const system = buildPostPrompt(menu);
    const accept = (r: { text: string }) => parsePostMatches(r.text, menu);
    const ask = (job: 'VISION' | 'COMMENT', request: AiRequest) => this.router.run(branchId, job, request, { accept }).catch(() => null);
    let out = image ? await ask('VISION', { system, messages: [{ role: 'user', content: text, images: [image] }] }) : null;
    if (!out && caption?.trim()) out = await ask('COMMENT', { system, messages: [{ role: 'user', content: text }] });
    if (!out) return null;

    const ids: string[] = [];
    for (const m of out.value) {
      const unit = m.confidence >= AI_MIN_CONFIDENCE ? menu.byRef.get(m.ref) : undefined;
      if (unit && !ids.includes(unit.dishId)) ids.push(unit.dishId);
    }
    return ids.slice(0, 3);
  }
}

/** The AI's {"matches": [...]} answer, keeping only refs on the menu. Null when unreadable. */
export function parsePostMatches(raw: string, menu: MenuSnapshot): { ref: string; confidence: number }[] | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { matches?: { ref?: unknown; confidence?: unknown }[] };
    if (!Array.isArray(obj.matches)) return null;
    return obj.matches
      .map((m) => ({ ref: String(m?.ref ?? '').trim(), confidence: Math.max(0, Math.min(1, Number(m?.confidence) || 0)) }))
      .filter((m) => menu.byRef.has(m.ref))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  } catch {
    return null;
  }
}
