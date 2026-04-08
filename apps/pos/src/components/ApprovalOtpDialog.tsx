import { useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';

interface Props {
  /** The action key (matches CashierAction in @restora/types). */
  action: string;
  /** Short summary of what's being approved (e.g. "Pay Supplier ৳5,000"). */
  summary: string;
  onClose: () => void;
  /** Called once OTP has been verified. The OTP string is consumable once. */
  onApproved: (otp: string) => void;
}

export default function ApprovalOtpDialog({ action, summary, onClose, onApproved }: Props) {
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [managerName, setManagerName] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const requestOtp = async () => {
    setSending(true);
    setError('');
    try {
      const res = await api.post<{ sent: boolean; otp?: string; managerName?: string }>(
        '/approval-otp/request',
        { action, summary },
      );
      setOtpSent(true);
      setManagerName(res.managerName ?? 'Manager');
      if (res.otp) setDevOtp(res.otp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send OTP');
    } finally {
      setSending(false);
    }
  };

  const verifyAndApprove = () => {
    if (otp.length !== 6) return;
    setError('');
    // Don't pre-verify — the OTP is single-use server-side. The caller will
    // pass it as `actionOtp` in their mutation, and the backend verifies it
    // during the permission check (consumes it once at that point).
    onApproved(otp);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-[420px] overflow-hidden">
        <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-theme-accent">Manager Approval</p>
            <h3 className="text-lg font-bold text-theme-text mt-0.5">{summary}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={16} />
          </button>
        </header>

        <div className="p-6 space-y-3">
          {!otpSent ? (
            <>
              <p className="text-xs text-theme-text-muted">
                A 6-digit OTP will be sent to a manager via SMS. Ask them to share it to continue.
              </p>
              <button
                onClick={() => void requestOtp()}
                disabled={sending}
                className="w-full bg-theme-text text-white py-3 rounded-theme text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {sending ? 'Sending OTP…' : 'Send OTP to Manager'}
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-theme-text-muted">
                OTP sent to <span className="font-bold text-theme-text">{managerName}</span>
                {devOtp && <span className="text-theme-danger ml-2">(Dev: {devOtp})</span>}
              </p>
              <label className="block text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">
                Enter 6-digit OTP
              </label>
              <input
                type="text"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full bg-theme-bg border border-theme-border rounded-theme px-4 py-3 text-2xl font-bold font-mono tracking-[0.5em] text-center text-theme-text outline-none focus:border-theme-accent"
                autoFocus
              />
              <button
                onClick={() => { setOtpSent(false); setOtp(''); setDevOtp(''); }}
                className="text-xs text-theme-text-muted hover:text-theme-accent"
              >
                Resend OTP
              </button>
            </>
          )}

          {error && <p className="text-xs text-theme-danger">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-theme-border flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-theme-bg text-theme-text font-semibold py-3 rounded-theme hover:bg-theme-surface-alt transition-colors"
          >
            Cancel
          </button>
          {otpSent && (
            <button
              onClick={verifyAndApprove}
              disabled={otp.length !== 6}
              className="flex-1 bg-theme-pop hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40"
            >
              Verify &amp; Continue
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
