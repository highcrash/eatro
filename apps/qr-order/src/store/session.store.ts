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
  /** Logged-in customer for this QR session. `null` until OTP login
   *  + (optional) name capture completes. Persisted in sessionStorage
   *  so a tab refresh keeps the user logged in until they close the
   *  tab. Cleared when admin restarts the QR session via setSession. */
  customer: QrCustomer | null;
  setSession: (data: { tableId: string; branchId: string; branchName: string; tableNumber: string }) => void;
  setActiveOrder: (orderId: string | null) => void;
  setCustomer: (c: QrCustomer | null) => void;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      tableId: null,
      branchId: null,
      branchName: 'Restaurant',
      tableNumber: '',
      activeOrderId: null,
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
    },
  ),
);
