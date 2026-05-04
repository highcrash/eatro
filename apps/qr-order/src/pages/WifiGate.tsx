import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/session.store';
import { apiUrl } from '../lib/api';

interface GatePayload {
  allowed: boolean;
  /** New: structured reason — undefined on older API versions, in
   *  which case we fall back to the legacy "Wi-Fi only" page. */
  reason?: 'OK' | 'DISABLED' | 'OUTSIDE_HOURS' | 'WIFI_BLOCKED';
  gateEnabled: boolean;
  /** Surfaced for the OUTSIDE_HOURS message ("open 10:00 – 22:00"). */
  windowStart?: string | null;
  windowEnd?: string | null;
  branchName: string;
  wifiSsid: string | null;
  wifiPass: string | null;
  message: string | null;
  clientIp: string | null;
}

/**
 * Gate-blocked page. Three failure modes:
 *   - DISABLED → "We are not accepting QR orders right now, please
 *     ask staff for assistance." Master kill switch path.
 *   - OUTSIDE_HOURS → "Sorry, we are not accepting orders right now"
 *     plus the configured open window.
 *   - WIFI_BLOCKED (default / legacy) → the original "connect to
 *     our Wi-Fi" page with SSID + password.
 *
 * Polls /public/qr-gate every 5 s so the page disappears automatically
 * once admin re-enables, the window opens, or the guest joins the
 * right Wi-Fi.
 */
export default function WifiGate({ payload, onAllowed }: { payload: GatePayload; onAllowed: () => void }) {
  const branchId = useSessionStore((s) => s.branchId);
  const [current, setCurrent] = useState<GatePayload>(payload);

  useEffect(() => {
    if (!branchId) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(apiUrl(`/public/qr-gate/${branchId}`));
        if (!r.ok) return;
        const next = (await r.json()) as GatePayload;
        if (next?.allowed) {
          onAllowed();
        } else {
          setCurrent(next);
        }
      } catch {
        // stay on the page until the next tick
      }
    }, 5000);
    return () => clearInterval(id);
  }, [branchId, onAllowed]);

  // Default reason for legacy API responses without the field — the
  // original Wi-Fi gate is the only failure mode older servers know.
  const reason = current.reason ?? 'WIFI_BLOCKED';

  if (reason === 'DISABLED') {
    return (
      <GateShell branchName={current.branchName} icon="pause">
        <h1 className="font-display text-2xl tracking-wide text-theme-text">QR Ordering Paused</h1>
        <p className="mt-2 text-sm text-theme-text-muted">
          We are not accepting QR orders right now. Please ask our staff for assistance and we'll take your order at the table.
        </p>
        {current.message && (
          <div className="mt-4 border-l-2 border-theme-accent pl-3 text-left">
            <p className="text-sm text-theme-text-muted whitespace-pre-wrap">{current.message}</p>
          </div>
        )}
        <p className="mt-5 text-[10px] text-theme-text-muted">Checking every 5s</p>
      </GateShell>
    );
  }

  if (reason === 'OUTSIDE_HOURS') {
    const hasWindow = !!(current.windowStart && current.windowEnd);
    return (
      <GateShell branchName={current.branchName} icon="clock">
        <h1 className="font-display text-2xl tracking-wide text-theme-text">Sorry, we're closed for QR orders</h1>
        <p className="mt-2 text-sm text-theme-text-muted">
          {hasWindow ? (
            <>
              QR ordering at <span className="font-semibold text-theme-text">{current.branchName}</span> is open{' '}
              <span className="font-mono font-semibold text-theme-text">{current.windowStart}</span>
              {' – '}
              <span className="font-mono font-semibold text-theme-text">{current.windowEnd}</span>{' '}
              every day.
            </>
          ) : (
            'We are not accepting QR orders right now. Please come back later or ask our staff for assistance.'
          )}
        </p>
        {current.message && (
          <div className="mt-4 border-l-2 border-theme-accent pl-3 text-left">
            <p className="text-sm text-theme-text-muted whitespace-pre-wrap">{current.message}</p>
          </div>
        )}
        <p className="mt-5 text-[10px] text-theme-text-muted">This page will refresh when ordering opens.</p>
      </GateShell>
    );
  }

  // Default: WIFI_BLOCKED — original page.
  return (
    <GateShell branchName={current.branchName} icon="wifi">
      <h1 className="font-display text-2xl tracking-wide text-theme-text">Please Connect to Our Wi-Fi</h1>
      <p className="mt-2 text-sm text-theme-text-muted">
        QR ordering at <span className="font-semibold text-theme-text">{current.branchName}</span> is restricted to
        our in-restaurant network. Connect to the Wi-Fi below and this page will continue automatically.
      </p>
      {(current.wifiSsid || current.wifiPass) && (
        <div className="mt-4 bg-theme-bg rounded-theme p-4 space-y-3 text-left">
          {current.wifiSsid && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Network (SSID)</p>
              <p className="text-base font-mono font-semibold text-theme-text break-all">{current.wifiSsid}</p>
            </div>
          )}
          {current.wifiPass && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Password</p>
              <p className="text-base font-mono font-semibold text-theme-text break-all">{current.wifiPass}</p>
            </div>
          )}
        </div>
      )}
      {current.message && (
        <div className="mt-4 border-l-2 border-theme-accent pl-3 text-left">
          <p className="text-sm text-theme-text-muted whitespace-pre-wrap">{current.message}</p>
        </div>
      )}
      {!current.wifiSsid && !current.wifiPass && !current.message && (
        <p className="mt-4 text-sm text-theme-text-muted">Ask our staff for the Wi-Fi password.</p>
      )}
      <p className="mt-5 text-[10px] text-theme-text-muted">
        Checking every 5s{current.clientIp ? ` · your IP ${current.clientIp} isn't on our allowlist` : ''}
      </p>
    </GateShell>
  );
}

function GateShell({ branchName: _branchName, icon, children }: { branchName: string; icon: 'wifi' | 'pause' | 'clock'; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-theme-bg text-theme-text flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-theme-surface border border-theme-border rounded-theme p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-theme-accent/10 flex items-center justify-center">
          {icon === 'wifi' && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-theme-accent">
              <path d="M5 12.55a11 11 0 0 1 14.08 0" />
              <path d="M1.42 9a16 16 0 0 1 21.16 0" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
          )}
          {icon === 'pause' && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-theme-accent">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          )}
          {icon === 'clock' && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-theme-accent">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export type { GatePayload };
