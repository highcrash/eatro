import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { api } from '../lib/api';

/**
 * License activation + status UI.
 *
 * Talks to /api/v1/license/{status,activate,deactivate} — all
 * `@Public()` on the server so they work even when the gate is
 * locked. An operator can always reach this page regardless of
 * license state; that's the point (they need it to RECOVER a
 * locked install).
 *
 * Four states the UI has to distinguish:
 *   - missing  → show the activate form
 *   - active   → show ACTIVE badge + details + deactivate
 *   - grace    → show WARNING banner with days remaining +
 *                "verify now" button + deactivate
 *   - locked   → show LOCKED banner (REVOKED/EXPIRED) +
 *                re-activate form
 */

type Mode = 'active' | 'grace' | 'locked' | 'missing';

interface Status {
  mode: Mode;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PENDING' | null;
  daysRemaining: number;
  domain: string | null;
  reason: string;
}

// The admin /api/v1 prefix is the license API's route. The license
// gate sits outside the versioned routes at /api/v1/license/* so
// regular api.ts works for it. Using api.ts directly.
const fetchStatus = () => api.get<Status>('/license/status');
const activate = (p: { purchaseCode: string; domain: string }) =>
  api.post<{ mode: Mode; status: string | null; domain: string | null; daysRemaining: number }>(
    '/license/activate',
    p,
  );
const deactivate = () => api.post<{ ok: true }>('/license/deactivate', {});

export default function LicensePage() {
  const qc = useQueryClient();
  const { data: status, isLoading, refetch } = useQuery<Status>({
    queryKey: ['license', 'status'],
    queryFn: fetchStatus,
    refetchInterval: 60_000,
  });

  const [purchaseCode, setPurchaseCode] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Prefill the domain field with the current hostname — most buyers
  // activate against the exact domain they visited this page from.
  useEffect(() => {
    if (!domain && typeof window !== 'undefined') {
      setDomain(window.location.hostname);
    }
  }, [domain]);

  const activateMutation = useMutation({
    mutationFn: activate,
    onSuccess: () => {
      setError(null);
      setPurchaseCode('');
      void qc.invalidateQueries({ queryKey: ['license'] });
    },
    onError: (err: Error & { body?: { message?: string; result?: string } }) => {
      setError(err.body?.message ?? err.message ?? 'Activation failed');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivate,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['license'] }),
  });

  if (isLoading) {
    return <div className="p-8 text-[#999]">Loading license status…</div>;
  }

  const mode = status?.mode ?? 'missing';

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <KeyRound className="w-6 h-6 text-[#D62B2B]" />
        <h1 className="text-2xl font-display text-white tracking-wider">LICENSE</h1>
      </div>

      <StatusCard status={status} />

      {(mode === 'missing' || mode === 'locked') && (
        <ActivateForm
          purchaseCode={purchaseCode}
          onPurchaseCodeChange={setPurchaseCode}
          domain={domain}
          onDomainChange={setDomain}
          error={error}
          busy={activateMutation.isPending}
          onSubmit={() => activateMutation.mutate({ purchaseCode: purchaseCode.trim(), domain: domain.trim() })}
        />
      )}

      {(mode === 'active' || mode === 'grace') && (
        <div className="mt-6 bg-[#141414] border border-[#2A2A2A] p-5">
          <h3 className="text-sm text-white font-display tracking-wider mb-3">MANAGE</h3>
          <div className="flex gap-3">
            <button
              onClick={() => void refetch()}
              className="px-4 py-2 bg-[#222] text-white border border-[#333] text-sm hover:border-[#555]"
              type="button"
            >
              Re-verify now
            </button>
            <button
              onClick={() => {
                if (confirm('Deactivate this install? You will need to re-enter the purchase code to use it again.')) {
                  deactivateMutation.mutate();
                }
              }}
              disabled={deactivateMutation.isPending}
              className="px-4 py-2 bg-[#D62B2B] text-white text-sm hover:bg-[#B02020] disabled:opacity-50"
              type="button"
            >
              {deactivateMutation.isPending ? 'Deactivating…' : 'Deactivate'}
            </button>
          </div>
          <p className="text-xs text-[#666] mt-3 leading-relaxed">
            Deactivating releases the license seat on the server so you can reuse the same purchase code on a
            different domain or machine. The install's reads remain functional; mutations are blocked until you
            re-activate.
          </p>
        </div>
      )}

      <HelpCard />
    </div>
  );
}

function StatusCard({ status }: { status: Status | undefined }) {
  if (!status) return null;
  const { mode, daysRemaining, domain, reason } = status;

  const variant = {
    active:  { Icon: CheckCircle2, bg: '#0f2a1f', border: '#1c5b3c', text: '#34d399', label: 'ACTIVE' },
    grace:   { Icon: AlertTriangle, bg: '#2e2514', border: '#7a5a1e', text: '#fbbf24', label: 'GRACE PERIOD' },
    locked:  { Icon: XCircle, bg: '#2a1416', border: '#7a2128', text: '#f87171', label: 'LOCKED' },
    missing: { Icon: KeyRound, bg: '#1a1a1a', border: '#333', text: '#999', label: 'NOT ACTIVATED' },
  }[mode];
  const { Icon } = variant;

  return (
    <div
      className="p-5 border flex items-start gap-4"
      style={{ background: variant.bg, borderColor: variant.border }}
    >
      <Icon className="w-8 h-8 shrink-0 mt-1" style={{ color: variant.text }} />
      <div className="flex-1">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="font-display text-lg tracking-wider" style={{ color: variant.text }}>
            {variant.label}
          </span>
          {mode === 'grace' && (
            <span className="text-xs text-[#999]">{daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining</span>
          )}
        </div>
        <p className="text-sm text-[#ccc]">{reason}</p>
        {domain && (
          <p className="text-xs text-[#888] mt-2">
            Activated for domain: <span className="font-mono text-[#aaa]">{domain}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function ActivateForm(props: {
  purchaseCode: string;
  onPurchaseCodeChange: (v: string) => void;
  domain: string;
  onDomainChange: (v: string) => void;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
}) {
  const { purchaseCode, onPurchaseCodeChange, domain, onDomainChange, error, busy, onSubmit } = props;
  const disabled = busy || purchaseCode.length < 8 || domain.length < 3;
  return (
    <div className="mt-6 bg-[#141414] border border-[#2A2A2A] p-5">
      <h3 className="text-sm text-white font-display tracking-wider mb-4">ACTIVATE LICENSE</h3>
      {error && (
        <div className="mb-4 p-3 bg-[#2a1416] border border-[#7a2128] text-sm text-[#f87171]">{error}</div>
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="space-y-4"
      >
        <label className="block">
          <span className="text-xs text-[#999] uppercase tracking-wider">Purchase Code</span>
          <input
            type="text"
            value={purchaseCode}
            onChange={(e) => onPurchaseCodeChange(e.target.value)}
            placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
            className="mt-1 w-full bg-[#0a0a0a] border border-[#333] text-white px-3 py-2 font-mono text-sm focus:outline-none focus:border-[#666]"
          />
          <span className="text-xs text-[#666] mt-1 block">
            From your CodeCanyon purchase email (36-char format).
          </span>
        </label>
        <label className="block">
          <span className="text-xs text-[#999] uppercase tracking-wider">Domain</span>
          <input
            type="text"
            value={domain}
            onChange={(e) => onDomainChange(e.target.value)}
            placeholder="yourdomain.com"
            className="mt-1 w-full bg-[#0a0a0a] border border-[#333] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#666]"
          />
          <span className="text-xs text-[#666] mt-1 block">
            The hostname you want to bind this license to. Wildcards like <span className="font-mono">*.yourdomain.com</span> are supported if your license type allows them.
          </span>
        </label>
        <button
          type="submit"
          disabled={disabled}
          className="px-5 py-2.5 bg-[#D62B2B] text-white font-display tracking-wider text-sm hover:bg-[#B02020] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'ACTIVATING…' : 'ACTIVATE'}
        </button>
      </form>
    </div>
  );
}

function HelpCard() {
  return (
    <div className="mt-8 bg-[#0d0d0d] border border-[#222] p-5 text-xs text-[#888] leading-relaxed">
      <h4 className="text-white font-display tracking-wider text-sm mb-2">HOW IT WORKS</h4>
      <ul className="space-y-1.5 list-disc pl-4">
        <li>
          Activation contacts the license server once. After that, your install verifies automatically every
          24 hours.
        </li>
        <li>
          If your server can't reach the license server, your install keeps working for up to 7 days (grace
          period). After that, reads still work but new orders are blocked until you reconnect.
        </li>
        <li>
          Only your purchase code, domain, and an opaque machine fingerprint are sent. No menu / order /
          customer data ever leaves your server.
        </li>
        <li>
          Moving to a new domain? Click <strong>Deactivate</strong> first, then re-activate on the new install.
        </li>
      </ul>
    </div>
  );
}
