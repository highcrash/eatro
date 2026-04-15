import React, { useState } from 'react';

interface Props {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * Modal asking for an OWNER's email + password before a sensitive action
 * (Unpair terminal, etc.). Validates via POST /auth/verify on the paired
 * server. Rejects non-OWNER credentials.
 */
export function OwnerPasswordDialog({ title, description, confirmLabel, danger, onClose, onConfirm }: Props): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verifyAndRun() {
    setError(null);
    if (!email || !password) { setError('Email and password are required'); return; }
    setBusy(true);
    try {
      const res = await window.desktop.api.fetch({
        method: 'POST',
        path: '/auth/verify',
        body: { email: email.trim(), password },
      });
      if (!res.ok) {
        const body = res.body as { message?: string } | null;
        setError(body?.message ?? 'Invalid credentials');
        return;
      }
      const body = res.body as { role: string } | null;
      if (body?.role !== 'OWNER') {
        setError('This action requires the OWNER password.');
        return;
      }
      await onConfirm();
    } catch (err) {
      setError((err as Error).message || 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <p style={kicker}>Owner only</p>
        <h2 style={titleStyle}>{title}</h2>
        <p style={sub}>{description}</p>

        <label style={fieldLabel}>
          Owner email
          <input
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={input}
          />
        </label>
        <label style={fieldLabel}>
          Owner password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={input}
          />
        </label>

        {error && <p style={errorText}>{error}</p>}

        <div style={actions}>
          <button onClick={onClose} disabled={busy} style={btnSecondary}>Cancel</button>
          <button
            onClick={() => void verifyAndRun()}
            disabled={busy}
            style={{ ...btnPrimary, ...(danger ? btnDanger : {}) }}
          >
            {busy ? 'Verifying…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 60, fontFamily: 'system-ui, sans-serif',
};
const box: React.CSSProperties = {
  background: '#161616', border: '1px solid #2A2A2A',
  padding: 28, width: '100%', maxWidth: 400,
  color: '#fff', display: 'flex', flexDirection: 'column', gap: 12,
};
const kicker: React.CSSProperties = { color: '#D62B2B', fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', margin: 0 };
const titleStyle: React.CSSProperties = { fontSize: 22, letterSpacing: 3, margin: '4px 0 4px' };
const sub: React.CSSProperties = { color: '#999', fontSize: 13, margin: '0 0 10px', lineHeight: 1.5 };
const fieldLabel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#666',
};
const input: React.CSSProperties = {
  background: '#0D0D0D', border: '1px solid #2A2A2A', color: '#fff',
  padding: '10px 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit',
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
const btnDanger: React.CSSProperties = { background: '#7A2A2A' };
const errorText: React.CSSProperties = { color: '#F03535', fontSize: 12, margin: 0 };
