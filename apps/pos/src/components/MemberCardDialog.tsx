import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

import type { MembershipMemberInfo, Order } from '@restora/types';

import { api } from '../lib/api';

interface Props {
  orderId: string;
  onClose: () => void;
  onApplied: (order: Order) => void;
}

const groupDigits = (raw: string) => raw.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
/** Server errors read "CARD_EXPIRED: this card expired…"; show the sentence. */
const friendly = (message: string) => message.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase());
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Type or scan a membership card (a USB scanner types the digits and
 * presses Enter). A card still in stock opens the hand-over form first;
 * the applied card's member is shown so the cashier can check it's theirs.
 */
export default function MemberCardDialog({ orderId, onClose, onApplied }: Props) {
  const [number, setNumber] = useState('');
  const [needsHandOver, setNeedsHandOver] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [member, setMember] = useState<MembershipMemberInfo | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => { numberRef.current?.focus(); }, []);
  useEffect(() => { if (needsHandOver) phoneRef.current?.focus(); }, [needsHandOver]);

  const digits = number.replace(/\s/g, '');

  const apply = async () => {
    const res = await api.post<{ order: Order; member: MembershipMemberInfo }>(`/orders/${orderId}/apply-membership`, { number: digits });
    onApplied(res.order);
    setMember(res.member);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      const message = (err as Error).message;
      if (message.startsWith('CARD_NOT_ACTIVE')) setNeedsHandOver(true);
      else setError(friendly(message));
    } finally {
      setBusy(false);
    }
  };

  const submitNumber = () => {
    if (digits.length === 16 && !busy) void run(apply);
  };
  const submitHandOver = () => {
    if (!phone.trim() || busy) return;
    void run(async () => {
      await api.post('/membership/cards/activate', { number: digits, phone: phone.trim(), name: name.trim() || undefined });
      await apply();
      setNeedsHandOver(false);
    });
  };

  const inputClass = 'w-full bg-theme-bg border border-theme-border rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none focus:border-theme-accent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">Member Card</p>
          <button onClick={onClose} className="w-7 h-7 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={14} />
          </button>
        </header>

        {member ? (
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-theme-pop">
              <CheckCircle2 size={18} />
              <p className="text-sm font-bold">{member.planName} applied</p>
            </div>
            <div className="bg-theme-bg rounded-theme p-3 space-y-1">
              <p className="text-base font-bold text-theme-text">{member.name}</p>
              <p className="text-xs text-theme-text-muted">{member.maskedPhone} · Card {member.maskedNumber}</p>
              <p className="text-xs text-theme-text-muted">Valid until {dayLabel(member.expiresAt)}</p>
            </div>
            <p className="text-[11px] text-theme-text-muted">Please check this is the guest's own card.</p>
            <button onClick={onClose} className="w-full bg-theme-accent text-white font-bold py-2.5 rounded-theme text-sm hover:opacity-90">Done</button>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            <input
              ref={numberRef}
              value={number}
              onChange={(e) => { setNumber(groupDigits(e.target.value)); setNeedsHandOver(false); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNumber(); } }}
              inputMode="numeric"
              placeholder="3287 0000 0000 0000"
              disabled={needsHandOver && busy}
              className={`${inputClass} font-mono text-center tracking-wider text-base`}
            />

            {needsHandOver ? (
              <>
                <div className="bg-theme-bg rounded-theme p-3">
                  <p className="text-sm font-bold text-theme-text">New card: give it to this guest</p>
                  <p className="text-[11px] text-theme-text-muted mt-0.5">It stays linked to their phone number and is valid from today.</p>
                </div>
                <input
                  ref={phoneRef}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitHandOver(); } }}
                  inputMode="tel"
                  placeholder="Customer phone *"
                  className={inputClass}
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitHandOver(); } }}
                  placeholder="Customer name"
                  className={inputClass}
                />
                <button
                  onClick={submitHandOver}
                  disabled={!phone.trim() || busy}
                  className="w-full bg-theme-accent text-white font-bold py-2.5 rounded-theme text-sm hover:opacity-90 disabled:opacity-40"
                >
                  {busy ? 'Saving…' : 'Give card & apply discount'}
                </button>
              </>
            ) : (
              <button
                onClick={submitNumber}
                disabled={digits.length !== 16 || busy}
                className="w-full bg-theme-accent text-white font-bold py-2.5 rounded-theme text-sm hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Checking…' : 'Apply'}
              </button>
            )}
            {error && <p className="text-xs text-theme-danger text-center">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
