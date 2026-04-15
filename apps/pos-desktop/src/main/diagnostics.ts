import { app } from 'electron';
import { readConfig, getPrinters } from './config/store';
import { onlineDetector } from './sync/online-detector';
import { counts, listFailed, listPending } from './sync/outbox';
import { getLocalDb } from './db/local-db';
import { getLastUpdateStatus } from './updater';
import { getSessionUser } from './session/session';
import type { UpdateStatus } from './updater';

/**
 * One-shot snapshot of every moving part a troubleshooter might want:
 * connection probes, outbox, pairing config, printer targets, session,
 * build info, SQLite sizes, auto-update state. Designed to be rendered
 * read-only on a Diagnostics page and screenshotted when a site has
 * trouble.
 *
 * Secrets are never included — no tokens, PIN hashes, DPAPI blobs.
 */

export interface DiagnosticsSnapshot {
  capturedAt: string;
  app: {
    version: string;
    isPackaged: boolean;
    electron: string;
    node: string;
    platform: string;
    commitSha: string | null;
  };
  session: {
    user: { id: string; name: string; email: string; role: string; branchId: string; branchName: string } | null;
  };
  pairing: {
    paired: boolean;
    serverUrl: string | null;
    deviceId: string | null;
    deviceName: string | null;
    branchId: string | null;
    branchName: string | null;
    pairedAt: string | null;
  };
  online: {
    status: 'unknown' | 'online' | 'offline';
    isOnline: boolean;
    lastProbeAtMs: number | null;
    lastProbeLatencyMs: number | null;
    lastError: string | null;
    consecutiveFails: number;
  };
  outbox: {
    pending: number;
    failed: number;
    oldestPendingAtMs: number | null;
    failedSamples: Array<{ id: string; method: string; path: string; attempts: number; lastError: string | null; createdAtMs: number }>;
  };
  localDb: {
    pathHint: string; // %APPDATA%/Restora POS/local.db — no absolute path for privacy
    tables: Array<{ name: string; rows: number }>;
  };
  printers: {
    kitchen: string;
    bill: string;
    reports: string;
    openCashDrawerOnCashPayment: boolean;
  };
  update: UpdateStatus;
}

function humanSlot(slot: { mode: string; host?: string; port?: number; deviceName?: string }): string {
  if (slot.mode === 'disabled') return 'Disabled';
  if (slot.mode === 'network') return `Network ${slot.host}:${slot.port}`;
  if (slot.mode === 'os-printer') return `OS printer "${slot.deviceName}"`;
  return slot.mode;
}

function rowCount(table: string): number {
  try {
    const row = getLocalDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function captureDiagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
  const cfg = await readConfig();
  const printers = await getPrinters();
  const user = getSessionUser();
  const telemetry = onlineDetector.telemetry();
  const pending = listPending();
  const oldestPending = pending[0]?.createdAtMs ?? null;
  const failed = listFailed().slice(0, 10).map((r) => ({
    id: r.id,
    method: r.method,
    path: r.path,
    attempts: r.attempts,
    lastError: r.lastError,
    createdAtMs: r.createdAtMs,
  }));

  return {
    capturedAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      // Injected by electron-vite at build time (see vite.config.ts).
      commitSha: (process.env.GIT_SHA as string | undefined) ?? null,
    },
    session: {
      user: user
        ? {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: user.branchId,
          branchName: user.branchName,
        }
        : null,
    },
    pairing: {
      paired: cfg != null,
      serverUrl: cfg?.serverUrl ?? null,
      deviceId: cfg?.deviceId ?? null,
      deviceName: cfg?.deviceName ?? null,
      branchId: cfg?.branch?.id ?? null,
      branchName: cfg?.branch?.name ?? null,
      pairedAt: cfg?.pairedAt ?? null,
    },
    online: {
      status: onlineDetector.currentStatus(),
      isOnline: onlineDetector.isOnline(),
      ...telemetry,
    },
    outbox: {
      ...counts(),
      oldestPendingAtMs: oldestPending,
      failedSamples: failed,
    },
    localDb: {
      pathHint: '%APPDATA%/Restora POS/local.db',
      tables: [
        { name: 'cashier_pins', rows: rowCount('cashier_pins') },
        { name: 'cashiers', rows: rowCount('cashiers') },
        { name: 'outbox', rows: rowCount('outbox') },
        { name: 'response_cache', rows: rowCount('response_cache') },
        { name: 'id_remap', rows: rowCount('id_remap') },
        { name: 'shadow_orders', rows: rowCount('shadow_orders') },
      ],
    },
    printers: {
      kitchen: humanSlot(printers.kitchen),
      bill: humanSlot(printers.bill),
      reports: humanSlot(printers.reports),
      openCashDrawerOnCashPayment: printers.openCashDrawerOnCashPayment,
    },
    update: getLastUpdateStatus(),
  };
}
