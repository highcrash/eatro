import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SessionStore {
  tableId: string | null;
  branchId: string | null;
  branchName: string;
  tableNumber: string;
  activeOrderId: string | null;
  setSession: (data: { tableId: string; branchId: string; branchName: string; tableNumber: string }) => void;
  setActiveOrder: (orderId: string | null) => void;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      tableId: null,
      branchId: null,
      branchName: 'Restaurant',
      tableNumber: '',
      activeOrderId: null,
      setSession: (data) => set(data),
      setActiveOrder: (orderId) => set({ activeOrderId: orderId }),
    }),
    {
      name: 'restora-qr-session',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
