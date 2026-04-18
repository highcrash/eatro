import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory abuse tracker for the public license endpoints.
 *
 * Two levers:
 *   - INVALID_CODE failures: ≥10 in a 5-minute rolling window from
 *     the same IP → block that IP for 15 minutes.
 *   - Block rejections themselves are logged once per minute per IP
 *     (not on every rejection) to keep the log table from filling up
 *     during a sustained brute-force.
 *
 * In-memory is fine for a single instance. When this app scales to
 * multiple replicas behind a load balancer the counters become
 * per-replica which weakens the protection but doesn't break it —
 * upgrade path is to swap the Map for a small Redis client. Documented
 * in the migration notes.
 *
 * State decay: the tracker periodically prunes its Map every 60s so
 * memory stays bounded even under heavy attack. Entries older than the
 * window TTL are dropped.
 */

interface Counter {
  count: number;
  windowEndAt: number; // unix ms when this counter resets
}

interface Block {
  until: number; // unix ms
  loggedAt: number; // unix ms; throttle log writes
}

@Injectable()
export class AbuseTracker {
  private readonly logger = new Logger(AbuseTracker.name);

  private readonly invalidCounters = new Map<string, Counter>();
  private readonly blocks = new Map<string, Block>();

  private readonly FAIL_WINDOW_MS = 5 * 60 * 1000;
  private readonly FAIL_THRESHOLD = 10;
  private readonly BLOCK_DURATION_MS = 15 * 60 * 1000;
  private readonly LOG_THROTTLE_MS = 60 * 1000;

  constructor() {
    // Periodic prune so the Maps don't grow forever on a hostile network.
    setInterval(() => this.prune(), 60 * 1000).unref();
  }

  /**
   * Returns true iff this IP is currently blocked. Side-effect free
   * for the caller (no log writes here — the rejection log is
   * emitted by `markBlockedHit` so we can throttle it).
   */
  isBlocked(ip: string, nowMs = Date.now()): boolean {
    const block = this.blocks.get(ip);
    if (!block) return false;
    if (nowMs >= block.until) {
      this.blocks.delete(ip);
      return false;
    }
    return true;
  }

  /**
   * Call when an INVALID_CODE result is returned. Returns true iff this
   * call pushed the IP into a blocked state for the first time.
   */
  recordInvalidCode(ip: string, nowMs = Date.now()): boolean {
    const counter = this.invalidCounters.get(ip);
    if (!counter || nowMs >= counter.windowEndAt) {
      this.invalidCounters.set(ip, { count: 1, windowEndAt: nowMs + this.FAIL_WINDOW_MS });
      return false;
    }
    counter.count++;
    if (counter.count < this.FAIL_THRESHOLD) return false;

    // Threshold crossed — start a block.
    const wasBlocked = this.blocks.has(ip);
    this.blocks.set(ip, { until: nowMs + this.BLOCK_DURATION_MS, loggedAt: 0 });
    // Clear the counter so the same IP doesn't double-trip on the next
    // failure during the block window.
    this.invalidCounters.delete(ip);
    return !wasBlocked;
  }

  /**
   * Call when a request is rejected because the IP is blocked. Returns
   * true iff a CheckLog entry should be written for this hit (caller
   * does the actual log write — keeps abuse-tracker log-free).
   */
  markBlockedHit(ip: string, nowMs = Date.now()): boolean {
    const block = this.blocks.get(ip);
    if (!block) return false;
    if (nowMs - block.loggedAt < this.LOG_THROTTLE_MS) return false;
    block.loggedAt = nowMs;
    return true;
  }

  private prune(nowMs = Date.now()): void {
    let pruned = 0;
    for (const [ip, c] of this.invalidCounters) {
      if (nowMs >= c.windowEndAt) {
        this.invalidCounters.delete(ip);
        pruned++;
      }
    }
    for (const [ip, b] of this.blocks) {
      if (nowMs >= b.until) {
        this.blocks.delete(ip);
        pruned++;
      }
    }
    if (pruned > 0) this.logger.debug(`Pruned ${pruned} expired abuse-tracker entries`);
  }
}
