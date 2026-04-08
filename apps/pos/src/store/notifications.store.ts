import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationsState {
  /** Stable keys (e.g. "qr:orderId", "items:orderId", "bill:orderId") that have been viewed. */
  seen: string[];
  /** Mark a notification as seen (and dismissed). */
  markSeen: (key: string) => void;
  /** Mark every key as seen — used by "clear all". */
  markAllSeen: (keys: string[]) => void;
  isSeen: (key: string) => boolean;
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set, get) => ({
      seen: [],
      markSeen: (key) => set((s) => (s.seen.includes(key) ? s : { seen: [...s.seen, key] })),
      markAllSeen: (keys) => set((s) => {
        const next = new Set(s.seen);
        for (const k of keys) next.add(k);
        return { seen: Array.from(next) };
      }),
      isSeen: (key) => get().seen.includes(key),
    }),
    { name: 'pos-notifications-seen' },
  ),
);
