import { contextBridge, ipcRenderer } from 'electron';
import type { KitchenTicketInput } from '@restora/utils';

export type PrinterSlot =
  | { mode: 'disabled' }
  | { mode: 'network'; host: string; port: number }
  | { mode: 'os-printer'; deviceName: string };

export interface PrintersConfig {
  kitchen: PrinterSlot;
  bill: PrinterSlot;
  reports: PrinterSlot;
  openCashDrawerOnCashPayment: boolean;
}

export interface OsPrinter {
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface ReceiptLine {
  quantity: number;
  menuItemName: string;
  unitPrice: number;
  lineTotal: number;
  notes?: string | null;
}

export interface ReceiptInput {
  brandName: string;
  branchName: string;
  branchAddress?: string;
  branchPhone?: string;
  orderNumber: string;
  tableNumber?: string | null;
  type: string;
  createdAt: string | Date;
  cashierName?: string;
  items: ReceiptLine[];
  subtotal: number;
  discountAmount?: number;
  discountName?: string | null;
  taxAmount?: number;
  totalAmount: number;
  paymentMethod?: string;
  currencySymbol?: string;
  footerText?: string;
}

export type PrintResult = { ok: true } | { ok: false; message: string };

export interface SyncStatus {
  online: boolean;
  rawStatus: 'unknown' | 'online' | 'offline';
  pending: number;
  failed: number;
}

export interface ApiFetchInput {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface ApiFetchResult {
  status: number;
  ok: boolean;
  body: unknown;
  queued?: boolean;
  idempotencyKey?: string;
}

export interface FailedOutboxRow {
  id: string;
  method: string;
  path: string;
  attempts: number;
  lastError: string | null;
  createdAtMs: number;
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; currentVersion: string }
  | { kind: 'available'; version: string; releaseNotes?: string }
  | { kind: 'downloading'; percent: number; speed?: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

export interface AppVersionInfo {
  version: string;
  isPackaged: boolean;
}

export interface PrinterSlotSnapshot {
  label: string;
  health: 'online' | 'unreachable' | 'unknown';
  latencyMs: number | null;
  lastError: string | null;
  lastCheckedAtMs: number | null;
}

// Shape mirrors captureDiagnosticsSnapshot() in main/diagnostics.ts. Kept
// minimally typed in the bridge so a schema change on the main side shows
// up as a TS error here first.
export interface DiagnosticsSnapshot {
  capturedAt: string;
  app: { version: string; isPackaged: boolean; electron: string; node: string; platform: string; commitSha: string | null };
  session: { user: { id: string; name: string; email: string; role: string; branchId: string; branchName: string } | null };
  pairing: { paired: boolean; serverUrl: string | null; deviceId: string | null; deviceName: string | null; branchId: string | null; branchName: string | null; pairedAt: string | null };
  online: { status: 'unknown' | 'online' | 'offline'; isOnline: boolean; lastProbeAtMs: number | null; lastProbeLatencyMs: number | null; lastError: string | null; consecutiveFails: number };
  outbox: { pending: number; failed: number; oldestPendingAtMs: number | null; failedSamples: Array<{ id: string; method: string; path: string; attempts: number; lastError: string | null; createdAtMs: number }> };
  localDb: { pathHint: string; tables: Array<{ name: string; rows: number }> };
  logs: { mainLogPath: string };
  printers: {
    kitchen: PrinterSlotSnapshot;
    bill: PrinterSlotSnapshot;
    reports: PrinterSlotSnapshot;
    openCashDrawerOnCashPayment: boolean;
  };
  update: UpdateStatus;
}

// Shape of config metadata returned to the renderer. The actual deviceToken
// NEVER crosses the bridge — it stays in the main process.
export interface PairedConfig {
  serverUrl: string;
  deviceId: string;
  deviceName: string;
  branch: { id: string; name: string };
  pairedAt: string;
}

export interface CashierTile {
  id: string;
  name: string;
  email: string;
  role: string;
  hasPin: boolean;
}

export interface PinStatus {
  hasPin: boolean;
  lockedUntilMs: number | null;
  failedAttempts: number;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId: string;
  branchName: string;
}

export type VerifyPinResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'no-pin' }
  | { ok: false; reason: 'locked'; lockedUntilMs: number }
  | { ok: false; reason: 'wrong'; failedAttempts: number; lockedUntilMs: number | null }
  | { ok: false; reason: 'server'; message: string };

export type SetPinResult =
  | { ok: true; user: SessionUser }
  | { ok: false; message: string };

export interface DesktopApi {
  version: string;
  phase: string;
  config: {
    get: () => Promise<PairedConfig | null>;
    isPaired: () => Promise<boolean>;
  };
  device: {
    register: (input: {
      serverUrl: string;
      email: string;
      password: string;
      branchId: string;
      deviceName: string;
    }) => Promise<PairedConfig>;
    unpair: () => Promise<{ ok: true }>;
  };
  cashier: {
    list: () => Promise<CashierTile[]>;
    pinStatus: (staffId: string) => Promise<PinStatus>;
    verifyPin: (args: { staffId: string; pin: string }) => Promise<VerifyPinResult>;
    setPin: (args: { email: string; password: string; pin: string }) => Promise<SetPinResult>;
    changePin: (args: { staffId: string; currentPin: string; newPin: string }) => Promise<{ ok: true } | { ok: false; message: string }>;
    forgetPin: (staffId: string) => Promise<{ ok: true }>;
  };
  session: {
    current: () => Promise<SessionUser | null>;
    signout: () => Promise<{ ok: true }>;
  };
  printers: {
    listOs: () => Promise<OsPrinter[]>;
    get: () => Promise<PrintersConfig>;
    set: (next: PrintersConfig) => Promise<PrintersConfig>;
    test: (slot: 'kitchen' | 'bill' | 'reports') => Promise<PrintResult>;
    openCashDrawer: () => Promise<PrintResult>;
  };
  print: {
    kitchen: (ticket: KitchenTicketInput) => Promise<PrintResult>;
    receipt: (args: { receipt: ReceiptInput; openCashDrawer?: boolean }) => Promise<PrintResult>;
    reportA4: (args: { html: string; landscape?: boolean }) => Promise<PrintResult>;
  };
  api: {
    fetch: (input: ApiFetchInput) => Promise<ApiFetchResult>;
  };
  sync: {
    status: () => Promise<SyncStatus>;
    failedList: () => Promise<FailedOutboxRow[]>;
    retry: (id: string) => Promise<{ ok: true }>;
    retryAllFailed: () => Promise<{ reset: number }>;
    dismiss: (id: string) => Promise<{ ok: true }>;
    drainNow: () => Promise<{ drained: number; failed: number; remaining: number }>;
    forceOffline: () => Promise<{ ok: true }>;
    probe: () => Promise<{ status: 'unknown' | 'online' | 'offline' }>;
    clearOutbox: () => Promise<{ ok: true }>;
    onStatusChanged: (cb: (status: SyncStatus) => void) => () => void;
  };
  app: {
    version: () => Promise<AppVersionInfo>;
  };
  update: {
    status: () => Promise<UpdateStatus>;
    check: () => Promise<UpdateStatus>;
    install: () => Promise<{ ok: true }>;
    onStatusChanged: (cb: (status: UpdateStatus) => void) => () => void;
  };
  diagnostics: {
    snapshot: () => Promise<DiagnosticsSnapshot>;
  };
  deviceStatus: {
    isRevoked: () => Promise<boolean>;
    clearRevoked: () => Promise<{ ok: true }>;
    onRevoked: (cb: () => void) => () => void;
  };
}

const api: DesktopApi = {
  version: '0.6.0',
  phase: 'auto-update',
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    isPaired: () => ipcRenderer.invoke('config:is-paired'),
  },
  device: {
    register: (input) => ipcRenderer.invoke('device:register', input),
    unpair: () => ipcRenderer.invoke('device:unpair'),
  },
  cashier: {
    list: () => ipcRenderer.invoke('cashier:list'),
    pinStatus: (staffId) => ipcRenderer.invoke('cashier:pin-status', staffId),
    verifyPin: (args) => ipcRenderer.invoke('cashier:verify-pin', args),
    setPin: (args) => ipcRenderer.invoke('cashier:set-pin', args),
    changePin: (args) => ipcRenderer.invoke('cashier:change-pin', args),
    forgetPin: (staffId) => ipcRenderer.invoke('cashier:forget-pin', staffId),
  },
  session: {
    current: () => ipcRenderer.invoke('session:current'),
    signout: () => ipcRenderer.invoke('session:signout'),
  },
  printers: {
    listOs: () => ipcRenderer.invoke('printers:list-os'),
    get: () => ipcRenderer.invoke('printers:get'),
    set: (next) => ipcRenderer.invoke('printers:set', next),
    test: (slot) => ipcRenderer.invoke('printers:test', slot),
    openCashDrawer: () => ipcRenderer.invoke('printers:open-cash-drawer'),
  },
  print: {
    kitchen: (ticket) => ipcRenderer.invoke('print:kitchen', ticket),
    receipt: (args) => ipcRenderer.invoke('print:receipt', args),
    reportA4: (args) => ipcRenderer.invoke('print:report-a4', args),
  },
  api: {
    fetch: (input) => ipcRenderer.invoke('api:fetch', input),
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    failedList: () => ipcRenderer.invoke('sync:failed-list'),
    retry: (id) => ipcRenderer.invoke('sync:retry', id),
    retryAllFailed: () => ipcRenderer.invoke('sync:retry-all-failed'),
    dismiss: (id) => ipcRenderer.invoke('sync:dismiss', id),
    drainNow: () => ipcRenderer.invoke('sync:drain-now'),
    forceOffline: () => ipcRenderer.invoke('sync:force-offline'),
    probe: () => ipcRenderer.invoke('sync:probe'),
    clearOutbox: () => ipcRenderer.invoke('sync:clear-outbox'),
    onStatusChanged: (cb) => {
      const listener = (_event: unknown, status: SyncStatus) => cb(status);
      ipcRenderer.on('sync:status-changed', listener);
      return () => ipcRenderer.off('sync:status-changed', listener);
    },
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatusChanged: (cb) => {
      const listener = (_event: unknown, status: UpdateStatus) => cb(status);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.off('update:status', listener);
    },
  },
  diagnostics: {
    snapshot: () => ipcRenderer.invoke('diagnostics:snapshot'),
  },
  deviceStatus: {
    isRevoked: () => ipcRenderer.invoke('device:is-revoked'),
    clearRevoked: () => ipcRenderer.invoke('device:clear-revoked'),
    onRevoked: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('device:revoked', listener);
      return () => ipcRenderer.off('device:revoked', listener);
    },
  },
};

contextBridge.exposeInMainWorld('desktop', api);

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
