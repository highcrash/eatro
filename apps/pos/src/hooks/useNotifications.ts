import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { Order } from '@restora/types';
import { api } from '../lib/api';
import { useNotificationsStore } from '../store/notifications.store';
// Asset import — Vite resolves to a build-time URL (fingerprinted on
// the web POS deploy, relative on the desktop electron-vite render
// build). See the longer note next to NOTIFICATION_SRC below.
import notificationSoundUrl from '../assets/sounds/notification-echo.mp3';

export type NotifType = 'qr' | 'items' | 'bill';

export interface PosNotification {
  /** Stable de-dupe key, also used as the "seen" marker. */
  key: string;
  type: NotifType;
  orderId: string;
  tableId: string | null;
  tableNumber: string | null;
  orderNumber: string;
  title: string;
  body: string;
  createdAt: string;
}

/**
 * Polls QR/pending/bill-requested orders branch-wide and exposes a normalized
 * notification list. Plays a soft beep whenever a brand-new (unseen) key
 * appears. Mounted once globally in PosLayout.
 */
export function useNotifications() {
  const seen = useNotificationsStore((s) => s.seen);

  // PENDING orders are QR submissions awaiting cashier acceptance
  const { data: pending = [] } = useQuery<Order[]>({
    queryKey: ['notifications', 'pending'],
    queryFn: () => api.get<Order[]>('/orders?status=PENDING'),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  // Active orders carry the bill-requested flag and PENDING_APPROVAL items
  const { data: active = [] } = useQuery<Order[]>({
    queryKey: ['notifications', 'active'],
    queryFn: () => api.get<Order[]>('/orders?status=CONFIRMED,PREPARING,READY,SERVED'),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  const notifications = useMemo<PosNotification[]>(() => {
    const out: PosNotification[] = [];

    for (const o of pending) {
      out.push({
        key: `qr:${o.id}`,
        type: 'qr',
        orderId: o.id,
        tableId: o.tableId ?? null,
        tableNumber: o.tableNumber ?? null,
        orderNumber: o.orderNumber,
        title: o.tableNumber ? `New QR order · Table ${o.tableNumber}` : 'New QR order · Takeaway',
        body: `Order #${o.orderNumber} awaiting acceptance`,
        createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date(o.createdAt as unknown as string).toISOString(),
      });
    }

    for (const o of active) {
      const itemsPending = o.items?.filter((i) => i.kitchenStatus === 'PENDING_APPROVAL' && !i.voidedAt) ?? [];
      if (itemsPending.length > 0) {
        out.push({
          key: `items:${o.id}`,
          type: 'items',
          orderId: o.id,
          tableId: o.tableId ?? null,
          tableNumber: o.tableNumber ?? null,
          orderNumber: o.orderNumber,
          title: `${itemsPending.length} new item${itemsPending.length > 1 ? 's' : ''} · ${o.tableNumber ? `Table ${o.tableNumber}` : 'Takeaway'}`,
          body: `Order #${o.orderNumber} — QR customer added items`,
          createdAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date(o.updatedAt as unknown as string).toISOString(),
        });
      }
      if ((o as { billRequested?: boolean }).billRequested) {
        out.push({
          key: `bill:${o.id}`,
          type: 'bill',
          orderId: o.id,
          tableId: o.tableId ?? null,
          tableNumber: o.tableNumber ?? null,
          orderNumber: o.orderNumber,
          title: `Bill requested · ${o.tableNumber ? `Table ${o.tableNumber}` : 'Takeaway'}`,
          body: `Order #${o.orderNumber} — process payment`,
          createdAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date(o.updatedAt as unknown as string).toISOString(),
        });
      }
    }

    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [pending, active]);

  const unseen = useMemo(
    () => notifications.filter((n) => !seen.includes(n.key)),
    [notifications, seen],
  );

  // Play a soft beep whenever a new unseen notification appears.
  const previousKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(unseen.map((n) => n.key));
    let hasNew = false;
    for (const k of current) {
      if (!previousKeysRef.current.has(k)) {
        hasNew = true;
        break;
      }
    }
    previousKeysRef.current = current;
    if (hasNew) playBeep();
  }, [unseen]);

  return { notifications, unseen };
}

// ─── Sound ──────────────────────────────────────────────────────────────────
// Plays the bundled notification chime (apps/pos/src/assets/sounds/
// notification-echo.mp3) on every new unseen notification. The asset
// is imported as a module so Vite resolves the URL at build time —
// the deployed web POS gets a fingerprinted absolute URL
// (`/assets/notification-echo-HASH.mp3`) served by the API host,
// and the desktop electron-vite renderer gets the SAME asset under
// a relative URL that works under `file://` when Electron loads the
// renderer dist via loadFile(). Earlier the path was hardcoded as
// `/sounds/notification-echo.mp3` in `public/`, which 404'd on the
// desktop because absolute paths under file:// resolve to the
// filesystem ROOT, not the app's renderer dir.
//
// Fallback path — if the MP3 fails to load (audio blocked before
// the cashier's first interaction, decoding error, etc.) drop
// back to the synthesized two-tone chime that used to be the only
// sound. Keeps the cashier's "an order needs attention" cue alive
// even when the file path is broken.

const NOTIFICATION_SRC = notificationSoundUrl;

// Single shared HTMLAudioElement so we don't pay the decode cost on
// every notification. `currentTime = 0` rewinds when a new event
// fires while a previous play is still in progress, so the cashier
// hears each event distinctly instead of one being silently dropped.
let notificationAudio: HTMLAudioElement | null = null;
function getNotificationAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!notificationAudio) {
    try {
      notificationAudio = new Audio(NOTIFICATION_SRC);
      notificationAudio.preload = 'auto';
      // Default volume — louder than the old synth chime which was
      // capped at 0.18. The MP3 is mastered so this is a comfortable
      // POS-floor volume; cashiers can lower the OS volume to taste.
      notificationAudio.volume = 0.7;
    } catch {
      notificationAudio = null;
    }
  }
  return notificationAudio;
}

let audioCtx: AudioContext | null = null;
function playBeep() {
  // Preferred path — bundled MP3 chime.
  const a = getNotificationAudio();
  if (a) {
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.catch(() => playSynthChimeFallback());
      }
      return;
    } catch {
      // fallthrough to synth fallback
    }
  }
  playSynthChimeFallback();
}

function playSynthChimeFallback() {
  try {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;
    audioCtx = audioCtx ?? new Ctor();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();

    const tones = [880, 1320]; // A5 then E6
    const now = ctx.currentTime;
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.2);
    });
  } catch {
    // Audio blocked or unsupported — silently ignore
  }
}
