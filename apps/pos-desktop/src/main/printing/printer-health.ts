import { createConnection, type Socket } from 'net';
import type { PrinterSlot } from '../config/store';

/**
 * Cheap TCP reachability probe + short-lived cache for networked thermal
 * printers. Used by:
 *   - sendThermalJob: skips the attempt when the slot is known-unreachable
 *     so a bad cable doesn't hang the receipt path for 4 s every time.
 *   - Diagnostics panel: live status dot per slot.
 *   - Cash-drawer fallback: picks the bill slot when reachable, falls back
 *     to the kitchen slot when not.
 *
 * A cache entry is valid for PROBE_TTL_MS; callers that want a fresh
 * result (e.g. the Diagnostics "Refresh" button) pass force=true.
 */

const PROBE_TTL_MS = 5_000;
const PROBE_TIMEOUT_MS = 1_500;

export type PrinterHealthStatus = 'online' | 'unreachable' | 'unknown';

export interface PrinterHealth {
  status: PrinterHealthStatus;
  lastCheckedAtMs: number | null;
  lastError: string | null;
  latencyMs: number | null;
}

const UNKNOWN: PrinterHealth = {
  status: 'unknown',
  lastCheckedAtMs: null,
  lastError: null,
  latencyMs: null,
};

const cache = new Map<string, PrinterHealth>();
const inflight = new Map<string, Promise<PrinterHealth>>();

function cacheKey(slot: PrinterSlot): string | null {
  if (slot.mode === 'network') return `tcp://${slot.host}:${slot.port}`;
  if (slot.mode === 'os-printer') return `os://${slot.deviceName}`;
  return null;
}

export function getHealth(slot: PrinterSlot): PrinterHealth {
  const key = cacheKey(slot);
  if (!key) return UNKNOWN;
  return cache.get(key) ?? UNKNOWN;
}

/**
 * Update the cache from a job's observed outcome. Called by sendThermalJob
 * so a successful print immediately upgrades the slot to 'online' without
 * a separate probe round-trip, and a connect failure marks it unreachable.
 */
export function recordOutcome(slot: PrinterSlot, outcome: { ok: boolean; error?: string; latencyMs?: number }): void {
  const key = cacheKey(slot);
  if (!key) return;
  cache.set(key, {
    status: outcome.ok ? 'online' : 'unreachable',
    lastCheckedAtMs: Date.now(),
    lastError: outcome.ok ? null : outcome.error ?? 'unknown error',
    latencyMs: outcome.latencyMs ?? null,
  });
}

export async function probe(slot: PrinterSlot, force = false): Promise<PrinterHealth> {
  const key = cacheKey(slot);
  if (!key) return UNKNOWN;
  const cached = cache.get(key);
  if (!force && cached && cached.lastCheckedAtMs && Date.now() - cached.lastCheckedAtMs < PROBE_TTL_MS) {
    return cached;
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const run = doProbe(slot).finally(() => { inflight.delete(key); });
  inflight.set(key, run);
  return run;
}

async function doProbe(slot: PrinterSlot): Promise<PrinterHealth> {
  if (slot.mode !== 'network') {
    // OS printers are always "reachable" as far as we can tell without
    // firing a full job; the Windows print spooler accepts the handoff
    // regardless. Treat as online with no latency measurement.
    const health: PrinterHealth = { status: 'online', lastCheckedAtMs: Date.now(), lastError: null, latencyMs: null };
    const key = cacheKey(slot)!;
    cache.set(key, health);
    return health;
  }

  const key = cacheKey(slot)!;
  const startedAt = Date.now();
  const health = await new Promise<PrinterHealth>((resolve) => {
    let settled = false;
    const sock: Socket = createConnection({ host: slot.host, port: slot.port });
    const finish = (h: PrinterHealth) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(h);
    };
    const timer = setTimeout(() => {
      finish({ status: 'unreachable', lastCheckedAtMs: Date.now(), lastError: `timeout after ${PROBE_TIMEOUT_MS}ms`, latencyMs: null });
    }, PROBE_TIMEOUT_MS);
    sock.once('connect', () => {
      clearTimeout(timer);
      finish({ status: 'online', lastCheckedAtMs: Date.now(), lastError: null, latencyMs: Date.now() - startedAt });
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      const code = (err as NodeJS.ErrnoException).code ?? 'ERR';
      finish({ status: 'unreachable', lastCheckedAtMs: Date.now(), lastError: `${code}: ${err.message}`, latencyMs: null });
    });
  });
  cache.set(key, health);
  return health;
}
