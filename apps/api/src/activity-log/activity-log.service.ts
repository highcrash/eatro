import { Injectable, Logger } from '@nestjs/common';
import type { ActivityCategory, ActivityAction } from '@prisma/client';
import type { JwtPayload } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';

// Strip these field names from any logged before/after snapshot. Keys are
// matched case-insensitively against the leaf field names — anything that
// could leak a secret, hash, token or PIN never reaches the DB. Add to this
// list when introducing new sensitive columns; the cost of a false positive
// (a benign field gets dropped from the diff) is much lower than the cost
// of leaking a credential into the audit table.
const SENSITIVE_FIELDS = new Set(
  [
    'password',
    'passwordHash',
    'pin',
    'pinHash',
    'accessToken',
    'refreshToken',
    'fbPageAccessToken',
    'tipsoiApiToken',
    'smsApiKey',
    'whatsappAccessToken',
    'licenseKey',
    'hmacSecretB64u',
    'jwtSecret',
    'webhookSecret',
  ].map((s) => s.toLowerCase()),
);

interface LogInput {
  branchId: string;
  /** JwtPayload from @CurrentUser(), or a manual { id, name, role } shape
   *  for cron-driven / system actors, or null for pre-auth events. */
  actor: JwtPayload | { sub: string; role: string; name?: string } | null;
  category: ActivityCategory;
  action: ActivityAction;
  entityType: string;
  entityId: string;
  entityName: string;
  /** UPDATE: previous-state snapshot (any object). DELETE: full row. */
  before?: Record<string, unknown> | null;
  /** UPDATE: post-state snapshot. CREATE: full row. */
  after?: Record<string, unknown> | null;
  /** Optional one-line headline. Falls back to a generic summary in the UI. */
  summary?: string;
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);
  // Tiny in-memory cache of staffId → name resolved on demand. Avoids an
  // extra query per logged mutation when the same actor fires a burst.
  private nameCache = new Map<string, { name: string; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist one activity-log row. Always fire-and-forget at call sites
   * (`void this.activityLog.log(...)`) — a failure here MUST NEVER take
   * down the underlying mutation. Any thrown error is swallowed and
   * surfaced via the Nest logger only.
   */
  async log(input: LogInput): Promise<void> {
    try {
      const actorId = input.actor && 'sub' in input.actor ? input.actor.sub : null;
      const actorRole = input.actor && 'role' in input.actor ? String(input.actor.role) : null;
      const actorName = await this.resolveActorName(actorId, input.actor);

      const diff = this.buildDiff(input.action, input.before ?? null, input.after ?? null);

      await this.prisma.activityLog.create({
        data: {
          branchId: input.branchId,
          actorId,
          actorName,
          actorRole,
          category: input.category,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          entityName: input.entityName,
          diff: diff as any,
          summary: input.summary ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `activity-log write failed (${input.category}/${input.action} ${input.entityType}:${input.entityId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Resolve a friendly name for the actor, freezing it on the row so a
   * future Staff rename doesn't rewrite the audit trail. Hits the DB at
   * most once per minute per actor.
   */
  private async resolveActorName(
    actorId: string | null,
    actor: LogInput['actor'],
  ): Promise<string | null> {
    if (!actorId) return null;
    if (actor && 'name' in actor && actor.name) return actor.name;
    const cached = this.nameCache.get(actorId);
    if (cached && cached.expiresAt > Date.now()) return cached.name;
    try {
      const staff = await this.prisma.staff.findUnique({
        where: { id: actorId },
        select: { name: true },
      });
      const name = staff?.name ?? null;
      if (name) {
        this.nameCache.set(actorId, { name, expiresAt: Date.now() + 60_000 });
      }
      return name;
    } catch {
      return null;
    }
  }

  /**
   * Compute the diff payload stored in `ActivityLog.diff`. CREATE keeps
   * the full sanitised row under `__after`; DELETE under `__before`;
   * UPDATE returns `{ field: { before, after } }` for every changed
   * primitive / shallow array. Sensitive fields are always stripped.
   */
  private buildDiff(
    action: ActivityAction,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): unknown {
    if (action === 'CREATE') {
      return after ? { __after: this.sanitise(after) } : null;
    }
    if (action === 'DELETE') {
      return before ? { __before: this.sanitise(before) } : null;
    }
    // UPDATE — shallow per-field diff.
    if (!before || !after) {
      // One-sided update (caller didn't capture before): just stamp after.
      return after ? { __after: this.sanitise(after) } : null;
    }
    const cleanBefore = this.sanitise(before);
    const cleanAfter = this.sanitise(after);
    const diff: Record<string, { before: unknown; after: unknown }> = {};
    const keys = new Set([...Object.keys(cleanBefore), ...Object.keys(cleanAfter)]);
    for (const k of keys) {
      const b = cleanBefore[k];
      const a = cleanAfter[k];
      if (!this.isEqual(b, a)) {
        diff[k] = { before: b, after: a };
      }
    }
    return Object.keys(diff).length === 0 ? null : diff;
  }

  /**
   * Recursively drop sensitive keys from a snapshot. Also collapses
   * known-large fields (Buffer, Decimal serialised as { d, e, s }) to
   * their numeric form so the JSON column stays small.
   */
  private sanitise(input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (SENSITIVE_FIELDS.has(k.toLowerCase())) {
        out[k] = '***';
        continue;
      }
      out[k] = this.sanitiseValue(v);
    }
    return out;
  }

  private sanitiseValue(v: unknown): unknown {
    if (v == null) return v;
    if (typeof v === 'object') {
      // Prisma Decimal serialises as a tagged object; calling toString gives
      // the readable number. Date instances we keep as ISO strings.
      const anyV = v as { toNumber?: () => number; toISOString?: () => string };
      if (typeof anyV.toNumber === 'function') return Number(anyV.toNumber());
      if (typeof anyV.toISOString === 'function') return anyV.toISOString();
      if (Array.isArray(v)) return v.map((item) => this.sanitiseValue(item));
      // Plain objects: recurse to strip nested secrets too.
      return this.sanitise(v as Record<string, unknown>);
    }
    return v;
  }

  private isEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a == b;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Manual purge — hits the same WHERE clause the cron uses. Returns the
   * deleted count so the admin UI can show "purged N rows".
   */
  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(0, days));
    const res = await this.prisma.activityLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return res.count;
  }
}
