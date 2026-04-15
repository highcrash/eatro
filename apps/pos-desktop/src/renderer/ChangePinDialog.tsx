import React, { useState } from 'react';

interface Props {
  staffId: string;
  cashierName: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Dialog that lets the currently signed-in cashier change their own PIN on
 * this terminal. Verifies the old PIN against the local bcrypt hash before
 * writing the new one — never round-trips through the server.
 */
export function ChangePinDialog({ staffId, cashierName, onClose, onDone }: Props): JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!/^\d{4,6}$/.test(current)) { setError('Current PIN must be 4–6 digits'); return; }
    if (!/^\d{4,6}$/.test(next))    { setError('New PIN must be 4–6 digits'); return; }
    if (next !== confirm)           { setError('PINs do not match'); return; }
    if (next === current)           { setError('New PIN is the same as the old one'); return; }

    setBusy(true);
    try {
      const res = await window.desktop.cashier.changePin({ staffId, currentPin: current, newPin: next });
      if (res.ok) onDone();
      else setError(res.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <p style={kicker}>Terminal</p>
        <h2 style={title}>CHANGE PIN</h2>
        <p style={sub}>For <span style={{ color: '#fff' }}>{cashierName}</span> on this terminal.</p>

        <Input label="Current PIN" value={current} onChange={setCurrent} autoFocus />
        <Input label="New PIN (4–6 digits)" value={next} onChange={setNext} />
        <Input label="Confirm new PIN" value={confirm} onChange={setConfirm} />

        {error && <p style={errorText}>{error}</p>}

        <div style={actions}>
          <button onClick={onClose} disabled={busy} style={btnSecondary}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy} style={btnPrimary}>
            {busy ? 'Saving…' : 'Change PIN'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }): JSX.Element {
  return (
    <label style={fieldLabel}>
      {label}
      <input
        type="password"
        inputMode="numeric"
        pattern="\\d*"
        maxLength={6}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        style={input}
      />
    </label>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 60, fontFamily: 'system-ui, sans-serif',
};
const box: React.CSSProperties = {
  background: '#161616', border: '1px solid #2A2A2A',
  padding: 28, width: '100%', maxWidth: 380,
  color: '#fff', display: 'flex', flexDirection: 'column', gap: 12,
};
const kicker: React.CSSProperties = { color: '#D62B2B', fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', margin: 0 };
const title: React.CSSProperties = { fontSize: 24, letterSpacing: 3, margin: '4px 0 6px' };
const sub: React.CSSProperties = { color: '#999', fontSize: 13, margin: '0 0 10px' };
const fieldLabel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#666',
};
const input: React.CSSProperties = {
  background: '#0D0D0D', border: '1px solid #2A2A2A', color: '#fff',
  padding: '10px 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit',
  letterSpacing: 6,
};
const actions: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 12 };
const btnSecondary: React.CSSProperties = {
  flex: 1, background: 'transparent', border: '1px solid #2A2A2A', color: '#999',
  padding: 12, fontSize: 11, letterSpacing: 3, textTransform: 'uppercase',
  cursor: 'pointer', fontFamily: 'inherit',
};
const btnPrimary: React.CSSProperties = {
  flex: 1, background: '#D62B2B', border: 'none', color: '#fff',
  padding: 12, fontSize: 11, letterSpacing: 3, textTransform: 'uppercase',
  cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
};
const errorText: React.CSSProperties = { color: '#F03535', fontSize: 12, margin: 0 };
