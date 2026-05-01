import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FacebookClient } from './facebook.client';
import { SocialImageStore } from './image-store';
import { composeDiscountImage } from './image-composer';
import { buildDiscountCaption } from './caption';

/**
 * Auto-Facebook-post coordinator.
 *
 * Owns:
 *   - Branch settings round-trip for the FB connection (connect /
 *     disconnect / read).
 *   - Schedule generation: when a MenuItemDiscount is created, render
 *     its image + caption and queue a ScheduledFbPost row.
 *   - Queue management API surface (list / reschedule / cancel /
 *     post-now).
 *   - The cron entrypoint `runDuePosts()` that publishes every PENDING
 *     row whose `scheduledAt <= now`.
 *
 * Failure posture: every external call is wrapped — a Graph API
 * outage, a missing food image, or an expired token will never
 * throw past `scheduleForDiscount`, because the caller (discount
 * service) is on the critical path and shouldn't fail when the
 * marketing extra fails.
 */

const MAX_ATTEMPTS = 3;

@Injectable()
export class SocialService {
  private readonly log = new Logger(SocialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fb: FacebookClient,
    private readonly store: SocialImageStore,
  ) {}

  // ─── Settings ────────────────────────────────────────────────────

  /** Read-side of the Settings tab. Token is masked for non-OWNER reads
   *  upstream; this method always returns the raw row so the caller can
   *  decide what to leak. */
  async getSettings(branchId: string) {
    const s = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!s) return null;
    return {
      fbAutopostEnabled: s.fbAutopostEnabled,
      fbPageId: s.fbPageId,
      fbPageName: s.fbPageName,
      fbConnectedAt: s.fbConnectedAt,
      fbDefaultPostTime: s.fbDefaultPostTime,
      fbHasToken: !!s.fbPageAccessToken,
    };
  }

  async setEnabled(branchId: string, enabled: boolean) {
    await this.prisma.branchSetting.upsert({
      where: { branchId },
      create: { branchId, fbAutopostEnabled: enabled },
      update: { fbAutopostEnabled: enabled },
    });
    return { fbAutopostEnabled: enabled };
  }

  async setDefaultPostTime(branchId: string, time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) {
      throw new BadRequestException('Default post time must be HH:mm');
    }
    await this.prisma.branchSetting.upsert({
      where: { branchId },
      create: { branchId, fbDefaultPostTime: time },
      update: { fbDefaultPostTime: time },
    });
    return { fbDefaultPostTime: time };
  }

  /** Connect a Facebook page. Verifies the token first so the admin gets
   *  a friendly Graph-API error message back instead of a 500 from the
   *  prisma update path. Uses upsert because some branches may not have
   *  a BranchSetting row yet (created lazily when other settings are
   *  first touched). */
  async connectPage(branchId: string, dto: { pageId: string; pageAccessToken: string }) {
    const pageId = dto.pageId.trim();
    const accessToken = dto.pageAccessToken.trim();
    if (!pageId || !accessToken) {
      throw new BadRequestException('pageId and pageAccessToken are required');
    }
    let verified;
    try {
      verified = await this.fb.verifyPage({ pageId, accessToken });
    } catch (err) {
      const msg = (err as Error).message ?? 'Facebook verification failed';
      this.log.warn(`connectPage verify failed for branch ${branchId}: ${msg}`);
      throw new BadRequestException(msg);
    }
    try {
      await this.prisma.branchSetting.upsert({
        where: { branchId },
        create: {
          branchId,
          fbPageId: verified.pageId,
          fbPageName: verified.pageName,
          fbPageAccessToken: accessToken,
          fbConnectedAt: new Date(),
          fbAutopostEnabled: true,
        },
        update: {
          fbPageId: verified.pageId,
          fbPageName: verified.pageName,
          fbPageAccessToken: accessToken,
          fbConnectedAt: new Date(),
          fbAutopostEnabled: true,
        },
      });
    } catch (err) {
      const msg = (err as Error).message ?? 'Failed to save page connection';
      this.log.error(`connectPage save failed for branch ${branchId}: ${msg}`);
      throw new BadRequestException(`Save failed: ${msg}`);
    }
    return { pageId: verified.pageId, pageName: verified.pageName };
  }

  async disconnectPage(branchId: string) {
    await this.prisma.branchSetting.upsert({
      where: { branchId },
      create: { branchId, fbAutopostEnabled: false },
      update: {
        fbPageId: null,
        fbPageName: null,
        fbPageAccessToken: null,
        fbConnectedAt: null,
        fbAutopostEnabled: false,
      },
    });
    return { ok: true };
  }

  // ─── Scheduling ──────────────────────────────────────────────────

  /**
   * Idempotent — call this whenever a MenuItemDiscount is created or
   * its `startDate` changes. Skips silently when:
   *   - Branch not connected to FB / autopost off.
   *   - Discount already has a non-PENDING ScheduledFbPost (POSTED /
   *     CANCELLED / FAILED) — admin already saw the outcome.
   *
   * Reschedule semantics: an existing PENDING row is updated in-place
   * (image regenerated to capture latest item info; scheduledAt
   * bumped). Errors caught — auto-post is best-effort.
   */
  async scheduleForDiscount(discountId: string): Promise<void> {
    try {
      const discount = await this.prisma.menuItemDiscount.findFirst({
        where: { id: discountId },
        include: {
          menuItem: { select: { id: true, name: true, price: true, imageUrl: true, branchId: true } },
        },
      });
      if (!discount) return;
      if (!discount.menuItem) return;
      const branchId = discount.menuItem.branchId;
      const settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
      if (!settings?.fbAutopostEnabled || !settings.fbPageAccessToken) return;
      const branch = await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { logoUrl: true, posLogoUrl: true, address: true, phone: true, name: true },
      });
      if (!branch) return;

      const days = (() => {
        if (!discount.applicableDays) return null;
        try {
          const arr = JSON.parse(discount.applicableDays);
          return Array.isArray(arr) ? (arr as string[]) : null;
        } catch {
          return null;
        }
      })();

      const oldPrice = Number(discount.menuItem.price);
      const value = Number(discount.value);
      const newPrice = discount.type === 'FLAT'
        ? Math.max(0, oldPrice - value)
        : Math.round(oldPrice * (1 - value / 100));

      // Roll midnight startDates forward to the branch's default post
      // time so we don't all post at 00:00.
      const now = new Date();
      let scheduledAt = new Date(discount.startDate);
      if (scheduledAt < now) scheduledAt = now;
      if (scheduledAt.getHours() === 0 && scheduledAt.getMinutes() === 0) {
        const [hh, mm] = settings.fbDefaultPostTime.split(':').map(Number);
        scheduledAt.setHours(hh, mm, 0, 0);
      }

      // Render the discount card.
      const imageRender = await composeDiscountImage({
        productName: discount.menuItem.name,
        foodImageUrl: discount.menuItem.imageUrl,
        discount: {
          type: discount.type as 'FLAT' | 'PERCENTAGE',
          value: discount.type === 'FLAT' ? value : value, // value semantics differ but renderer handles both
        },
        validity: {
          endDate: new Date(discount.endDate),
          days,
        },
        branding: {
          logoUrl: branch.posLogoUrl ?? branch.logoUrl,
          address: branch.address ?? '',
        },
      });

      // Reuse the discount id as a stable key so rescheduling overwrites
      // the same image file rather than leaking copies.
      const stored = await this.store.save(`discount-${discount.id}`, imageRender.buffer);

      // Build the caption.
      const message = buildDiscountCaption({
        productName: discount.menuItem.name,
        oldPrice,
        newPrice,
        days,
        validTill: new Date(discount.endDate),
        timeRange: null,
        address: branch.address ?? '',
        phone: branch.phone ?? '',
      });

      // Upsert by discountId — a given discount can have at most one
      // active scheduled post. If a row already exists in non-PENDING
      // status (POSTED / CANCELLED / FAILED), skip.
      const existing = await this.prisma.scheduledFbPost.findFirst({
        where: { menuDiscountId: discount.id },
        orderBy: { createdAt: 'desc' },
      });
      if (existing && existing.status !== 'PENDING') return;
      if (existing) {
        await this.prisma.scheduledFbPost.update({
          where: { id: existing.id },
          data: { scheduledAt, message, imagePath: stored.path, attempts: 0, lastError: null },
        });
      } else {
        await this.prisma.scheduledFbPost.create({
          data: {
            branchId,
            menuDiscountId: discount.id,
            scheduledAt,
            message,
            imagePath: stored.path,
          },
        });
      }
    } catch (err) {
      this.log.warn(`scheduleForDiscount(${discountId}) failed: ${(err as Error).message}`);
    }
  }

  // ─── Queue management ────────────────────────────────────────────

  async list(branchId: string, opts?: { status?: string; limit?: number }) {
    const status = opts?.status;
    const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
    return this.prisma.scheduledFbPost.findMany({
      where: {
        branchId,
        ...(status ? { status: status as 'PENDING' | 'POSTED' | 'CANCELLED' | 'FAILED' } : {}),
      },
      orderBy: { scheduledAt: 'desc' },
      take: limit,
      include: {
        menuDiscount: {
          select: {
            id: true,
            type: true,
            value: true,
            menuItem: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async reschedule(branchId: string, postId: string, scheduledAt: Date) {
    const post = await this.prisma.scheduledFbPost.findFirst({ where: { id: postId, branchId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status !== 'PENDING') {
      throw new BadRequestException(`Post is ${post.status} and cannot be rescheduled`);
    }
    return this.prisma.scheduledFbPost.update({
      where: { id: postId },
      data: { scheduledAt, attempts: 0, lastError: null },
    });
  }

  async cancel(branchId: string, postId: string) {
    const post = await this.prisma.scheduledFbPost.findFirst({ where: { id: postId, branchId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status === 'POSTED') {
      throw new BadRequestException('Cannot cancel a post that has already been published');
    }
    return this.prisma.scheduledFbPost.update({
      where: { id: postId },
      data: { status: 'CANCELLED' },
    });
  }

  /** Push the row to the head of the queue — the next cron tick fires
   *  it. Returns the updated row so the UI can re-render immediately. */
  async postNow(branchId: string, postId: string) {
    const post = await this.prisma.scheduledFbPost.findFirst({ where: { id: postId, branchId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status !== 'PENDING' && post.status !== 'FAILED') {
      throw new BadRequestException(`Post is ${post.status}`);
    }
    return this.prisma.scheduledFbPost.update({
      where: { id: postId },
      data: { scheduledAt: new Date(), status: 'PENDING', attempts: 0, lastError: null },
    });
  }

  /** Used by the admin preview endpoint. */
  async getImageBytes(branchId: string, postId: string): Promise<Buffer> {
    const post = await this.prisma.scheduledFbPost.findFirst({ where: { id: postId, branchId } });
    if (!post) throw new NotFoundException('Post not found');
    return this.store.read(post.imagePath);
  }

  // ─── Cron worker ─────────────────────────────────────────────────

  /** Called by `SocialScheduler` once per minute. Picks up every
   *  PENDING row whose `scheduledAt <= now` and posts it. Bounded
   *  fan-out to keep one slow page from blocking the rest. */
  async runDuePosts(): Promise<{ scanned: number; posted: number; failed: number }> {
    const now = new Date();
    const due = await this.prisma.scheduledFbPost.findMany({
      where: { status: 'PENDING', scheduledAt: { lte: now } },
      include: {
        branch: {
          select: {
            id: true,
            settings: { select: { fbPageId: true, fbPageAccessToken: true, fbAutopostEnabled: true } },
          },
        },
      },
      take: 50,
    });
    let posted = 0;
    let failed = 0;
    for (const p of due) {
      const settings = p.branch.settings;
      if (!settings?.fbAutopostEnabled || !settings.fbPageId || !settings.fbPageAccessToken) {
        // Branch disconnected after the row was queued — leave it
        // PENDING; admin can disconnect/cancel manually.
        continue;
      }
      try {
        const buf = await this.store.read(p.imagePath);
        const res = await this.fb.postPhoto({
          pageId: settings.fbPageId,
          accessToken: settings.fbPageAccessToken,
          imageBuffer: buf,
          caption: p.message,
        });
        await this.prisma.scheduledFbPost.update({
          where: { id: p.id },
          data: { status: 'POSTED', postedAt: new Date(), fbPostId: res.postId, lastError: null },
        });
        posted++;
      } catch (err) {
        const attempts = p.attempts + 1;
        const status = attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
        const msg = (err as Error).message ?? String(err);
        await this.prisma.scheduledFbPost.update({
          where: { id: p.id },
          data: { attempts, status, lastError: msg.slice(0, 500) },
        });
        if (status === 'FAILED') failed++;
        this.log.warn(`Post ${p.id} attempt ${attempts}/${MAX_ATTEMPTS}: ${msg}`);
      }
    }
    return { scanned: due.length, posted, failed };
  }
}
