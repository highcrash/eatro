import React, { useEffect, useState } from 'react';
import type { SyncStatus } from './desktop-api';

/**
 * Top-of-screen banner that reflects the paired terminal's connection
 * state + pending outbox size. Subscribes once to sync:status-changed
 * and uses that for all updates.
 */
export function SyncBanner(): JSX.Element | null {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    void window.desktop.sync.status().then(setStatus);
    const off = window.desktop.sync.onStatusChanged((s) => setStatus(s));
    return off;
  }, []);

  if (!status) return null;
  // Suppress before the first probe resolves (initial pairing flow, etc.)
  if (status.rawStatus === 'unknown') return null;
  if (status.online && status.pending === 0 && status.failed === 0) return null;

  const offline = !status.online;
  const bg = offline ? '#7A2A2A' : status.failed > 0 ? '#7A5A2A' : '#1F4A2A';
  const label = offline
    ? `OFFLINE — ${status.pending} queued`
    : status.failed > 0
      ? `SYNC ISSUES — ${status.failed} failed, ${status.pending} pending`
      : `SYNCING — ${status.pending} pending`;

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: bg,
        color: '#fff',
        fontSize: 11,
        letterSpacing: 3,
        textTransform: 'uppercase',
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 500,
      }}
    >
      <span>{label}</span>
    </div>
  );
}
