import React, { useState } from 'react';

/**
 * Hard lock shown when the server tells us this terminal has been revoked.
 * Occupies the whole window and blocks every other UI path until the
 * owner unpairs (after which First-Run Setup runs again on next launch).
 *
 * Requires an owner password before unpair to stop a passing cashier from
 * wiping the terminal.
 */

interface Props {
  branchName: string;
  deviceName: string;
  onUnpaired: () => void;
}

export function RevokedScreen({ branchName, deviceName, onUnpaired }: Props): JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <p style={styles.kicker}>Access revoked</p>
        <h1 style={styles.title}>TERMINAL REVOKED</h1>
        <p style={styles.sub}>{branchName} · {deviceName}</p>
        <p style={styles.body}>
          This terminal has been deactivated by an owner. The device token is
          no longer accepted by the server, so no new sessions can be signed
          in here.
        </p>
        <p style={styles.body}>
          To put it back in service, unpair it now and run first-run setup
          again with a fresh registration. The owner password is required to
          unpair.
        </p>
        <button onClick={() => setConfirmOpen(true)} style={styles.btnPrimary}>
          Unpair this terminal
        </button>
      </div>

      {confirmOpen && (
        <OwnerConfirm
          onCancel={() => setConfirmOpen(false)}
          onConfirmed={async () => {
            await window.desktop.device.unpair();
            onUnpaired();
          }}
        />
      )}
    </div>
  );
}

/**
 * Minimal owner-password gate. Calls /auth/verify-self via the regular POS
 * API path (which goes through api-proxy and survives offline). Avoids
 * pulling in the OwnerPasswordDialog component from apps/pos because this
 * screen has to render before the full React tree mounts.
 */
function OwnerConfirm({
  onCancel, onConfirmed,
}: { onCancel: () => void; onConfirmed: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await window.desktop.api.fetch({
        method: 'POST',
        path: '/auth/login',
        body: { email, password },
      });
      if (!res.ok) {
        setError('Wrong email or password');
        return;
      }
      const body = res.body as { user?: { role?: string } };
      if (body?.user?.role !== 'OWNER') {
        setError('Only an owner can unpair');
        return;
      }
      await onConfirmed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.dialog}>
        <p style={styles.kicker}>Confirm unpair</p>
        <h2 style={styles.dialogTitle}>OWNER PASSWORD REQUIRED</h2>
        <label style={styles.label}>
          Owner email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />
        </label>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.dialogActions}>
          <button onClick={onCancel} style={styles.btnSecondary}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !email || !password} style={styles.btnDanger}>
            {busy ? 'Checking…' : 'Unpair'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0D0D0D',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    padding: 24,
  },
  card: {
    maxWidth: 520,
    background: '#161616',
    border: '1px solid #2A2A2A',
    padding: 32,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    textAlign: 'center',
  },
  kicker: { color: '#D62B2B', fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', margin: 0 },
  title: { fontSize: 28, letterSpacing: 4, margin: '4px 0 8px' },
  sub: { color: '#666', fontSize: 11, margin: '0 0 12px', letterSpacing: 2, textTransform: 'uppercase' },
  body: { color: '#ccc', fontSize: 13, lineHeight: 1.6, margin: '0 0 8px' },
  btnPrimary: {
    background: '#D62B2B',
    color: '#fff',
    border: 'none',
    padding: '12px 20px',
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: 12,
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    width: 420,
    background: '#161616',
    border: '1px solid #2A2A2A',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  dialogTitle: { fontSize: 18, letterSpacing: 3, margin: '4px 0 16px' },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#888',
  },
  input: {
    background: '#0D0D0D',
    border: '1px solid #2A2A2A',
    color: '#fff',
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
  },
  error: { color: '#F03535', fontSize: 12, margin: 0 },
  dialogActions: { display: 'flex', gap: 8, marginTop: 8 },
  btnSecondary: {
    flex: 1,
    background: 'transparent',
    border: '1px solid #2A2A2A',
    color: '#999',
    padding: 10,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnDanger: {
    flex: 1,
    background: '#D62B2B',
    color: '#fff',
    border: 'none',
    padding: 10,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 600,
  },
};
