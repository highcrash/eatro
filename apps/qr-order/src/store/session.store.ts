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
      // A new QR scan implies a new session — drop any stale customer
      // from the previous diner. `setSession` is the only place this
      // happens; SetActiveOrder + SetCustomer leave it alone.
      setSession: (data) => set({ ...data, customer: null }),
      setActiveOrder: (orderId) => set({ activeOrderId: orderId }),
      setCustomer: (c) => set({ customer: c }),
    }),
    {
      name: 'restora-qr-session',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
