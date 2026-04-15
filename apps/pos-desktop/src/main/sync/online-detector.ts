import { EventEmitter } from 'events';
import { readConfig } from '../config/store';

/**
 * Periodic health-ping against the paired API server. Emits "online"
 * whenever the status flips. Starts in an "unknown" state until the
 * first probe completes.
 */

type Status = 'unknown' | 'online' | 'offline';

class OnlineDetector extends EventEmitter {
  private status: Status = 'unknown';
  private timer: NodeJS.Timeout | null = null;
  private intervalMs = 15_000;
  private fastIntervalMs = 3_000;
  private consecutiveFails = 0;
  private probing = false;
  private lastProbeAtMs: number | null = null;
  private lastProbeLatencyMs: number | null = null;
  private lastError: string | null = null;

  isOnline(): boolean { return this.status === 'online'; }
  currentStatus(): Status { return this.status; }

  telemetry(): { lastProbeAtMs: number | null; lastProbeLatencyMs: number | null; lastError: string | null; consecutiveFails: number } {
    return {
      lastProbeAtMs: this.lastProbeAtMs,
      lastProbeLatencyMs: this.lastProbeLatencyMs,
      lastError: this.lastError,
      consecutiveFails: this.consecutiveFails,
    };
  }

  start(): void {
    if (this.timer) return;
    void this.probe();
    this.timer = setInterval(() => void this.probe(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Force an immediate probe (used after reconfigure / manual retry). */
  async forceProbe(): Promise<Status> {
    await this.probe();
    return this.status;
  }

  /** Test override — pretend we're offline until the next real probe. */
  forceOffline(): void {
    this.setStatus('offline');
  }

  private async probe(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    const startedAt = Date.now();
    try {
      const cfg = await readConfig();
      if (!cfg) return; // not paired yet — treat as unknown
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(`${cfg.serverUrl}/api/v1/health`, {
          signal: controller.signal,
          method: 'GET',
        });
        this.lastProbeAtMs = Date.now();
        this.lastProbeLatencyMs = this.lastProbeAtMs - startedAt;
        if (res.ok) {
          this.consecutiveFails = 0;
          this.lastError = null;
          this.setStatus('online');
        } else {
          this.onFail(`HTTP ${res.status}`);
        }
      } catch (err) {
        this.lastProbeAtMs = Date.now();
        this.lastProbeLatencyMs = this.lastProbeAtMs - startedAt;
        this.onFail((err as Error).message || 'fetch failed');
      } finally {
        clearTimeout(t);
      }
    } finally {
      this.probing = false;
    }
  }

  private onFail(message?: string): void {
    this.consecutiveFails++;
    if (message) this.lastError = message;
    // Single failure doesn't flip status immediately; require two in a row.
    if (this.consecutiveFails >= 2) this.setStatus('offline');
    // Tighten polling while offline so reconnect is detected quickly.
    if (this.status === 'offline' && this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => void this.probe(), this.fastIntervalMs);
    }
  }

  private setStatus(next: Status): void {
    if (this.status === next) return;
    const prev = this.status;
    this.status = next;
    this.emit('change', next, prev);
    // Relax polling back to normal cadence once back online.
    if (next === 'online' && this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => void this.probe(), this.intervalMs);
    }
  }
}

export const onlineDetector = new OnlineDetector();
