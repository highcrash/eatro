import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/session.store';
import { apiUrl } from '../lib/api';

interface GatePayload {
  allowed: boolean;
  gateEnabled: boolean;
  branchName: string;
  wifiSsid: string | null;
  wifiPass: string | null;
  message: string | null;
  clientIp: string | null;
}

/**
 * "Please connect to our Wi-Fi" page. Shown when the /public/qr-gate
 * check returns allowed=false for the current client IP. Polls the
 * gate endpoint every 5 seconds so the page disappears automatically
 * once the guest joins the right network.
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

  return (
    <div className="min-h-screen bg-theme-bg text-theme-text flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-theme-surface border border-theme-border rounded-theme p-8 space-y-5">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-theme-accent/10 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-theme-accent">
              <path d="M5 12.55a11 11 0 0 1 14.08 0" />
              <path d="M1.42 9a16 16 0 0 1 21.16 0" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
          </div>
          <h1 className="font-display text-2xl tracking-wide text-theme-text">Please Connect to Our Wi-Fi</h1>
          <p className="mt-2 text-sm text-theme-text-muted">
            QR ordering at <span className="font-semibold text-theme-text">{current.branchName}</span> is restricted to
            our in-restaurant network. Connect to the Wi-Fi below and this page will continue automatically.
          </p>
        </div>

        {(current.wifiSsid || current.wifiPass) && (
          <div className="bg-theme-bg rounded-theme p-4 space-y-3">
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
          <div className="border-l-2 border-theme-accent pl-3">
            <p className="text-sm text-theme-text-muted whitespace-pre-wrap">{current.message}</p>
          </div>
        )}

        {!current.wifiSsid && !current.wifiPass && !current.message && (
          <p className="text-sm text-center text-theme-text-muted">
            Ask our staff for the Wi-Fi password.
          </p>
        )}

        <p className="text-[10px] text-center text-theme-text-muted">
          Checking every 5s{current.clientIp ? ` · your IP ${current.clientIp} isn't on our allowlist` : ''}
        </p>
      </div>
    </div>
  );
}

export type { GatePayload };
