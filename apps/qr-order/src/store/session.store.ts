import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface QrCustomer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

interface SessionStore {
  tableId: string | null;
  branchId: string | null;
  branchName: string;
  tableNumber: string;
  activeOrderId: string | null;
  /** Stable per-device UUID. Generated on first mount, persisted in
   *  localStorage so the SAME phone is always the same device across
   *  refreshes / tab closes / cross-day visits. Sent on every QR API
   *  call as `x-qr-device-id`. The server stamps it on
   *  `Order.primaryDeviceId` when an order is created and uses it as
   *  the auth anchor for subsequent mutations — only the creating
   *  device (or devices it later shares with) can edit the order. */
  deviceId: string;
  /** Logged-in customer for this QR session. `null` until OTP login
   *  + (optional) name capture completes. Persisted in sessionStorage
   *  so a tab refresh keeps the user logged in until they close the
   *  tab. Cleared when admin restarts the QR session via setSession. */
  customer: QrCustomer | null;
  setSession: (data: { tableId: string; branchId: string; branchName: string; tableNumber: string }) => void;
  setActiveOrder: (orderId: string | null) => void;
  setCustomer: (c: QrCustomer | null) => void;
}

/**
 * Best-effort UUID v4. Uses crypto.randomUUID when available
 * (browsers + Node 19+), falls back to a Math.random hex for
 * legacy WebViews. Doesn't need to be cryptographically perfect —
 * its only job is to discriminate between devices on the same
 * branch's QR ordering surface.
 */
function newDeviceId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fallthrough */ }
  return 'd-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      tableId: null,
      branchId: null,
      branchName: 'Restaurant',
      tableNumber: '',
      activeOrderId: null,
      // Lazy-init: zustand persist hydrates from localStorage if the
      // key already exists; otherwise the initial value here is what
      // gets persisted on the first mutation.
      deviceId: newDeviceId(),
      customer: null,
      // QR scans now PRESERVE the customer (and the activeOrderId) by
      // default — the same customer often rescans across the night
      // (e.g. moves to a different table). TableEntry handles the
      // table-transfer + active-order rehydration on top of this.
      // Different customers = different devices = different localStorage
      // keys per device, so cross-customer leakage isn't a concern.
      setSession: (data) => set({ ...data }),
      setActiveOrder: (orderId) => set({ activeOrderId: orderId }),
      setCustomer: (c) => set({ customer: c }),
    }),
    {
      // localStorage so the session + login + active order survive a
      // page refresh and tab close. sessionStorage was losing them on
      // every reload, which forced the customer to re-login mid-meal.
      name: 'restora-qr-session',
      storage: createJSONStorage(() => localStorage),
      // Older sessions in the wild don't have a deviceId — bump the
      // store version + migrate so we mint one on first load instead
      // of leaving it undefined (which would 403 every QR mutation).
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted as Partial<SessionStore>) ?? {};
        if (version < 2 && !state.deviceId) {
          state.deviceId = newDeviceId();
        }
        return state as SessionStore;
      },
    },
  ),
);
