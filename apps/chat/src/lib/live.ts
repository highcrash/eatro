import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

import { API_BASE } from './api';

let socket: Socket | null = null;

function wsUrl(): string {
  if (!API_BASE.startsWith('http')) return '/ws';
  try {
    const u = new URL(API_BASE);
    return `${u.protocol}//${u.host}/ws`;
  } catch {
    return '/ws';
  }
}

/** Calls `onChange` whenever the branch's chats, comments or complaints change. */
export function useLive(branchId: string | undefined, onChange: (payload: { conversationId?: string; complaintId?: string }) => void) {
  const handler = useRef(onChange);
  handler.current = onChange;
  useEffect(() => {
    if (!branchId) return;
    socket ??= io(wsUrl(), { transports: ['websocket'] });
    const s = socket;
    const join = () => s.emit('join:branch', branchId);
    const listen = (p: { conversationId?: string; complaintId?: string }) => handler.current(p ?? {});
    join();
    s.on('connect', join);
    s.on('chat:updated', listen);
    return () => {
      s.off('connect', join);
      s.off('chat:updated', listen);
    };
  }, [branchId]);
}

/** A short two-note chime, made in the browser so no sound file is needed. */
export function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.32);
    });
    if ('vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
  } catch {
    /* sound is a nice-to-have */
  }
}
