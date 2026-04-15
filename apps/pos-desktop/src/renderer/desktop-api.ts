/**
 * Type-only mirror of the preload surface. The renderer imports from here
 * instead of `../preload/index.ts` so it never pulls the `electron` module
 * into the browser bundle.
 */

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

export interface DiagnosticsSnapshot {
  capturedAt: string;
  app: { version: string; isPackaged: boolean; electron: string; node: string; platform: string; commitSha: string | null };
  session: { user: { id: string; name: string; email: string; role: string; branchId: string; branchName: string } | null };
  pairing: { paired: boolean; serverUrl: string | null; deviceId: string | null; deviceName: string | null; branchId: string | null; branchName: string | null; pairedAt: string | null };
  online: { status: 'unknown' | 'online' | 'offline'; isOnline: boolean; lastProbeAtMs: number | null; lastProbeLatencyMs: number | null; lastError: string | null; consecutiveFails: number };
  outbox: { pending: number; failed: number; oldestPendingAtMs: number | null; failedSamples: Array<{ id: string; method: string; path: string; attempts: number; lastError: string | null; createdAtMs: number }> };
  localDb: { pathHint: string; tables: Array<{ name: string; rows: number }> };
  printers: { kitchen: string; bill: string; reports: string; openCashDrawerOnCashPayment: boolean };
  update: UpdateStatus;
}
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

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

export {};
